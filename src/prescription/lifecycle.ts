import type { Queryable } from '../member/member-service.js';

export function makeLifecycleService(db: Queryable) {
  return {
    // End-of-course (or early stop). 'ended' prescriptions stop generating
    // reminders/escalations (guarded in the dose jobs) and refill nudges.
    async endCourse(prescriptionId: number | string): Promise<void> {
      await db.query(
        `UPDATE prescription SET status = 'ended' WHERE id = $1 AND status = 'active'`,
        [prescriptionId],
      );
    },

    // Pharmacist marks the patient as having returned to refill (drives the
    // 續領率 / 已挽回 numbers the pharmacy owner cares about).
    async markRefilled(prescriptionId: number | string): Promise<void> {
      await db.query(`UPDATE prescription SET refilled_at = now() WHERE id = $1`, [
        prescriptionId,
      ]);
    },
  };
}

export type LifecycleService = ReturnType<typeof makeLifecycleService>;
