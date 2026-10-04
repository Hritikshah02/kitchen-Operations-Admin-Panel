import { DateTime } from 'luxon';
import type { IsoDate } from '../settings/kitchen-calendar.js';

export const AT_RISK_MINUTES = 30;

export type KitchenPlan = { dispatchReadyAt: Date; kitchenReadyAt: Date };
export type Timing = 'DONE' | 'LATE' | 'AT_RISK' | 'ON_TRACK';

/**
 * 4.7: dispatch-ready = delivery time minus the company's delivery minutes; kitchen-ready = dispatch-ready minus
 * the kitchen buffer. Worked out from the wall-clock delivery time in the kitchen zone, so it is right in any
 * server or browser time zone, and it moves automatically when the delivery time changes.
 */
export function planFor(date: IsoDate, deliveryTime: string, deliveryMinutes: number, bufferMinutes: number, timezone: string): KitchenPlan {
  const delivery = DateTime.fromISO(`${date}T${deliveryTime}`, { zone: timezone });
  const dispatchReady = delivery.minus({ minutes: deliveryMinutes });
  return { dispatchReadyAt: dispatchReady.toJSDate(), kitchenReadyAt: dispatchReady.minus({ minutes: bufferMinutes }).toJSDate() };
}

/** Late once the planned kitchen-ready time passes unfinished; at risk in the last AT_RISK_MINUTES before it. */
export function timingOf(plan: KitchenPlan, readyAt: Date | null, now: Date): Timing {
  if (readyAt) return 'DONE';
  const remainingMs = plan.kitchenReadyAt.getTime() - now.getTime();
  if (remainingMs < 0) return 'LATE';
  return remainingMs <= AT_RISK_MINUTES * 60_000 ? 'AT_RISK' : 'ON_TRACK';
}

export type UnitState = 'PENDING' | 'STARTED' | 'DONE';
export const unitState = (unit: { startedAt: Date | null; doneAt: Date | null }): UnitState => (unit.doneAt ? 'DONE' : unit.startedAt ? 'STARTED' : 'PENDING');
