import { describe, it, expect } from 'vitest';
import { classifyPushError } from '../src/line/push.js';

describe('classifyPushError', () => {
  it('429 -> retry (rate limited)', () => {
    expect(classifyPushError({ statusCode: 429 })).toBe('retry');
  });

  it('403 -> unreachable (user blocked the OA)', () => {
    expect(classifyPushError({ statusCode: 403 })).toBe('unreachable');
  });

  it('5xx -> retry (transient)', () => {
    expect(classifyPushError({ status: 502 })).toBe('retry');
  });

  it('400 -> fatal', () => {
    expect(classifyPushError({ statusCode: 400 })).toBe('fatal');
  });

  it('unknown shape -> fatal', () => {
    expect(classifyPushError(new Error('boom'))).toBe('fatal');
  });

  it('reads nested response.status', () => {
    expect(classifyPushError({ response: { status: 429 } })).toBe('retry');
  });
});
