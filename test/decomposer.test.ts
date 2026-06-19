import { describe, it, expect } from 'vitest';
import {
  decompose,
  UnknownFrequencyError,
  type Med,
  type MealTimes,
} from '../src/dosing/decomposer.js';

const MEAL: MealTimes = {
  breakfast: '08:00',
  lunch: '12:30',
  dinner: '18:30',
  bedtime: '22:00',
};

function med(over: Partial<Med> = {}): Med {
  return { name: 'A', qty: 1, freq: 'TID', timing: '飯後', ...over };
}

describe('decompose', () => {
  it('TID 飯後 7 天 → 21 doses, morning at meal+30 (Taipei→UTC)', () => {
    const doses = decompose(
      { id: 42, startDate: '2026-06-20', days: 7, meds: [med()] },
      MEAL,
    );
    expect(doses.length).toBe(21);
    expect(doses[0].slot).toBe('morning');
    // breakfast 08:00 + 30m = 08:30 Taipei = 00:30 UTC
    expect(doses[0].scheduledAt.toISOString()).toBe('2026-06-20T00:30:00.000Z');
    expect(doses[0].doseEventId).toBe('42-2026-06-20-morning');
  });

  it('frequency → slot count per day: QD=1, BID=2, TID=3, QID=4', () => {
    const day = { id: 1, startDate: '2026-06-20', days: 1 };
    expect(decompose({ ...day, meds: [med({ freq: 'QD' })] }, MEAL).length).toBe(1);
    expect(decompose({ ...day, meds: [med({ freq: 'BID' })] }, MEAL).length).toBe(2);
    expect(decompose({ ...day, meds: [med({ freq: 'TID' })] }, MEAL).length).toBe(3);
    expect(decompose({ ...day, meds: [med({ freq: 'QID' })] }, MEAL).length).toBe(4);
  });

  it('QID bedtime dose ignores timing offset (uses bedtime exactly)', () => {
    const doses = decompose(
      { id: 1, startDate: '2026-06-20', days: 1, meds: [med({ freq: 'QID' })] },
      MEAL,
    );
    const bedtime = doses.find((d) => d.slot === 'bedtime')!;
    // 22:00 Taipei = 14:00 UTC, regardless of 飯後
    expect(bedtime.scheduledAt.toISOString()).toBe('2026-06-20T14:00:00.000Z');
  });

  it('飯前 shifts -30m, wrapping the UTC date when needed', () => {
    const doses = decompose(
      { id: 1, startDate: '2026-06-20', days: 1, meds: [med({ freq: 'QD', timing: '飯前' })] },
      MEAL,
    );
    // breakfast 08:00 - 30m = 07:30 Taipei = 23:30 UTC previous day
    expect(doses[0].scheduledAt.toISOString()).toBe('2026-06-19T23:30:00.000Z');
  });

  it('merges multiple drugs sharing a slot into one dose event', () => {
    const doses = decompose(
      {
        id: 1,
        startDate: '2026-06-20',
        days: 1,
        meds: [med({ name: 'A', freq: 'TID' }), med({ name: 'B', freq: 'TID' })],
      },
      MEAL,
    );
    expect(doses.length).toBe(3); // 3 slots, not 6
    expect(doses[0].meds.map((m) => m.name).sort()).toEqual(['A', 'B']);
  });

  it('throws UnknownFrequencyError on a bad frequency', () => {
    expect(() =>
      decompose(
        { id: 1, startDate: '2026-06-20', days: 1, meds: [med({ freq: 'Q6H' as any })] },
        MEAL,
      ),
    ).toThrow(UnknownFrequencyError);
  });

  it('boundary: 1-day prescription yields exactly one day of doses', () => {
    const doses = decompose(
      { id: 1, startDate: '2026-06-20', days: 1, meds: [med({ freq: 'BID' })] },
      MEAL,
    );
    expect(doses.length).toBe(2);
    expect(doses.map((d) => d.slot).sort()).toEqual(['evening', 'morning']);
    expect(doses.every((d) => d.doseEventId.startsWith('1-2026-06-20-'))).toBe(true);
  });

  it('rejects days < 1', () => {
    expect(() =>
      decompose({ id: 1, startDate: '2026-06-20', days: 0, meds: [med()] }, MEAL),
    ).toThrow(RangeError);
  });
});
