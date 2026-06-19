import type { Queryable } from '../member/member-service.js';
import type { ObjectStore } from '../storage/object-store.js';
import type { ConsentService } from '../consent/consent-service.js';

export interface IncomingImage {
  lineUserId: string;
  messageId: string;
  replyToken?: string;
}

export type ImageOutcome = 'stored' | 'consent_requested' | 'no_member';

export interface ImageServiceDeps {
  db: Queryable;
  store: ObjectStore;
  consent: ConsentService;
  // Fetch the raw image bytes for a LINE message (prod: blob client).
  fetchContent: (messageId: string) => Promise<{ body: Buffer; contentType: string }>;
  notifyPharmacy: (text: string) => Promise<void>;
  reply?: (replyToken: string, text: string) => Promise<void>;
}

export function makeImageService(deps: ImageServiceDeps) {
  async function resolveMemberId(lineUserId: string): Promise<number | string | null> {
    const { rows } = await deps.db.query('SELECT id FROM member WHERE line_user_id = $1', [
      lineUserId,
    ]);
    return rows.length ? (rows[0].id as number | string) : null;
  }

  return {
    async handleIncomingImage(input: IncomingImage): Promise<ImageOutcome> {
      const memberId = await resolveMemberId(input.lineUserId);
      if (memberId == null) return 'no_member';

      // Compliance: do NOT store medical images before the patient consents.
      if (!(await deps.consent.has(memberId))) {
        if (deps.reply && input.replyToken) {
          await deps.reply(
            input.replyToken,
            '上傳處方箋前，請先按「同意」讓藥局為你管理用藥資料，然後再傳一次照片。',
          );
        }
        return 'consent_requested';
      }

      const content = await deps.fetchContent(input.messageId);
      const objectKey = `prescriptions/${memberId}/${input.messageId}`;
      await deps.store.put(objectKey, content.body, content.contentType);

      await deps.db.query(
        `INSERT INTO prescription_image (member_id, object_key, status)
         VALUES ($1, $2, 'pending')`,
        [memberId, objectKey],
      );
      await deps.notifyPharmacy(`收到病人 #${memberId} 的處方箋影像`);
      if (deps.reply && input.replyToken) {
        await deps.reply(input.replyToken, '已收到你的處方箋，藥師會盡快建檔 👍');
      }
      return 'stored';
    },

    async recordConsent(lineUserId: string): Promise<boolean> {
      const memberId = await resolveMemberId(lineUserId);
      if (memberId == null) return false;
      await deps.consent.record(memberId);
      return true;
    },

    // Pharmacist view: short-lived signed URL. No public URL ever exists.
    async getSignedUrl(
      imageId: number | string,
      ttlSeconds = 900,
    ): Promise<string | null> {
      const { rows } = await deps.db.query(
        'SELECT object_key FROM prescription_image WHERE id = $1',
        [imageId],
      );
      if (!rows.length) return null;
      return deps.store.signedUrl(rows[0].object_key as string, ttlSeconds);
    },
  };
}

export type ImageService = ReturnType<typeof makeImageService>;
