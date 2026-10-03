import { describe, expect, it } from 'vitest';
import { cutoffFor, type KitchenCalendar } from '../settings/kitchen-calendar.js';
import { checkDeliveryDay, type CompanyCalendar } from './company-calendar.js';

const kitchen: KitchenCalendar = { timezone: 'Asia/Kolkata', workingDays: [1, 2, 3, 4, 5], holidays: new Set(['2026-10-20']) };
const company: CompanyCalendar = { workingDays: [1, 2, 3, 4], holidays: new Set(['2026-10-07']) };

describe('company delivery calendar', () => {
  it('accepts a day when both kitchen and company are working', () => {
    expect(checkDeliveryDay('2026-10-06', company, kitchen)).toEqual({ ok: true });
  });

  it('rejects kitchen holidays, company non-working days and company holidays, with a reason', () => {
    expect(checkDeliveryDay('2026-10-20', company, kitchen)).toMatchObject({ ok: false, reason: expect.stringMatching(/kitchen/) });
    expect(checkDeliveryDay('2026-10-09', company, kitchen)).toMatchObject({ ok: false, reason: expect.stringMatching(/weekday/) }); // Friday
    expect(checkDeliveryDay('2026-10-07', company, kitchen)).toMatchObject({ ok: false, reason: expect.stringMatching(/company holiday/) });
  });

  it('rejects a weekend even if the company works it, because the kitchen is closed', () => {
    expect(checkDeliveryDay('2026-10-10', { ...company, workingDays: [1, 2, 3, 4, 5, 6] }, kitchen).ok).toBe(false);
  });

  it('does not let a company holiday move the cut-off (spec 4.4)', () => {
    // Company holiday on Wed 7 Oct; a Thu 8 Oct delivery still locks Wed 16:00 (1 kitchen working day before).
    expect(cutoffFor('2026-10-08', { cutoffTime: '16:00', cutoffWorkingDays: 1 }, kitchen).toISO()).toBe('2026-10-07T16:00:00.000+05:30');
  });
});
