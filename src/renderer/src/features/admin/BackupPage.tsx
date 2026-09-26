import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, DatabaseBackup, FolderOpen, HardDrive, History, RotateCcw, ShieldCheck, Usb, XCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import type { BackupFileInfo } from '@shared/types/system';
import type { AppSettings } from '@shared/settings';
import { formatBytes, relativeDays } from '@shared/format';
import { daysBetween, todayLocal, toLocalDate } from '@shared/dates';
import { api, ApiError, errorMessage } from '@renderer/lib/api';
import { useFormat } from '@renderer/lib/format';
import { queryClient, useApiMutation, useApiQuery } from '@renderer/lib/query';
import { cn } from '@renderer/lib/cn';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Alert, Badge, Card, CardHeader, EmptyState, KeyValue } from '@renderer/components/ui/display';
import { NumberInput } from '@renderer/components/ui/inputs';
import { SwitchRow } from '@renderer/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@renderer/components/ui/dialog';
import { Field } from '@renderer/components/ui/field';
import { Input } from '@renderer/components/ui/input';
import { DataTable } from '@renderer/components/DataTable';
import { StatusBadge } from '@renderer/components/StatusBadges';

export function BackupPage() {
  const f = useFormat();
  const status = useApiQuery('backup.status', undefined, { refetchInterval: 30_000 });
  const [busy, setBusy] = useState<'choose' | 'default' | 'restore' | null>(null);
  const [restoreInfo, setRestoreInfo] = useState<BackupFileInfo | null>(null);
  const s = status.data;
  const save = useApiMutation('settings.update', { success: 'Backup settings saved' });
  const lastAge = s?.lastSuccess ? daysBetween(toLocalDate(new Date(s.lastSuccess.createdAt)), todayLocal()) : null;
  const health: 'good' | 'warn' | 'bad' = !s?.lastSuccess ? 'bad' : lastAge! <= 1 ? 'good' : lastAge! <= 7 ? 'warn' : 'bad';

  const backup = async (mode: 'choose' | 'default') => {
    setBusy(mode);
    try {
      const r = await api('backup.create', { directory: mode === 'default' ? s?.effectiveDirectory : null });
      toast.success('Backup completed and verified', { description: r.filePath });
      void queryClient.invalidateQueries();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'CANCELLED')) toast.error(errorMessage(e), { duration: 10_000 });
    } finally {
      setBusy(null);
    }
  };

  const pickRestore = async () => {
    setBusy('restore');
    try {
      const info = await api('backup.pickFile');
      if (info) setRestoreInfo(info);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page>
      <PageHeader title="Backup & restore" description="Protect your pharmacy data. Keep a copy on a USB drive or external disk, away from this computer." icon={<DatabaseBackup />} />
      <div className="grid grid-cols-3 gap-4">
        <Card className="relative col-span-2 overflow-hidden p-6">
          <div className={cn('pointer-events-none absolute -end-16 -top-16 size-56 rounded-full blur-3xl', health === 'good' ? 'bg-success/15' : health === 'warn' ? 'bg-warning/15' : 'bg-danger/15')} />
          <div className="flex items-start gap-4">
            <div className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl', health === 'good' ? 'bg-success-soft text-success' : health === 'warn' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger')}>
              {health === 'good' ? <ShieldCheck className="size-6" /> : health === 'warn' ? <AlertTriangle className="size-6" /> : <XCircle className="size-6" />}
            </div>
            <div className="min-w-0">
              <div className="text-[17px] font-semibold tracking-tight">{health === 'good' ? 'Your data is backed up' : health === 'warn' ? 'Backup is getting old' : s?.lastSuccess ? 'Backup is out of date' : 'No backup yet'}</div>
              <div className="mt-1 text-[13px] text-muted-foreground">
                {s?.lastSuccess ? (
                  <>
                    Last verified backup {f.dateTime(s.lastSuccess.createdAt)} ({relativeDays(-(lastAge ?? 0))}) · {formatBytes(s.lastSuccess.sizeBytes)}
                    <div className="mt-0.5 truncate font-mono text-[11.5px]">{s.lastSuccess.filePath}</div>
                  </>
                ) : (
                  'Create your first backup now and store it on a USB drive.'
                )}
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button size="lg" variant="primary" icon={<Usb />} loading={busy === 'choose'} onClick={() => void backup('choose')}>
              Backup database…
            </Button>
            <Button size="lg" icon={<HardDrive />} loading={busy === 'default'} onClick={() => void backup('default')}>
              Backup to default folder
            </Button>
            <Button size="lg" variant="ghost" icon={<RotateCcw />} loading={busy === 'restore'} onClick={() => void pickRestore()}>
              Restore database…
            </Button>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-4 border-t border-border pt-5 text-[12.5px]">
            <div>
              <div className="text-muted-foreground">Database size</div>
              <div className="num mt-0.5 font-semibold">{s ? formatBytes(s.dbSizeBytes) : '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Automatic backup</div>
              <div className="mt-0.5 font-semibold">{s?.settings.autoEnabled ? `Every ${s.settings.intervalHours} h` : 'Off'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Next automatic</div>
              <div className="mt-0.5 font-semibold">{s?.nextAutoAt ? f.dateTime(s.nextAutoAt) : '—'}</div>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold">
            <ShieldCheck className="size-4 text-primary" /> Good practice
          </h3>
          <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-muted-foreground">
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              Back up to a USB drive at the end of every day and take it home.
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              Keep at least two drives and alternate them weekly.
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              Each backup is verified with an integrity check and never overwrites an existing file.
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              Restoring first saves a safety copy of the current data.
            </li>
          </ul>
        </Card>
      </div>

      {s && <AutoBackupSettings s={s.settings} defaultDir={s.defaultDirectory} onSave={({ lastBackupAt: _ignored, ...v }) => save.mutate({ section: 'backup', value: v })} saving={save.isPending} />}

      <Card className="mt-4 overflow-hidden">
        <CardHeader title="Backup history" icon={<History />} />
        <DataTable
          rows={s?.logs}
          loading={status.isLoading}
          rowKey={(r) => r.id}
          empty={<EmptyState compact title="No backups yet" />}
          columns={[
            { key: 'date', header: 'When', cell: (r) => f.dateTime(r.createdAt) },
            { key: 'kind', header: 'Type', cell: (r) => <Badge tone={r.kind === 'MANUAL' ? 'primary' : r.kind === 'PRE_RESTORE' ? 'warning' : 'neutral'}>{r.kind === 'PRE_RESTORE' ? 'Pre-restore safety' : r.kind.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge> },
            {
              key: 'file',
              header: 'File',
              cell: (r) => (
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12px]">{r.fileName}</div>
                  <div className="truncate text-[11.5px] text-muted-foreground">{r.error ?? r.filePath}</div>
                </div>
              ),
            },
            { key: 'size', header: 'Size', align: 'right', cell: (r) => (r.sizeBytes ? formatBytes(r.sizeBytes) : '—') },
            { key: 'by', header: 'By', cell: (r) => <span className="text-[12.5px]">{r.createdByName ?? 'System'}</span> },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'open',
              header: '',
              cell: (r) =>
                r.status === 'SUCCESS' && (
                  <Button size="icon-xs" variant="ghost" aria-label="Show in folder" onClick={() => void api('backup.showInFolder', { filePath: r.filePath })}>
                    <FolderOpen />
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <RestoreDialog info={restoreInfo} onClose={() => setRestoreInfo(null)} />
    </Page>
  );
}

function AutoBackupSettings({ s, defaultDir, onSave, saving }: { s: AppSettings['backup']; defaultDir: string; onSave: (v: AppSettings['backup']) => void; saving: boolean }) {
  const [v, setV] = useState(s);
  useEffect(() => setV(s), [s]);
  const dirty = JSON.stringify(v) !== JSON.stringify(s);
  return (
    <Card className="mt-4 p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-[14px] font-semibold">
            <Clock className="size-4 text-muted-foreground" /> Automatic backups
          </h3>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">Runs in the background while PharmaDesk is open. Old automatic backups are pruned; manual backups are never deleted.</p>
        </div>
        <Button variant="primary" size="sm" disabled={!dirty} loading={saving} onClick={() => onSave(v)}>
          Save
        </Button>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-x-10 gap-y-4">
        <SwitchRow label="Enable automatic backups" checked={v.autoEnabled} onChange={(x) => setV({ ...v, autoEnabled: x })} />
        <SwitchRow label="Back up when closing the app" description="Only when data changed since the last backup" checked={v.backupOnExit} onChange={(x) => setV({ ...v, backupOnExit: x })} />
        <Field label="Backup folder" hint={`Default: ${defaultDir}`}>
          <div className="flex gap-2">
            <Input className="flex-1 font-mono text-[12px]" value={v.directory} readOnly placeholder={defaultDir} />
            <Button
              icon={<FolderOpen />}
              onClick={async () => {
                const d = await api('backup.chooseDirectory');
                if (d) setV({ ...v, directory: d });
              }}
            >
              Choose
            </Button>
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Every">
            <NumberInput value={v.intervalHours} onChange={(x) => setV({ ...v, intervalHours: x ?? 24 })} min={1} max={168} suffix="hours" />
          </Field>
          <Field label="Keep last">
            <NumberInput value={v.keepLast} onChange={(x) => setV({ ...v, keepLast: x ?? 14 })} min={1} max={365} suffix="copies" />
          </Field>
        </div>
      </div>
    </Card>
  );
}

function RestoreDialog({ info, onClose }: { info: BackupFileInfo | null; onClose: () => void }) {
  const f = useFormat();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setTyped(''), [info]);
  return (
    <Dialog open={!!info} onOpenChange={(o) => !o && !busy && onClose()}>
      {info && (
        <DialogContent size="md">
          <DialogHeader icon={<RotateCcw />} tone={info.compatible ? 'warning' : 'danger'} title="Restore database" description={info.fileName} />
          <DialogBody className="space-y-4">
            {info.problem ? (
              <Alert tone="danger" icon={<XCircle />} title="This file cannot be restored">
                {info.problem}
              </Alert>
            ) : (
              <>
                <Alert tone="warning" icon={<AlertTriangle />} title="All current data will be replaced">
                  Everything recorded after this backup was made will be removed from the live database. A safety copy of the current data is saved first. PharmaDesk restarts after restoring.
                </Alert>
                <Card className="p-4">
                  <KeyValue
                    cols={3}
                    items={[
                      ['Pharmacy', info.pharmacyName],
                      ['Last activity', info.lastActivityAt ? f.dateTime(info.lastActivityAt) : '—'],
                      ['Size', formatBytes(info.sizeBytes)],
                      ['Products', f.number(info.counts.products)],
                      ['Sales', f.number(info.counts.sales)],
                      ['Purchases', f.number(info.counts.purchases)],
                      ['Customers', f.number(info.counts.customers)],
                      ['Suppliers', f.number(info.counts.suppliers)],
                      ['Integrity', <span className="text-success">✓ {info.integrity}</span>],
                    ]}
                  />
                </Card>
                <Field label={<>Type <b className="font-mono">RESTORE</b> to confirm</>}>
                  <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} className="font-mono" />
                </Field>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            {info.compatible && (
              <Button
                variant="danger"
                icon={<RotateCcw />}
                loading={busy}
                disabled={typed !== 'RESTORE'}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api('backup.restore', { filePath: info.filePath, confirm: 'RESTORE' });
                    toast.success('Database restored — restarting PharmaDesk…');
                  } catch (e) {
                    toast.error(errorMessage(e));
                    setBusy(false);
                  }
                }}
              >
                Restore and restart
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
