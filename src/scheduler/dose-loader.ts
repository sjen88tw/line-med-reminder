import type { Queryable } from '../member/member-service.js';

export interface DoseRow {
  id: string;
  member_id: number | string;
  slot: string;
  status: string;
  meds: unknown;
  line_user_id: string;
  prescription_status: string;
}

export function parseMeds(meds: unknown): { name: string; qty: number }[] {
  const v = typeof meds === 'string' ? JSON.parse(meds) : meds;
  return Array.isArray(v) ? (v as { name: string; qty: number }[]) : [];
}

export async function loadDose(
  db: Queryable,
  doseEventId: string,
): Promise<DoseRow | null> {
  const { rows } = await db.query(
    `SELECT d.id, d.member_id, d.slot, d.status, d.meds, m.line_user_id,
            p.status AS prescription_status
     FROM dose_event d
     JOIN member m ON m.id = d.member_id
     JOIN prescription p ON p.id = d.prescription_id
     WHERE d.id = $1`,
    [doseEventId],
  );
  return rows.length === 1 ? (rows[0] as DoseRow) : null;
}
