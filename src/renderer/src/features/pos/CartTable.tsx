import { useState } from 'react';
import { AlertTriangle, ChevronDown, Minus, Plus, ShieldCheck, Trash2, Layers, Percent, Tag } from 'lucide-react';
import type { QuoteLine, SaleQuote } from '@shared/types/sales';
import { cn } from '@renderer/lib/cn';
import { useFormat } from '@renderer/lib/format';
import { useApiQuery } from '@renderer/lib/query';
import { useOverride } from '@renderer/components/OverrideProvider';
import { Popover, PopoverContent, PopoverTrigger, Segmented } from '@renderer/components/ui/controls';
import { Badge } from '@renderer/components/ui/display';
import { Button } from '@renderer/components/ui/button';
import { MoneyInput, NumberInput } from '@renderer/components/ui/inputs';
import { RxBadges } from '@renderer/components/StatusBadges';
import { usePos, type CartLine } from './store';

export function CartTable({ quote }: { quote: SaleQuote | undefined }) {
  const lines = usePos((s) => s.lines);
  const selected = usePos((s) => s.selected);
  const select = usePos((s) => s.select);
  const byKey = new Map(quote?.lines.map((l) => [l.key, l]));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-10">
          <tr className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            <th className="w-10 border-b border-border bg-subtle/95 py-2.5 ps-4 text-start backdrop-blur">#</th>
            <th className="border-b border-border bg-subtle/95 px-3 py-2.5 text-start backdrop-blur">Item</th>
            <th className="w-[196px] border-b border-border bg-subtle/95 px-3 py-2.5 text-center backdrop-blur">Quantity</th>
            <th className="w-[120px] border-b border-border bg-subtle/95 px-3 py-2.5 text-end backdrop-blur">Price</th>
            <th className="w-[92px] border-b border-border bg-subtle/95 px-3 py-2.5 text-end backdrop-blur">Discount</th>
            <th className="w-[120px] border-b border-border bg-subtle/95 px-3 py-2.5 text-end backdrop-blur">Amount</th>
            <th className="w-12 border-b border-border bg-subtle/95 backdrop-blur" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <CartRow key={l.key} index={i} line={l} q={byKey.get(l.key)} selected={selected === l.key} onSelect={() => select(l.key)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CartRow({ line, q, index, selected, onSelect }: { line: CartLine; q: QuoteLine | undefined; index: number; selected: boolean; onSelect: () => void }) {
  const f = useFormat();
  const update = usePos((s) => s.update);
  const remove = usePos((s) => s.remove);
  const addToken = usePos((s) => s.addToken);
  const requestOverride = useOverride();
  const packSize = q?.packSize ?? line.packSize;
  const unitMode = packSize > 1 ? line.unitMode : 'pack';
  const displayQty = unitMode === 'pack' ? line.quantity / packSize : line.quantity;
  const step = unitMode === 'pack' ? packSize : 1;
  const errors = q?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = q?.issues.filter((i) => i.severity === 'warning') ?? [];

  const setQty = (n: number | null) => {
    if (!n || n <= 0) return;
    update(line.key, { quantity: unitMode === 'pack' ? n * packSize : n });
  };

  return (
    <tr onClick={onSelect} className={cn('group align-top transition-colors', selected ? 'bg-primary-soft/50 dark:bg-primary-soft/60' : 'hover:bg-subtle')}>
      <td className={cn('border-b border-border/70 py-3 ps-4 text-[12px] font-medium text-muted-foreground', selected && 'shadow-[inset_3px_0_0_var(--primary)]')}>{index + 1}</td>
      <td className="border-b border-border/70 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold">{q?.productName ?? line.name}</span>
          <RxBadges rx={q?.requiresPrescription} controlled={q?.isControlled} />
          {q?.priceOverridden && <Badge tone="violet">Price changed</Badge>}
        </div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">{q?.genericName ?? ' '}</div>
        <BatchPicker line={line} q={q} />
        {errors.map((e) => (
          <div key={e.code + e.message} className="mt-1.5 flex items-center gap-2 text-[12px] font-medium text-danger">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span>{e.message}</span>
            {e.permission && (
              <Button
                size="xs"
                variant="danger-soft"
                icon={<ShieldCheck />}
                onClick={async (ev) => {
                  ev.stopPropagation();
                  const token = await requestOverride(e.permission!, `${q?.productName}: ${e.message}`);
                  if (token) addToken(token);
                }}
              >
                Authorise
              </Button>
            )}
          </div>
        ))}
        {warnings.map((w) => (
          <div key={w.code + w.message} className="mt-1 flex items-center gap-1.5 text-[12px] text-warning">
            <AlertTriangle className="size-3.5" />
            {w.message}
          </div>
        ))}
      </td>
      <td className="border-b border-border/70 px-3 py-2.5">
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="secondary" aria-label="Decrease" onClick={(e) => (e.stopPropagation(), line.quantity - step > 0 && update(line.key, { quantity: line.quantity - step }))}>
              <Minus />
            </Button>
            <NumberInput value={displayQty} onChange={setQty} min={1} className="w-[68px]" size="sm" />
            <Button size="icon-sm" variant="secondary" aria-label="Increase" onClick={(e) => (e.stopPropagation(), update(line.key, { quantity: line.quantity + step }))}>
              <Plus />
            </Button>
          </div>
          {packSize > 1 ? (
            <Segmented
              size="sm"
              value={unitMode}
              onChange={(m) => {
                if (m === 'pack') {
                  const packs = Math.max(1, Math.round(line.quantity / packSize));
                  update(line.key, { unitMode: 'pack', quantity: packs * packSize });
                } else update(line.key, { unitMode: 'unit' });
              }}
              options={[
                { value: 'pack', label: `${line.packName} (${packSize})` },
                ...(q?.allowLooseSale ?? line.allowLooseSale ? [{ value: 'unit' as const, label: line.unitName }] : []),
              ]}
            />
          ) : (
            <span className="text-[11.5px] text-muted-foreground">{line.unitName}</span>
          )}
          {q && q.available > 0 && <span className="num text-[11px] text-muted-foreground">{f.qty(q.available, packSize, q.unitName, q.packName)} in stock</span>}
        </div>
      </td>
      <td className="border-b border-border/70 px-3 py-3 text-end">
        <PricePopover line={line} q={q} />
      </td>
      <td className="border-b border-border/70 px-3 py-3 text-end">
        <DiscountPopover line={line} q={q} />
      </td>
      <td className="num border-b border-border/70 px-3 py-3 text-end text-[14.5px] font-semibold">{q ? f.money(q.total) : '—'}</td>
      <td className="border-b border-border/70 py-2.5 pe-3 text-end">
        <Button size="icon-sm" variant="ghost" className="opacity-60 group-hover:opacity-100 hover:!bg-danger-soft hover:!text-danger" aria-label="Remove" onClick={(e) => (e.stopPropagation(), remove(line.key))}>
          <Trash2 />
        </Button>
      </td>
    </tr>
  );
}

function BatchPicker({ line, q }: { line: CartLine; q: QuoteLine | undefined }) {
  const f = useFormat();
  const update = usePos((s) => s.update);
  const [open, setOpen] = useState(false);
  const batches = useApiQuery('batches.forProduct', { productId: line.productId, includeEmpty: false }, { enabled: open });
  const alloc = q?.allocations ?? [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()} className="mt-1.5 inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-md border border-dashed border-border-strong px-2 py-1 text-[11.5px] text-muted-foreground transition hover:border-primary hover:text-foreground">
          <Layers className="size-3.5 shrink-0" />
          <span className="flex min-w-0 flex-col items-start gap-0.5">
          {alloc.length === 0 ? (
            <span>No batch available</span>
          ) : (
            alloc.map((a) => (
              <span key={a.batchId} className={cn('num', a.expired && 'font-semibold text-danger', a.nearExpiry && 'text-warning')}>
                <span className="font-mono">{a.batchNumber}</span> · Exp {f.expiry(a.expiryDate)} · ×{a.quantity}
              </span>
            ))
          )}
          </span>
          <span className={cn('rounded px-1 text-[10px] font-semibold uppercase', q?.manualBatch ? 'bg-violet-soft text-violet' : 'bg-primary-soft text-primary-soft-foreground')}>{q?.manualBatch ? 'Manual' : 'FEFO'}</span>
          <ChevronDown className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[440px] p-1.5" onClick={(e) => e.stopPropagation()}>
        <div className="px-2.5 pb-2 pt-1.5 text-[12px] font-semibold text-muted-foreground">Choose batch — earliest expiry first</div>
        <button type="button" onClick={() => (update(line.key, { batchId: null }), setOpen(false))} className={cn('flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-start text-[13px] hover:bg-muted', !line.batchId && 'bg-primary-soft/60')}>
          <span className="font-medium">Automatic (FEFO)</span>
          <span className="text-[12px] text-muted-foreground">recommended</span>
        </button>
        <div className="my-1 h-px bg-border" />
        {batches.isLoading && <div className="px-3 py-4 text-[12.5px] text-muted-foreground">Loading batches…</div>}
        {batches.data?.map((b) => (
          <button
            key={b.id}
            type="button"
            disabled={b.status !== 'ACTIVE' || b.quantityOnHand <= 0}
            onClick={() => (update(line.key, { batchId: b.id }), setOpen(false))}
            className={cn('grid w-full grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-lg px-2.5 py-2 text-start text-[12.5px] hover:bg-muted disabled:opacity-40', line.batchId === b.id && 'bg-primary-soft/60')}
          >
            <span>
              <span className="font-mono font-medium">{b.batchNumber}</span>
              {b.status !== 'ACTIVE' && <Badge tone="warning" className="ms-2">{b.status}</Badge>}
              {b.isExpired && <Badge tone="danger" className="ms-2">Expired</Badge>}
            </span>
            <span className={cn('num', b.isExpired ? 'text-danger' : b.daysToExpiry <= 90 ? 'text-warning' : 'text-muted-foreground')}>{f.date(b.expiryDate)}</span>
            <span className="num w-20 text-end">{f.qty(b.quantityOnHand, b.packSize, b.unitName, b.packName, 'units')}</span>
            <span className="num w-20 text-end font-medium">{f.money(b.salePrice)}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function PricePopover({ line, q }: { line: CartLine; q: QuoteLine | undefined }) {
  const f = useFormat();
  const update = usePos((s) => s.update);
  const [value, setValue] = useState<number | null>(null);
  return (
    <Popover onOpenChange={(o) => o && setValue(q?.unitPrice ?? null)}>
      <PopoverTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()} className="num rounded-md px-1.5 py-0.5 text-[13.5px] font-medium hover:bg-muted">
          {q ? f.money(q.unitPrice) : '—'}
          {(q?.packSize ?? 1) > 1 && <div className="text-[10.5px] font-normal text-muted-foreground">per {line.packName.toLowerCase()}</div>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold">
          <Tag className="size-3.5" /> Price per {line.packName.toLowerCase()}
        </div>
        <MoneyInput value={value} onChange={setValue} symbol={f.symbol} autoFocus onEnter={() => update(line.key, { unitPrice: value })} />
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">Changing the batch price requires the price-override permission or supervisor approval.</p>
        <div className="mt-3 flex justify-between">
          <Button size="sm" variant="ghost" onClick={() => update(line.key, { unitPrice: null })}>
            Reset
          </Button>
          <Button size="sm" variant="primary" onClick={() => update(line.key, { unitPrice: value })}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DiscountPopover({ line, q }: { line: CartLine; q: QuoteLine | undefined }) {
  const f = useFormat();
  const update = usePos((s) => s.update);
  const [type, setType] = useState<'PERCENT' | 'AMOUNT'>(line.discount?.type ?? 'PERCENT');
  const [pct, setPct] = useState<number | null>(line.discount?.type === 'PERCENT' ? line.discount.value / 100 : null);
  const [amt, setAmt] = useState<number | null>(line.discount?.type === 'AMOUNT' ? line.discount.value : null);
  const apply = () => {
    if (type === 'PERCENT') update(line.key, { discount: pct ? { type, value: Math.round(pct * 100) } : null });
    else update(line.key, { discount: amt ? { type, value: amt } : null });
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()} className={cn('num rounded-md px-1.5 py-0.5 text-[13px] hover:bg-muted', q && q.discount > 0 ? 'font-medium text-success' : 'text-muted-foreground')}>
          {q && q.discount > 0 ? `−${f.money(q.discount, { symbol: false })}` : 'Add'}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
            <Percent className="size-3.5" /> Line discount
          </span>
          <Segmented size="sm" value={type} onChange={setType} options={[{ value: 'PERCENT', label: '%' }, { value: 'AMOUNT', label: f.symbol }]} />
        </div>
        {type === 'PERCENT' ? <NumberInput value={pct} onChange={setPct} max={100} allowDecimal suffix="%" autoFocus onEnter={apply} /> : <MoneyInput value={amt} onChange={setAmt} symbol={f.symbol} autoFocus onEnter={apply} />}
        <div className="mt-3 flex justify-between">
          <Button size="sm" variant="ghost" onClick={() => update(line.key, { discount: null })}>
            Remove
          </Button>
          <Button size="sm" variant="primary" onClick={apply}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
