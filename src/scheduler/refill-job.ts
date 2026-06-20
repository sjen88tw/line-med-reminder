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
  const { rows } = await deps.db.query(
    `SELECT p.id, p.status, p.meds, p.member_id, m.line_user_id
     FROM prescription p
     JOIN member m ON m.id = p.member_id
     WHERE p.id = $1`,
    [prescriptionId],
  );
  if (!rows.length) return;
  const p = rows[0];
  if (p.status !== 'active') return; // ended/stopped -> don't nudge

  const summary = parseMeds(p.meds)
    .map((m) => m.name)
    .join('、');

  await deps.pusher.push(p.line_user_id, [buildRefillMessage(summary)]);
  await deps.db.query(
    `UPDATE prescription SET refill_reminded_at = now() WHERE id = $1`,
    [prescriptionId],
  );
  await deps.notifyPharmacy(`病人 #${p.member_id} 待續領召回（${summary}）`);
}
