import type { WebhookEvent } from '@line/bot-sdk';
import type { MemberService } from '../member/member-service.js';

export interface WebhookDeps {
  members: MemberService;
  // Optional: resolve a LINE display name (via the profile API). Returns null
  // when unavailable so member creation never blocks on the profile lookup.
  getDisplayName?: (userId: string) => Promise<string | null>;
}

export async function handleEvent(
  event: WebhookEvent,
  deps: WebhookDeps,
): Promise<void> {
  switch (event.type) {
    case 'follow': {
      // "LINE 簡易註冊": adding the official account creates a member.
      if (event.source.type === 'user') {
        const userId = event.source.userId;
        const displayName = deps.getDisplayName
          ? await deps.getDisplayName(userId)
          : null;
        await deps.members.upsertByLineUserId(userId, displayName);
      }
      return;
    }
    case 'message':
      // TODO #06: image messages -> store prescription photo + notify pharmacy.
      return;
    case 'postback':
      // TODO #04: dose confirmation (idempotent "已服藥").
      return;
    default:
      return;
  }
}

export async function handleEvents(
  events: WebhookEvent[],
  deps: WebhookDeps,
): Promise<void> {
  await Promise.all(events.map((e) => handleEvent(e, deps)));
}
