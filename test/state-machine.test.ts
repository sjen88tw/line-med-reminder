import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertTransition,
  isTerminal,
  IllegalTransitionError,
} from '../src/dosing/state-machine.js';

describe('dose state machine', () => {
  it('allows the happy path SCHEDULED → REMINDED → CONFIRMED', () => {
    expect(canTransition('SCHEDULED', 'REMINDED')).toBe(true);
    expect(canTransition('REMINDED', 'CONFIRMED')).toBe(true);
  });

  it('allows the escalation path REMINDED → ESCALATED → CONFIRMED', () => {
    expect(canTransition('REMINDED', 'ESCALATED')).toBe(true);
    expect(canTransition('ESCALATED', 'CONFIRMED')).toBe(true);
  });

  it('rejects illegal transitions (CONFIRMED is terminal)', () => {
    expect(canTransition('CONFIRMED', 'SCHEDULED')).toBe(false);
    expect(canTransition('CONFIRMED', 'REMINDED')).toBe(false);
    expect(canTransition('SCHEDULED', 'CONFIRMED')).toBe(false); // must be reminded first
  });

  it('assertTransition throws IllegalTransitionError on a bad move', () => {
    expect(() => assertTransition('CONFIRMED', 'SCHEDULED')).toThrow(IllegalTransitionError);
  });

  it('marks CONFIRMED and MISSED as terminal', () => {
    expect(isTerminal('CONFIRMED')).toBe(true);
    expect(isTerminal('MISSED')).toBe(true);
    expect(isTerminal('REMINDED')).toBe(false);
  });
});
