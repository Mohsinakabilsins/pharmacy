import { useEffect, useState } from 'react';
import { Ban, HandCoins, Plus, Settings2, Pencil } from 'lucide-react';
import { todayLocal } from '@shared/dates';
import { useFormat } from '@renderer/lib/format';
import { useApiMutation, useApiQuery } from '@renderer/lib/query';
import { useDebounced } from '@renderer/lib/hotkeys';
import { useCan } from '@renderer/stores/session';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Badge, Card, CardHeader, EmptyState } from '@renderer/components/ui/display';
import { DateInput, MoneyInput, SearchInput } from '@renderer/components/ui/inputs';
import { Select } from '@renderer/components/ui/select';
import { Segmented, SwitchRow } from '@renderer/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog';
import { Field } from '@renderer/components/ui/field';
import { Input } from '@renderer/components/ui/input';
import { DataTable, Pagination } from '@renderer/components/DataTable';
import { DateRangePicker, FilterBar, presetRange } from '@renderer/components/FilterBar';
import { BarList } from '@renderer/components/Charts';
import { MethodLabel, StatusBadge } from '@renderer/components/StatusBadges';
import { useConfirm } from '@renderer/components/ui/confirm';

export function ExpensesPage() {
  const f = useFormat();
  const can = useCan();
  const confirm = useConfirm();
  const [range, setRange] = useState(presetRange('month'));
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [status, setStatus] = useState<'POSTED' | 'VOID' | 'all'>('POSTED');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const ds = useDebounced(search, 180);
  const cats = useApiQuery('expenseCategories.list');
  const { data, isLoading } = useApiQuery('expenses.list', { from: range.from, to: range.to, categoryId, status, search: ds, page, pageSize: 25 });
  const voidM = useApiMutation('expenses.void', { success: 'Expense voided' });
  return (
    <Page>
      <PageHeader
        title="Expenses"
        description="Operating expenses. Purchases of stock are not expenses — they reach profit through cost of goods sold."
        icon={<HandCoins />}
        actions={
          can('expenses.manage') && (
            <>
              <Button icon={<Settings2 />} onClick={() => setManaging(true)}>
                Categories
              </Button>
              <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                Record expense
              </Button>
            </>
          )
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
        <Card className="overflow-hidden">
          <FilterBar>
            <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Description, reference" className="w-60" />
            <DateRangePicker value={range} onChange={(r) => (setRange(r), setPage(1))} />
            <Select className="w-44" value={categoryId ? String(categoryId) : null} onChange={(v) => (setCategoryId(v ? Number(v) : null), setPage(1))} allowClear clearLabel="All categories" placeholder="All categories" options={(cats.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))} />
            <Segmented value={status} onChange={(v) => (setStatus(v), setPage(1))} options={[{ value: 'POSTED', label: 'Posted' }, { value: 'VOID', label: 'Void' }, { value: 'all', label: 'All' }]} />
          </FilterBar>
          <DataTable
            rows={data?.rows}
            loading={isLoading}
            rowKey={(r) => r.id}
            empty={<EmptyState icon={<HandCoins />} title="No expenses in this period" />}
            columns={[
              { key: 'no', header: 'No.', cell: (r) => <span className="font-medium">{r.expenseNo}</span> },
              { key: 'date', header: 'Date', cell: (r) => f.date(r.expenseDate) },
              { key: 'cat', header: 'Category', cell: (r) => <Badge>{r.categoryName}</Badge> },
              {
                key: 'desc',
                header: 'Description',
                cell: (r) => (
                  <div>
                    <div>{r.description}</div>
                    {r.voidReason && <div className="text-[11.5px] text-danger">Void: {r.voidReason}</div>}
                  </div>
                ),
              },
              { key: 'method', header: 'Paid by', cell: (r) => <MethodLabel method={r.paymentMethod} className="text-[12.5px]" /> },
              { key: 'amt', header: 'Amount', align: 'right', cell: (r) => <span className={r.status === 'VOID' ? 'text-muted-foreground line-through' : 'font-semibold'}>{f.money(r.amount)}</span> },
              { key: 'by', header: 'By', cell: (r) => <span className="text-[12.5px]">{r.createdByName}</span> },
              {
                key: 'act',
                header: '',
                cell: (r) =>
                  r.status === 'VOID' ? (
                    <StatusBadge status="VOID" />
                  ) : (
                    can('expenses.manage') && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Void"
                        onClick={async () => {
                          const reason = await confirm({ title: `Void ${r.expenseNo}?`, description: `${r.categoryName} · ${f.money(r.amount)}`, tone: 'danger', confirmLabel: 'Void expense', requireReason: true });
                          if (reason !== false) voidM.mutate({ id: r.id, reason });
                        }}
                      >
                        <Ban />
                      </Button>
                    )
                  ),
              },
            ]}
          />
          {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
        </Card>
        <Card className="h-fit">
          <CardHeader title="By category" description="Posted expenses in period" />
          <div className="px-5 pb-5">
            <div className="num mb-4 text-[26px] font-semibold tracking-tight">{f.money(data?.amountTotal ?? 0)}</div>
            {data && data.byCategory.length > 0 ? <BarList items={data.byCategory.map((c) => ({ key: c.categoryName, label: c.categoryName, value: c.amount }))} formatValue={(v) => f.money(v)} color="var(--chart-2)" /> : <EmptyState compact title="No expenses" />}
          </div>
        </Card>
      </div>
      <ExpenseDialog open={creating} onClose={() => setCreating(false)} />
      <CategoryManager open={managing} onClose={() => setManaging(false)} />
    </Page>
  );
}

function ExpenseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const f = useFormat();
  const cats = useApiQuery('expenseCategories.list', undefined, { enabled: open });
  const [date, setDate] = useState<string | null>(todayLocal());
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<'CASH' | 'CARD' | 'BANK_TRANSFER' | 'MOBILE_WALLET'>('CASH');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setDate(todayLocal());
      setAmount(null);
      setDescription('');
      setReference('');
      setErrors({});
    }
  }, [open]);
  const m = useApiMutation('expenses.create', { success: (e) => `Expense ${e.expenseNo} recorded`, onSuccess: onClose, onError: (e) => setErrors(e.fields ?? {}) });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader icon={<HandCoins />} title="Record expense" description="Cash expenses paid today are deducted from the open shift." />
        <DialogBody className="grid grid-cols-2 gap-4">
          <Field label="Category" required error={errors.categoryId}>
            <Select value={categoryId ? String(categoryId) : null} onChange={(v) => setCategoryId(v ? Number(v) : null)} placeholder="Select category" options={(cats.data ?? []).filter((c) => c.isActive).map((c) => ({ value: String(c.id), label: c.name }))} />
          </Field>
          <Field label="Date" required error={errors.expenseDate}>
            <DateInput value={date} onChange={setDate} max={todayLocal()} />
          </Field>
          <Field label="Amount" required error={errors.amount}>
            <MoneyInput value={amount} onChange={setAmount} symbol={f.symbol} autoFocus />
          </Field>
          <Field label="Paid by">
            <Select value={method} onChange={(v) => v && setMethod(v as typeof method)} options={['CASH', 'BANK_TRANSFER', 'CARD', 'MOBILE_WALLET'].map((m2) => ({ value: m2, label: <MethodLabel method={m2} /> }))} />
          </Field>
          <Field label="Description" required error={errors.description} className="col-span-2">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. September electricity bill" />
          </Field>
          <Field label="Reference" className="col-span-2">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bill / receipt number" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={m.isPending} disabled={!categoryId || !amount || !description.trim()} onClick={() => m.mutate({ expenseDate: date ?? todayLocal(), categoryId: categoryId ?? 0, amount: amount ?? 0, description, paymentMethod: method, reference: reference || null })}>
            Save expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoryManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cats = useApiQuery('expenseCategories.list', undefined, { enabled: open });
  const [edit, setEdit] = useState<{ id?: number; name: string; isActive: boolean } | null>(null);
  const save = useApiMutation('expenseCategories.save', { success: 'Saved', onSuccess: () => setEdit(null) });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader icon={<Settings2 />} title="Expense categories" />
        <DialogBody className="space-y-1.5">
          {cats.data?.map((c) => (
            <button key={c.id} type="button" onClick={() => setEdit({ id: c.id, name: c.name, isActive: c.isActive })} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-[13.5px] hover:bg-muted">
              <span className={c.isActive ? '' : 'text-muted-foreground line-through'}>{c.name}</span>
              <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
                {c.expenseCount} <Pencil className="size-3.5" />
              </span>
            </button>
          ))}
          {edit && (
            <div className="mt-3 space-y-3 rounded-xl border border-border p-3">
              <Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Category name" />
              <SwitchRow label="Active" checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
                  Cancel
                </Button>
                <Button size="sm" variant="primary" loading={save.isPending} disabled={!edit.name.trim()} onClick={() => save.mutate({ id: edit.id, name: edit.name, isActive: edit.isActive })}>
                  Save
                </Button>
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button icon={<Plus />} onClick={() => setEdit({ name: '', isActive: true })}>
            New category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
