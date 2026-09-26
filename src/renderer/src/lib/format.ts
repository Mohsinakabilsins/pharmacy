import { useMemo } from 'react';
import { defaultSettings, type AppSettings } from '@shared/settings';
import {
  formatDate,
  formatDateTime,
  formatExpiry,
  formatMoney,
  formatMoneyCompact,
  formatNumber,
  formatPercent,
  formatQty,
  formatTime,
} from '@shared/format';
import { useApiQuery } from './query';

const DEFAULTS = defaultSettings();

export function useSettings(): AppSettings {
  const { data } = useApiQuery('settings.get', undefined, { staleTime: 60_000 });
  return data ?? DEFAULTS;
}

/** Formatting helpers bound to the pharmacy's currency / locale settings. */
export function useFormat() {
  const s = useSettings();
  return useMemo(() => {
    const c = { ...s.currency, locale: s.locale.numberLocale };
    return {
      settings: s,
      money: (v: number | null | undefined, opts?: { symbol?: boolean; signed?: boolean }) => formatMoney(v, c, opts),
      compact: (v: number | null | undefined) => formatMoneyCompact(v, c),
      number: (v: number | null | undefined, d = 0) => formatNumber(v, d, s.locale.numberLocale),
      percent: formatPercent,
      date: (v: string | Date | null | undefined) => formatDate(v, s.locale.dateFormat),
      time: (v: string | Date | null | undefined) => formatTime(v, s.locale.timeFormat),
      dateTime: (v: string | Date | null | undefined) => formatDateTime(v, s.locale.dateFormat, s.locale.timeFormat),
      expiry: formatExpiry,
      qty: formatQty,
      symbol: s.currency.symbol,
      decimals: s.currency.decimals,
    };
  }, [s]);
}
