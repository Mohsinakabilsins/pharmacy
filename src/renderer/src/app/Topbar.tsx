import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Bell, ChevronDown, KeyRound, Lock, LogOut, Monitor, Moon, Search, Sun, WifiOff, CalendarClock, PackageX, AlertTriangle, CircleDot } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@renderer/lib/api';
import { cn } from '@renderer/lib/cn';
import { useFormat } from '@renderer/lib/format';
import { useApiQuery } from '@renderer/lib/query';
import { useCan, useSession } from '@renderer/stores/session';
import { usePrefs, type ThemePref } from '@renderer/stores/prefs';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@renderer/components/ui/menu';
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@renderer/components/ui/controls';
import { Kbd } from '@renderer/components/ui/display';
import { ALL_NAV_ITEMS, NAV } from './nav';
import { useUi } from './ui-store';

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Topbar() {
  const { t } = useTranslation();
  const loc = useLocation();
  const nav = useNavigate();
  const session = useSession((s) => s.session);
  const can = useCan();
  const f = useFormat();
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const openPalette = useUi((s) => s.openPalette);
  const openPassword = useUi((s) => s.openPassword);
  const qc = useQueryClient();

  const path = '/' + (loc.pathname.split('/')[1] ?? '');
  const item = ALL_NAV_ITEMS.find((i) => i.to === path) ?? ALL_NAV_ITEMS[0];
  const group = NAV.find((g) => g.items.includes(item));

  const shift = useApiQuery('cash.current', undefined, { enabled: can('pos.access', 'cash.operate', 'cash.view_all'), refetchInterval: 60_000 });
  const dash = useApiQuery('dashboard.get', undefined, { enabled: can('dashboard.view'), staleTime: 60_000, refetchInterval: 120_000 });
  const k = dash.data?.kpis;
  const alertCount = k ? (k.expiredCount > 0 ? 1 : 0) + (k.expiringSoonCount > 0 ? 1 : 0) + (k.outOfStockCount > 0 ? 1 : 0) + (k.lowStockCount > 0 ? 1 : 0) : 0;

  const themeIcon = theme === 'dark' ? <Moon /> : theme === 'light' ? <Sun /> : <Monitor />;
  const nextTheme: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };

  return (
    <header className="drag relative z-20 flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-card/80 pe-[150px] ps-6 backdrop-blur-md">
      <div className="flex min-w-[160px] shrink-0 items-center gap-2 text-[13px]">
        {group && group.label !== 'Overview' && <span className="text-muted-foreground">{t(group.i18n, group.label)}</span>}
        {group && group.label !== 'Overview' && <span className="text-muted-foreground/50">/</span>}
        <span className="truncate font-semibold">{t(item.i18n, item.label)}</span>
      </div>

      <button
        type="button"
        onClick={openPalette}
        className="no-drag mx-auto flex h-8 w-[min(400px,30vw)] min-w-0 items-center gap-2 rounded-lg border border-border bg-subtle px-3 text-[13px] text-muted-foreground shadow-xs transition hover:border-border-strong hover:bg-card"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-start">{t('top.search', 'Search products, invoices, pages…')}</span>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </button>

      <div className="no-drag flex items-center gap-1.5">
        <Tooltip content="All data is stored on this computer. No internet connection is required.">
          <div className="hidden h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-subtle px-2.5 text-[11.5px] font-medium text-muted-foreground 2xl:flex">
            <WifiOff className="size-3.5" />
            {t('top.offline', 'Offline-ready')}
          </div>
        </Tooltip>

        {can('pos.access', 'cash.operate', 'cash.view_all') && (
          <button
            type="button"
            onClick={() => nav('/cash')}
            className={cn(
              'flex h-7 items-center gap-2 whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-semibold ring-1 ring-inset transition',
              shift.data ? 'bg-success-soft text-success ring-success/20 hover:brightness-95' : 'bg-warning-soft text-warning ring-warning/25 hover:brightness-95',
            )}
          >
            <span className="relative flex size-2">
              {shift.data && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-50" />}
              <span className={cn('relative inline-flex size-2 rounded-full', shift.data ? 'bg-success' : 'bg-warning')} />
            </span>
            {shift.data ? (
              <span className="num">
                {t('top.shiftOpen', 'Shift open')} · {f.money(shift.data.summary.expectedCash)}
              </span>
            ) : (
              t('top.noShift', 'No shift open')
            )}
          </button>
        )}

        {can('dashboard.view') && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="relative flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground">
                <Bell className="size-[17px]" />
                {alertCount > 0 && <span className="absolute end-1 top-1 flex size-4 items-center justify-center rounded-full bg-danger text-[9.5px] font-bold text-white ring-2 ring-card">{alertCount}</span>}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[340px] p-0">
              <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">{t('top.alerts', 'Alerts')}</div>
              <div className="p-1.5">
                {k && k.expiredCount > 0 && <AlertRow icon={<AlertTriangle />} tone="danger" title={`${k.expiredCount} expired batch${k.expiredCount === 1 ? '' : 'es'} on hand`} sub={`Value ${f.money(k.expiredValue)} — remove from shelves`} onClick={() => nav('/expiry?bucket=EXPIRED')} />}
                {k && k.expiringSoonCount > 0 && <AlertRow icon={<CalendarClock />} tone="warning" title={`${k.expiringSoonCount} batch${k.expiringSoonCount === 1 ? '' : 'es'} expiring within ${dash.data?.expiryWarningDays} days`} sub={`Value ${f.money(k.expiringSoonValue)}`} onClick={() => nav('/expiry')} />}
                {k && k.outOfStockCount > 0 && <AlertRow icon={<PackageX />} tone="danger" title={`${k.outOfStockCount} product${k.outOfStockCount === 1 ? '' : 's'} out of stock`} sub="Review the reorder list" onClick={() => nav('/reorder')} />}
                {k && k.lowStockCount > 0 && <AlertRow icon={<CircleDot />} tone="info" title={`${k.lowStockCount} product${k.lowStockCount === 1 ? '' : 's'} low on stock`} sub="Below minimum level" onClick={() => nav('/reorder')} />}
                {alertCount === 0 && <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">{t('top.noAlerts', 'All clear — nothing needs attention.')}</div>}
              </div>
            </PopoverContent>
          </Popover>
        )}

        <Tooltip content={`Theme: ${theme}`}>
          <button type="button" onClick={() => setTheme(nextTheme[theme])} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground [&_svg]:size-[17px]">
            {themeIcon}
          </button>
        </Tooltip>

        {session && (
          <Menu>
            <MenuTrigger asChild>
              <button type="button" className="ms-1 flex h-9 items-center gap-2 rounded-lg ps-1 pe-2 transition hover:bg-muted">
                <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-[11px] font-semibold text-white dark:from-slate-500 dark:to-slate-700">{initials(session.user.fullName)}</span>
                <span className="hidden text-start leading-tight lg:block">
                  <span className="block max-w-[140px] truncate text-[12.5px] font-semibold">{session.user.fullName}</span>
                  <span className="block text-[11px] text-muted-foreground">{session.user.roleName}</span>
                </span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>{session.user.username}</MenuLabel>
              <MenuItem icon={<KeyRound />} onSelect={openPassword}>
                {t('user.changePassword', 'Change password')}
              </MenuItem>
              <MenuItem icon={<Lock />} shortcut="Ctrl+L" onSelect={() => void api('auth.lock')}>
                {t('user.lock', 'Lock screen')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                icon={<LogOut />}
                danger
                onSelect={async () => {
                  await api('auth.logout');
                  useSession.getState().set(null);
                  qc.clear();
                  nav('/');
                }}
              >
                {t('user.signOut', 'Sign out')}
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </div>
    </header>
  );
}

function AlertRow({ icon, title, sub, tone, onClick }: { icon: React.ReactNode; title: string; sub: string; tone: 'danger' | 'warning' | 'info'; onClick: () => void }) {
  const cls = { danger: 'bg-danger-soft text-danger', warning: 'bg-warning-soft text-warning', info: 'bg-info-soft text-info' }[tone];
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-start transition hover:bg-muted">
      <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4', cls)}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block text-[12px] text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}
