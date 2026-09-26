import type { Channel, ChannelInput, ChannelOutput, MainEventName, MainEvents } from '@shared/contract';
import type { AppErrorShape, ErrorCode, IpcResult } from '@shared/errors';

export class ApiError extends Error {
  code: ErrorCode;
  fields?: Record<string, string>;
  data?: Record<string, unknown>;
  constructor(shape: AppErrorShape) {
    super(shape.message);
    this.name = 'ApiError';
    this.code = shape.code;
    this.fields = shape.fields;
    this.data = shape.data;
  }
}

type SessionListener = (code: ErrorCode) => void;
const sessionListeners = new Set<SessionListener>();
export function onSessionError(fn: SessionListener) {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
}

/** Typed call into the main process. Rejects with ApiError on failure. */
export async function api<K extends Channel>(channel: K, input?: ChannelInput<K>): Promise<ChannelOutput<K>> {
  const bridge = window.pharmacy;
  if (!bridge) throw new ApiError({ code: 'INTERNAL', message: 'Application bridge unavailable' });
  const res = (await bridge.invoke(channel, input)) as IpcResult<ChannelOutput<K>>;
  if (res.ok) return res.data;
  if (res.error.code === 'UNAUTHENTICATED' || res.error.code === 'SESSION_LOCKED') {
    if (!channel.startsWith('auth.')) for (const fn of sessionListeners) fn(res.error.code);
  }
  throw new ApiError(res.error);
}

export function onMainEvent<E extends MainEventName>(event: E, cb: (payload: MainEvents[E]) => void): () => void {
  return window.pharmacy?.on(event, cb as (p: unknown) => void) ?? (() => undefined);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
