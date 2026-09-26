import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ScanBarcode, Search, PackageX, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import type { ProductSearchHit } from '@shared/types/catalog';
import { api } from '@renderer/lib/api';
import { cn } from '@renderer/lib/cn';
import { useDebounced } from '@renderer/lib/hotkeys';
import { useFormat } from '@renderer/lib/format';
import { useApiQuery } from '@renderer/lib/query';
import { Badge, Kbd, Spinner } from '@renderer/components/ui/display';
import { RxBadges } from '@renderer/components/StatusBadges';
import { daysBetween, todayLocal } from '@shared/dates';

export interface ProductSearchHandle {
  focus: () => void;
}

/**
 * POS product search. USB barcode scanners "type" the code and press Enter: an exact
 * barcode / product-code match is added immediately; otherwise Enter picks the highlighted result.
 */
export const ProductSearch = forwardRef<ProductSearchHandle, { onPick: (p: ProductSearchHit) => void; disabled?: boolean }>(({ onPick, disabled }, ref) => {
  const f = useFormat();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const dq = useDebounced(q, 90);
  const results = useApiQuery('products.search', { query: dq, limit: 40 }, { enabled: dq.trim().length >= 1, placeholderData: (prev) => prev, staleTime: 5_000 });
  const list = dq.trim() ? (results.data ?? []) : [];
  const listRef = useRef<HTMLDivElement>(null);
  const today = todayLocal();

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));
  useEffect(() => setActive(0), [dq]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (p: ProductSearchHit) => {
    onPick(p);
    setQ('');
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onEnter = async () => {
    const text = q.trim();
    if (!text) return;
    if (/^[\w-]{4,}$/.test(text)) {
      try {
        const hit = await api('products.byBarcode', { barcode: text });
        if (hit && (hit.barcode === text || hit.code.toLowerCase() === text.toLowerCase())) return pick(hit);
      } catch {
        /* fall through */
      }
    }
    const fresh = dq === q ? list : await api('products.search', { query: text, limit: 40 }).catch(() => []);
    if (fresh[active]) pick(fresh[active]);
    else if (fresh.length === 0) toast.error(`No product found for “${text}”`);
  };

  return (
    <div className="relative">
      <div className={cn('flex h-[52px] items-center gap-3 rounded-xl border border-input bg-card px-4 shadow-card transition focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/15', disabled && 'opacity-50')}>
        <ScanBarcode className="size-5 text-primary" />
        <input
          ref={inputRef}
          disabled={disabled}
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, list.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              void onEnter();
            } else if (e.key === 'Escape') {
              if (q) {
                e.stopPropagation();
                setQ('');
              } else {
                inputRef.current?.blur();
              }
            }
          }}
          placeholder="Scan a barcode, or search brand, generic, strength, manufacturer…"
          className="h-full flex-1 bg-transparent text-[15.5px] outline-none placeholder:text-muted-foreground/70"
        />
        {results.isFetching && dq ? <Spinner /> : <Search className="size-4 text-muted-foreground" />}
        <Kbd>F2</Kbd>
      </div>
      {open && dq.trim() && (
        <div ref={listRef} className="absolute inset-x-0 top-[58px] z-30 max-h-[min(520px,60vh)] overflow-y-auto rounded-xl border border-border bg-elevated p-1.5 shadow-dialog">
          {list.length === 0 && !results.isFetching && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-[13px] text-muted-foreground">
              <PackageX className="size-6" />
              No medicines match “{dq}”
            </div>
          )}
          {list.map((p, i) => {
            const days = p.nearestExpiry ? daysBetween(today, p.nearestExpiry) : null;
            const out = p.sellableQty <= 0;
            return (
              <button
                key={p.id}
                type="button"
                data-idx={i}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(p)}
                className={cn('flex w-full items-center gap-4 rounded-lg px-3 py-2.5 text-start transition', i === active ? 'bg-primary-soft/70 dark:bg-primary-soft' : 'hover:bg-muted', out && 'opacity-60')}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-semibold">{p.brandName}</span>
                    {p.strength && <span className="text-[13px] text-muted-foreground">{p.strength}</span>}
                    {p.dosageForm && <span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">{p.dosageForm}</span>}
                    <RxBadges rx={p.requiresPrescription} controlled={p.isControlled} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 truncate text-[12px] text-muted-foreground">
                    <span className="truncate">{p.genericName ?? '—'}</span>
                    {p.manufacturerName && <span>· {p.manufacturerName}</span>}
                    {p.storageLocation && (
                      <span className="inline-flex items-center gap-0.5">
                        · <MapPin className="size-3" />
                        {p.storageLocation}
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-36 text-end">
                  {out ? (
                    <Badge tone="danger">{p.expiredQty > 0 ? 'Only expired stock' : 'Out of stock'}</Badge>
                  ) : (
                    <div className="num text-[12.5px] font-medium">{f.qty(p.sellableQty, p.packSize, p.unitName, p.packName)}</div>
                  )}
                  {days !== null && !out && <div className={cn('text-[11.5px]', days <= 90 ? 'font-medium text-warning' : 'text-muted-foreground')}>Exp {f.expiry(p.nearestExpiry)}</div>}
                </div>
                <div className="num w-24 text-end">
                  <div className="text-[14.5px] font-semibold">{f.money(p.price)}</div>
                  <div className="text-[11px] text-muted-foreground">per {p.packName.toLowerCase()}{p.packSize > 1 ? ` of ${p.packSize}` : ''}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
ProductSearch.displayName = 'ProductSearch';
