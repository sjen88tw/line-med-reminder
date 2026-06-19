import type { Queryable } from '../member/member-service.js';
import {
  decompose,
  type Med,
  type MealTimes,
} from '../dosing/decomposer.js';
import { type JobQueue, scheduleForDose } from '../scheduler/scheduler.js';

// A2: silent default meal times. No prompt to the patient (pilot decision).
export const DEFAULT_MEAL_TIMES: MealTimes = {
  breakfast: '08:00',
  lunch: '12:30',
  dinner: '18:30',
  bedtime: '22:00',
};

export interface CreatePrescriptionInput {
  memberId: number | string;
  startDate: string; // "YYYY-MM-DD"
  days: number;
  meds: Med[];
  mealTimes?: MealTimes;
  // When provided, each materialized dose gets a persisted reminder +
  // escalation job (#03). Omit in tests that only assert DB materialization.
  queue?: JobQueue;
}

export interface CreatePrescriptionResult {
  prescriptionId: number | string;
  doseCount: number;
}

export function makePrescriptionService(db: Queryable) {
  return {
    // Creates the prescription row, then materializes one dose_event row per
    // dose per day (A8). Re-running is safe: dose ids collide via ON CONFLICT.
    async create(
      input: CreatePrescriptionInput,
    ): Promise<CreatePrescriptionResult> {
      const meal = input.mealTimes ?? DEFAULT_MEAL_TIMES;

      const { rows } = await db.query(
        `INSERT INTO prescription (member_id, start_date, days, meds, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING id`,
        [input.memberId, input.startDate, input.days, JSON.stringify(input.meds)],
      );
      const prescriptionId = rows[0].id as number | string;

      const doses = decompose(
        {
          id: prescriptionId,
          startDate: input.startDate,
          days: input.days,
          meds: input.meds,
        },
        meal,
      );

      for (const d of doses) {
        await db.query(
          `INSERT INTO dose_event (id, prescription_id, member_id, slot, scheduled_at, meds, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'SCHEDULED')
           ON CONFLICT (id) DO NOTHING`,
          [
            d.doseEventId,
            prescriptionId,
            input.memberId,
            d.slot,
            d.scheduledAt.toISOString(),
            JSON.stringify(d.meds),
          ],
        );
        if (input.queue) {
          await scheduleForDose(input.queue, {
            doseEventId: d.doseEventId,
            scheduledAt: d.scheduledAt,
          });
        }
      }

      return { prescriptionId, doseCount: doses.length };
    },
  };
}

export type PrescriptionService = ReturnType<typeof makePrescriptionService>;
