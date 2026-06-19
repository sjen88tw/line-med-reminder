import type { Queryable } from '../member/member-service.js';

export interface AdherenceStats {
  confirmed: number;
  missed: number;
  rate: number; // confirmed / (confirmed + missed); 0 when denominator is 0
}

export function makeAdherenceService(db: Queryable) {
  return {
    async forMember(memberId: number | string): Promise<AdherenceStats> {
      const { rows } = await db.query(
        `SELECT
           SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
           SUM(CASE WHEN status = 'MISSED' THEN 1 ELSE 0 END) AS missed
         FROM dose_event
         WHERE member_id = $1`,
        [memberId],
      );
      const confirmed = Number(rows[0]?.confirmed ?? 0);
      const missed = Number(rows[0]?.missed ?? 0);
      const denom = confirmed + missed;
      return { confirmed, missed, rate: denom === 0 ? 0 : confirmed / denom };
    },
  };
}

export type AdherenceService = ReturnType<typeof makeAdherenceService>;
