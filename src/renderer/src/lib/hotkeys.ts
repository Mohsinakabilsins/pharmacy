import { useEffect, useRef, useState } from 'react';

type Handler = (e: KeyboardEvent) => void;

/**
 * Register keyboard shortcuts. Keys use the form `F2`, `Ctrl+K`, `Escape`, `Delete`.
 * Function keys and modifier combos fire even inside inputs; plain keys do not.
 */
export function useHotkeys(map: Record<string, Handler>, deps: unknown[] = [], enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey && e.key.length > 1) parts.push('Shift');
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      parts.push(key);
      const combo = parts.join('+');
      const handler = ref.current[combo];
      if (!handler) return;
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const global = /^F\d+$/.test(key) || combo.includes('Ctrl') || combo.includes('Alt') || key === 'Escape';
      if (typing && !global) return;
      // don't hijack keys while a modal dialog owns focus (except Escape which dialogs handle)
      if (document.querySelector('[role="dialog"][data-state="open"]') && !target?.closest('[role="dialog"]')) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
}

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms, setV]);
  return v;
}

