import type { Queryable } from '../member/member-service.js';

// /review finding: nothing ever set dose status to MISSED, so the adherence
// denominator was always just CONFIRMED -> rate looked like 100%.
//
// This sweep transitions doses the patient WAS told about (REMINDED/ESCALATED)
// but never confirmed, once they're well past their scheduled time, to MISSED.
// SCHEDULED doses (reminder never delivered) are deliberately left out — that's
// a delivery problem, not non-adherence, and the escalation job already flags it.
export async function markMissedDoses(
  db: Queryable,
  asOf: Date,
  graceMinutes = 240,
): Promise<number> {
  const cutoff = new Date(asOf.getTime() - graceMinutes * 60_000).toISOString();
  const { rows } = await db.query(
    `UPDATE dose_event SET status = 'MISSED'
     WHERE status IN ('REMINDED', 'ESCALATED') AND scheduled_at < $1
     RETURNING id`,
    [cutoff],
  );
  return rows.length;
}
