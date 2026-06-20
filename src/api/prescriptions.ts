import type { CreatePrescriptionInput } from '../prescription/prescription-service.js';
import type { Freq, Timing } from '../dosing/decomposer.js';

const FREQS: Freq[] = ['QD', 'BID', 'TID', 'QID'];
const TIMINGS: Timing[] = ['飯前', '飯後', '睡前'];

export type ValidationResult =
  | { ok: true; value: Omit<CreatePrescriptionInput, 'queue'> }
  | { ok: false; errors: string[] };

// Validates the pharmacist's structured prescription form before materializing.
export function validateCreatePrescription(body: unknown): ValidationResult {
  const errors: string[] = [];
  if (!body || typeof body !== 'object') {
    return { ok: false, errors: ['request body required'] };
  }
  const b = body as Record<string, unknown>;

  if (b.memberId == null || (typeof b.memberId !== 'number' && typeof b.memberId !== 'string')) {
    errors.push('memberId required');
  }
  if (typeof b.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.startDate)) {
    errors.push('startDate must be YYYY-MM-DD');
  }
  if (!Number.isInteger(b.days) || (b.days as number) < 1 || (b.days as number) > 90) {
    errors.push('days must be an integer between 1 and 90');
  }
  if (!Array.isArray(b.meds) || b.meds.length === 0) {
    errors.push('at least one med required');
  } else {
    b.meds.forEach((m: unknown, i: number) => {
      const med = m as Record<string, unknown>;
      if (!med || typeof med.name !== 'string' || !med.name.trim()) {
        errors.push(`meds[${i}].name required`);
      }
      if (typeof med?.qty !== 'number' || !Number.isFinite(med.qty) || med.qty <= 0) {
        errors.push(`meds[${i}].qty must be a number > 0`);
      }
      if (!FREQS.includes(med?.freq as Freq)) {
        errors.push(`meds[${i}].freq must be one of ${FREQS.join('/')}`);
      }
      if (!TIMINGS.includes(med?.timing as Timing)) {
        errors.push(`meds[${i}].timing must be one of ${TIMINGS.join('/')}`);
      }
    });
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      memberId: b.memberId as number | string,
      startDate: b.startDate as string,
      days: b.days as number,
      meds: b.meds as Omit<CreatePrescriptionInput, 'queue'>['meds'],
    },
  };
}
