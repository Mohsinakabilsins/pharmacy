import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Pill, Plus, Tags, Factory, Pencil } from 'lucide-react';
import type { StockStatus } from '@shared/calc/stock';
import { useFormat } from '@renderer/lib/format';
import { useApiMutation, useApiQuery } from '@renderer/lib/query';
import { useDebounced } from '@renderer/lib/hotkeys';
import { useCan } from '@renderer/stores/session';
import { cn } from '@renderer/lib/cn';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Badge, Card, EmptyState } from '@renderer/components/ui/display';
import { SearchInput } from '@renderer/components/ui/inputs';
import { Select } from '@renderer/components/ui/select';
import { Segmented, Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog';
import { Field } from '@renderer/components/ui/field';
import { Input } from '@renderer/components/ui/input';
import { SwitchRow } from '@renderer/components/ui/controls';
import { DataTable, Pagination, type SortState } from '@renderer/components/DataTable';
import { FilterBar } from '@renderer/components/FilterBar';
import { RxBadges, StockBadge } from '@renderer/components/StatusBadges';
import { ProductFormDialog } from './ProductForm';
import { ProductSheet } from './ProductSheet';

export function ProductsPage() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  const openId = params.get('open') ? Number(params.get('open')) : null;
  useEffect(() => {
    if (params.get('new') === '1') setCreating(true);
  }, [params]);

  return (
    <Page>
      <PageHeader
        title="Products"
        description="Medicine master — brands, generics, packaging, pricing and stock levels."
        icon={<Pill />}
        actions={
          can('products.manage') && (
            <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
              New product
            </Button>
          )
        }
      />
      <Tabs defaultValue="products">
        <TabsList className="mb-4">
          <TabsTrigger value="products">
            <Pill /> Catalogue
          </TabsTrigger>
          <TabsTrigger value="categories">
            <Tags /> Categories
          </TabsTrigger>
          <TabsTrigger value="manufacturers">
            <Factory /> Manufacturers
          </TabsTrigger>
        </TabsList>
        <TabsContent value="products">
          <ProductList onOpen={(id) => setParams({ open: String(id) })} selected={openId} />
        </TabsContent>
        <TabsContent value="categories">
          <MasterList kind="category" />
        </TabsContent>
        <TabsContent value="manufacturers">
          <MasterList kind="manufacturer" />
        </TabsContent>
      </Tabs>
      <ProductFormDialog
        open={creating}
        onClose={() => {
          setCreating(false);
          if (params.get('new')) setParams({});
        }}
        onSaved={(p) => setParams({ open: String(p.id) })}
      />
      <ProductSheet id={openId} onClose={() => setParams({})} />
    </Page>
  );
}

function ProductList({ onOpen, selected }: { onOpen: (id: number) => void; selected: number | null }) {
  const f = useFormat();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [stock, setStock] = useState<'all' | 'in_stock' | 'low' | 'out' | 'reorder' | 'expired'>('all');
  const [rx, setRx] = useState<'all' | 'rx' | 'controlled'>('all');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const ds = useDebounced(search, 180);
  const cats = useApiQuery('categories.list', { includeInactive: false });
  const { data, isLoading } = useApiQuery('products.list', { search: ds, categoryId, stock, rx, status, sort: sort.key as never, dir: sort.dir, page, pageSize: 25 });
  const reset = () => setPage(1);

  return (
    <Card className="overflow-hidden">
      <FilterBar right={data && <span className="num text-[12.5px] text-muted-foreground">{f.number(data.total)} products</span>}>
        <SearchInput value={search} onChange={(v) => (setSearch(v), reset())} placeholder="Brand, generic, barcode, code, strength…" className="w-80" />
        <Select className="w-44" value={categoryId ? String(categoryId) : null} onChange={(v) => (setCategoryId(v ? Number(v) : null), reset())} allowClear clearLabel="All categories" placeholder="All categories" options={(cats.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))} />
        <Select
          className="w-40"
          value={stock}
          onChange={(v) => (setStock((v ?? 'all') as typeof stock), reset())}
          options={[
            { value: 'all', label: 'Any stock' },
            { value: 'in_stock', label: 'In stock' },
            { value: 'low', label: 'Low stock' },
            { value: 'reorder', label: 'Needs reorder' },
            { value: 'out', label: 'Out of stock' },
            { value: 'expired', label: 'Has expired stock' },
          ]}
        />
        <Segmented value={rx} onChange={(v) => (setRx(v), reset())} options={[{ value: 'all', label: 'All' }, { value: 'rx', label: 'Rx only' }, { value: 'controlled', label: 'Controlled' }]} />
        <Segmented value={status} onChange={(v) => (setStatus(v), reset())} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' }]} />
      </FilterBar>
      <DataTable
        rows={data?.rows}
        loading={isLoading}
        rowKey={(r) => r.id}
        selectedKey={selected}
        onRowClick={(r) => onOpen(r.id)}
        sort={sort}
        onSort={(s) => (setSort(s), reset())}
        rowClassName={(r) => (r.isActive ? undefined : 'opacity-60')}
        empty={<EmptyState icon={<Pill />} title="No products match" description="Adjust the filters or add a new product." />}
        columns={[
          {
            key: 'name',
            header: 'Product',
            sortKey: 'name',
            cell: (r) => (
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{r.brandName}</span>
                  {r.strength && <span className="text-muted-foreground">{r.strength}</span>}
                  <RxBadges rx={r.requiresPrescription} controlled={r.isControlled} />
                </div>
                <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {r.genericName ?? '—'} · {r.code}
                  {r.manufacturerName && ` · ${r.manufacturerName}`}
                </div>
              </div>
            ),
          },
          { key: 'cat', header: 'Category', cell: (r) => <span className="text-[12.5px]">{r.categoryName ?? '—'}</span> },
          { key: 'form', header: 'Pack', cell: (r) => <span className="text-[12.5px] text-muted-foreground">{r.dosageForm ?? r.unitName} · {r.packSize > 1 ? `${r.packSize}/${r.packName.toLowerCase()}` : r.packName.toLowerCase()}</span> },
          {
            key: 'stock',
            header: 'Stock',
            sortKey: 'stock',
            align: 'right',
            cell: (r) => (
              <div className="flex flex-col items-end gap-1">
                <span className={cn('font-semibold', r.stockOnHand <= 0 && 'text-danger')}>{f.qty(r.stockOnHand, r.packSize, r.unitName, r.packName)}</span>
                <StockBadge status={r.stockStatus as StockStatus} />
              </div>
            ),
          },
          {
            key: 'exp',
            header: 'Nearest expiry',
            sortKey: 'expiry',
            cell: (r) => (
              <div>
                <span className="num">{r.nearestExpiry ? f.expiry(r.nearestExpiry) : '—'}</span>
                {r.expiredQty > 0 && (
                  <Badge tone="danger" className="ms-2">
                    {r.expiredQty} expired
                  </Badge>
                )}
              </div>
            ),
          },
          { key: 'price', header: 'Price', sortKey: 'price', align: 'right', cell: (r) => <span className="font-medium">{f.money(r.defaultSalePrice)}</span> },
          ...(data?.rows[0]?.defaultCostPrice !== null && data?.rows.length ? [{ key: 'value', header: 'Stock value', align: 'right' as const, cell: (r: (typeof data.rows)[number]) => <span className="text-muted-foreground">{f.money(r.stockValueCost)}</span> }] : []),
          { key: 'loc', header: 'Location', cell: (r) => <span className="text-[12.5px] text-muted-foreground">{r.storageLocation ?? '—'}</span> },
        ]}
      />
      {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
    </Card>
  );
}

