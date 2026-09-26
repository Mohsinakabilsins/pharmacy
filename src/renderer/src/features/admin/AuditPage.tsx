import { useState } from 'react';
import { ScrollText, ShieldAlert, AlertTriangle, Info, ChevronDown } from 'lucide-react';
import { useFormat } from '@renderer/lib/format';
import { useApiQuery } from '@renderer/lib/query';
import { useDebounced } from '@renderer/lib/hotkeys';
import { cn } from '@renderer/lib/cn';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Badge, Card, EmptyState } from '@renderer/components/ui/display';
import { SearchInput } from '@renderer/components/ui/inputs';
import { Select } from '@renderer/components/ui/select';
import { Segmented } from '@renderer/components/ui/controls';
import { Pagination } from '@renderer/components/DataTable';
import { DateRangePicker, FilterBar, presetRange } from '@renderer/components/FilterBar';

const SEV = { INFO: { icon: Info, tone: 'info' as const }, WARNING: { icon: AlertTriangle, tone: 'warning' as const }, CRITICAL: { icon: ShieldAlert, tone: 'danger' as const } };

export function AuditPage() {
  const f = useFormat();
  const [range, setRange] = useState(presetRange('7d'));
  const [severity, setSeverity] = useState<'all' | 'INFO' | 'WARNING' | 'CRITICAL'>('all');
  const [action, setAction] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const ds = useDebounced(search, 200);
  const actions = useApiQuery('audit.actions');
  const users = useApiQuery('users.options');
  const { data, isLoading } = useApiQuery('audit.list', { from: range.from, to: range.to, severity, action, userId, search: ds, page, pageSize: 40 });
  return (
    <Page>
      <PageHeader title="Audit log" description="Append-only record of sign-ins, sales, stock changes, price changes, overrides and administrative actions. Entries cannot be edited or deleted." icon={<ScrollText />} />
      <Card className="overflow-hidden">
        <FilterBar right={data && <span className="num text-[12.5px] text-muted-foreground">{f.number(data.total)} entries</span>}>
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Search descriptions" />
          <DateRangePicker value={range} onChange={(r) => (setRange(r), setPage(1))} />
          <Segmented value={severity} onChange={(v) => (setSeverity(v), setPage(1))} options={[{ value: 'all', label: 'All' }, { value: 'INFO', label: 'Info' }, { value: 'WARNING', label: 'Warning' }, { value: 'CRITICAL', label: 'Critical' }]} />
          <Select className="w-52" value={action} onChange={(v) => (setAction(v), setPage(1))} allowClear clearLabel="All actions" placeholder="All actions" options={(actions.data ?? []).map((a) => ({ value: a, label: a.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }))} />
          <Select className="w-44" value={userId ? String(userId) : null} onChange={(v) => (setUserId(v ? Number(v) : null), setPage(1))} allowClear clearLabel="All users" placeholder="All users" options={(users.data ?? []).map((u) => ({ value: String(u.id), label: u.name }))} />
        </FilterBar>
        <div className="divide-y divide-border/70">
          {data?.rows.map((r) => {
            const S = SEV[r.severity];
            const Icon = S.icon;
            const open = expanded === r.id;
            return (
              <div key={r.id} className={cn('px-5 py-3 transition', r.details && 'cursor-pointer hover:bg-subtle')} onClick={() => r.details && setExpanded(open ? null : r.id)}>
                <div className="flex items-start gap-3.5">
                  <div className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', S.tone === 'info' ? 'bg-info-soft text-info' : S.tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger')}>
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px]">{r.description}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                      <Badge tone={S.tone}>{r.action.replace(/_/g, ' ')}</Badge>
                      <span>{r.fullName ?? r.username ?? 'System'}</span>
                      <span>·</span>
                      <span className="num">{f.dateTime(r.createdAt)}</span>
                      {r.entityType && (
                        <>
                          <span>·</span>
                          <span>
                            {r.entityType}
                            {r.entityId ? ` #${r.entityId}` : ''}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {r.details && <ChevronDown className={cn('mt-1 size-4 text-muted-foreground transition', open && 'rotate-180')} />}
                </div>
                {open && r.details && <pre className="selectable ms-[46px] mt-3 max-h-72 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11.5px] leading-relaxed text-foreground/85">{JSON.stringify(JSON.parse(r.details), null, 2)}</pre>}
              </div>
            );
          })}
        </div>
        {!isLoading && data?.rows.length === 0 && <EmptyState icon={<ScrollText />} title="No audit entries match" />}
        {data && <Pagination page={page} pageSize={40} total={data.total} onPage={setPage} />}
      </Card>
    </Page>
  );
}
