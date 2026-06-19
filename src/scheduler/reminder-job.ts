import type { Queryable } from '../member/member-service.js';
import { type Pusher, classifyPushError } from '../line/push.js';
import { buildReminderFlex } from '../line/flex-reminder.js';
import { loadDose, parseMeds } from './dose-loader.js';

export interface ReminderDeps {
  db: Queryable;
  pusher: Pusher;
  markUnreachable?: (memberId: number | string) => Promise<void>;
}

export async function handleReminder(
  doseEventId: string,
  deps: ReminderDeps,
): Promise<void> {
  const dose = await loadDose(deps.db, doseEventId);
  if (!dose) return;
  // Only a still-SCHEDULED dose gets reminded. Confirmed/reminded/missed -> no-op.
  if (dose.status !== 'SCHEDULED') return;

  const flex = buildReminderFlex({
    doseEventId,
    slot: dose.slot,
    meds: parseMeds(dose.meds),
  });

  try {
    await deps.pusher.push(dose.line_user_id, [flex]);
  } catch (err) {
    const cls = classifyPushError(err);
    if (cls === 'unreachable') {
      // User blocked the OA. Don't retry; leave SCHEDULED so escalation can
      // report "never delivered" rather than "delivered, not confirmed".
      if (deps.markUnreachable) await deps.markUnreachable(dose.member_id);
      return;
    }
    throw err; // retry / fatal -> queue retry, then dead-letter
  }

  // Mark REMINDED only after a successful push.
  await deps.db.query(
    `UPDATE dose_event SET status = 'REMINDED' WHERE id = $1 AND status = 'SCHEDULED'`,
    [doseEventId],
  );
}
