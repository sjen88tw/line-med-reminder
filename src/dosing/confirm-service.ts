import type { Queryable } from '../member/member-service.js';

export type ConfirmOutcome = 'confirmed' | 'already' | 'not_applicable';

export function makeConfirmService(db: Queryable) {
  return {
    // Idempotent "已服藥". The WHERE status IN (...) guard is the single source
    // of truth for dedup: a second tap updates 0 rows and reports 'already'.
    async confirm(doseEventId: string): Promise<ConfirmOutcome> {
      const { rows } = await db.query(
        `UPDATE dose_event
         SET status = 'CONFIRMED', confirmed_at = now()
         WHERE id = $1 AND status IN ('REMINDED', 'ESCALATED')
         RETURNING id`,
        [doseEventId],
      );
      if (rows.length === 1) return 'confirmed';

      const { rows: cur } = await db.query(
        'SELECT status FROM dose_event WHERE id = $1',
        [doseEventId],
      );
      if (cur.length === 1 && cur[0].status === 'CONFIRMED') return 'already';
      // SCHEDULED (not reminded yet), MISSED, or unknown id.
      return 'not_applicable';
    },
  };
}

export type ConfirmService = ReturnType<typeof makeConfirmService>;
