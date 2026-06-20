import type { Queryable } from '../member/member-service.js';
import type { Pusher } from '../line/push.js';
import { buildEscalationFlex, slotLabel } from '../line/flex-reminder.js';
import { loadDose, parseMeds } from './dose-loader.js';

export interface EscalationDeps {
  db: Queryable;
  pusher: Pusher;
  notifyPharmacy: (text: string) => Promise<void>;
}

// Runs 3 minutes after a dose's scheduled time. Replaces the original "鳴笛"
// requirement (LINE can't): stronger push to the patient + pharmacy notice.
export async function handleEscalation(
  doseEventId: string,
  deps: EscalationDeps,
): Promise<void> {
  const dose = await loadDose(deps.db, doseEventId);
  if (!dose) return;
  if (dose.prescription_status === 'ended') return; // course stopped -> no escalation

  // Already confirmed, already escalated, or missed -> nothing to do.
  if (dose.status === 'CONFIRMED' || dose.status === 'ESCALATED' || dose.status === 'MISSED') {
    return;
  }

  if (dose.status === 'SCHEDULED') {
    // Reminder never delivered (push failed / user unreachable). This is a
    // different problem than "ignored" — tell the pharmacy, don't re-push.
    await deps.notifyPharmacy(
      `病人 #${dose.member_id} 的服藥提醒未送達（${slotLabel(dose.slot)}）`,
    );
    return;
  }

  // status === 'REMINDED': delivered but unconfirmed -> escalate.
  const updated = await deps.db.query(
    `UPDATE dose_event SET status = 'ESCALATED' WHERE id = $1 AND status = 'REMINDED' RETURNING id`,
    [doseEventId],
  );
  if (updated.rows.length === 0) return; // raced to CONFIRMED between load and update

  const flex = buildEscalationFlex({
    doseEventId,
    slot: dose.slot,
    meds: parseMeds(dose.meds),
  });
  await deps.pusher.push(dose.line_user_id, [flex]);
  await deps.notifyPharmacy(
    `病人 #${dose.member_id} 逾時未服藥（${slotLabel(dose.slot)}）`,
  );
}
