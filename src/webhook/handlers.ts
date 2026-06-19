import type { WebhookEvent } from '@line/bot-sdk';
import type { MemberService } from '../member/member-service.js';
import type { ConfirmService } from '../dosing/confirm-service.js';
import type { ImageService } from '../prescription/image-service.js';

export interface WebhookDeps {
  members: MemberService;
  confirms?: ConfirmService; // #04
  images?: ImageService; // #06
  // Optional: resolve a LINE display name (via the profile API). Returns null
  // when unavailable so member creation never blocks on the profile lookup.
  getDisplayName?: (userId: string) => Promise<string | null>;
  // Optional: reply to the user (LINE replyMessage). No-op in tests if absent.
  reply?: (replyToken: string, text: string) => Promise<void>;
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
      const params = new URLSearchParams(event.postback.data);
      const action = params.get('action');

      if (action === 'confirm' && deps.confirms) {
        // #04: 已服藥 confirmation (idempotent).
        const doseEventId = params.get('dose');
        if (doseEventId) {
          const outcome = await deps.confirms.confirm(doseEventId);
          if (deps.reply && event.replyToken) {
            await deps.reply(
              event.replyToken,
              outcome === 'not_applicable'
                ? '找不到這筆服藥提醒，請聯絡藥局。'
                : '已記錄，今天做得很好 👍',
            );
          }
        }
      } else if (action === 'consent' && deps.images && event.source.type === 'user') {
        // #06: patient agrees to let the pharmacy manage their medication data.
        await deps.images.recordConsent(event.source.userId);
        if (deps.reply && event.replyToken) {
          await deps.reply(event.replyToken, '感謝同意 👍 現在可以把處方箋照片傳給我們了。');
        }
      }
      return;
    }
    case 'message': {
      // #06: prescription photo upload.
      if (
        event.message.type === 'image' &&
        deps.images &&
        event.source.type === 'user'
      ) {
        await deps.images.handleIncomingImage({
          lineUserId: event.source.userId,
          messageId: event.message.id,
          replyToken: event.replyToken,
        });
      }
      return;
    }
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