function MasterList({ kind }: { kind: 'category' | 'manufacturer' }) {
  const can = useCan();
  const cats = useApiQuery('categories.list', { includeInactive: true }, { enabled: kind === 'category' });
  const mans = useApiQuery('manufacturers.list', { includeInactive: true }, { enabled: kind === 'manufacturer' });
  const [edit, setEdit] = useState<{ id?: number; name: string; extra: string; isActive: boolean } | null>(null);
  const saveCat = useApiMutation('categories.save', { success: 'Saved', onSuccess: () => setEdit(null) });
  const saveMan = useApiMutation('manufacturers.save', { success: 'Saved', onSuccess: () => setEdit(null) });
  const rows = kind === 'category' ? (cats.data ?? []).map((c) => ({ id: c.id, name: c.name, extra: c.description ?? '', isActive: c.isActive, count: c.productCount })) : (mans.data ?? []).map((m) => ({ id: m.id, name: m.name, extra: m.country ?? '', isActive: m.isActive, count: m.productCount }));
  const label = kind === 'category' ? 'Category' : 'Manufacturer';
  return (
    <Card className="overflow-hidden">
      <FilterBar
        right={
          can('products.manage') && (
            <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setEdit({ name: '', extra: '', isActive: true })}>
              New {label.toLowerCase()}
            </Button>
          )
        }
      >
        <span className="text-[13px] text-muted-foreground">
          {rows.length} {kind === 'category' ? (rows.length === 1 ? 'category' : 'categories') : rows.length === 1 ? 'manufacturer' : 'manufacturers'}
        </span>
      </FilterBar>
      <DataTable
        rows={rows}
        loading={kind === 'category' ? cats.isLoading : mans.isLoading}
        rowKey={(r) => r.id}
        onRowClick={can('products.manage') ? (r) => setEdit({ id: r.id, name: r.name, extra: r.extra, isActive: r.isActive }) : undefined}
        empty={<EmptyState title={`No ${label.toLowerCase()} yet`} />}
        columns={[
          { key: 'name', header: label, cell: (r) => <span className="font-medium">{r.name}</span> },
          { key: 'extra', header: kind === 'category' ? 'Description' : 'Country', cell: (r) => <span className="text-muted-foreground">{r.extra || '—'}</span> },
          { key: 'count', header: 'Active products', align: 'right', cell: (r) => r.count },
          { key: 'status', header: 'Status', cell: (r) => (r.isActive ? <Badge tone="success" dot>Active</Badge> : <Badge>Inactive</Badge>) },
          { key: 'edit', header: '', width: 40, cell: () => (can('products.manage') ? <Pencil className="size-3.5 text-muted-foreground" /> : null) },
        ]}
      />
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        {edit && (
          <DialogContent size="sm">
            <DialogHeader icon={kind === 'category' ? <Tags /> : <Factory />} title={edit.id ? `Edit ${label.toLowerCase()}` : `New ${label.toLowerCase()}`} />
            <DialogBody className="space-y-4">
              <Field label="Name" required>
                <Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </Field>
              <Field label={kind === 'category' ? 'Description' : 'Country'}>
                <Input value={edit.extra} onChange={(e) => setEdit({ ...edit, extra: e.target.value })} />
              </Field>
              <SwitchRow label="Active" checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} />
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setEdit(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={saveCat.isPending || saveMan.isPending}
                disabled={!edit.name.trim()}
                onClick={() => (kind === 'category' ? saveCat.mutate({ id: edit.id, name: edit.name, description: edit.extra || null, isActive: edit.isActive }) : saveMan.mutate({ id: edit.id, name: edit.name, country: edit.extra || null, phone: null, isActive: edit.isActive }))}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
