import type { SessionUser } from './context';

export interface ActiveSession {
  user: SessionUser;
  sessionId: number;
  startedAt: string;
  lastActivity: number;
  locked: boolean;
  mustChangePassword: boolean;
}

/** Holds the signed-in user. Lives only in the main process — the renderer can never forge it. */
export class SessionManager {
  private current: ActiveSession | null = null;
  private listeners = new Set<(s: ActiveSession | null) => void>();

  get(): ActiveSession | null {
    return this.current;
  }

  set(session: ActiveSession | null): void {
    this.current = session;
    this.emit();
  }

  touch(now = Date.now()): void {
    if (this.current && !this.current.locked) this.current.lastActivity = now;
  }

  lock(): void {
    if (this.current && !this.current.locked) {
      this.current.locked = true;
      this.emit();
    }
  }

  unlock(now = Date.now()): void {
    if (this.current) {
      this.current.locked = false;
      this.current.lastActivity = now;
      this.emit();
    }
  }

  /** Lock when idle longer than `minutes` (0 disables). Returns true when it locked. */
  checkIdle(minutes: number, now = Date.now()): boolean {
    if (!this.current || this.current.locked || minutes <= 0) return false;
    if (now - this.current.lastActivity >= minutes * 60_000) {
      this.lock();
      return true;
    }
    return false;
  }

  replaceUser(user: SessionUser): void {
    if (this.current && this.current.user.id === user.id) {
      this.current.user = user;
      this.emit();
    }
  }

  onChange(fn: (s: ActiveSession | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.current);
  }
}
