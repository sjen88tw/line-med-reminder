import type { Queryable } from '../member/member-service.js';

export const CONSENT_VERSION = 'v1';

export function makeConsentService(db: Queryable) {
  return {
    async has(memberId: number | string): Promise<boolean> {
      const { rows } = await db.query(
        'SELECT 1 FROM consent WHERE member_id = $1',
        [memberId],
      );
      return rows.length > 0;
    },
    async record(
      memberId: number | string,
      version: string = CONSENT_VERSION,
    ): Promise<void> {
      await db.query(
        `INSERT INTO consent (member_id, agreed_at, version)
         VALUES ($1, now(), $2)
         ON CONFLICT (member_id) DO NOTHING`,
        [memberId, version],
      );
    },
  };
}

export type ConsentService = ReturnType<typeof makeConsentService>;
