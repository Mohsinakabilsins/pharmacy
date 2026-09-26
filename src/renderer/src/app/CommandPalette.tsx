import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CornerDownLeft, FileText, Lock, Moon, Pill, Plus, ScanBarcode, Search, Truck, DatabaseBackup } from 'lucide-react';
import { api } from '@renderer/lib/api';
import { useDebounced, useHotkeys } from '@renderer/lib/hotkeys';
import { useApiQuery } from '@renderer/lib/query';
import { useFormat } from '@renderer/lib/format';
import { useCan } from '@renderer/stores/session';
import { usePrefs } from '@renderer/stores/prefs';
import { Badge } from '@renderer/components/ui/display';
import { ALL_NAV_ITEMS } from './nav';
import { useUi } from './ui-store';

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const openPalette = useUi((s) => s.openPalette);
  const close = useUi((s) => s.closePalette);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 120);
  const nav = useNavigate();
  const can = useCan();
  const f = useFormat();
  const setTheme = usePrefs((s) => s.setTheme);
  const theme = usePrefs((s) => s.theme);

  useHotkeys({ 'Ctrl+K': () => openPalette(), 'Ctrl+L': () => void api('auth.lock') }, []);
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const products = useApiQuery('products.search', { query: dq, limit: 8 }, { enabled: open && dq.trim().length >= 2 });
  const go = (to: string) => {
    close();
    nav(to);
  };
  const looksLikeInvoice = /^(inv-?)?\d{1,8}$/i.test(dq.trim());

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? openPalette() : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0b1220]/35 backdrop-blur-[2px] animate-in dark:bg-black/60" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[14vh] z-50 w-[640px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-elevated shadow-dialog outline-none">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search and run commands</DialogPrimitive.Description>
          <Command shouldFilter={false} className="flex flex-col" loop>
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="size-[18px] text-muted-foreground" />
              <Command.Input value={q} onValueChange={setQ} autoFocus placeholder="Search medicines, jump to a page, or type an invoice number…" className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/70" />
            </div>
            <Command.List className="max-h-[440px] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground">
              <Command.Empty className="px-4 py-10 text-center text-[13px] text-muted-foreground">No results</Command.Empty>
              {looksLikeInvoice && can('sales.view', 'sales.view_own', 'returns.manage') && (
                <Command.Group heading="Invoice">
                  <Item
                    icon={<FileText />}
                    onSelect={async () => {
                      try {
                        const sale = await api('sales.byInvoice', { invoiceNo: dq.trim() });
                        go(`/sales?open=${sale.id}`);
                      } catch {
                        go(`/sales?q=${encodeURIComponent(dq.trim())}`);
                      }
                    }}
                  >
                    Open invoice {dq.trim().toUpperCase()}
                  </Item>
                </Command.Group>
              )}
              {products.data && products.data.length > 0 && (
                <Command.Group heading="Products">
                  {products.data.map((p) => (
                    <Item key={p.id} icon={<Pill />} onSelect={() => go(`/products?open=${p.id}`)} aside={<span className="num text-[12px] text-muted-foreground">{f.money(p.price)}</span>}>
                      <span className="font-medium">{p.brandName}</span>
                      {p.strength && <span className="text-muted-foreground"> {p.strength}</span>}
                      {p.genericName && <span className="ms-2 text-[12px] text-muted-foreground">{p.genericName}</span>}
                      {p.sellableQty <= 0 && (
                        <Badge tone="danger" className="ms-2">
                          Out
                        </Badge>
                      )}
                    </Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Quick actions">
                {can('pos.access') && matches(dq, 'new sale pos checkout') && (
                  <Item icon={<ScanBarcode />} onSelect={() => go('/pos')} aside="F2">
                    New sale
                  </Item>
                )}
                {can('purchases.manage') && matches(dq, 'new purchase receive stock') && (
                  <Item icon={<Truck />} onSelect={() => go('/purchases/new')}>
                    Receive stock (new purchase)
                  </Item>
                )}
                {can('products.manage') && matches(dq, 'add product new medicine') && (
                  <Item icon={<Plus />} onSelect={() => go('/products?new=1')}>
                    Add product
                  </Item>
                )}
                {can('backup.manage') && matches(dq, 'backup database') && (
                  <Item icon={<DatabaseBackup />} onSelect={() => go('/backup')}>
                    Backup database
                  </Item>
                )}
                {matches(dq, 'dark light theme') && (
                  <Item
                    icon={<Moon />}
                    onSelect={() => {
                      setTheme(theme === 'dark' ? 'light' : 'dark');
                      close();
                    }}
                  >
                    Toggle dark mode
                  </Item>
                )}
                {matches(dq, 'lock screen') && (
                  <Item
                    icon={<Lock />}
                    aside="Ctrl+L"
                    onSelect={() => {
                      close();
                      void api('auth.lock');
                    }}
                  >
                    Lock screen
                  </Item>
                )}
              </Command.Group>
              <Command.Group heading="Go to">
                {ALL_NAV_ITEMS.filter((i) => can(...i.perms) && matches(dq, i.label)).map((i) => {
                  const Icon = i.icon;
                  return (
                    <Item key={i.to} icon={<Icon />} onSelect={() => go(i.to)}>
                      {i.label}
                    </Item>
                  );
                })}
              </Command.Group>
            </Command.List>
            <div className="flex items-center gap-4 border-t border-border bg-subtle px-4 py-2 text-[11.5px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CornerDownLeft className="size-3.5" /> select
              </span>
              <span>↑↓ navigate</span>
              <span>Esc close</span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function matches(q: string, text: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return s.split(/\s+/).every((t) => text.toLowerCase().includes(t));
}

function Item({ children, icon, onSelect, aside }: { children: React.ReactNode; icon: React.ReactNode; onSelect: () => void; aside?: React.ReactNode }) {
  return (
    <Command.Item onSelect={onSelect} className="flex h-10 cursor-default items-center gap-3 rounded-lg px-2.5 text-[13.5px] data-[selected=true]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground">
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {aside && <span className="text-[11.5px] text-muted-foreground">{aside}</span>}
    </Command.Item>
  );
}
