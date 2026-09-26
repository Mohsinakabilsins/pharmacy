/**
 * Display formatting shared by the renderer and print templates. Driven by settings so
 * currency, decimals and date formats are never hard-coded.
 */
import type { AppSettings } from './settings';

export type CurrencyFormat = Pick<AppSettings['currency'], 'symbol' | 'decimals' | 'symbolPosition'> & { locale?: string };
export type DateFormat = AppSettings['locale']['dateFormat'];

const DEFAULT_CURRENCY: CurrencyFormat = { symbol: 'Rs', decimals: 2, symbolPosition: 'before', locale: 'en-PK' };

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, min: number, max: number): Intl.NumberFormat {
  const key = `${locale}|${min}|${max}`;
  let f = nfCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max });
    } catch {
      f = new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });
    }
    nfCache.set(key, f);
  }
  return f;
}

/** Format paisa as currency, e.g. `Rs 1,250.00`. */
export function formatMoney(paisa: number | null | undefined, c: CurrencyFormat = DEFAULT_CURRENCY, opts: { symbol?: boolean; signed?: boolean } = {}): string {
  if (paisa === null || paisa === undefined || Number.isNaN(paisa)) return '—';
  const value = Math.abs(paisa) / 100;
  const decimals = c.decimals ?? 2;
  const num = nf(c.locale ?? 'en-PK', decimals, decimals).format(decimals === 0 ? Math.round(value) : value);
  const sign = paisa < 0 ? '−' : opts.signed && paisa > 0 ? '+' : '';
  if (opts.symbol === false) return `${sign}${num}`;
  return c.symbolPosition === 'after' ? `${sign}${num} ${c.symbol}` : `${sign}${c.symbol} ${num}`;
}

/** Compact money for charts / KPI cards: Rs 1.2M, Rs 45.3K. */
export function formatMoneyCompact(paisa: number | null | undefined, c: CurrencyFormat = DEFAULT_CURRENCY): string {
  if (paisa === null || paisa === undefined) return '—';
  const v = Math.abs(paisa) / 100;
  const sign = paisa < 0 ? '−' : '';
  const fmt = (n: number, s: string) => `${sign}${c.symbol} ${n.toFixed(n >= 100 ? 0 : 1).replace(/\.0$/, '')}${s}`;
  if (v >= 10_000_000) return fmt(v / 10_000_000, ' Cr');
  if (v >= 100_000) return fmt(v / 100_000, ' Lac');
  if (v >= 1_000) return fmt(v / 1_000, 'K');
  return formatMoney(paisa, { ...c, decimals: 0 });
}

export function formatNumber(n: number | null | undefined, decimals = 0, locale = 'en-PK'): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return nf(locale, decimals, decimals).format(n);
}

export function formatPercent(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n.toFixed(decimals)}%`;
}

/** Quantity in base units shown as packs + loose units, e.g. `2 Strip + 4 Tablet` or `24 Tablet`. */
export function formatQty(units: number, packSize = 1, unitName = 'unit', packName = 'pack', mode: 'auto' | 'units' = 'auto'): string {
  const u = unitName.toLowerCase();
  if (mode === 'units' || packSize <= 1) return `${formatNumber(units)} ${plural(u, units)}`;
  const sign = units < 0 ? '−' : '';
  const abs = Math.abs(units);
  const packs = Math.floor(abs / packSize);
  const loose = abs % packSize;
  const p = packName.toLowerCase();
  if (packs === 0) return `${sign}${loose} ${plural(u, loose)}`;
  if (loose === 0) return `${sign}${formatNumber(packs)} ${plural(p, packs)}`;
  return `${sign}${formatNumber(packs)} ${plural(p, packs)} + ${loose} ${plural(u, loose)}`;
}

function plural(word: string, n: number): string {
  if (Math.abs(n) === 1) return word;
  if (/(s|x|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');

function parts(value: string | Date): { y: number; m: number; d: number; h: number; min: number; hasTime: boolean } | null {
  if (value instanceof Date) return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate(), h: value.getHours(), min: value.getMinutes(), hasTime: true };
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return { y, m, d, h: 0, min: 0, hasTime: false };
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), h: dt.getHours(), min: dt.getMinutes(), hasTime: true };
}

export function formatDate(value: string | Date | null | undefined, fmt: DateFormat = 'dd/MM/yyyy'): string {
  if (!value) return '—';
  const x = parts(value);
  if (!x) return '—';
  switch (fmt) {
    case 'MM/dd/yyyy':
      return `${p2(x.m)}/${p2(x.d)}/${x.y}`;
    case 'yyyy-MM-dd':
      return `${x.y}-${p2(x.m)}-${p2(x.d)}`;
    case 'dd-MMM-yyyy':
      return `${p2(x.d)}-${MONTHS[x.m - 1]}-${x.y}`;
    default:
      return `${p2(x.d)}/${p2(x.m)}/${x.y}`;
  }
}

export function formatTime(value: string | Date | null | undefined, timeFormat: '12h' | '24h' = '12h'): string {
  if (!value) return '';
  const x = parts(value);
  if (!x || !x.hasTime) return '';
  if (timeFormat === '24h') return `${p2(x.h)}:${p2(x.min)}`;
  const h = x.h % 12 === 0 ? 12 : x.h % 12;
  return `${h}:${p2(x.min)} ${x.h < 12 ? 'AM' : 'PM'}`;
}

export function formatDateTime(value: string | Date | null | undefined, fmt: DateFormat = 'dd/MM/yyyy', timeFormat: '12h' | '24h' = '12h'): string {
  if (!value) return '—';
  const t = formatTime(value, timeFormat);
  return t ? `${formatDate(value, fmt)} ${t}` : formatDate(value, fmt);
}

/** Expiry shown as `MM/YYYY` (as printed on packs) — full date available on hover. */
export function formatExpiry(date: string | null | undefined): string {
  if (!date) return '—';
  const x = parts(date);
  return x ? `${p2(x.m)}/${x.y}` : '—';
}

export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) {
    if (days < 60) return `in ${days} days`;
    return `in ${Math.round(days / 30)} months`;
  }
  const a = Math.abs(days);
  if (a < 60) return `${a} days ago`;
  return `${Math.round(a / 30)} months ago`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
