/**
 * IPC contract: every channel, its input schema and required access, declared once.
 * The main process implements a handler per channel (checked exhaustively at compile time);
 * the renderer calls `api(channel, input)` with full typing.
 */
import { z } from 'zod';
import type { PermissionKey } from './permissions';
import type { AppSettings } from './settings';
import { SETTINGS_SECTIONS } from './settings';
import { zId, zIdInput, zVoid } from './schemas/common';
import {
  ChangePasswordSchema,
  LoginSchema,
  OverrideSchema,
  ResetPasswordSchema,
  RoleSaveSchema,
  UnlockSchema,
  UserCreateSchema,
  UserUpdateSchema,
} from './schemas/auth';
import {
  BarcodeSchema,
  CategorySaveSchema,
  LabelPrintSchema,
  ManufacturerSaveSchema,
  ProductListSchema,
  ProductSaveSchema,
  ProductSearchSchema,
  SetActiveSchema,
} from './schemas/catalog';
import {
  AdjustmentListSchema,
  BatchListSchema,
  BatchUpdateSchema,
  ExpiryQuerySchema,
  MovementListSchema,
  OpeningStockSchema,
  ProductBatchesSchema,
  ReorderQuerySchema,
  StockAdjustSchema,
} from './schemas/inventory';
import {
  LedgerQuerySchema,
  PurchaseCalcSchema,
  PurchaseDraftSchema,
  PurchaseListSchema,
  PurchasePostSchema,
  SupplierListSchema,
  SupplierSaveSchema,
} from './schemas/purchasing';
import {
  AttachmentAddSchema,
  CustomerListSchema,
  CustomerSaveSchema,
  CustomerSearchSchema,
  PrescriptionListSchema,
  PrescriptionSaveSchema,
  PrescriptionStatusSchema,
} from './schemas/customers';
import {
  HoldBillSchema,
  InvoiceLookupSchema,
  PrintSchema,
  ReturnCreateSchema,
  ReturnListSchema,
  SaleCompleteSchema,
  SaleDraftSchema,
  SaleListSchema,
  SaleVoidSchema,
} from './schemas/sales';
import {
  CashAdjustSchema,
  CashCloseSchema,
  CashListSchema,
  CashOpenSchema,
  CustomerPaymentSchema,
  ExpenseCategorySaveSchema,
  ExpenseCreateSchema,
  ExpenseListSchema,
  PaymentListSchema,
  SupplierPaymentSchema,
} from './schemas/finance';
import { AuditListSchema, ReportExportSchema, ReportRunSchema } from './schemas/reports';
import type { BootstrapInfo, OverrideResult, RoleRow, SessionInfo, UserRow } from './types/auth';
import type { CategoryRow, ManufacturerRow, ProductDetail, ProductListRow, ProductSearchHit } from './types/catalog';
import type { Option, Paged } from './types/common';
import type { AdjustmentRow, BatchRow, ExpiryReport, IntegrityReport, MovementRow, ReorderRow } from './types/inventory';
import type { Ledger, PurchaseDetail, PurchaseRow, PurchaseTotals, SupplierDetail, SupplierRow } from './types/purchasing';
import type { CustomerDetail, CustomerHit, CustomerRow, PrescriptionDetail, PrescriptionRow } from './types/customers';
import type { HeldBillRow, ReturnDetail, ReturnRow, SaleCompleted, SaleDetail, SaleQuote, SaleRow } from './types/sales';
import type { CashSessionDetail, CashSessionRow, ExpenseCategoryRow, ExpenseList, ExpenseRow, PaymentRow } from './types/finance';
import type { DashboardData, ReportDefinition, ReportResult } from './types/reports';
import type { AppInfo, AuditRow, BackupFileInfo, BackupLogRow, BackupStatus, PrinterInfo, PrintResult } from './types/system';

/** `public`: no session · `session`: signed in (may be locked) · otherwise signed in, unlocked and holding ANY listed permission. */
export type Access = 'public' | 'session' | 'user' | PermissionKey[];

const none = z.undefined().optional();
const p = (...keys: PermissionKey[]) => keys;

