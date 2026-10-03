import { DateTime } from 'luxon';
import { isKitchenWorkingDay, type IsoDate, type KitchenCalendar } from '../settings/kitchen-calendar.js';

export type CompanyCalendar = {
  workingDays: readonly number[]; // ISO weekday the company accepts deliveries
  holidays: ReadonlySet<IsoDate>;
};

export type DeliveryDayCheck = { ok: true } | { ok: false; reason: string };

/**
 * A delivery needs the kitchen open AND the company receiving. The company calendar only restricts
 * which dates can be ordered; it never moves the cut-off, which counts kitchen working days only (4.4).
 */
export function checkDeliveryDay(date: IsoDate, company: CompanyCalendar, kitchen: KitchenCalendar): DeliveryDayCheck {
  const weekday = DateTime.fromISO(date, { zone: kitchen.timezone }).weekday;
  if (!isKitchenWorkingDay(date, kitchen)) return { ok: false, reason: 'The kitchen is closed on this date.' };
  if (!company.workingDays.includes(weekday)) return { ok: false, reason: 'The company does not receive deliveries on this weekday.' };
  if (company.holidays.has(date)) return { ok: false, reason: 'This date is a company holiday.' };
  return { ok: true };
}
