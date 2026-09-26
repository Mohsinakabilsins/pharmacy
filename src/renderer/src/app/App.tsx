import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { ShieldAlert } from 'lucide-react';
import type { PermissionKey } from '@shared/permissions';
import { api, onMainEvent, onSessionError } from '@renderer/lib/api';
import { queryClient } from '@renderer/lib/query';
import { useHotkeys } from '@renderer/lib/hotkeys';
import { useSettings } from '@renderer/lib/format';
import { applyLanguage } from '@renderer/i18n';
import { useCan, useSession } from '@renderer/stores/session';
import { resolvedTheme, usePrefs } from '@renderer/stores/prefs';
import { TooltipProvider } from '@renderer/components/ui/controls';
import { ConfirmProvider } from '@renderer/components/ui/confirm';
import { EmptyState } from '@renderer/components/ui/display';
import { OverrideProvider } from '@renderer/components/OverrideProvider';
import { PrintProvider } from '@renderer/components/PrintProvider';
import { LogoMark } from '@renderer/components/Logo';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';
import { ChangePasswordDialog, LockScreen, LoginScreen } from './AuthScreens';
import { useUi } from './ui-store';
import { ALL_NAV_ITEMS } from './nav';
import { DashboardPage } from '@renderer/features/dashboard/DashboardPage';
import { PosPage } from '@renderer/features/pos/PosPage';
import { SalesPage } from '@renderer/features/sales/SalesPage';
import { ReturnsPage } from '@renderer/features/sales/ReturnsPage';
import { ProductsPage } from '@renderer/features/products/ProductsPage';
import { StockPage } from '@renderer/features/inventory/StockPage';
import { ExpiryPage } from '@renderer/features/inventory/ExpiryPage';
import { ReorderPage } from '@renderer/features/inventory/ReorderPage';
import { PurchasesPage } from '@renderer/features/purchases/PurchasesPage';
import { PurchaseEditorPage } from '@renderer/features/purchases/PurchaseEditorPage';
import { SuppliersPage } from '@renderer/features/suppliers/SuppliersPage';
import { CustomersPage } from '@renderer/features/customers/CustomersPage';
import { PrescriptionsPage } from '@renderer/features/customers/PrescriptionsPage';
import { CashPage } from '@renderer/features/finance/CashPage';
import { ExpensesPage } from '@renderer/features/finance/ExpensesPage';
import { PaymentsPage } from '@renderer/features/finance/PaymentsPage';
import { ReportsPage } from '@renderer/features/reports/ReportsPage';
import { UsersPage } from '@renderer/features/admin/UsersPage';
import { AuditPage } from '@renderer/features/admin/AuditPage';
import { BackupPage } from '@renderer/features/admin/BackupPage';
import { SettingsPage } from '@renderer/features/admin/SettingsPage';

function useThemeSync() {
  const pref = usePrefs((s) => s.theme);
  useEffect(() => {
    const apply = () => {
      const t = resolvedTheme(pref);
      document.documentElement.classList.toggle('dark', t === 'dark');
      window.pharmacy?.setTheme(t);
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);
}

function useSessionSync() {
  const set = useSession((s) => s.set);
  const setReady = useSession((s) => s.setReady);
  useEffect(() => {
    api('auth.session')
      .then(set)
      .catch(() => set(null))
      .finally(setReady);
    const offEvent = onMainEvent('session.changed', (s) => set(s));
    const offErr = onSessionError(() => {
      api('auth.session')
        .then(set)
        .catch(() => set(null));
    });
    const offBackup = onMainEvent('backup.completed', (b) => {
      if (b.kind === 'AUTO') toast.success('Automatic backup completed', { description: b.fileName });
    });
    const offBackupFail = onMainEvent('backup.failed', (e) => toast.error('Automatic backup failed', { description: e.message, duration: 12_000 }));
    return () => {
      offEvent();
      offErr();
      offBackup();
      offBackupFail();
    };
  }, [set, setReady]);
}

function useHeartbeat(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let last = 0;
    const beat = () => {
      const now = Date.now();
      if (now - last > 30_000) {
        last = now;
        void api('auth.heartbeat').catch(() => undefined);
      }
    };
    window.addEventListener('keydown', beat);
    window.addEventListener('pointerdown', beat);
    window.addEventListener('mousemove', beat);
    return () => {
      window.removeEventListener('keydown', beat);
      window.removeEventListener('pointerdown', beat);
      window.removeEventListener('mousemove', beat);
    };
  }, [active]);
}

