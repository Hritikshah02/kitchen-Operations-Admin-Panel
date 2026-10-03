import { DateTime } from 'luxon';

/** Calendar dates are plain `YYYY-MM-DD` strings, always meaning a day in the kitchen's timezone. */
export type IsoDate = string;

export type KitchenCalendar = {
  timezone: string;
  workingDays: readonly number[]; // ISO weekday, 1 = Monday ... 7 = Sunday
  holidays: ReadonlySet<IsoDate>;
};

export type CutoffRule = {
  cutoffTime: string; // HH:mm, kitchen timezone
  cutoffWorkingDays: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Guards the backward walk; a year with no working day means the settings are unusable, not that we should loop forever.
const MAX_DAYS_SCANNED = 366;

function parseDate(date: IsoDate, timezone: string): DateTime {
  const parsed = ISO_DATE.test(date) ? DateTime.fromISO(date, { zone: timezone }) : DateTime.invalid('bad format');
  if (!parsed.isValid) throw new RangeError(`Invalid calendar date: ${date}`);
  return parsed;
}

export function isKitchenWorkingDay(date: IsoDate, calendar: KitchenCalendar): boolean {
  const day = parseDate(date, calendar.timezone);
  return calendar.workingDays.includes(day.weekday) && !calendar.holidays.has(date);
}

/**
 * The instant orders for `deliveryDate` lock: `cutoffTime` on the day reached by counting back
 * `cutoffWorkingDays` kitchen working days from the delivery date (non-working days and holidays are skipped).
 * Example: 2 working days at 16:00 -> a Wednesday delivery locks Monday 16:00.
 */
export function cutoffFor(deliveryDate: IsoDate, rule: CutoffRule, calendar: KitchenCalendar): DateTime {
  let day = parseDate(deliveryDate, calendar.timezone);
  let remaining = rule.cutoffWorkingDays;
  for (let scanned = 0; remaining > 0; scanned++) {
    if (scanned > MAX_DAYS_SCANNED) throw new RangeError('No kitchen working days found within a year; check settings.');
    day = day.minus({ days: 1 });
    if (isKitchenWorkingDay(day.toISODate()!, calendar)) remaining--;
  }
  const [hour, minute] = rule.cutoffTime.split(':').map(Number);
  return day.set({ hour, minute, second: 0, millisecond: 0 });
}

/** True while orders for `deliveryDate` can still be changed or cancelled without an admin override. */
export function isBeforeCutoff(deliveryDate: IsoDate, rule: CutoffRule, calendar: KitchenCalendar, now: Date = new Date()): boolean {
  return DateTime.fromJSDate(now) < cutoffFor(deliveryDate, rule, calendar);
}

/** Today's date in the kitchen, regardless of the server's or browser's timezone. */
export function kitchenToday(timezone: string, now: Date = new Date()): IsoDate {
  return DateTime.fromJSDate(now, { zone: timezone }).toISODate()!;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toISODate()!;
}

/** Postgres DATE columns round-trip through JS Dates at UTC midnight. */
export const toDbDate = (date: IsoDate) => new Date(`${date}T00:00:00.000Z`);
export const fromDbDate = (date: Date): IsoDate => date.toISOString().slice(0, 10);
