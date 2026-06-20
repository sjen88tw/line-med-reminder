import type { Queryable } from '../member/member-service.js';
import type { Pusher } from '../line/push.js';
import { buildRefillMessage } from '../line/flex-reminder.js';
import { parseMeds } from '../scheduler/dose-loader.js';

export type RiskLevel = 'high' | 'medium';

export interface AtRiskRow {
  prescriptionId: number | string;
  memberId: number | string;
  memberName: string | null;
  drugSummary: string;
  daysLeft: number;
  adherenceRate: number;
  risk: RiskLevel;
}

export interface DashboardMetrics {
  refillRate: number;
  adherenceRate: number;
  atRiskCount: number;
  recovered: number; // 已挽回 = prescriptions the patient came back to refill
}

export interface DashboardDeps {
  db: Queryable;
  pusher: Pusher;
  notifyPharmacy?: (text: string) => Promise<void>;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toYMD(d: unknown): string {
  if (d instanceof Date) {
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  return String(d).slice(0, 10);
}

function addDaysYMD(ymd: string, n: number): string {
  const [y, mo, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function daysBetweenYMD(fromYMD: string, toYMD_: string): number {
  const f = Date.parse(`${fromYMD}T00:00:00Z`);
  const t = Date.parse(`${toYMD_}T00:00:00Z`);
  return Math.round((t - f) / 86_400_000);
}

async function adherenceForMember(db: Queryable, memberId: number | string): Promise<number> {
  const { rows } = await db.query(
    `SELECT SUM(CASE WHEN status='CONFIRMED' THEN 1 ELSE 0 END) AS c,
            SUM(CASE WHEN status='MISSED' THEN 1 ELSE 0 END) AS m
     FROM dose_event WHERE member_id = $1`,
    [memberId],
  );
  const c = Number(rows[0]?.c ?? 0);
  const m = Number(rows[0]?.m ?? 0);
  return c + m === 0 ? 0 : c / (c + m);
}

export function makeDashboardService(deps: DashboardDeps) {
  const { db } = deps;

  return {
    // 風險名單: active, not-yet-refilled prescriptions running out within
    // `thresholdDays`, sorted soonest-first. ≤2 days = high, else medium.
    async atRisk(
      asOf: Date,
      opts?: { thresholdDays?: number },
    ): Promise<AtRiskRow[]> {
      const threshold = opts?.thresholdDays ?? 5;
      const asOfYMD = toYMD(asOf);
      const { rows } = await db.query(
        `SELECT p.id, p.member_id, p.start_date, p.days, p.meds, m.display_name
         FROM prescription p
         JOIN member m ON m.id = p.member_id
         WHERE p.status = 'active' AND p.refilled_at IS NULL`,
      );

      const out: AtRiskRow[] = [];
      for (const r of rows) {
        const endYMD = addDaysYMD(toYMD(r.start_date), Number(r.days));
        const daysLeft = daysBetweenYMD(asOfYMD, endYMD);
        if (daysLeft > threshold) continue;
        out.push({
          prescriptionId: r.id,
          memberId: r.member_id,
          memberName: r.display_name ?? null,
          drugSummary: parseMeds(r.meds).map((x) => x.name).join('、'),
          daysLeft,
          adherenceRate: await adherenceForMember(db, r.member_id),
          risk: daysLeft <= 2 ? 'high' : 'medium',
        });
      }
      out.sort((a, b) => a.daysLeft - b.daysLeft);
      return out;
    },

    async metrics(asOf: Date): Promise<DashboardMetrics> {
      const refill = await db.query(
        `SELECT SUM(CASE WHEN refill_reminded_at IS NOT NULL THEN 1 ELSE 0 END) AS reminded,
                SUM(CASE WHEN refilled_at IS NOT NULL THEN 1 ELSE 0 END) AS refilled
         FROM prescription`,
      );
      const reminded = Number(refill.rows[0]?.reminded ?? 0);
      const refilled = Number(refill.rows[0]?.refilled ?? 0);

      const adh = await db.query(
        `SELECT SUM(CASE WHEN status='CONFIRMED' THEN 1 ELSE 0 END) AS c,
                SUM(CASE WHEN status='MISSED' THEN 1 ELSE 0 END) AS m
         FROM dose_event`,
      );
      const c = Number(adh.rows[0]?.c ?? 0);
      const m = Number(adh.rows[0]?.m ?? 0);

      const atRisk = await this.atRisk(asOf);
      return {
        refillRate: reminded === 0 ? 0 : refilled / reminded,
        adherenceRate: c + m === 0 ? 0 : c / (c + m),
        atRiskCount: atRisk.length,
        recovered: refilled,
      };
    },

    // One-tap "LINE 提醒" from the dashboard: a manual refill nudge. Always
    // sends (pharmacist intent) and records refill_reminded_at.
    async remind(prescriptionId: number | string): Promise<boolean> {
      const { rows } = await db.query(
        `SELECT p.status, p.meds, p.member_id, m.line_user_id
         FROM prescription p JOIN member m ON m.id = p.member_id
         WHERE p.id = $1`,
        [prescriptionId],
      );
      if (!rows.length || rows[0].status !== 'active') return false;
      const summary = parseMeds(rows[0].meds).map((x) => x.name).join('、');
      await deps.pusher.push(rows[0].line_user_id as string, [buildRefillMessage(summary)]);
      await db.query(`UPDATE prescription SET refill_reminded_at = now() WHERE id = $1`, [
        prescriptionId,
      ]);
      if (deps.notifyPharmacy) {
        await deps.notifyPharmacy(`已手動提醒病人 #${rows[0].member_id} 續領`);
      }
      return true;
    },
  };
}

export type DashboardService = ReturnType<typeof makeDashboardService>;
