import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ThemePref = 'light' | 'dark' | 'system';

interface PrefsState {
  theme: ThemePref;
  sidebarCollapsed: boolean;
  density: 'comfortable' | 'compact';
  setTheme: (t: ThemePref) => void;
  toggleSidebar: () => void;
  setDensity: (d: 'comfortable' | 'compact') => void;
}

const safeStorage = createJSONStorage(() => {
  try {
    const k = '__pd_probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  }
});

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      sidebarCollapsed: false,
      density: 'comfortable',
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setDensity: (density) => set({ density }),
    }),
    { name: 'pharmadesk.prefs', storage: safeStorage },
  ),
);

export function resolvedTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
