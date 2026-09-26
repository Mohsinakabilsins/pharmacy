import { useEffect, useRef, useState } from 'react';
import { Archive, FileHeart, ImagePlus, Paperclip, Pencil, Plus, Trash2, Stethoscope, FileText, Download } from 'lucide-react';
import { toast } from 'sonner';
import type { PrescriptionDetail } from '@shared/types/customers';
import { todayLocal } from '@shared/dates';
import { api, errorMessage } from '@renderer/lib/api';
import { useFormat } from '@renderer/lib/format';
import { useApiMutation, useApiQuery } from '@renderer/lib/query';
import { useDebounced } from '@renderer/lib/hotkeys';
import { useCan } from '@renderer/stores/session';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { Button } from '@renderer/components/ui/button';
import { Alert, Badge, Card, EmptyState, KeyValue, Skeleton } from '@renderer/components/ui/display';
import { DateInput, SearchInput } from '@renderer/components/ui/inputs';
import { Select } from '@renderer/components/ui/select';
import { Segmented } from '@renderer/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Sheet, SheetHeader } from '@renderer/components/ui/dialog';
import { Field, FormSection } from '@renderer/components/ui/field';
import { Input, Textarea } from '@renderer/components/ui/input';
import { DataTable, Pagination } from '@renderer/components/DataTable';
import { DateRangePicker, FilterBar, presetRange } from '@renderer/components/FilterBar';
import { ProductPicker } from '@renderer/components/ProductPicker';
import { StatusBadge } from '@renderer/components/StatusBadges';
import { useConfirm } from '@renderer/components/ui/confirm';

export function PrescriptionsPage() {
  const f = useFormat();
  const can = useCan();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED' | 'all'>('ACTIVE');
  const [range, setRange] = useState(presetRange('all'));
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [edit, setEdit] = useState<PrescriptionDetail | 'new' | null>(null);
  const ds = useDebounced(search, 180);
  const { data, isLoading } = useApiQuery('prescriptions.list', { search: ds, status, from: range.from, to: range.to, page, pageSize: 25 });
  return (
    <Page>
      <PageHeader
        title="Prescriptions"
        description="Dispensing records with prescriber details and scanned copies. Access is restricted to authorised staff."
        icon={<FileHeart />}
        actions={
          can('prescriptions.manage') && (
            <Button variant="primary" icon={<Plus />} onClick={() => setEdit('new')}>
              Record prescription
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        <FilterBar>
          <SearchInput value={search} onChange={(v) => (setSearch(v), setPage(1))} placeholder="Patient, prescriber, Rx number, phone" />
          <DateRangePicker value={range} onChange={(r) => (setRange(r), setPage(1))} />
          <Segmented value={status} onChange={(v) => (setStatus(v), setPage(1))} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }, { value: 'all', label: 'All' }]} />
        </FilterBar>
        <DataTable
          rows={data?.rows}
          loading={isLoading}
          rowKey={(r) => r.id}
          selectedKey={open}
          onRowClick={(r) => setOpen(r.id)}
          empty={<EmptyState icon={<FileHeart />} title="No prescriptions recorded" description="Record prescriptions to link them to sales of prescription-only and controlled medicines." />}
          columns={[
            { key: 'no', header: 'Rx no.', cell: (r) => <span className="font-semibold">{r.prescriptionNo}</span> },
            { key: 'date', header: 'Date', cell: (r) => f.date(r.prescriptionDate) },
            {
              key: 'patient',
              header: 'Patient',
              cell: (r) => (
                <div>
                  <div className="font-medium">{r.patientName}</div>
                  {r.customerName && r.customerName !== r.patientName && <div className="text-[12px] text-muted-foreground">Customer: {r.customerName}</div>}
                </div>
              ),
            },
            {
              key: 'doc',
              header: 'Prescriber',
              cell: (r) => (
                <div>
                  <div>{r.prescriberName}</div>
                  {r.clinic && <div className="text-[12px] text-muted-foreground">{r.clinic}</div>}
                </div>
              ),
            },
            { key: 'items', header: 'Items', align: 'right', cell: (r) => r.itemCount },
            { key: 'att', header: 'Scans', align: 'right', cell: (r) => (r.attachmentCount ? <Badge icon={<Paperclip />}>{r.attachmentCount}</Badge> : '—') },
            { key: 'sales', header: 'Dispensed', align: 'right', cell: (r) => (r.salesCount ? <Badge tone="success">{r.salesCount}×</Badge> : '—') },
            { key: 'by', header: 'Recorded by', cell: (r) => <span className="text-[12.5px]">{r.recordedByName}</span> },
            { key: 'st', header: '', cell: (r) => r.status === 'ARCHIVED' && <StatusBadge status="ARCHIVED" /> },
          ]}
        />
        {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
      <PrescriptionSheet id={open} onClose={() => setOpen(null)} onEdit={(p) => setEdit(p)} />
      <PrescriptionEditor value={edit} onClose={() => setEdit(null)} onSaved={(p) => setOpen(p.id)} />
    </Page>
  );
}

