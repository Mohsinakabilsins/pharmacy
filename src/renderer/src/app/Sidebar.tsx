import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@renderer/lib/cn';
import { useCan } from '@renderer/stores/session';
import { usePrefs } from '@renderer/stores/prefs';
import { useSettings } from '@renderer/lib/format';
import { LogoMark } from '@renderer/components/Logo';
import { Tooltip } from '@renderer/components/ui/controls';
import { NAV } from './nav';

export function Sidebar() {
  const { t } = useTranslation();
  const can = useCan();
  const collapsed = usePrefs((s) => s.sidebarCollapsed);
  const toggle = usePrefs((s) => s.toggleSidebar);
  const settings = useSettings();

  return (
    <aside className={cn('relative flex h-full shrink-0 flex-col border-e border-sidebar-border bg-sidebar transition-[width] duration-200', collapsed ? 'w-[68px]' : 'w-[248px]')}>
      <div className="drag flex h-[52px] shrink-0 items-center gap-2.5 px-4">
        <LogoMark logo={settings.pharmacy.logo || undefined} className="no-drag" />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13.5px] font-semibold tracking-tight">{settings.pharmacy.name}</div>
            <div className="text-[11px] font-medium text-muted-foreground">PharmaDesk</div>
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-3">
        {NAV.map((group) => {
          const items = group.items.filter((i) => can(...i.perms));
          if (items.length === 0) return null;
          return (
            <div key={group.label}>
              {!collapsed ? (
                <div className="mb-1.5 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/80">{t(group.i18n, group.label)}</div>
              ) : (
                <div className="mx-auto mb-2 h-px w-6 bg-border" />
              )}
              <div className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const link = (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors',
                          collapsed && 'justify-center px-0',
                          isActive
                            ? 'bg-card text-foreground shadow-card ring-1 ring-border dark:bg-white/[0.06] dark:ring-white/[0.06]'
                            : 'text-muted-foreground hover:bg-black/[0.035] hover:text-foreground dark:hover:bg-white/[0.04]',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute -start-3 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-e-full bg-primary" />}
                          <Icon className={cn('size-[17px] shrink-0', isActive ? 'text-primary' : 'text-muted-foreground/90 group-hover:text-foreground')} strokeWidth={isActive ? 2.2 : 1.9} />
                          {!collapsed && <span className="flex-1 truncate">{t(item.i18n, item.label)}</span>}
                          {!collapsed && item.shortcut && <span className="rounded border border-border px-1 font-mono text-[10px] text-muted-foreground/80">{item.shortcut}</span>}
                        </>
                      )}
                    </NavLink>
                  );
                  return collapsed ? (
                    <Tooltip key={item.to} content={t(item.i18n, item.label)} side="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <button type="button" onClick={toggle} className={cn('flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[12.5px] font-medium text-muted-foreground transition hover:bg-black/[0.035] hover:text-foreground dark:hover:bg-white/[0.04]', collapsed && 'justify-center px-0')}>
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          {!collapsed && t('nav.collapse', 'Collapse sidebar')}
        </button>
      </div>
    </aside>
  );
}
