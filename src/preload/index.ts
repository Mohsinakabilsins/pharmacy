import { contextBridge, ipcRenderer } from 'electron';

/**
 * The ONLY bridge between the sandboxed renderer and the main process.
 * No Node APIs are exposed; every call is validated and authorised in the main process.
 */
const EVENTS = new Set(['session.changed', 'backup.completed', 'backup.failed']);

const api = Object.freeze({
  invoke: (channel: string, payload?: unknown) => ipcRenderer.invoke('pharmacy:invoke', channel, payload),
  on: (event: string, callback: (payload: unknown) => void) => {
    if (!EVENTS.has(event)) throw new Error(`Unknown event: ${event}`);
    const listener = (_e: Electron.IpcRendererEvent, name: string, payload: unknown) => {
      if (name === event) callback(payload);
    };
    ipcRenderer.on('pharmacy:event', listener);
    return () => ipcRenderer.removeListener('pharmacy:event', listener);
  },
  setTheme: (theme: 'light' | 'dark') => ipcRenderer.send('pharmacy:theme', theme),
  platform: process.platform,
});

contextBridge.exposeInMainWorld('pharmacy', api);