async function fileToPayload(file: File): Promise<{ fileName: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'; dataBase64: string }> {
  if (file.type === 'application/pdf') {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { fileName: file.name, mimeType: 'application/pdf', dataBase64: btoa(bin) };
  }
  // downscale images so scans stay small inside the database backup
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  return { fileName: file.name.replace(/\.\w+$/, '.jpg'), mimeType: 'image/jpeg', dataBase64: dataUrl.split(',')[1] };
}

function PrescriptionSheet({ id, onClose, onEdit }: { id: number | null; onClose: () => void; onEdit: (p: PrescriptionDetail) => void }) {
  const f = useFormat();
  const can = useCan();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ name: string; url: string; mime: string } | null>(null);
  const { data: p } = useApiQuery('prescriptions.get', { id: id ?? 0 }, { enabled: !!id });
  const attach = useApiMutation('prescriptions.addAttachment', { success: 'Scan attached' });
  const remove = useApiMutation('prescriptions.removeAttachment', { success: 'Attachment removed' });
  const status = useApiMutation('prescriptions.setStatus', { success: (d) => (d.status === 'ARCHIVED' ? 'Archived' : 'Restored') });

  const view = async (attId: number) => {
    try {
      const a = await api('prescriptions.getAttachment', { id: attId });
      const bin = atob(a.dataBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      setPreview({ name: a.fileName, url: URL.createObjectURL(new Blob([bytes], { type: a.mimeType })), mime: a.mimeType });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()} width="lg">
      {!p ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <SheetHeader
            icon={<FileHeart />}
            title={`${p.prescriptionNo} · ${p.patientName}`}
            subtitle={`${f.date(p.prescriptionDate)} · ${p.prescriberName}${p.clinic ? `, ${p.clinic}` : ''}`}
            badges={<StatusBadge status={p.status} />}
            actions={
              can('prescriptions.manage') && (
                <>
                  <Button size="sm" variant="primary" icon={<Pencil />} onClick={() => onEdit(p)}>
                    Edit
                  </Button>
                  <Button size="sm" icon={<ImagePlus />} loading={attach.isPending} onClick={() => fileRef.current?.click()}>
                    Attach scan
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Archive />} onClick={() => status.mutate({ id: p.id, status: p.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' })}>
                    {p.status === 'ACTIVE' ? 'Archive' : 'Restore'}
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      if (file.size > 20 * 1024 * 1024) return toast.error('File is too large');
                      try {
                        attach.mutate({ prescriptionId: p.id, ...(await fileToPayload(file)) });
                      } catch (err) {
                        toast.error(errorMessage(err));
                      }
                    }}
                  />
                </>
              )
            }
          />
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <Alert tone="info" icon={<Stethoscope />}>
              PharmaDesk records prescriptions for dispensing and audit purposes only. It does not evaluate prescriptions clinically.
            </Alert>
            <Card className="p-5">
              <KeyValue
                cols={3}
                items={[
                  ['Patient', p.patientName],
                  ['Age', p.patientAge],
                  ['Customer account', p.customerName],
                  ['Prescriber', p.prescriberName],
                  ['Registration no.', p.prescriberRegistration],
                  ['Clinic / hospital', p.clinic],
                  ['Recorded by', p.recordedByName],
                  ['Recorded on', f.dateTime(p.createdAt)],
                ]}
              />
              {p.notes && <p className="mt-4 border-t border-border pt-4 text-[13px] text-muted-foreground">{p.notes}</p>}
            </Card>
            <div>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Prescribed items</div>
              <div className="overflow-hidden rounded-xl border border-border">
                {p.items.map((i) => (
                  <div key={i.id} className="flex items-start justify-between border-b border-border/70 px-4 py-2.5 last:border-0">
                    <div>
                      <div className="text-[13.5px] font-medium">{i.productName ?? i.medicineText}</div>
                      {i.instructions && <div className="text-[12.5px] text-muted-foreground">{i.instructions}</div>}
                    </div>
                    {i.quantity !== null && <span className="num text-[13px] text-muted-foreground">Qty {i.quantity}</span>}
                  </div>
                ))}
                {p.items.length === 0 && <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">No items recorded</div>}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Scanned copies</div>
              <div className="grid grid-cols-2 gap-2">
                {p.attachments.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">{a.mimeType === 'application/pdf' ? <FileText className="size-4" /> : <ImagePlus className="size-4" />}</div>
                    <button type="button" className="min-w-0 flex-1 text-start" onClick={() => void view(a.id)}>
                      <div className="truncate text-[13px] font-medium hover:text-primary">{a.fileName}</div>
                      <div className="text-[11.5px] text-muted-foreground">
                        {(a.size / 1024).toFixed(0)} KB · {f.date(a.createdAt)}
                      </div>
                    </button>
                    {can('prescriptions.manage') && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Remove"
                        onClick={async () => {
                          if ((await confirm({ title: 'Remove this attachment?', tone: 'danger', confirmLabel: 'Remove' })) !== false) remove.mutate({ id: a.id });
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {p.attachments.length === 0 && <EmptyState compact icon={<Paperclip />} title="No scans attached" description="Attach a photo or PDF of the prescription." />}
            </div>
            {p.sales.length > 0 && (
              <div>
                <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Dispensed on</div>
                {p.sales.map((s) => (
                  <div key={s.id} className="flex justify-between border-b border-border/70 py-2 text-[13px] last:border-0">
                    <span>
                      <b>{s.invoiceNo}</b> · {f.dateTime(s.createdAt)}
                    </span>
                    <span className="num">{f.money(s.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Dialog open={!!preview} onOpenChange={(o) => !o && (preview && URL.revokeObjectURL(preview.url), setPreview(null))}>
            {preview && (
              <DialogContent size="xl" className="h-[calc(100vh-48px)]">
                <DialogHeader icon={<FileText />} title={preview.name} />
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/60 p-4">
                  {preview.mime.startsWith('image/') ? (
                    <img src={preview.url} alt={preview.name} className="max-h-full max-w-full rounded-md shadow-pop" />
                  ) : (
                    <EmptyState icon={<FileText />} title="PDF document" description="Save the file to view it in your PDF reader." action={<Button asChild variant="primary"><a href={preview.url} download={preview.name}><Download /> Save PDF</a></Button>} />
                  )}
                </div>
              </DialogContent>
            )}
          </Dialog>
        </>
      )}
    </Sheet>
  );
}

interface RxItem {
  key: string;
  productId: number | null;
  medicineText: string;
  quantity: number | null;
  instructions: string;
}

function PrescriptionEditor({ value, onClose, onSaved }: { value: PrescriptionDetail | 'new' | null; onClose: () => void; onSaved: (p: PrescriptionDetail) => void }) {
  const editing = value && value !== 'new' ? value : null;
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [patientName, setPatientName] = useState('');
  const [patientAge, setPatientAge] = useState('');
  const [prescriber, setPrescriber] = useState('');
  const [reg, setReg] = useState('');
  const [clinic, setClinic] = useState('');
  const [date, setDate] = useState<string | null>(todayLocal());
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<RxItem[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const customers = useApiQuery('customers.search', { query: '', limit: 50 }, { enabled: !!value });
  useEffect(() => {
    if (!value) return;
    setErrors({});
    setCustomerId(editing?.customerId ?? null);
    setPatientName(editing?.patientName ?? '');
    setPatientAge(editing?.patientAge ?? '');
    setPrescriber(editing?.prescriberName ?? '');
    setReg(editing?.prescriberRegistration ?? '');
    setClinic(editing?.clinic ?? '');
    setDate(editing?.prescriptionDate ?? todayLocal());
    setNotes(editing?.notes ?? '');
    setItems(editing?.items.map((i) => ({ key: String(i.id), productId: i.productId, medicineText: i.medicineText, quantity: i.quantity, instructions: i.instructions ?? '' })) ?? []);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useApiMutation('prescriptions.save', { success: 'Prescription saved', onSuccess: (p) => (onSaved(p), onClose()), onError: (e) => setErrors(e.fields ?? {}) });
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader icon={<FileHeart />} title={editing ? `Edit ${editing.prescriptionNo}` : 'Record prescription'} description="Record only what is needed for dispensing. Do not store diagnoses." />
        <DialogBody className="space-y-6">
          <FormSection title="Patient">
            <div className="grid grid-cols-3 gap-4">
              <Field label="Customer account (optional)" className="col-span-2">
                <Select
                  value={customerId ? String(customerId) : null}
                  onChange={(v) => {
                    const id = v ? Number(v) : null;
                    setCustomerId(id);
                    const c = customers.data?.find((x) => x.id === id);
                    if (c && !patientName) setPatientName(c.name);
                  }}
                  allowClear
                  clearLabel="Not linked"
                  placeholder="Not linked"
                  options={(customers.data ?? []).map((c) => ({ value: String(c.id), label: `${c.name}${c.phone ? ` · ${c.phone}` : ''}` }))}
                />
              </Field>
              <Field label="Prescription date" required error={errors.prescriptionDate}>
                <DateInput value={date} onChange={setDate} max={todayLocal()} />
              </Field>
              <Field label="Patient name" required error={errors.patientName} className="col-span-2">
                <Input autoFocus value={patientName} onChange={(e) => setPatientName(e.target.value)} />
              </Field>
              <Field label="Age">
                <Input value={patientAge} onChange={(e) => setPatientAge(e.target.value)} placeholder="e.g. 54 / 6 months" />
              </Field>
            </div>
          </FormSection>
          <FormSection title="Prescriber">
            <div className="grid grid-cols-3 gap-4">
              <Field label="Doctor / prescriber" required error={errors.prescriberName}>
                <Input value={prescriber} onChange={(e) => setPrescriber(e.target.value)} placeholder="Dr. …" />
              </Field>
              <Field label="Registration no.">
                <Input value={reg} onChange={(e) => setReg(e.target.value)} placeholder="PMDC no." />
              </Field>
              <Field label="Clinic / hospital">
                <Input value={clinic} onChange={(e) => setClinic(e.target.value)} />
              </Field>
            </div>
          </FormSection>
          <FormSection title="Medicines">
            <div className="space-y-2">
              {items.map((it) => (
                <div key={it.key} className="grid grid-cols-[1.4fr_90px_1.4fr_36px] items-center gap-2">
                  <Input inputSize="sm" value={it.medicineText} onChange={(e) => setItems((s) => s.map((x) => (x.key === it.key ? { ...x, medicineText: e.target.value } : x)))} placeholder="Medicine" />
                  <Input inputSize="sm" value={it.quantity ?? ''} onChange={(e) => setItems((s) => s.map((x) => (x.key === it.key ? { ...x, quantity: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null } : x)))} placeholder="Qty" />
                  <Input inputSize="sm" value={it.instructions} onChange={(e) => setItems((s) => s.map((x) => (x.key === it.key ? { ...x, instructions: e.target.value } : x)))} placeholder="Instructions (e.g. 1 tab twice daily)" />
                  <Button size="icon-sm" variant="ghost" onClick={() => setItems((s) => s.filter((x) => x.key !== it.key))} aria-label="Remove">
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <ProductPicker
                placeholder="Add medicine from catalogue…"
                includeInactive
                onPick={(p) => setItems((s) => [...s, { key: `n${Date.now()}`, productId: p.id, medicineText: `${p.brandName}${p.strength ? ` ${p.strength}` : ''}`, quantity: null, instructions: '' }])}
              />
              <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setItems((s) => [...s, { key: `n${Date.now()}`, productId: null, medicineText: '', quantity: null, instructions: '' }])}>
                Add free-text line
              </Button>
            </div>
          </FormSection>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Dispensing notes (no diagnoses)" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!patientName.trim() || !prescriber.trim()}
            onClick={() =>
              save.mutate({
                id: editing?.id,
                customerId,
                patientName,
                patientAge: patientAge || null,
                prescriberName: prescriber,
                prescriberRegistration: reg || null,
                clinic: clinic || null,
                prescriptionDate: date ?? todayLocal(),
                notes: notes || null,
                items: items.filter((i) => i.medicineText.trim()).map((i) => ({ productId: i.productId, medicineText: i.medicineText, quantity: i.quantity, instructions: i.instructions || null })),
              })
            }
          >
            Save prescription
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
