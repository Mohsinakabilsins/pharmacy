import { CHANNELS, type Channel, type ChannelOutput, type ChannelParsed } from '@shared/contract';
import type { IpcResult } from '@shared/errors';
import type { PermissionKey } from '@shared/permissions';
import type { Db, Sqlite } from './db';
import type { ServiceContext } from './context';
import { AppError, toErrorShape } from './errors';
import type { SessionManager } from './session';

export type HandlerMap = {
  [K in Channel]: (input: ChannelParsed<K>, ctx: ServiceContext) => ChannelOutput<K> | Promise<ChannelOutput<K>>;
};

export interface RouterDeps {
  database: () => { db: Db; sqlite: Sqlite };
  sessions: SessionManager;
  now?: () => Date;
  onError?: (channel: string, err: unknown) => void;
}

/** Channels usable while a password change is pending. */
const PASSWORD_CHANGE_ALLOWED = new Set<string>(['app.bootstrap', 'app.info', 'auth.session', 'auth.logout', 'auth.changePassword', 'auth.lock', 'auth.unlock', 'auth.heartbeat', 'settings.get']);
/** Channels that do not count as user activity for auto-lock. */
const PASSIVE = new Set<string>(['auth.heartbeat', 'auth.session', 'app.bootstrap']);

/**
 * Transport-agnostic dispatcher: allow-list, session & permission checks, Zod validation and
 * error normalisation. Electron's ipcMain simply forwards (channel, payload) here.
 */
export class Router {
  constructor(
    private readonly deps: RouterDeps,
    private readonly handlers: HandlerMap,
  ) {}

  async dispatch(channel: string, payload: unknown): Promise<IpcResult<unknown>> {
    try {
      if (!Object.prototype.hasOwnProperty.call(CHANNELS, channel)) throw new AppError('NOT_FOUND', 'Unknown operation');
      const key = channel as Channel;
      const def = CHANNELS[key];
      const session = this.deps.sessions.get();
      const access = def.access as 'public' | 'session' | 'user' | readonly PermissionKey[];
      if (access !== 'public') {
        if (!session) throw new AppError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
        if (access !== 'session' && session.locked) throw new AppError('SESSION_LOCKED', 'The screen is locked. Enter your password to continue.');
        if (session.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(channel)) {
          throw new AppError('FORBIDDEN', 'Please change your password before continuing.');
        }
        if (Array.isArray(access) && !access.some((p) => session.user.permissions.has(p))) {
          throw new AppError('FORBIDDEN', 'You do not have permission to perform this action');
        }
      }
      const input = def.input.parse(payload ?? undefined);
      const { db, sqlite } = this.deps.database();
      const ctx: ServiceContext = { db, sqlite, user: session && !session.locked ? session.user : (session?.user ?? null), now: this.deps.now ?? (() => new Date()) };
      if (session && !PASSIVE.has(channel)) this.deps.sessions.touch();
      const handler = this.handlers[key] as (input: unknown, ctx: ServiceContext) => unknown;
      const data = await handler(input, ctx);
      return { ok: true, data };
    } catch (err) {
      const shape = toErrorShape(err);
      if (shape.code === 'INTERNAL') this.deps.onError?.(channel, err);
      return { ok: false, error: shape };
    }
  }
}
