import type { messagingApi } from '@line/bot-sdk';

export interface Pusher {
  push(toUserId: string, messages: messagingApi.Message[]): Promise<void>;
}

export type PushClass = 'retry' | 'unreachable' | 'fatal';

// Classify a LINE push failure so the caller knows whether to retry (queue
// re-delivery), give up on this user, or hard-fail.
//   429 / 5xx -> retry (rate limit, transient)
//   403       -> unreachable (user blocked the official account)
//   else      -> fatal (bad request, auth, etc.)
export function classifyPushError(err: unknown): PushClass {
  const e = err as {
    statusCode?: number;
    status?: number;
    response?: { status?: number };
  };
  const status = e?.statusCode ?? e?.status ?? e?.response?.status;
  if (status === 429) return 'retry';
  if (status === 403) return 'unreachable';
  if (typeof status === 'number' && status >= 500) return 'retry';
  return 'fatal';
}
