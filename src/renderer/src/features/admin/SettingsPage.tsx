import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Building2,
  Coins,
  Cpu,
  FileText,
  Globe2,
  ImagePlus,
  Info,
  Lock,
  Package,
  Percent,
  Printer,
  Receipt,
  RotateCcw,
  Save,
  ScanBarcode,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AppSettings, SettingsSection } from '@shared/settings';
import { formatBytes, formatDate, formatDateTime, formatMoney } from '@shared/format';
import { api, errorMessage } from '@renderer/lib/api';
import { queryClient, useApiMutation, useApiQuery } from '@renderer/lib/query';
import { useSettings } from '@renderer/lib/format';
import { useCan } from '@renderer/stores/session';
import { cn } from '@renderer/lib/cn';
import { Page, PageHeader } from '@renderer/components/PageHeader';
import { usePrint } from '@renderer/components/PrintProvider';
import { useConfirm } from '@renderer/components/ui/confirm';
import { Button } from '@renderer/components/ui/button';
import { Alert, Badge, Card, KeyValue } from '@renderer/components/ui/display';
import { Field } from '@renderer/components/ui/field';
import { Input, Textarea } from '@renderer/components/ui/input';
import { NumberInput } from '@renderer/components/ui/inputs';
import { Select } from '@renderer/components/ui/select';
import { Segmented, SwitchRow } from '@renderer/components/ui/controls';

type SectionId = SettingsSection | 'about';

const SECTIONS: Array<{ id: SectionId; label: string; description: string; icon: ReactNode }> = [
  { id: 'pharmacy', label: 'Pharmacy profile', description: 'Name, address and licence shown on receipts', icon: <Building2 /> },
  { id: 'receipt', label: 'Receipt', description: 'Thermal receipt layout', icon: <Receipt /> },
  { id: 'invoice', label: 'A4 invoice', description: 'Printed invoice wording', icon: <FileText /> },
  { id: 'currency', label: 'Currency', description: 'Symbol and decimals', icon: <Coins /> },
  { id: 'locale', label: 'Language & region', description: 'Dates, numbers, language', icon: <Globe2 /> },
  { id: 'tax', label: 'Tax', description: 'GST / sales tax', icon: <Percent /> },
  { id: 'inventory', label: 'Inventory', description: 'Stock levels and expiry', icon: <Package /> },
  { id: 'sales', label: 'Sales & POS', description: 'Discounts, rounding, returns', icon: <ScanBarcode /> },
  { id: 'security', label: 'Security', description: 'Auto-lock and passwords', icon: <Lock /> },
  { id: 'printer', label: 'Printers', description: 'Default printers and test pages', icon: <Printer /> },
  { id: 'about', label: 'About', description: 'Version and data location', icon: <Info /> },
];

