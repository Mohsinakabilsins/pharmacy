import { statSync, writeFileSync } from 'node:fs';
import type { MainEventName, MainEvents } from '@shared/contract';
import type { SettingsSection } from '@shared/settings';
import type { BootstrapInfo } from '@shared/types/auth';
import type { PrinterInfo, PrintResult } from '@shared/types/system';
import { can, get, requirePermission, requireUser, type ServiceContext } from '../core/context';
import { AppError } from '../core/errors';
import { overrides } from '../core/overrides';
import type { HandlerMap } from '../core/router';
import type { SessionManager } from '../core/session';
import { audit } from '../core/audit';
import { getSettings, updateSettingsSection } from '../core/settings';
import { DEFAULT_ADMIN } from '../db/bootstrap';
import { verifyPassword } from '../modules/auth/password';
import * as auth from '../modules/auth/auth.service';
import * as users from '../modules/auth/users.service';
import * as catalog from '../modules/catalog/catalog.service';
import * as inventory from '../modules/inventory/inventory.service';
import * as suppliers from '../modules/purchasing/suppliers.service';
import * as purchases from '../modules/purchasing/purchases.service';
import * as customers from '../modules/customers/customers.service';
import * as sales from '../modules/sales/sales.service';
import * as returns from '../modules/sales/returns.service';
import * as expenses from '../modules/finance/expenses.service';
import * as payments from '../modules/finance/payments.service';
import * as cash from '../modules/finance/cash.service';
import * as reports from '../modules/reports/reports.service';
import { dashboard } from '../modules/dashboard/dashboard.service';
import { auditActions, listAudit } from '../modules/audit/audit.service';
import * as backup from '../modules/backup/backup.service';
import * as templates from '../printing/templates';
import { reportToCsv, reportToXlsx } from '../printing/exporter';
import type { PaperKind } from '../printing/printer';

export interface MainEnv {
  sessions: SessionManager;
  version: string;
  productName: string;
  packaged: boolean;
  dataDir: string;
  dbPath: () => string;
  migrationCount: () => number;
  defaultBackupDir: string;
  versions: { electron: string; node: string; sqlite: string };
  dialogs: {
    chooseDirectory: (title: string, defaultPath?: string) => Promise<string | null>;
    pickBackupFile: (defaultPath?: string) => Promise<string | null>;
    saveFile: (defaultName: string, filters: Array<{ name: string; extensions: string[] }>) => Promise<string | null>;
  };
  showItemInFolder: (path: string) => void;
  printers: () => Promise<PrinterInfo[]>;
  print: (html: string, opts: { paper: PaperKind; deviceName?: string; silent?: boolean; copies?: number }) => Promise<boolean>;
  pdf: (html: string, opts: { paper: PaperKind }) => Promise<Buffer>;
  restore: (ctx: ServiceContext, filePath: string) => Promise<void>;
  emit: <E extends MainEventName>(event: E, payload: MainEvents[E]) => void;
  loadDemo: (ctx: ServiceContext) => { loaded: boolean; message: string };
}

function activeSession(env: MainEnv) {
  const s = env.sessions.get();
  if (!s) throw new AppError('UNAUTHENTICATED', 'Please sign in');
  return s;
}

async function deliver(
  env: MainEnv,
  ctx: ServiceContext,
  html: string,
  mode: 'preview' | 'print' | 'pdf',
  paper: PaperKind,
  fileName: string,
  printerKind: 'receipt' | 'a4' | 'label',
): Promise<PrintResult> {
  const previewPaper: PrintResult['paper'] = paper === '58mm' || paper === '80mm' ? paper : paper === 'label' ? 'label' : 'A4';
  if (mode === 'preview') return { html, paper: previewPaper };
  if (mode === 'pdf') {
    const target = await env.dialogs.saveFile(fileName, [{ name: 'PDF document', extensions: ['pdf'] }]);
    if (!target) return { filePath: null, paper: previewPaper };
    writeFileSync(target, await env.pdf(html, { paper }));
    return { filePath: target, paper: previewPaper };
  }
  const ps = getSettings(ctx).printer;
  const device = printerKind === 'receipt' ? ps.receiptPrinter : printerKind === 'label' ? ps.labelPrinter : ps.a4Printer;
  const printed = await env.print(html, { paper, deviceName: device || undefined, silent: ps.silentPrint && !!device, copies: 1 });
  return { printed, paper: previewPaper };
}

