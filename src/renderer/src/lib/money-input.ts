import { parseRupees } from '@shared/money';

/** Paisa → editable rupee string ("1250.5" → "1250.50"). */
export function paisaToInput(paisa: number | null | undefined, decimals = 2): string {
  if (paisa === null || paisa === undefined) return '';
  const v = paisa / 100;
  return decimals === 0 ? String(Math.round(v)) : v.toFixed(2).replace(/\.00$/, '');
}

export function inputToPaisa(text: string): number | null {
  if (text.trim() === '') return null;
  const v = parseRupees(text);
  return Number.isNaN(v) ? null : v;
}
