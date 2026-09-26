import { create } from 'zustand';
import type { SessionInfo } from '@shared/types/auth';
import type { PermissionKey } from '@shared/permissions';

interface SessionState {
  session: SessionInfo | null;
  ready: boolean;
  set: (s: SessionInfo | null) => void;
  setReady: () => void;
}

export const useSession = create<SessionState>((set) => ({
  session: null,
  ready: false,
  set: (session) => set({ session }),
  setReady: () => set({ ready: true }),
}));

/** Permission check in the UI (for showing/hiding — the main process always re-checks). */
export function useCan() {
  const perms = useSession((s) => s.session?.permissions);
  return (...keys: PermissionKey[]) => !!perms && keys.some((k) => perms.includes(k));
}
