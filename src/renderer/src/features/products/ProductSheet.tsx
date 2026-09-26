import { useState } from 'react';
import { Pill, Pencil, PackagePlus, Barcode, Power, SlidersHorizontal, MoreHorizontal, MapPin, Thermometer } from 'lucide-react';
import { useFormat } from '@renderer/lib/format';
import { useApiMutation, useApiQuery } from '@renderer/lib/query';
import { useCan } from '@renderer/stores/session';
import { cn } from '@renderer/lib/cn';
import { Sheet, SheetHeader } from '@renderer/components/ui/dialog';
import { Button } from '@renderer/components/ui/button';
import { Badge, Card, EmptyState, KeyValue, Skeleton, Stat } from '@renderer/components/ui/display';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/controls';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@renderer/components/ui/menu';
import { ExpiryBadge, RxBadges, StatusBadge, StockBadge } from '@renderer/components/StatusBadges';
import { MOVEMENT_LABELS } from '@shared/types/inventory';
import type { BatchRow } from '@shared/types/inventory';
import { ProductFormDialog } from './ProductForm';
import { LabelDialog } from './LabelDialog';
import { AdjustStockDialog, EditBatchDialog, OpeningStockDialog } from '../inventory/InventoryDialogs';

export function ProductSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const f = useFormat();
  const can = useCan();
  const { data: p, isLoading } = useApiQuery('products.get', { id: id ?? 0 }, { enabled: !!id });
  const batches = useApiQuery('batches.forProduct', { productId: id ?? 0, includeEmpty: true }, { enabled: !!id && can('inventory.view') });
  const moves = useApiQuery('inventory.movements', { productId: id ?? 0, page: 1, pageSize: 50 }, { enabled: !!id && can('inventory.view') });
  const [dialog, setDialog] = useState<'edit' | 'opening' | 'labels' | null>(null);
  const [adjust, setAdjust] = useState<BatchRow | null>(null);
  const [editBatch, setEditBatch] = useState<BatchRow | null>(null);
  const toggle = useApiMutation('products.setActive', { success: (d) => (d.isActive ? 'Product activated' : 'Product deactivated') });

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()} width="xl">
      {isLoading || !p ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-6 w-60" />
          <Skeleton className="h-4 w-80" />
          <Skeleton className="mt-6 h-48" />
        </div>
      ) : (
        <>
          <SheetHeader
            icon={<Pill />}
            title={`${p.brandName}${p.strength ? ` ${p.strength}` : ''}`}
            subtitle={[p.genericName, p.dosageForm, p.manufacturerName].filter(Boolean).join(' · ')}
            badges={
              <>
                <StockBadge status={p.stock.status} />
                <RxBadges rx={p.requiresPrescription} controlled={p.isControlled} />
                {!p.isActive && <StatusBadge status="Inactive" />}
                <Badge>{p.code}</Badge>
                {p.barcode && (
                  <Badge icon={<Barcode />}>
                    <span className="font-mono">{p.barcode}</span>
                  </Badge>
                )}
              </>
            }
            actions={
              <>
                {can('products.manage') && (
                  <Button size="sm" variant="primary" icon={<Pencil />} onClick={() => setDialog('edit')}>
                    Edit
                  </Button>
                )}
                {can('stock.opening') && (
                  <Button size="sm" icon={<PackagePlus />} onClick={() => setDialog('opening')}>
                    Opening stock
                  </Button>
                )}
                <Button size="sm" icon={<Barcode />} onClick={() => setDialog('labels')}>
                  Print labels
                </Button>
                {can('products.manage') && (
                  <Button size="sm" variant="ghost" icon={<Power />} loading={toggle.isPending} onClick={() => toggle.mutate({ id: p.id, isActive: !p.isActive })}>
                    {p.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                )}
              </>
            }
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-5 gap-3">
              <Card className="p-4">
                <Stat label="Sellable stock" value={f.qty(p.stock.sellable, p.packSize, p.unitName, p.packName)} sub={`${f.number(p.stock.sellable)} ${p.unitName.toLowerCase()}s`} />
              </Card>
              <Card className="p-4">
                <Stat label="Expired / blocked" value={f.number(p.stock.expired + p.stock.blocked)} tone={p.stock.expired > 0 ? 'danger' : undefined} sub={`${p.stock.expired} expired · ${p.stock.blocked} quarantined`} />
              </Card>
              <Card className="p-4">
                <Stat label="Nearest expiry" value={p.stock.nearestExpiry ? f.date(p.stock.nearestExpiry) : '—'} sub="Sellable batches" />
              </Card>
              <Card className="p-4">
                <Stat label="Stock value" value={p.stock.valueCost !== null ? f.money(p.stock.valueCost) : f.money(p.stock.valueRetail)} sub={p.stock.valueCost !== null ? `Retail ${f.money(p.stock.valueRetail)}` : 'At retail'} />
              </Card>
              <Card className="p-4">
                <Stat label="Sold · 30 days" value={f.qty(p.stock.soldLast30Days, p.packSize, p.unitName, p.packName)} sub={p.stock.lastSaleAt ? `Last sale ${f.date(p.stock.lastSaleAt)}` : 'No sales yet'} />
              </Card>
            </div>
            <Tabs defaultValue="batches" className="mt-6">
              <TabsList className="w-full">
                <TabsTrigger value="batches">Batches</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
                {can('inventory.view') && <TabsTrigger value="moves">Stock movements</TabsTrigger>}
              </TabsList>
              <TabsContent value="batches" className="pt-4">
                {batches.data && batches.data.length === 0 ? (
                  <EmptyState compact icon={<PackagePlus />} title="No batches yet" description="Receive stock through a purchase or add opening stock." />
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border">
                    <table className="w-full text-[13px]">
                      <thead className="bg-subtle text-[11px] uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2.5 text-start font-semibold">Batch</th>
                          <th className="px-3 py-2.5 text-start font-semibold">Expiry</th>
                          <th className="px-3 py-2.5 text-end font-semibold">On hand</th>
                          <th className="px-3 py-2.5 text-end font-semibold">Received</th>
                          {p.defaultCostPrice !== null && <th className="px-3 py-2.5 text-end font-semibold">Cost</th>}
                          <th className="px-3 py-2.5 text-end font-semibold">Price</th>
                          <th className="px-3 py-2.5 text-start font-semibold">Supplier</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/70">
                        {batches.data?.map((b) => (
                          <tr key={b.id} className={cn(b.quantityOnHand === 0 && 'text-muted-foreground')}>
                            <td className="px-4 py-2.5">
                              <div className="font-mono font-medium">{b.batchNumber}</div>
                              <div className="mt-0.5 flex gap-1.5">
                                {b.status !== 'ACTIVE' && <StatusBadge status={b.status} />}
                                {b.location && (
                                  <span className="inline-flex items-center gap-0.5 text-[11.5px] text-muted-foreground">
                                    <MapPin className="size-3" />
                                    {b.location}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="num">{f.date(b.expiryDate)}</div>
                              {b.quantityOnHand > 0 && <ExpiryBadge bucket={b.expiryBucket} days={b.daysToExpiry} />}
                            </td>
                            <td className="num px-3 py-2.5 text-end font-semibold">{f.qty(b.quantityOnHand, b.packSize, b.unitName, b.packName)}</td>
                            <td className="num px-3 py-2.5 text-end text-muted-foreground">{f.number(b.quantityReceived)}</td>
                            {p.defaultCostPrice !== null && <td className="num px-3 py-2.5 text-end">{f.money(b.costPrice, { symbol: false })}</td>}
                            <td className="num px-3 py-2.5 text-end">{f.money(b.salePrice, { symbol: false })}</td>
                            <td className="px-3 py-2.5 text-[12.5px]">
                              {b.supplierName ?? '—'}
                              {b.purchaseNo && <div className="text-[11.5px] text-muted-foreground">{b.purchaseNo}</div>}
                            </td>
                            <td className="pe-2">
                              {(can('stock.adjust') || can('batches.manage')) && (
                                <Menu>
                                  <MenuTrigger asChild>
                                    <Button size="icon-xs" variant="ghost" aria-label="Batch actions">
                                      <MoreHorizontal />
                                    </Button>
                                  </MenuTrigger>
                                  <MenuContent>
                                    {can('stock.adjust') && (
                                      <MenuItem icon={<SlidersHorizontal />} onSelect={() => setAdjust(b)}>
                                        Adjust stock / write off
                                      </MenuItem>
                                    )}
                                    {can('batches.manage') && (
                                      <MenuItem icon={<Pencil />} onSelect={() => setEditBatch(b)}>
                                        Edit batch
                                      </MenuItem>
                                    )}
                                  </MenuContent>
                                </Menu>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="details" className="pt-4">
                <Card className="p-5">
                  <KeyValue
                    cols={3}
                    items={[
                      ['Generic name', p.genericName],
                      ['Category', p.categoryName],
                      ['Manufacturer', p.manufacturerName],
                      ['Dosage form', p.dosageForm],
                      ['Strength', p.strength],
                      ['Packing', `${p.packSize} ${p.unitName.toLowerCase()}${p.packSize === 1 ? '' : 's'} per ${p.packName.toLowerCase()}${p.allowLooseSale ? ' · loose sale allowed' : ''}`],
                      ['Selling price', `${f.money(p.defaultSalePrice)} / ${p.packName.toLowerCase()}`],
                      ['Purchase price', p.defaultCostPrice !== null ? `${f.money(p.defaultCostPrice)} / ${p.packName.toLowerCase()}` : '—'],
                      ['Tax rate', p.taxRateBp ? `${p.taxRateBp / 100}%` : 'Exempt'],
                      ['Min / reorder / max', `${p.minStock} / ${p.reorderLevel} / ${p.maxStock || '—'}`],
                      [
                        'Storage',
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3.5 text-muted-foreground" />
                          {p.storageLocation ?? '—'}
                        </span>,
                      ],
                      [
                        'Condition',
                        <span className="inline-flex items-center gap-1">
                          <Thermometer className="size-3.5 text-muted-foreground" />
                          {p.storageCondition ?? '—'}
                        </span>,
                      ],
                      ['Last purchase', p.stock.lastPurchaseAt ? f.date(p.stock.lastPurchaseAt) : '—'],
                      ['Created', f.dateTime(p.createdAt)],
                      ['Updated', f.dateTime(p.updatedAt)],
                    ]}
                  />
                  {p.notes && <p className="mt-5 whitespace-pre-line border-t border-border pt-4 text-[13px] text-muted-foreground">{p.notes}</p>}
                </Card>
              </TabsContent>
              <TabsContent value="moves" className="pt-4">
                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-[13px]">
                    <thead className="bg-subtle text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 text-start font-semibold">When</th>
                        <th className="px-3 py-2.5 text-start font-semibold">Movement</th>
                        <th className="px-3 py-2.5 text-start font-semibold">Batch</th>
                        <th className="px-3 py-2.5 text-start font-semibold">Reference</th>
                        <th className="px-3 py-2.5 text-end font-semibold">Qty</th>
                        <th className="px-4 py-2.5 text-end font-semibold">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {moves.data?.rows.map((m) => (
                        <tr key={m.id}>
                          <td className="px-4 py-2 text-muted-foreground">{f.dateTime(m.createdAt)}</td>
                          <td className="px-3 py-2">{MOVEMENT_LABELS[m.movementType]}</td>
                          <td className="px-3 py-2 font-mono text-[12px]">{m.batchNumber}</td>
                          <td className="px-3 py-2 text-[12.5px]">
                            {m.referenceNo ?? '—'} <span className="text-muted-foreground">{m.userName ? `· ${m.userName}` : ''}</span>
                          </td>
                          <td className={cn('num px-3 py-2 text-end font-semibold', m.quantity > 0 ? 'text-success' : 'text-danger')}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td>
                          <td className="num px-4 py-2 text-end">{m.balanceAfter}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {moves.data?.rows.length === 0 && <EmptyState compact title="No movements yet" />}
                </div>
              </TabsContent>
            </Tabs>
          </div>
          <ProductFormDialog open={dialog === 'edit'} onClose={() => setDialog(null)} product={p} />
          <OpeningStockDialog open={dialog === 'opening'} onClose={() => setDialog(null)} product={p} />
          <LabelDialog open={dialog === 'labels'} onClose={() => setDialog(null)} productId={p.id} batches={batches.data ?? []} />
          <AdjustStockDialog batch={adjust} open={!!adjust} onClose={() => setAdjust(null)} />
          <EditBatchDialog batch={editBatch} open={!!editBatch} onClose={() => setEditBatch(null)} />
        </>
      )}
    </Sheet>
  );
}
