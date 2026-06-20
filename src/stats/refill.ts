import type { Queryable } from '../member/member-service.js';

export interface RefillStats {
  reminded: number; // prescriptions that got a refill nudge
  refilled: number; // of those, how many the patient actually came back for
  rate: number; // refilled / reminded; 0 when no nudges yet
}

export function makeRefillService(db: Queryable) {
  return {
    // 續領率 + 已挽回, for the pharmacy retention dashboard (#08).
    async summary(): Promise<RefillStats> {
      const { rows } = await db.query(
        `SELECT
           SUM(CASE WHEN refill_reminded_at IS NOT NULL THEN 1 ELSE 0 END) AS reminded,
           SUM(CASE WHEN refilled_at IS NOT NULL THEN 1 ELSE 0 END) AS refilled
         FROM prescription`,
      );
      const reminded = Number(rows[0]?.reminded ?? 0);
      const refilled = Number(rows[0]?.refilled ?? 0);
      return { reminded, refilled, rate: reminded === 0 ? 0 : refilled / reminded };
    },
  };
}

export type RefillService = ReturnType<typeof makeRefillService>;
