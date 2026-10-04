import { describe, expect, it } from 'vitest';
import { planFor, timingOf, unitState } from './kitchen-plan.js';

const plan = planFor('2026-10-06', '12:30', 60, 30, 'Asia/Kolkata');

describe('planFor', () => {
  it('works back from the delivery time in the kitchen zone', () => {
    expect(plan.dispatchReadyAt.toISOString()).toBe('2026-10-06T06:00:00.000Z'); // 11:30 IST
    expect(plan.kitchenReadyAt.toISOString()).toBe('2026-10-06T05:30:00.000Z'); // 11:00 IST
  });
  it('follows a changed delivery time and company delivery minutes', () => {
    const moved = planFor('2026-10-06', '13:00', 45, 30, 'Asia/Kolkata');
    expect(moved.kitchenReadyAt.toISOString()).toBe('2026-10-06T06:15:00.000Z'); // 11:45 IST
  });
  it('can cross midnight', () => {
    expect(planFor('2026-10-06', '00:30', 60, 30, 'Asia/Kolkata').kitchenReadyAt.toISOString()).toBe('2026-10-05T17:30:00.000Z'); // 23:00 IST the day before
  });
});

describe('timingOf', () => {
  const at = (minutesBefore: number) => new Date(plan.kitchenReadyAt.getTime() - minutesBefore * 60_000);
  it('is done once ready, however late', () => expect(timingOf(plan, new Date(), at(-500))).toBe('DONE'));
  it('is on track more than 30 minutes ahead', () => expect(timingOf(plan, null, at(31))).toBe('ON_TRACK'));
  it('is at risk within 30 minutes, including the minute it is due', () => {
    expect(timingOf(plan, null, at(30))).toBe('AT_RISK');
    expect(timingOf(plan, null, at(0))).toBe('AT_RISK');
  });
  it('is late after the planned time', () => expect(timingOf(plan, null, at(-1))).toBe('LATE'));
});

describe('unitState', () => {
  it('derives pending, started and done', () => {
    expect(unitState({ startedAt: null, doneAt: null })).toBe('PENDING');
    expect(unitState({ startedAt: new Date(), doneAt: null })).toBe('STARTED');
    expect(unitState({ startedAt: new Date(), doneAt: new Date() })).toBe('DONE');
  });
});
