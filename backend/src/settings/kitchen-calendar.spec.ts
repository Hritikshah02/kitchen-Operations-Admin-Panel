import { describe, expect, it } from 'vitest';
import { cutoffFor, isBeforeCutoff, isKitchenWorkingDay, kitchenToday, type KitchenCalendar } from './kitchen-calendar.js';

const monToFri: KitchenCalendar = { timezone: 'Asia/Kolkata', workingDays: [1, 2, 3, 4, 5], holidays: new Set() };
const at = (date: string, rule = { cutoffTime: '16:00', cutoffWorkingDays: 2 }, calendar = monToFri) =>
  cutoffFor(date, rule, calendar).toISO({ suppressMilliseconds: true });

describe('kitchen calendar', () => {
  it('locks a Wednesday delivery at Monday 16:00 with a 2-working-day cut-off (spec example)', () => {
    expect(at('2026-10-07')).toBe('2026-10-05T16:00:00+05:30');
  });

  it('skips the weekend when counting back', () => {
    expect(at('2026-10-05')).toBe('2026-10-01T16:00:00+05:30'); // Monday -> previous Thursday
    expect(at('2026-10-06', { cutoffTime: '16:00', cutoffWorkingDays: 1 })).toBe('2026-10-05T16:00:00+05:30');
  });

  it('skips kitchen holidays when counting back', () => {
    const withHoliday = { ...monToFri, holidays: new Set(['2026-10-05']) };
    expect(at('2026-10-07', undefined, withHoliday)).toBe('2026-10-02T16:00:00+05:30'); // Wed -> Tue, (Mon holiday), Fri
  });

  it('uses the delivery day itself for a 0-day cut-off', () => {
    expect(at('2026-10-07', { cutoffTime: '09:30', cutoffWorkingDays: 0 })).toBe('2026-10-07T09:30:00+05:30');
  });

  it('respects a custom working week (Mon-Sat)', () => {
    const monToSat = { ...monToFri, workingDays: [1, 2, 3, 4, 5, 6] };
    expect(at('2026-10-05', { cutoffTime: '16:00', cutoffWorkingDays: 1 }, monToSat)).toBe('2026-10-03T16:00:00+05:30');
  });

  it('computes the cut-off instant in the kitchen timezone, independent of the server timezone', () => {
    expect(cutoffFor('2026-10-07', { cutoffTime: '16:00', cutoffWorkingDays: 2 }, monToFri).toUTC().toISO()).toBe(
      '2026-10-05T10:30:00.000Z',
    );
  });

  it('reports working days, weekends and holidays', () => {
    expect(isKitchenWorkingDay('2026-10-07', monToFri)).toBe(true);
    expect(isKitchenWorkingDay('2026-10-10', monToFri)).toBe(false);
    expect(isKitchenWorkingDay('2026-10-07', { ...monToFri, holidays: new Set(['2026-10-07']) })).toBe(false);
  });

  it('gives the kitchen date even when UTC is still on the previous day', () => {
    expect(kitchenToday('Asia/Kolkata', new Date('2026-10-06T20:00:00Z'))).toBe('2026-10-07');
  });

  it('rejects malformed dates and a calendar with no working days', () => {
    expect(() => at('2026-13-01')).toThrow(RangeError);
    expect(() => at('2026-10-07', undefined, { ...monToFri, workingDays: [] })).toThrow(RangeError);
  });

  it('is before cut-off up to, but not at, the cut-off instant', () => {
    const rule = { cutoffTime: '16:00', cutoffWorkingDays: 2 };
    expect(isBeforeCutoff('2026-10-07', rule, monToFri, new Date('2026-10-05T10:29:59Z'))).toBe(true); // Mon 15:59:59 IST
    expect(isBeforeCutoff('2026-10-07', rule, monToFri, new Date('2026-10-05T10:30:00Z'))).toBe(false); // Mon 16:00 IST
  });
});