export const CHANNELS = {
  // App & auth
  'app.bootstrap': { input: none, access: 'public' },
  'app.info': { input: none, access: 'user' },
  'auth.login': { input: LoginSchema, access: 'public' },
  'auth.logout': { input: none, access: 'session' },
  'auth.session': { input: none, access: 'public' },
  'auth.lock': { input: none, access: 'session' },
  'auth.unlock': { input: UnlockSchema, access: 'session' },
  'auth.changePassword': { input: ChangePasswordSchema, access: 'session' },
  'auth.heartbeat': { input: none, access: 'session' },
  'auth.override': { input: OverrideSchema, access: 'user' },

  // Users & roles
  'users.list': { input: none, access: p('users.manage') },
  'users.options': { input: none, access: 'user' },
  'users.create': { input: UserCreateSchema, access: p('users.manage') },
  'users.update': { input: UserUpdateSchema, access: p('users.manage') },
  'users.resetPassword': { input: ResetPasswordSchema, access: p('users.manage') },
  'roles.list': { input: none, access: p('users.manage', 'roles.manage') },
  'roles.save': { input: RoleSaveSchema, access: p('roles.manage') },
  'roles.delete': { input: zIdInput, access: p('roles.manage') },

  // Settings
  'settings.get': { input: none, access: 'user' },
  'settings.update': { input: z.object({ section: z.enum(SETTINGS_SECTIONS as [string, ...string[]]), value: z.record(z.string(), z.unknown()) }), access: p('settings.manage') },
  'settings.printers': { input: none, access: 'user' },

  // Catalogue
  'categories.list': { input: z.object({ includeInactive: z.boolean().default(true) }).optional(), access: 'user' },
  'categories.save': { input: CategorySaveSchema, access: p('products.manage') },
  'manufacturers.list': { input: z.object({ includeInactive: z.boolean().default(true) }).optional(), access: 'user' },
  'manufacturers.save': { input: ManufacturerSaveSchema, access: p('products.manage') },
  'products.list': { input: ProductListSchema, access: p('products.view', 'inventory.view') },
  'products.get': { input: zIdInput, access: p('products.view', 'inventory.view', 'pos.access') },
  'products.save': { input: ProductSaveSchema, access: p('products.manage') },
  'products.setActive': { input: SetActiveSchema, access: p('products.manage') },
  'products.search': { input: ProductSearchSchema, access: 'user' },
  'products.byBarcode': { input: BarcodeSchema, access: 'user' },
  'products.nextCode': { input: none, access: p('products.manage') },

  // Inventory
  'batches.list': { input: BatchListSchema, access: p('inventory.view') },
  'batches.forProduct': { input: ProductBatchesSchema, access: p('inventory.view', 'pos.access', 'purchases.manage') },
  'batches.update': { input: BatchUpdateSchema, access: p('batches.manage') },
  'inventory.opening': { input: OpeningStockSchema, access: p('stock.opening') },
  'inventory.adjust': { input: StockAdjustSchema, access: p('stock.adjust') },
  'inventory.adjustments': { input: AdjustmentListSchema, access: p('inventory.view') },
  'inventory.movements': { input: MovementListSchema, access: p('inventory.view') },
  'inventory.expiry': { input: ExpiryQuerySchema, access: p('inventory.view') },
  'inventory.reorder': { input: ReorderQuerySchema, access: p('inventory.view', 'purchases.manage') },
  'inventory.integrity': { input: none, access: p('settings.manage', 'stock.adjust') },

  // Suppliers & purchases
  'suppliers.list': { input: SupplierListSchema, access: p('suppliers.view') },
  'suppliers.options': { input: none, access: 'user' },
  'suppliers.get': { input: zIdInput, access: p('suppliers.view') },
  'suppliers.save': { input: SupplierSaveSchema, access: p('suppliers.manage') },
  'suppliers.ledger': { input: LedgerQuerySchema, access: p('suppliers.view', 'payments.view') },
  'purchases.list': { input: PurchaseListSchema, access: p('purchases.view') },
  'purchases.get': { input: zIdInput, access: p('purchases.view') },
  'purchases.saveDraft': { input: PurchaseDraftSchema, access: p('purchases.manage') },
  'purchases.calculate': { input: PurchaseCalcSchema, access: p('purchases.manage') },
  'purchases.post': { input: PurchasePostSchema, access: p('purchases.manage') },
  'purchases.void': { input: zVoid, access: p('purchases.void') },
  'purchases.deleteDraft': { input: zIdInput, access: p('purchases.manage') },

  // Customers & prescriptions
  'customers.list': { input: CustomerListSchema, access: p('customers.view') },
  'customers.search': { input: CustomerSearchSchema, access: p('customers.view', 'pos.access') },
  'customers.get': { input: zIdInput, access: p('customers.view') },
  'customers.save': { input: CustomerSaveSchema, access: p('customers.manage') },
  'customers.ledger': { input: LedgerQuerySchema, access: p('customers.view', 'payments.view') },
  'prescriptions.list': { input: PrescriptionListSchema, access: p('prescriptions.view') },
  'prescriptions.get': { input: zIdInput, access: p('prescriptions.view') },
  'prescriptions.save': { input: PrescriptionSaveSchema, access: p('prescriptions.manage') },
  'prescriptions.setStatus': { input: PrescriptionStatusSchema, access: p('prescriptions.manage') },
  'prescriptions.addAttachment': { input: AttachmentAddSchema, access: p('prescriptions.manage') },
  'prescriptions.getAttachment': { input: zIdInput, access: p('prescriptions.view') },
  'prescriptions.removeAttachment': { input: zIdInput, access: p('prescriptions.manage') },

  // POS & sales
  'pos.quote': { input: SaleDraftSchema, access: p('pos.access') },
  'pos.complete': { input: SaleCompleteSchema, access: p('pos.access') },
  'pos.hold': { input: HoldBillSchema, access: p('pos.access') },
  'pos.held': { input: none, access: p('pos.access') },
  'pos.resume': { input: zIdInput, access: p('pos.access') },
  'pos.deleteHeld': { input: zIdInput, access: p('pos.access') },
  'sales.list': { input: SaleListSchema, access: p('sales.view', 'sales.view_own') },
  'sales.get': { input: zIdInput, access: p('sales.view', 'sales.view_own', 'returns.manage') },
  'sales.byInvoice': { input: InvoiceLookupSchema, access: p('sales.view', 'sales.view_own', 'returns.manage') },
  'sales.last': { input: none, access: p('pos.access') },
  'sales.void': { input: SaleVoidSchema, access: p('sales.void', 'pos.access') },
  'returns.create': { input: ReturnCreateSchema, access: p('returns.manage') },
  'returns.list': { input: ReturnListSchema, access: p('returns.manage', 'sales.view') },
  'returns.get': { input: zIdInput, access: p('returns.manage', 'sales.view') },

  // Finance
  'expenseCategories.list': { input: none, access: p('expenses.view', 'expenses.manage') },
  'expenseCategories.save': { input: ExpenseCategorySaveSchema, access: p('expenses.manage') },
  'expenses.list': { input: ExpenseListSchema, access: p('expenses.view') },
  'expenses.create': { input: ExpenseCreateSchema, access: p('expenses.manage') },
  'expenses.void': { input: zVoid, access: p('expenses.manage') },
  'payments.list': { input: PaymentListSchema, access: p('payments.view') },
  'payments.supplier': { input: SupplierPaymentSchema, access: p('payments.manage') },
  'payments.customer': { input: CustomerPaymentSchema, access: p('payments.manage', 'sales.credit') },
  'payments.void': { input: zVoid, access: p('payments.manage') },
  'cash.current': { input: none, access: p('cash.operate', 'cash.view_all', 'pos.access') },
  'cash.open': { input: CashOpenSchema, access: p('cash.operate') },
  'cash.adjust': { input: CashAdjustSchema, access: p('cash.operate') },
  'cash.close': { input: CashCloseSchema, access: p('cash.operate') },
  'cash.list': { input: CashListSchema, access: p('cash.view_all', 'cash.operate') },
  'cash.get': { input: zIdInput, access: p('cash.view_all', 'cash.operate') },

  // Dashboard, reports, audit
  'dashboard.get': { input: none, access: p('dashboard.view') },
  'reports.list': { input: none, access: 'user' },
  'reports.run': { input: ReportRunSchema, access: 'user' },
  'reports.export': { input: ReportExportSchema, access: 'user' },
  'audit.list': { input: AuditListSchema, access: p('audit.view') },
  'audit.actions': { input: none, access: p('audit.view') },

  // Backup
  'backup.status': { input: none, access: p('backup.manage') },
  'backup.create': { input: z.object({ directory: z.string().max(1000).nullable().optional() }), access: p('backup.manage') },
  'backup.chooseDirectory': { input: none, access: p('backup.manage') },
  'backup.pickFile': { input: none, access: p('backup.manage') },
  'backup.inspect': { input: z.object({ filePath: z.string().min(1).max(1000) }), access: p('backup.manage') },
  'backup.restore': { input: z.object({ filePath: z.string().min(1).max(1000), confirm: z.literal('RESTORE') }), access: p('backup.manage') },
  'backup.showInFolder': { input: z.object({ filePath: z.string().min(1).max(1000) }), access: p('backup.manage') },

  // Printing
  'print.sale': { input: PrintSchema, access: p('pos.access', 'sales.reprint', 'sales.view') },
  'print.return': { input: PrintSchema, access: p('returns.manage', 'sales.view') },
  'print.cashSession': { input: PrintSchema, access: p('cash.operate', 'cash.view_all') },
  'print.purchase': { input: PrintSchema, access: p('purchases.view') },
  'print.labels': { input: LabelPrintSchema, access: p('products.view', 'inventory.view') },
  'print.test': { input: z.object({ target: z.enum(['receipt', 'a4']) }), access: p('settings.manage') },

  // Demo data
  'demo.load': { input: none, access: p('settings.manage') },
} as const satisfies Record<string, { input: z.ZodType; access: Access }>;

