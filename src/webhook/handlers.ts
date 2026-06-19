import type { WebhookEvent } from '@line/bot-sdk';
import type { MemberService } from '../member/member-service.js';
import type { ConfirmService } from '../dosing/confirm-service.js';

export interface WebhookDeps {
  members: MemberService;
  confirms?: ConfirmService; // #04
  // Optional: resolve a LINE display name (via the profile API). Returns null
  // when unavailable so member creation never blocks on the profile lookup.
  getDisplayName?: (userId: string) => Promise<string | null>;
  // Optional: reply to the user (LINE replyMessage). No-op in tests if absent.
  reply?: (replyToken: string, text: string) => Promise<void>;
}

// Postback data convention emitted by the reminder Flex (#03):
//   action=confirm&dose=<doseEventId>
function parseConfirm(data: string): string | null {
  const params = new URLSearchParams(data);
  return params.get('action') === 'confirm' ? params.get('dose') : null;
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
    case 'postback': {
      // #04: 已服藥 confirmation (idempotent).
      const doseEventId = parseConfirm(event.postback.data);
      if (doseEventId && deps.confirms) {
        const outcome = await deps.confirms.confirm(doseEventId);
        if (deps.reply && event.replyToken) {
          const text =
            outcome === 'not_applicable'
              ? '找不到這筆服藥提醒，請聯絡藥局。'
              : '已記錄，今天做得很好 👍';
          await deps.reply(event.replyToken, text);
        }
      }
      return;
    }
    case 'message':
      // TODO #06: image messages -> store prescription photo + notify pharmacy.
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