export function SettingsPage() {
  const [active, setActive] = useState<SectionId>('pharmacy');
  const meta = SECTIONS.find((s) => s.id === active)!;
  return (
    <Page>
      <PageHeader title="Settings" description="Configure how PharmaDesk works for your pharmacy. Every change is recorded in the audit log." />
      <div className="grid grid-cols-[248px_minmax(0,1fr)] items-start gap-6">
        <nav className="sticky top-0 flex flex-col gap-0.5 rounded-xl border border-border bg-card p-1.5 shadow-card">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-start text-[13px] font-medium transition',
                active === s.id ? 'bg-primary-soft text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span className={cn('[&_svg]:size-[17px]', active === s.id ? 'text-primary' : 'text-muted-foreground/80 group-hover:text-foreground')}>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary [&_svg]:size-5">{meta.icon}</div>
            <div>
              <h2 className="text-[16px] font-semibold tracking-tight">{meta.label}</h2>
              <p className="text-[12.5px] text-muted-foreground">{meta.description}</p>
            </div>
          </div>
          {active === 'about' ? <About /> : <SectionForm key={active} section={active} />}
        </div>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------------ */

function SectionForm<K extends SettingsSection>({ section }: { section: K }) {
  const all = useSettings();
  const saved = all[section];
  const [v, setV] = useState<AppSettings[K]>(saved);
  const can = useCan();
  const readOnly = !can('settings.manage');
  useEffect(() => setV(saved), [saved]);
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  const save = useApiMutation('settings.update', { success: 'Settings saved' });
  const set = <F extends keyof AppSettings[K]>(field: F, value: AppSettings[K][F]) => setV((x) => ({ ...x, [field]: value }));
  const props = { v, set, all } as unknown as FormProps<K>;

  const Form = FORMS[section] as unknown as (p: FormProps<K>) => ReactNode;
  return (
    <>
      <Card className="p-6">
        {readOnly && (
          <Alert tone="info" icon={<Lock />} className="mb-5">
            You can view these settings but not change them.
          </Alert>
        )}
        <fieldset disabled={readOnly} className="contents">
          <Form {...props} />
        </fieldset>
      </Card>
      <div
        className={cn(
          'sticky bottom-0 z-10 mt-4 flex items-center justify-between rounded-xl border border-border bg-card/95 px-4 py-3 shadow-pop backdrop-blur transition-all',
          dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
        )}
      >
        <span className="text-[13px] text-muted-foreground">You have unsaved changes</span>
        <div className="flex gap-2">
          <Button variant="ghost" icon={<RotateCcw />} onClick={() => setV(saved)}>
            Discard
          </Button>
          <Button variant="primary" icon={<Save />} loading={save.isPending} onClick={() => save.mutate({ section, value: v as Record<string, unknown> })}>
            Save changes
          </Button>
        </div>
      </div>
    </>
  );
}

interface FormProps<K extends SettingsSection> {
  v: AppSettings[K];
  set: <F extends keyof AppSettings[K]>(field: F, value: AppSettings[K][F]) => void;
  all: AppSettings;
}

const Grid = ({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) => <div className={cn('grid gap-x-5 gap-y-4', cols === 2 ? 'grid-cols-2' : 'grid-cols-3')}>{children}</div>;
const Divider = ({ title, description }: { title: string; description?: string }) => (
  <div className="mb-4 mt-7 border-t border-border pt-5 first:mt-0 first:border-0 first:pt-0">
    <h3 className="text-[13.5px] font-semibold tracking-tight">{title}</h3>
    {description && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>}
  </div>
);
const Switches = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-2 gap-x-10 gap-y-3">{children}</div>;

/** Basis-point value edited as a percentage (e.g. 1250 bp ↔ 12.5 %). */
function PercentInput({ bp, onChange, max = 100 }: { bp: number; onChange: (bp: number) => void; max?: number }) {
  return <NumberInput value={bp / 100} allowDecimal min={0} max={max} suffix="%" onChange={(x) => onChange(Math.round((x ?? 0) * 100))} />;
}

const FORMS: { [K in SettingsSection]: (p: FormProps<K>) => ReactNode } = {
  pharmacy: ({ v, set }) => (
    <>
      <div className="mb-6 flex items-center gap-5">
        <LogoPicker value={v.logo} onChange={(x) => set('logo', x)} />
        <div className="text-[12.5px] text-muted-foreground">
          <div className="text-[13px] font-medium text-foreground">Logo</div>
          Shown on receipts, invoices and the login screen. PNG or JPEG; it is resized automatically.
        </div>
      </div>
      <Grid>
        <Field label="Pharmacy name" required>
          <Input value={v.name} maxLength={120} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Tagline" hint="Optional line under the name">
          <Input value={v.tagline} maxLength={160} onChange={(e) => set('tagline', e.target.value)} />
        </Field>
        <Field label="Address" className="col-span-2">
          <Input value={v.address} maxLength={300} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="City">
          <Input value={v.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input value={v.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Drug sale licence no.">
          <Input value={v.licenseNo} onChange={(e) => set('licenseNo', e.target.value)} />
        </Field>
        <Field label="NTN / tax ID">
          <Input value={v.ntn} onChange={(e) => set('ntn', e.target.value)} />
        </Field>
      </Grid>
    </>
  ),

  receipt: ({ v, set }) => (
    <>
      <Divider title="Paper" />
      <Grid>
        <Field label="Paper width">
          <Segmented value={v.paperWidth} onChange={(x) => set('paperWidth', x)} options={[{ value: '80mm', label: '80 mm' }, { value: '58mm', label: '58 mm' }]} />
        </Field>
        <Field label="Copies per sale">
          <NumberInput value={v.copies} min={1} max={3} onChange={(x) => set('copies', Math.min(3, Math.max(1, x ?? 1)))} />
        </Field>
      </Grid>
      <Divider title="Show on receipt" />
      <Switches>
        <SwitchRow label="Logo" checked={v.showLogo} onChange={(x) => set('showLogo', x)} />
        <SwitchRow label="Invoice barcode" description="Scan to find the sale for returns" checked={v.showBarcode} onChange={(x) => set('showBarcode', x)} />
        <SwitchRow label="Batch number" checked={v.showBatch} onChange={(x) => set('showBatch', x)} />
        <SwitchRow label="Expiry date" checked={v.showExpiry} onChange={(x) => set('showExpiry', x)} />
        <SwitchRow label="Generic name" checked={v.showGeneric} onChange={(x) => set('showGeneric', x)} />
        <SwitchRow label="Cashier name" checked={v.showCashier} onChange={(x) => set('showCashier', x)} />
        <SwitchRow label="Print automatically after sale" checked={v.autoPrint} onChange={(x) => set('autoPrint', x)} />
      </Switches>
      <Divider title="Messages" />
      <div className="grid gap-4">
        <Field label="Header note">
          <Input value={v.headerNote} maxLength={300} onChange={(e) => set('headerNote', e.target.value)} />
        </Field>
        <Field label="Footer note">
          <Textarea rows={2} value={v.footerNote} maxLength={500} onChange={(e) => set('footerNote', e.target.value)} />
        </Field>
        <Field label="Return policy">
          <Textarea rows={2} value={v.returnPolicy} maxLength={300} onChange={(e) => set('returnPolicy', e.target.value)} />
        </Field>
      </div>
      <TestPrint target="receipt" />
    </>
  ),

  invoice: ({ v, set }) => (
    <>
      <div className="grid gap-4">
        <Field label="Document title">
          <Input value={v.title} maxLength={60} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Terms & conditions">
          <Textarea rows={4} value={v.terms} maxLength={800} onChange={(e) => set('terms', e.target.value)} />
        </Field>
        <Field label="Footer">
          <Input value={v.footer} maxLength={300} onChange={(e) => set('footer', e.target.value)} />
        </Field>
      </div>
      <TestPrint target="a4" />
    </>
  ),

  currency: ({ v, set, all }) => (
    <>
      <Grid>
        <Field label="Currency code">
          <Input value={v.code} maxLength={8} onChange={(e) => set('code', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Symbol">
          <Input value={v.symbol} maxLength={8} onChange={(e) => set('symbol', e.target.value)} />
        </Field>
        <Field label="Decimals">
          <Segmented value={String(v.decimals) as '0' | '2'} onChange={(x) => set('decimals', Number(x) as 0 | 2)} options={[{ value: '2', label: '2 (Rs 12.50)' }, { value: '0', label: 'None (Rs 13)' }]} />
        </Field>
        <Field label="Symbol position">
          <Segmented value={v.symbolPosition} onChange={(x) => set('symbolPosition', x)} options={[{ value: 'before', label: 'Before amount' }, { value: 'after', label: 'After amount' }]} />
        </Field>
      </Grid>
      <Preview>
        <span className="num text-[22px] font-semibold tracking-tight">{formatMoney(1_234_550, { ...v, locale: all.locale.numberLocale })}</span>
      </Preview>
      <p className="mt-3 text-[12px] text-muted-foreground">Amounts are always stored as exact integers; this only changes how they are displayed and printed.</p>
    </>
  ),

  locale: ({ v, set, all }) => (
    <>
      <Grid>
        <Field label="Language" hint="Urdu layout is right-to-left; translations can be added without code changes.">
          <Select value={v.language} onChange={(x) => x && set('language', x)} options={[{ value: 'en', label: 'English' }, { value: 'ur', label: 'اردو — Urdu (preview)' }]} />
        </Field>
        <Field label="Number format">
          <Select
            value={v.numberLocale}
            onChange={(x) => x && set('numberLocale', x)}
            options={[
              { value: 'en-PK', label: 'Pakistan — 1,234,567.50' },
              { value: 'en-IN', label: 'Lakh grouping — 12,34,567.50' },
              { value: 'en-US', label: 'International — 1,234,567.50' },
              { value: 'en-GB', label: 'United Kingdom — 1,234,567.50' },
            ]}
          />
        </Field>
        <Field label="Date format">
          <Select
            value={v.dateFormat}
            onChange={(x) => x && set('dateFormat', x)}
            options={(['dd/MM/yyyy', 'dd-MMM-yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'] as const).map((f) => ({ value: f, label: `${f} — ${formatDate(new Date(), f)}` }))}
          />
        </Field>
        <Field label="Time format">
          <Segmented value={v.timeFormat} onChange={(x) => set('timeFormat', x)} options={[{ value: '12h', label: '12-hour' }, { value: '24h', label: '24-hour' }]} />
        </Field>
      </Grid>
      <Preview>
        <div className="flex items-baseline gap-6">
          <span className="text-[15px] font-semibold">{formatDateTime(new Date(), v.dateFormat, v.timeFormat)}</span>
          <span className="num text-[15px] font-semibold">{formatMoney(123_456_750, { ...all.currency, locale: v.numberLocale })}</span>
        </div>
      </Preview>
    </>
  ),

  tax: ({ v, set }) => (
    <>
      <SwitchRow label="Charge tax on sales" description="When off, no tax lines appear on receipts or reports" checked={v.enabled} onChange={(x) => set('enabled', x)} />
      <div className={cn('mt-5 transition', !v.enabled && 'pointer-events-none opacity-50')}>
        <Grid>
          <Field label="Tax label">
            <Input value={v.label} maxLength={20} onChange={(e) => set('label', e.target.value)} />
          </Field>
          <Field label="Default rate" hint="Used for new products; each product can override it.">
            <PercentInput bp={v.defaultRateBp} onChange={(x) => set('defaultRateBp', x)} />
          </Field>
          <Field label="Prices are" className="col-span-2">
            <Segmented value={v.mode} onChange={(x) => set('mode', x)} options={[{ value: 'INCLUSIVE', label: 'Tax inclusive (MRP includes tax)' }, { value: 'EXCLUSIVE', label: 'Tax exclusive (added at checkout)' }]} />
          </Field>
          <Field label="Registration no. (STRN)">
            <Input value={v.registrationNo} onChange={(e) => set('registrationNo', e.target.value)} />
          </Field>
        </Grid>
      </div>
      <Divider title="Purchases" />
      <SwitchRow label="Purchase tax is part of cost" description="Turn off if you claim input tax back — it is then excluded from batch cost." checked={v.purchaseTaxIsCost} onChange={(x) => set('purchaseTaxIsCost', x)} />
    </>
  ),

  inventory: ({ v, set }) => (
    <>
      <Grid>
        <Field label="Expiry warning" hint="Batches expiring within this window are flagged as near-expiry.">
          <NumberInput value={v.expiryWarningDays} min={1} max={730} suffix="days" onChange={(x) => set('expiryWarningDays', x ?? 90)} />
        </Field>
        <Field label="Block selling within" hint="0 = allow selling until the expiry date.">
          <NumberInput value={v.blockSaleWithinDays} min={0} max={365} suffix="days of expiry" onChange={(x) => set('blockSaleWithinDays', x ?? 0)} />
        </Field>
        <Field label="Default minimum stock" hint="For new products, in packs">
          <NumberInput value={v.defaultMinStock} min={0} suffix="packs" onChange={(x) => set('defaultMinStock', x ?? 0)} />
        </Field>
        <Field label="Default reorder level" hint="For new products, in packs">
          <NumberInput value={v.defaultReorderLevel} min={0} suffix="packs" onChange={(x) => set('defaultReorderLevel', x ?? 0)} />
        </Field>
      </Grid>
      <Divider title="Safety" />
      <SwitchRow label="Allow negative stock" description="Not recommended. When off, a sale can never take more than is physically in stock." checked={v.allowNegativeStock} onChange={(x) => set('allowNegativeStock', x)} />
      <Alert tone="info" className="mt-4">
        Expired batches can never be sold, whatever these settings say.
      </Alert>
    </>
  ),

  sales: ({ v, set }) => (
    <>
      <Grid>
        <Field label="Maximum discount without approval" hint="Larger discounts need a supervisor override.">
          <PercentInput bp={v.maxDiscountBp} onChange={(x) => set('maxDiscountBp', x)} />
        </Field>
        <Field label="Round bill total to">
          <Select
            value={String(v.roundingStep)}
            onChange={(x) => x && set('roundingStep', Number(x) as 0 | 100 | 500 | 1000)}
            options={[
              { value: '0', label: 'No rounding' },
              { value: '100', label: 'Nearest 1' },
              { value: '500', label: 'Nearest 5' },
              { value: '1000', label: 'Nearest 10' },
            ]}
          />
        </Field>
        <Field label="Prescription-only medicines">
          <Select
            value={v.prescriptionEnforcement}
            onChange={(x) => x && set('prescriptionEnforcement', x)}
            options={[
              { value: 'warn', label: 'Warn the cashier' },
              { value: 'require', label: 'Require a linked prescription' },
              { value: 'off', label: 'No check' },
            ]}
          />
        </Field>
        <Field label="Default payment method">
          <Select
            value={v.defaultPaymentMethod}
            onChange={(x) => x && set('defaultPaymentMethod', x)}
            options={[
              { value: 'CASH', label: 'Cash' },
              { value: 'CARD', label: 'Card' },
              { value: 'MOBILE_WALLET', label: 'Mobile wallet' },
              { value: 'BANK_TRANSFER', label: 'Bank transfer' },
            ]}
          />
        </Field>
        <Field label="Return window" hint="0 = returns allowed any time (with approval)">
          <NumberInput value={v.returnWindowDays} min={0} max={365} suffix="days" onChange={(x) => set('returnWindowDays', x ?? 0)} />
        </Field>
        <Field label="Walk-in customer label">
          <Input value={v.walkInLabel} maxLength={40} onChange={(e) => set('walkInLabel', e.target.value)} />
        </Field>
      </Grid>
      <Divider title="Controls" />
      <Switches>
        <SwitchRow label="Require an open cash shift" description="Sales can only be made after the cashier opens a shift." checked={v.requireOpenShift} onChange={(x) => set('requireOpenShift', x)} />
        <SwitchRow label="Allow credit sales" description="Sell on account to registered customers." checked={v.allowCreditSales} onChange={(x) => set('allowCreditSales', x)} />
      </Switches>
    </>
  ),

  security: ({ v, set }) => (
    <Grid>
      <Field label="Auto-lock after inactivity" hint="0 = never lock automatically">
        <NumberInput value={v.autoLockMinutes} min={0} max={240} suffix="minutes" onChange={(x) => set('autoLockMinutes', x ?? 0)} />
      </Field>
      <Field label="Minimum password length">
        <NumberInput value={v.passwordMinLength} min={6} max={64} suffix="characters" onChange={(x) => set('passwordMinLength', x ?? 8)} />
      </Field>
      <Field label="Lock account after" hint="Consecutive wrong passwords">
        <NumberInput value={v.maxFailedAttempts} min={3} max={20} suffix="attempts" onChange={(x) => set('maxFailedAttempts', x ?? 5)} />
      </Field>
      <Field label="Account lockout duration">
        <NumberInput value={v.lockoutMinutes} min={1} max={1440} suffix="minutes" onChange={(x) => set('lockoutMinutes', x ?? 15)} />
      </Field>
    </Grid>
  ),

  printer: ({ v, set }) => <PrinterForm v={v} set={set} />,

  backup: () => (
    <Alert tone="info" icon={<Info />}>
      Backup options live on the Backup &amp; restore page.
    </Alert>
  ),
};

function PrinterForm({ v, set }: Pick<FormProps<'printer'>, 'v' | 'set'>) {
  const printers = useApiQuery('settings.printers');
  const options = useMemo(() => (printers.data ?? []).map((p) => ({ value: p.name, label: p.displayName, hint: p.isDefault ? 'Default' : undefined })), [printers.data]);
  return (
    <>
      {printers.data && printers.data.length === 0 && (
        <Alert tone="warning" icon={<Printer />} className="mb-5" title="No printers found">
          Install your printer driver in Windows, then reopen this page. You can still preview and save documents as PDF.
        </Alert>
      )}
      <Grid>
        <Field label="Receipt printer" hint="Thermal printer for POS receipts">
          <Select value={v.receiptPrinter || null} onChange={(x) => set('receiptPrinter', x ?? '')} options={options} allowClear clearLabel="System default" placeholder="System default" />
        </Field>
        <Field label="A4 printer" hint="Invoices, purchase orders and reports">
          <Select value={v.a4Printer || null} onChange={(x) => set('a4Printer', x ?? '')} options={options} allowClear clearLabel="System default" placeholder="System default" />
        </Field>
        <Field label="Label printer" hint="Barcode labels">
          <Select value={v.labelPrinter || null} onChange={(x) => set('labelPrinter', x ?? '')} options={options} allowClear clearLabel="System default" placeholder="System default" />
        </Field>
      </Grid>
      <Divider title="Behaviour" />
      <SwitchRow label="Print silently" description="Send straight to the printer without the Windows print dialog." checked={v.silentPrint} onChange={(x) => set('silentPrint', x)} />
      <div className="mt-6 flex gap-2">
        <TestPrint target="receipt" inline />
        <TestPrint target="a4" inline />
      </div>
    </>
  );
}

function TestPrint({ target, inline }: { target: 'receipt' | 'a4'; inline?: boolean }) {
  const { showHtml } = usePrint();
  const [busy, setBusy] = useState(false);
  const button = (
    <Button
      icon={<Printer />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api('print.test', { target });
          showHtml(target === 'a4' ? 'A4 test page' : 'Receipt test page', r);
        } catch (e) {
          toast.error(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {target === 'a4' ? 'A4 test page' : 'Receipt test page'}
    </Button>
  );
  if (inline) return button;
  return (
    <div className="mt-6 flex items-center justify-between rounded-lg bg-muted/60 px-4 py-3">
      <span className="text-[12.5px] text-muted-foreground">Save your changes first, then print a test page to check the layout.</span>
      {button}
    </div>
  );
}

function Preview({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-border bg-muted/40 px-5 py-4">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Preview</div>
      {children}
    </div>
  );
}

function LogoPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="flex size-24 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border bg-muted/50 text-muted-foreground transition hover:border-primary hover:text-primary"
        aria-label="Upload logo"
      >
        {value ? <img src={value} alt="Pharmacy logo" className="size-full object-contain p-2" /> : <ImagePlus className="size-7" />}
      </button>
      {value && (
        <button
          type="button"
          aria-label="Remove logo"
          onClick={() => onChange('')}
          className="absolute -end-2 -top-2 hidden size-6 items-center justify-center rounded-full bg-card text-danger shadow-pop ring-1 ring-border group-hover:flex"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            onChange(await logoDataUrl(file));
          } catch {
            toast.error('This image could not be read');
          }
        }}
      />
    </div>
  );
}

/** Resize to at most 360px and encode as PNG (keeps transparency) — small enough for receipts and backups. */
async function logoDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 360 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let url = canvas.toDataURL('image/png');
  if (url.length > 380_000) url = canvas.toDataURL('image/jpeg', 0.85);
  return url;
}

/* ------------------------------------------------------------------ */

function About() {
  const info = useApiQuery('app.info');
  const dash = useApiQuery('products.list', { page: 1, pageSize: 1 });
  const can = useCan();
  const confirm = useConfirm();
  const load = useApiMutation('demo.load');
  const i = info.data;
  const empty = dash.data ? dash.data.total === 0 : false;
  return (
    <div className="space-y-4">
      <Card className="relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -end-20 -top-24 size-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-teal-700 text-white shadow-pop">
            <Cpu className="size-7" />
          </div>
          <div>
            <div className="text-[18px] font-semibold tracking-tight">{i?.productName ?? 'PharmaDesk'}</div>
            <div className="text-[13px] text-muted-foreground">
              Version {i?.version ?? '—'} · Offline pharmacy management
            </div>
          </div>
          <Badge tone="success" className="ms-auto">
            Works fully offline
          </Badge>
        </div>
        <KeyValue
          cols={3}
          className="mt-6 border-t border-border pt-5"
          items={[
            ['Database size', i ? formatBytes(i.dbSizeBytes) : '—'],
            ['Schema migrations', i?.migrations ?? '—'],
            ['SQLite', i?.sqlite ?? '—'],
            ['Electron', i?.electron ?? '—'],
            ['Platform', i?.platform ?? '—'],
            ['Build', i ? (i.packaged ? 'Installed' : 'Development') : '—'],
          ]}
        />
        <div className="mt-5 rounded-lg bg-muted/60 px-4 py-3">
          <div className="text-[11.5px] font-medium text-muted-foreground">Database file</div>
          <div className="mt-0.5 break-all font-mono text-[12px]">{i?.dbPath ?? '—'}</div>
        </div>
      </Card>
      {can('settings.manage') && empty && (
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Sparkles className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">Explore with sample data</div>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                Loads a fictional pharmacy with products, batches, suppliers, customers and three months of sales so you can try every screen. Only available while the database is empty.
              </p>
            </div>
            <Button
              variant="soft"
              icon={<Sparkles />}
              loading={load.isPending}
              onClick={async () => {
                const ok = await confirm({ title: 'Load sample data?', description: 'Sample data is fictional. Use a fresh database for real trading, or restore a backup later to start over.', confirmLabel: 'Load sample data' });
                if (!ok) return;
                try {
                  const r = await load.mutateAsync(undefined);
                  toast.success(r.message);
                  void queryClient.invalidateQueries();
                } catch {
                  /* toast shown by mutation */
                }
              }}
            >
              Load sample data
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
