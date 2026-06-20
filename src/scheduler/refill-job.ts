import type { Queryable } from '../member/member-service.js';
import type { Pusher } from '../line/push.js';
import { buildRefillMessage } from '../line/flex-reminder.js';
import { parseMeds } from './dose-loader.js';

export interface RefillDeps {
  db: Queryable;
  pusher: Pusher;
  notifyPharmacy: (text: string) => Promise<void>;
}

// #05 (E1, the monetization hook): R days before the course runs out, nudge the
// patient to come back and refill, and put them on the pharmacy's recall list.
export async function handleRefillReminder(
  prescriptionId: number | string,
  deps: RefillDeps,
): Promise<void> {
  // Atomic claim: only an active prescription that hasn't been nudged yet wins.
  // pg-boss is at-least-once, so a redelivered job must NOT re-push or overwrite.
  const claimed = await deps.db.query(
    `UPDATE prescription SET refill_reminded_at = now()
     WHERE id = $1 AND status = 'active' AND refill_reminded_at IS NULL
     RETURNING member_id, meds`,
    [prescriptionId],
  );
  if (!claimed.rows.length) return; // already nudged, ended, or missing

  const memberId = claimed.rows[0].member_id;
  const summary = parseMeds(claimed.rows[0].meds)
    .map((m) => m.name)
    .join('、');

  const { rows: mrows } = await deps.db.query(
    'SELECT line_user_id FROM member WHERE id = $1',
    [memberId],
  );
  if (!mrows.length) return;

  await deps.pusher.push(mrows[0].line_user_id, [buildRefillMessage(summary)]);
  await deps.notifyPharmacy(`病人 #${memberId} 待續領召回（${summary}）`);
}
