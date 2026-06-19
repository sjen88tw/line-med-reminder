// 拆解器 — 把處方(藥品 + 頻率 + 餐別 + 天數)展開成每餐絕對時間的 dose 陣列。
//
// table-driven:頻率→槽位、餐別→偏移皆查表,新增頻率只改資料、不改邏輯。
// 時區:台灣 UTC+8,無 DST(設計 A4)。所有絕對時間以此換算成 UTC,測試才確定。

export type Freq = 'QD' | 'BID' | 'TID' | 'QID';
export type Timing = '飯前' | '飯後' | '睡前';
export type Slot = 'morning' | 'noon' | 'evening' | 'bedtime';

export interface Med {
  name: string;
  qty: number;
  freq: Freq;
  timing: Timing;
}

export interface MealTimes {
  breakfast: string; // "HH:MM"
  lunch: string;
  dinner: string;
  bedtime: string;
}

export interface PrescriptionInput {
  id: number | string;
  startDate: string; // "YYYY-MM-DD"
  days: number;
  meds: Med[];
}

export interface DoseMed {
  name: string;
  qty: number;
}

export interface Dose {
  doseEventId: string; // `${prescriptionId}-${YYYY-MM-DD}-${slot}`
  slot: Slot;
  scheduledAt: Date; // absolute (UTC)
  meds: DoseMed[];
}

export class UnknownFrequencyError extends Error {
  constructor(public readonly freq: string) {
    super(`Unknown frequency: ${freq}`);
    this.name = 'UnknownFrequencyError';
  }
}

const FREQ_SLOTS: Record<Freq, Slot[]> = {
  QD: ['morning'],
  BID: ['morning', 'evening'],
  TID: ['morning', 'noon', 'evening'],
  QID: ['morning', 'noon', 'evening', 'bedtime'],
};

const SLOT_ORDER: Slot[] = ['morning', 'noon', 'evening', 'bedtime'];

const SLOT_MEAL: Record<Slot, keyof MealTimes> = {
  morning: 'breakfast',
  noon: 'lunch',
  evening: 'dinner',
  bedtime: 'bedtime',
};

// 餐別相對餐時的分鐘偏移。bedtime 槽位忽略偏移(睡前 = 就寢時間本身)。
const TIMING_OFFSET_MIN: Record<Timing, number> = {
  飯前: -30,
  飯後: 30,
  睡前: 0,
};

const TAIPEI_UTC_OFFSET_HOURS = 8;

function parseHM(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(':').map(Number);
  return { h, m };
}

// 台灣牆鐘時間 → UTC Date。Date.UTC 自動處理分鐘/小時的進退位(負分鐘、跨午夜)。
function taipeiWallClockToUtc(dateStr: string, h: number, m: number): Date {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - TAIPEI_UTC_OFFSET_HOURS, m));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function addDays(dateStr: string, n: number): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function decompose(rx: PrescriptionInput, meal: MealTimes): Dose[] {
  if (rx.days < 1) throw new RangeError(`days must be >= 1, got ${rx.days}`);
  if (rx.meds.length === 0) throw new RangeError('prescription has no meds');

  // Validate all frequencies up front so we fail loud, not half-materialized.
  for (const med of rx.meds) {
    if (!(med.freq in FREQ_SLOTS)) throw new UnknownFrequencyError(med.freq);
  }

  const doses: Dose[] = [];
  for (let day = 0; day < rx.days; day++) {
    const dateStr = addDays(rx.startDate, day);
    for (const slot of SLOT_ORDER) {
      const slotMeds = rx.meds.filter((m) => FREQ_SLOTS[m.freq].includes(slot));
      if (slotMeds.length === 0) continue;

      const base = parseHM(meal[SLOT_MEAL[slot]]);
      // When meds in one slot mix 飯前/飯後, take the earliest (safest) offset.
      const offset =
        slot === 'bedtime'
          ? 0
          : Math.min(...slotMeds.map((m) => TIMING_OFFSET_MIN[m.timing] ?? 0));

      doses.push({
        doseEventId: `${rx.id}-${dateStr}-${slot}`,
        slot,
        scheduledAt: taipeiWallClockToUtc(dateStr, base.h, base.m + offset),
        meds: slotMeds.map((m) => ({ name: m.name, qty: m.qty })),
      });
    }
  }

  return doses.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}
