export interface PharmacyBridge {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>;
  on: (event: string, callback: (payload: unknown) => void) => () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  platform: string;
}

declare global {
  interface Window {
    pharmacy: PharmacyBridge;
  }
}
