import { useEffect, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { ProductSearchHit } from '@shared/types/catalog';
import { useDebounced } from '@renderer/lib/hotkeys';
import { useApiQuery } from '@renderer/lib/query';
import { useFormat } from '@renderer/lib/format';
import { cn } from '@renderer/lib/cn';
import { api } from '@renderer/lib/api';
import { RxBadges } from './StatusBadges';

/** Inline product search with keyboard navigation (used in purchases and prescriptions). */
export function ProductPicker({ onPick, placeholder = 'Add product — type name, generic or scan barcode…', autoFocus, className, includeInactive }: { onPick: (p: ProductSearchHit) => void; placeholder?: string; autoFocus?: boolean; className?: string; includeInactive?: boolean }) {
  const f = useFormat();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const dq = useDebounced(q, 100);
  const res = useApiQuery('products.search', { query: dq, limit: 15, includeInactive: !!includeInactive }, { enabled: dq.trim().length > 0 });
  const list = dq.trim() ? (res.data ?? []) : [];
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setActive(0), [dq]);
  const pick = (p: ProductSearchHit) => {
    onPick(p);
    setQ('');
    setOpen(false);
  };
  return (
    <div className={cn('relative', className)}>
      <div className="flex h-10 items-center gap-2.5 rounded-lg border border-dashed border-border-strong bg-card px-3 transition focus-within:border-solid focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/15">
        <Plus className="size-4 text-primary" />
        <input
          ref={ref}
          autoFocus={autoFocus}
          value={q}
          placeholder={placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={async (e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, list.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const text = q.trim();
              if (!text) return;
              const exact = /^[\w-]{4,}$/.test(text) ? await api('products.byBarcode', { barcode: text }).catch(() => null) : null;
              if (exact && (exact.barcode === text || exact.code.toLowerCase() === text.toLowerCase())) pick(exact);
              else if (list[active]) pick(list[active]);
            } else if (e.key === 'Escape') setQ('');
          }}
          className="h-full flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/70"
        />
        <Search className="size-4 text-muted-foreground" />
      </div>
      {open && list.length > 0 && (
        <div className="absolute inset-x-0 top-11 z-30 max-h-80 overflow-y-auto rounded-xl border border-border bg-elevated p-1 shadow-dialog">
          {list.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(p)}
              className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start', i === active ? 'bg-muted' : '')}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13.5px]">
                  <span className="font-semibold">{p.brandName}</span>
                  <span className="text-muted-foreground">{p.strength}</span>
                  <RxBadges rx={p.requiresPrescription} controlled={p.isControlled} />
                </div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {p.genericName} · {p.packSize > 1 ? `${p.packSize} ${p.unitName.toLowerCase()}s / ${p.packName.toLowerCase()}` : p.packName}
                </div>
              </div>
              <div className="num text-end text-[12px] text-muted-foreground">
                <div>{f.qty(p.sellableQty, p.packSize, p.unitName, p.packName)}</div>
                <div className="font-medium text-foreground">{f.money(p.price)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