export type Channel = keyof typeof CHANNELS;
export type ChannelInput<K extends Channel> = z.input<(typeof CHANNELS)[K]['input']>;
export type ChannelParsed<K extends Channel> = z.output<(typeof CHANNELS)[K]['input']>;

type SaleDraft = z.output<typeof SaleDraftSchema>;

export interface Outputs {
  'app.bootstrap': BootstrapInfo;
  'app.info': AppInfo;
  'auth.login': SessionInfo;
  'auth.logout': void;
  'auth.session': SessionInfo | null;
  'auth.lock': SessionInfo;
  'auth.unlock': SessionInfo;
  'auth.changePassword': SessionInfo;
  'auth.heartbeat': { locked: boolean };
  'auth.override': OverrideResult;
  'users.list': UserRow[];
  'users.options': Option[];
  'users.create': UserRow;
  'users.update': UserRow;
  'users.resetPassword': void;
  'roles.list': RoleRow[];
  'roles.save': RoleRow;
  'roles.delete': void;
  'settings.get': AppSettings;
  'settings.update': AppSettings;
  'settings.printers': PrinterInfo[];
  'categories.list': CategoryRow[];
  'categories.save': CategoryRow;
  'manufacturers.list': ManufacturerRow[];
  'manufacturers.save': ManufacturerRow;
  'products.list': Paged<ProductListRow>;
  'products.get': ProductDetail;
  'products.save': ProductDetail;
  'products.setActive': ProductDetail;
  'products.search': ProductSearchHit[];
  'products.byBarcode': ProductSearchHit | null;
  'products.nextCode': string;
  'batches.list': Paged<BatchRow>;
  'batches.forProduct': BatchRow[];
  'batches.update': BatchRow;
  'inventory.opening': BatchRow;
  'inventory.adjust': AdjustmentRow;
  'inventory.adjustments': Paged<AdjustmentRow>;
  'inventory.movements': Paged<MovementRow>;
  'inventory.expiry': ExpiryReport;
  'inventory.reorder': ReorderRow[];
  'inventory.integrity': IntegrityReport;
  'suppliers.list': Paged<SupplierRow> & { totalPayable: number };
  'suppliers.options': Option[];
  'suppliers.get': SupplierDetail;
  'suppliers.save': SupplierDetail;
  'suppliers.ledger': Ledger;
  'purchases.list': Paged<PurchaseRow> & { totalAmount: number };
  'purchases.get': PurchaseDetail;
  'purchases.saveDraft': PurchaseDetail;
  'purchases.calculate': PurchaseTotals;
  'purchases.post': PurchaseDetail;
  'purchases.void': PurchaseDetail;
  'purchases.deleteDraft': void;
  'customers.list': Paged<CustomerRow> & { totalReceivable: number };
  'customers.search': CustomerHit[];
  'customers.get': CustomerDetail;
  'customers.save': CustomerDetail;
  'customers.ledger': Ledger;
  'prescriptions.list': Paged<PrescriptionRow>;
  'prescriptions.get': PrescriptionDetail;
  'prescriptions.save': PrescriptionDetail;
  'prescriptions.setStatus': PrescriptionDetail;
  'prescriptions.addAttachment': PrescriptionDetail;
  'prescriptions.getAttachment': { fileName: string; mimeType: string; dataBase64: string };
  'prescriptions.removeAttachment': PrescriptionDetail;
  'pos.quote': SaleQuote;
  'pos.complete': SaleCompleted;
  'pos.hold': HeldBillRow;
  'pos.held': HeldBillRow[];
  'pos.resume': SaleDraft;
  'pos.deleteHeld': void;
  'sales.list': Paged<SaleRow> & { totalAmount: number };
  'sales.get': SaleDetail;
  'sales.byInvoice': SaleDetail;
  'sales.last': number | null;
  'sales.void': SaleDetail;
  'returns.create': ReturnDetail;
  'returns.list': Paged<ReturnRow> & { totalAmount: number };
  'returns.get': ReturnDetail;
  'expenseCategories.list': ExpenseCategoryRow[];
  'expenseCategories.save': ExpenseCategoryRow;
  'expenses.list': ExpenseList;
  'expenses.create': ExpenseRow;
  'expenses.void': ExpenseRow;
  'payments.list': Paged<PaymentRow> & { amountTotal: number };
  'payments.supplier': PaymentRow;
  'payments.customer': PaymentRow;
  'payments.void': PaymentRow;
  'cash.current': CashSessionDetail | null;
  'cash.open': CashSessionDetail;
  'cash.adjust': CashSessionDetail;
  'cash.close': CashSessionDetail;
  'cash.list': Paged<CashSessionRow>;
  'cash.get': CashSessionDetail;
  'dashboard.get': DashboardData;
  'reports.list': ReportDefinition[];
  'reports.run': ReportResult;
  'reports.export': { filePath: string | null; printed?: boolean };
  'audit.list': Paged<AuditRow>;
  'audit.actions': string[];
  'backup.status': BackupStatus;
  'backup.create': BackupLogRow;
  'backup.chooseDirectory': string | null;
  'backup.pickFile': BackupFileInfo | null;
  'backup.inspect': BackupFileInfo;
  'backup.restore': { restarting: boolean };
  'backup.showInFolder': void;
  'print.sale': PrintResult;
  'print.return': PrintResult;
  'print.cashSession': PrintResult;
  'print.purchase': PrintResult;
  'print.labels': PrintResult;
  'print.test': PrintResult;
  'demo.load': { loaded: boolean; message: string };
}

export type ChannelOutput<K extends Channel> = Outputs[K];

/** Events pushed from main to renderer. */
export interface MainEvents {
  'session.changed': SessionInfo | null;
  'backup.completed': BackupLogRow;
  'backup.failed': { message: string };
}
export type MainEventName = keyof MainEvents;
export const MAIN_EVENTS: MainEventName[] = ['session.changed', 'backup.completed', 'backup.failed'];

export { zId };