function Guard({ perms, children }: { perms: PermissionKey[]; children: React.ReactNode }) {
  const can = useCan();
  if (!can(...perms)) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState icon={<ShieldAlert />} title="Access restricted" description="Your role does not include access to this area. Ask an administrator if you need it." />
      </div>
    );
  }
  return <>{children}</>;
}

function Home() {
  const can = useCan();
  if (can('dashboard.view')) return <DashboardPage />;
  const first = ALL_NAV_ITEMS.find((i) => can(...i.perms));
  return first ? <Navigate to={first.to} replace /> : <Guard perms={['dashboard.view']}>{null}</Guard>;
}

function GlobalShortcuts() {
  const nav = useNavigate();
  const can = useCan();
  useHotkeys({ F2: () => can('pos.access') && nav('/pos') }, [can]);
  return null;
}

function Shell() {
  const session = useSession((s) => s.session)!;
  const passwordOpen = useUi((s) => s.passwordOpen);
  const closePassword = useUi((s) => s.closePassword);
  const perm = (to: string) => ALL_NAV_ITEMS.find((i) => i.to === to)!.perms;
  const r = (to: string, el: React.ReactNode) => <Guard perms={perm(to)}>{el}</Guard>;
  return (
    <div className="flex h-full">
      <GlobalShortcuts />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/pos" element={r('/pos', <PosPage />)} />
            <Route path="/sales" element={r('/sales', <SalesPage />)} />
            <Route path="/returns" element={r('/returns', <ReturnsPage />)} />
            <Route path="/customers" element={r('/customers', <CustomersPage />)} />
            <Route path="/prescriptions" element={r('/prescriptions', <PrescriptionsPage />)} />
            <Route path="/products" element={r('/products', <ProductsPage />)} />
            <Route path="/stock" element={r('/stock', <StockPage />)} />
            <Route path="/expiry" element={r('/expiry', <ExpiryPage />)} />
            <Route path="/reorder" element={r('/reorder', <ReorderPage />)} />
            <Route path="/purchases" element={r('/purchases', <PurchasesPage />)} />
            <Route path="/purchases/new" element={<Guard perms={['purchases.manage']}><PurchaseEditorPage /></Guard>} />
            <Route path="/purchases/:id" element={r('/purchases', <PurchaseEditorPage />)} />
            <Route path="/suppliers" element={r('/suppliers', <SuppliersPage />)} />
            <Route path="/cash" element={r('/cash', <CashPage />)} />
            <Route path="/expenses" element={r('/expenses', <ExpensesPage />)} />
            <Route path="/payments" element={r('/payments', <PaymentsPage />)} />
            <Route path="/reports" element={r('/reports', <ReportsPage />)} />
            <Route path="/users" element={r('/users', <UsersPage />)} />
            <Route path="/audit" element={r('/audit', <AuditPage />)} />
            <Route path="/backup" element={r('/backup', <BackupPage />)} />
            <Route path="/settings" element={r('/settings', <SettingsPage />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <CommandPalette />
      <ChangePasswordDialog open={session.mustChangePassword || passwordOpen} forced={session.mustChangePassword} onClose={closePassword} />
      {session.locked && <LockScreen />}
    </div>
  );
}

function Root() {
  useThemeSync();
  useSessionSync();
  const session = useSession((s) => s.session);
  const ready = useSession((s) => s.ready);
  useHeartbeat(!!session && !session.locked);
  const settings = useSettings();
  useEffect(() => applyLanguage(settings.locale.language), [settings.locale.language]);
  const userId = session?.user.id;
  useEffect(() => {
    void queryClient.invalidateQueries();
  }, [userId]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <LogoMark className="size-12 animate-pulse" />
      </div>
    );
  }
  return session ? <Shell /> : <LoginScreen />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConfirmProvider>
          <OverrideProvider>
            <PrintProvider>
              <HashRouter>
                <Root />
              </HashRouter>
              <Toaster position="bottom-right" closeButton richColors={false} toastOptions={{ classNames: { toast: '!rounded-xl !border-border !bg-elevated !text-foreground !shadow-pop !text-[13px]', description: '!text-muted-foreground' } }} />
            </PrintProvider>
          </OverrideProvider>
        </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