function bootstrapInfo(env: MainEnv, ctx: ServiceContext): BootstrapInfo {
  const s = getSettings(ctx);
  const admin = get<{ password_hash: string; is_active: number }>(ctx, 'SELECT password_hash, is_active FROM users WHERE username = ? COLLATE NOCASE', DEFAULT_ADMIN.username);
  const counts = get<{ p: number; s: number }>(ctx, 'SELECT (SELECT COUNT(*) FROM products) AS p, (SELECT COUNT(*) FROM sales) AS s')!;
  const userCount = get<{ n: number }>(ctx, 'SELECT COUNT(*) AS n FROM users')!.n;
  return {
    pharmacyName: s.pharmacy.name,
    logo: s.pharmacy.logo,
    language: s.locale.language,
    version: env.version,
    firstRun: userCount === 1 && !!admin && !!admin.is_active && counts.p === 0,
    hasData: counts.p > 0 || counts.s > 0,
    defaultAdminActive: !!admin && !!admin.is_active && verifyPassword(DEFAULT_ADMIN.password, admin.password_hash),
  };
}

export function createHandlers(env: MainEnv): HandlerMap {
  return {
    /* App & auth */
    'app.bootstrap': (_i, ctx) => bootstrapInfo(env, ctx),
    'app.info': (_i, ctx) => ({
      version: env.version,
      productName: env.productName,
      dbPath: env.dbPath(),
      dbSizeBytes: (() => {
        try {
          return statSync(env.dbPath()).size;
        } catch {
          return 0;
        }
      })(),
      dataDir: env.dataDir,
      platform: `${process.platform} ${process.arch}`,
      electron: env.versions.electron,
      node: env.versions.node,
      sqlite: String((ctx.sqlite.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v),
      packaged: env.packaged,
      migrations: env.migrationCount(),
    }),
    'auth.login': (i, ctx) => {
      const current = env.sessions.get();
      if (current) auth.logout({ ...ctx, user: current.user }, current);
      const session = auth.login(ctx, i.username, i.password);
      env.sessions.set(session);
      return auth.toSessionInfo(ctx, session);
    },
    'auth.logout': (_i, ctx) => {
      const s = activeSession(env);
      auth.logout({ ...ctx, user: s.user }, s);
      env.sessions.set(null);
    },
    'auth.session': (_i, ctx) => {
      const s = env.sessions.get();
      return s ? auth.toSessionInfo(ctx, s) : null;
    },
    'auth.lock': (_i, ctx) => {
      const s = activeSession(env);
      env.sessions.lock();
      audit({ ...ctx, user: s.user }, { action: 'LOCK', entityType: 'user', entityId: s.user.id, description: `${s.user.fullName} locked the screen` });
      return auth.toSessionInfo(ctx, s);
    },
    'auth.unlock': (i, ctx) => {
      const s = activeSession(env);
      auth.unlock({ ...ctx, user: s.user }, s, i.password);
      env.sessions.unlock();
      return auth.toSessionInfo(ctx, s);
    },
    'auth.changePassword': (i, ctx) => {
      const s = activeSession(env);
      if (s.locked) throw new AppError('SESSION_LOCKED', 'Unlock the screen first');
      auth.changePassword({ ...ctx, user: s.user }, i.currentPassword, i.newPassword);
      s.mustChangePassword = false;
      env.sessions.set(s);
      return auth.toSessionInfo(ctx, s);
    },
    'auth.heartbeat': () => {
      const s = activeSession(env);
      if (!s.locked) env.sessions.touch();
      return { locked: s.locked };
    },
    'auth.override': (i, ctx) => {
      const supervisor = auth.authorizeOverride(ctx, i.username, i.password, i.permission as never, i.reason);
      const grant = overrides.issue(i.permission as never, supervisor.id, supervisor.fullName, i.reason);
      return { token: grant.token, grantedBy: grant.grantedByName, permission: grant.permission, expiresAt: new Date(grant.expiresAt).toISOString() };
    },

    /* Users & roles */
    'users.list': (_i, ctx) => users.listUsers(ctx),
    'users.options': (_i, ctx) => users.listUsers(ctx).map((u) => ({ id: u.id, name: u.fullName })),
    'users.create': (i, ctx) => users.createUser(ctx, i),
    'users.update': (i, ctx) => {
      const row = users.updateUser(ctx, i);
      const s = env.sessions.get();
      if (s && s.user.id === i.id) {
        const fresh = auth.loadSessionUser(ctx, i.id);
        if (fresh) env.sessions.replaceUser(fresh);
      }
      return row;
    },
    'users.resetPassword': (i, ctx) => users.resetPassword(ctx, i),
    'roles.list': (_i, ctx) => users.listRoles(ctx),
    'roles.save': (i, ctx) => {
      const row = users.saveRole(ctx, i);
      const s = env.sessions.get();
      if (s && s.user.roleId === row.id) {
        const fresh = auth.loadSessionUser(ctx, s.user.id);
        if (fresh) env.sessions.replaceUser(fresh);
      }
      return row;
    },
    'roles.delete': (i, ctx) => users.deleteRole(ctx, i.id),

    /* Settings */
    'settings.get': (_i, ctx) => getSettings(ctx),
    'settings.update': (i, ctx) => {
      updateSettingsSection(ctx, i.section as SettingsSection, i.value);
      return getSettings(ctx);
    },
    'settings.printers': () => env.printers(),

    /* Catalogue */
    'categories.list': (i, ctx) => catalog.listCategories(ctx, i?.includeInactive ?? true),
    'categories.save': (i, ctx) => catalog.saveCategory(ctx, i),
    'manufacturers.list': (i, ctx) => catalog.listManufacturers(ctx, i?.includeInactive ?? true),
    'manufacturers.save': (i, ctx) => catalog.saveManufacturer(ctx, i),
    'products.list': (i, ctx) => catalog.listProducts(ctx, i),
    'products.get': (i, ctx) => catalog.getProduct(ctx, i.id),
    'products.save': (i, ctx) => catalog.saveProduct(ctx, i),
    'products.setActive': (i, ctx) => catalog.setProductActive(ctx, i.id, i.isActive),
    'products.search': (i, ctx) => catalog.searchProducts(ctx, i),
    'products.byBarcode': (i, ctx) => catalog.findByBarcode(ctx, i.barcode),
    'products.nextCode': (_i, ctx) => catalog.nextProductCode(ctx),

    /* Inventory */
    'batches.list': (i, ctx) => inventory.listBatches(ctx, i),
    'batches.forProduct': (i, ctx) => inventory.productBatches(ctx, i.productId, i.includeEmpty),
    'batches.update': (i, ctx) => inventory.updateBatch(ctx, i),
    'inventory.opening': (i, ctx) => inventory.addOpeningStock(ctx, i),
    'inventory.adjust': (i, ctx) => inventory.adjustStock(ctx, i),
    'inventory.adjustments': (i, ctx) => inventory.listAdjustments(ctx, i),
    'inventory.movements': (i, ctx) => inventory.listMovements(ctx, i),
    'inventory.expiry': (i, ctx) => inventory.expiryReport(ctx, i),
    'inventory.reorder': (i, ctx) => inventory.reorderReport(ctx, i),
    'inventory.integrity': (_i, ctx) => inventory.integrityCheck(ctx),

    /* Suppliers & purchases */
    'suppliers.list': (i, ctx) => suppliers.listSuppliers(ctx, i),
    'suppliers.options': (_i, ctx) => suppliers.supplierOptions(ctx),
    'suppliers.get': (i, ctx) => suppliers.getSupplier(ctx, i.id),
    'suppliers.save': (i, ctx) => suppliers.saveSupplier(ctx, i),
    'suppliers.ledger': (i, ctx) => suppliers.getSupplierLedger(ctx, i.id, i.from, i.to),
    'purchases.list': (i, ctx) => purchases.listPurchases(ctx, i),
    'purchases.get': (i, ctx) => purchases.getPurchase(ctx, i.id),
    'purchases.saveDraft': (i, ctx) => purchases.savePurchaseDraft(ctx, i),
    'purchases.calculate': (i, ctx) => purchases.calculatePurchaseTotals(ctx, i),
    'purchases.post': (i, ctx) => purchases.postPurchase(ctx, i),
    'purchases.void': (i, ctx) => purchases.voidPurchase(ctx, i.id, i.reason),
    'purchases.deleteDraft': (i, ctx) => purchases.deletePurchaseDraft(ctx, i.id),

    /* Customers & prescriptions */
    'customers.list': (i, ctx) => customers.listCustomers(ctx, i),
    'customers.search': (i, ctx) => customers.searchCustomers(ctx, i),
    'customers.get': (i, ctx) => customers.getCustomer(ctx, i.id),
    'customers.save': (i, ctx) => customers.saveCustomer(ctx, i),
    'customers.ledger': (i, ctx) => customers.getCustomerLedger(ctx, i.id, i.from, i.to),
    'prescriptions.list': (i, ctx) => customers.listPrescriptions(ctx, i),
    'prescriptions.get': (i, ctx) => customers.getPrescription(ctx, i.id),
    'prescriptions.save': (i, ctx) => customers.savePrescription(ctx, i),
    'prescriptions.setStatus': (i, ctx) => customers.setPrescriptionStatus(ctx, i.id, i.status),
    'prescriptions.addAttachment': (i, ctx) => customers.addPrescriptionAttachment(ctx, i),
    'prescriptions.getAttachment': (i, ctx) => customers.getPrescriptionAttachment(ctx, i.id),
    'prescriptions.removeAttachment': (i, ctx) => customers.removePrescriptionAttachment(ctx, i.id),

    /* POS & sales */
    'pos.quote': (i, ctx) => sales.quoteSale(ctx, i),
    'pos.complete': (i, ctx) => sales.completeSale(ctx, i),
    'pos.hold': (i, ctx) => sales.holdBill(ctx, i),
    'pos.held': (_i, ctx) => sales.listHeldBills(ctx),
    'pos.resume': (i, ctx) => sales.resumeHeldBill(ctx, i.id),
    'pos.deleteHeld': (i, ctx) => sales.deleteHeldBill(ctx, i.id),
    'sales.list': (i, ctx) => sales.listSales(ctx, i),
    'sales.get': (i, ctx) => sales.getSale(ctx, i.id),
    'sales.byInvoice': (i, ctx) => sales.findSaleByInvoice(ctx, i.invoiceNo),
    'sales.last': (_i, ctx) => sales.lastSaleId(ctx),
    'sales.void': (i, ctx) => sales.voidSale(ctx, i.id, i.reason, i.overrideToken),
    'returns.create': (i, ctx) => returns.createReturn(ctx, i),
    'returns.list': (i, ctx) => returns.listReturns(ctx, i),
    'returns.get': (i, ctx) => returns.getReturn(ctx, i.id),

    /* Finance */
    'expenseCategories.list': (_i, ctx) => expenses.listExpenseCategories(ctx),
    'expenseCategories.save': (i, ctx) => expenses.saveExpenseCategory(ctx, i),
    'expenses.list': (i, ctx) => expenses.listExpenses(ctx, i),
    'expenses.create': (i, ctx) => expenses.createExpense(ctx, i),
    'expenses.void': (i, ctx) => expenses.voidExpense(ctx, i.id, i.reason),
    'payments.list': (i, ctx) => payments.listPayments(ctx, i),
    'payments.supplier': (i, ctx) => payments.createSupplierPayment(ctx, i),
    'payments.customer': (i, ctx) => payments.createCustomerPayment(ctx, i),
    'payments.void': (i, ctx) => payments.voidPayment(ctx, i.id, i.reason),
    'cash.current': (_i, ctx) => cash.currentCashSession(ctx),
    'cash.open': (i, ctx) => cash.openCashSession(ctx, i),
    'cash.adjust': (i, ctx) => cash.addCashAdjustment(ctx, i),
    'cash.close': (i, ctx) => cash.closeCashSession(ctx, i),
    'cash.list': (i, ctx) => cash.listCashSessions(ctx, i),
    'cash.get': (i, ctx) => cash.getCashSession(ctx, i.id),

    /* Dashboard, reports, audit */
    'dashboard.get': (_i, ctx) => dashboard(ctx),
    'reports.list': (_i, ctx) => reports.listReports(ctx),
    'reports.run': (i, ctx) => reports.runReport(ctx, i.reportId, i.params),
    'reports.export': async (i, ctx) => {
      const user = requireUser(ctx);
      const r = reports.runReport(ctx, i.reportId, i.params);
      const s = getSettings(ctx);
      const safe = `${r.title.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_')}_${(i.params.from ?? '').replace(/-/g, '')}${i.params.to ? `-${i.params.to.replace(/-/g, '')}` : ''}`;
      audit(ctx, { action: 'REPORT_EXPORT', entityType: 'report', entityId: r.id, description: `Exported ${r.title} (${r.subtitle}) as ${i.format.toUpperCase()}` });
      if (i.format === 'print') {
        const printed = await env.print(templates.reportHtml(r, s, user.fullName), { paper: r.columns.length > 7 ? 'A4-landscape' : 'A4', deviceName: s.printer.a4Printer || undefined });
        return { filePath: null, printed };
      }
      const ext = i.format;
      const target = await env.dialogs.saveFile(`${safe}.${ext}`, [
        ext === 'csv' ? { name: 'CSV (comma separated)', extensions: ['csv'] } : ext === 'xlsx' ? { name: 'Excel workbook', extensions: ['xlsx'] } : { name: 'PDF document', extensions: ['pdf'] },
      ]);
      if (!target) return { filePath: null };
      if (ext === 'csv') writeFileSync(target, reportToCsv(r, s), 'utf8');
      else if (ext === 'xlsx') writeFileSync(target, await reportToXlsx(r, s, user.fullName));
      else writeFileSync(target, await env.pdf(templates.reportHtml(r, s, user.fullName), { paper: r.columns.length > 7 ? 'A4-landscape' : 'A4' }));
      return { filePath: target };
    },
    'audit.list': (i, ctx) => listAudit(ctx, i),
    'audit.actions': (_i, ctx) => auditActions(ctx),

    /* Backup */
    'backup.status': (_i, ctx) => {
      const settings = getSettings(ctx).backup;
      const logs = backup.listBackupLogs(ctx, 30);
      const lastSuccess = logs.find((l) => l.status === 'SUCCESS') ?? null;
      let dbSizeBytes = 0;
      try {
        dbSizeBytes = statSync(env.dbPath()).size;
      } catch {
        /* ignore */
      }
      const next = settings.autoEnabled
        ? new Date((settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : Date.now()) + settings.intervalHours * 3_600_000).toISOString()
        : null;
      return {
        settings,
        defaultDirectory: env.defaultBackupDir,
        effectiveDirectory: settings.directory || env.defaultBackupDir,
        last: logs[0] ?? null,
        lastSuccess,
        logs,
        dbPath: env.dbPath(),
        dbSizeBytes,
        nextAutoAt: next,
      };
    },
    'backup.create': async (i, ctx) => {
      let directory = i.directory ?? null;
      if (!directory) directory = await env.dialogs.chooseDirectory('Choose where to save the backup (USB drive, external disk or folder)', getSettings(ctx).backup.directory || env.defaultBackupDir);
      if (!directory) throw new AppError('CANCELLED', 'Backup cancelled');
      const row = await backup.createBackup(ctx, directory, 'MANUAL');
      env.emit('backup.completed', row);
      return row;
    },
    'backup.chooseDirectory': async (_i, ctx) => env.dialogs.chooseDirectory('Choose backup folder', getSettings(ctx).backup.directory || env.defaultBackupDir),
    'backup.pickFile': async (_i, ctx) => {
      const file = await env.dialogs.pickBackupFile(getSettings(ctx).backup.directory || env.defaultBackupDir);
      return file ? backup.inspectBackupFile(file, env.migrationCount()) : null;
    },
    'backup.inspect': (i) => backup.inspectBackupFile(i.filePath, env.migrationCount()),
    'backup.restore': async (i, ctx) => {
      requirePermission(ctx, 'backup.manage');
      const info = backup.inspectBackupFile(i.filePath, env.migrationCount());
      if (!info.compatible) throw new AppError('RESTORE_FAILED', info.problem ?? 'This backup cannot be restored');
      await env.restore(ctx, i.filePath);
      return { restarting: true };
    },
    'backup.showInFolder': (i) => env.showItemInFolder(i.filePath),

    /* Printing */
    'print.sale': async (i, ctx) => {
      const user = requireUser(ctx);
      const sale = sales.getSale(ctx, i.id);
      const ageMs = ctx.now().getTime() - Date.parse(sale.createdAt);
      const reprint = ageMs > 2 * 60_000 || sale.status === 'VOID';
      if (reprint && i.mode !== 'preview') {
        if (!can(ctx, 'sales.reprint') && !can(ctx, 'sales.view')) throw new AppError('FORBIDDEN', 'You are not permitted to reprint receipts');
        audit(ctx, { action: 'RECEIPT_REPRINT', entityType: 'sale', entityId: sale.id, description: `${user.fullName} reprinted ${sale.invoiceNo} (${i.format})` });
      }
      const s = getSettings(ctx);
      const html = i.format === 'a4' ? templates.invoiceA4Html(sale, s) : templates.receiptHtml(sale, s, { reprint });
      return deliver(env, ctx, html, i.mode, i.format === 'a4' ? 'A4' : s.receipt.paperWidth, `${sale.invoiceNo}.pdf`, i.format === 'a4' ? 'a4' : 'receipt');
    },
    'print.return': async (i, ctx) => {
      const r = returns.getReturn(ctx, i.id);
      const s = getSettings(ctx);
      return deliver(env, ctx, templates.returnReceiptHtml(r, s), i.mode, s.receipt.paperWidth, `${r.returnNo}.pdf`, 'receipt');
    },
    'print.cashSession': async (i, ctx) => {
      const cs = cash.getCashSession(ctx, i.id);
      const s = getSettings(ctx);
      return deliver(env, ctx, templates.cashSessionHtml(cs, s, i.format), i.mode, i.format === 'a4' ? 'A4' : s.receipt.paperWidth, `${cs.sessionNo}.pdf`, i.format === 'a4' ? 'a4' : 'receipt');
    },
    'print.purchase': async (i, ctx) => {
      const p = purchases.getPurchase(ctx, i.id);
      return deliver(env, ctx, templates.purchaseA4Html(p, getSettings(ctx)), i.mode, 'A4', `${p.purchaseNo}.pdf`, 'a4');
    },
    'print.labels': async (i, ctx) => {
      const labels = i.items.map((it) => {
        const p = catalog.getProduct(ctx, it.productId);
        const b = it.batchId ? inventory.getBatch(ctx, it.batchId) : null;
        return { name: p.brandName, strength: p.strength, code: p.code, barcode: p.barcode, price: b?.salePrice ?? p.defaultSalePrice, batchNumber: b?.batchNumber ?? null, expiryDate: b?.expiryDate ?? null, copies: it.copies };
      });
      const html = templates.labelsHtml(labels, getSettings(ctx), i.layout, i.showPrice);
      return deliver(env, ctx, html, i.mode, i.layout === 'a4-40' ? 'A4' : 'label', 'labels.pdf', i.layout === 'a4-40' ? 'a4' : 'label');
    },
    'print.test': async (i, ctx) => {
      const s = getSettings(ctx);
      return deliver(env, ctx, templates.testPageHtml(s, i.target), 'print', i.target === 'a4' ? 'A4' : s.receipt.paperWidth, 'test.pdf', i.target);
    },

    /* Demo */
    'demo.load': (_i, ctx) => env.loadDemo(ctx),
  };
}
