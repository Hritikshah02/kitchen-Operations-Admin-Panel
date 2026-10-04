import { DateTime } from 'luxon';
import type { IsoDate } from '../settings/kitchen-calendar.js';

export type DropKey = { companyId: number; addressId: number; deliveryDate: IsoDate; deliveryTime: string };

/** 4.8: orders for the same company, address and exact delivery time are one drop. */
export const dropId = (key: DropKey) => `${key.deliveryDate}|${key.companyId}|${key.addressId}|${key.deliveryTime}`;

export type Stage = 'COOKING' | 'KITCHEN_READY' | 'DISPATCH_READY' | 'OUT_FOR_DELIVERY' | 'DELIVERED';

export type Member = {
  id: number;
  kitchenReadyAt: Date | null;
  dispatchReadyAt: Date | null;
  outForDeliveryAt: Date | null;
  deliveredAt: Date | null;
  plannedKitchenReadyAt: Date;
};

export const stageOf = (member: Pick<Member, 'kitchenReadyAt' | 'dispatchReadyAt' | 'outForDeliveryAt' | 'deliveredAt'>): Stage =>
  member.deliveredAt ? 'DELIVERED' : member.outForDeliveryAt ? 'OUT_FOR_DELIVERY' : member.dispatchReadyAt ? 'DISPATCH_READY' : member.kitchenReadyAt ? 'KITCHEN_READY' : 'COOKING';

export type DispatchGate = { ids: number[]; blockedReason: string | null };

/**
 * Which orders of a drop can be marked dispatch-ready now. Kitchen-ready orders leave together. Orders still
 * cooking are waited for while they can still make their planned kitchen-ready time; one that is already late
 * is not waited for and follows later as a second trip.
 */
export function dispatchGate(members: Member[], now: Date): DispatchGate {
  const ready = members.filter((member) => stageOf(member) === 'KITCHEN_READY');
  if (!ready.length) return { ids: [], blockedReason: members.some((member) => stageOf(member) === 'COOKING') ? 'No order in this drop is kitchen ready yet.' : 'Nothing is waiting to be dispatched.' };
  const waiting = members.filter((member) => stageOf(member) === 'COOKING' && member.plannedKitchenReadyAt.getTime() >= now.getTime());
  if (waiting.length) return { ids: [], blockedReason: `Waiting for ${waiting.length} order${waiting.length === 1 ? '' : 's'} still due from the kitchen.` };
  return { ids: ready.map((member) => member.id), blockedReason: null };
}

/** Delivery is late by the minutes past the delivery time (never negative); on time while within the grace. */
export function deliveryTiming(date: IsoDate, deliveryTime: string, deliveredAt: Date, graceMinutes: number, timezone: string) {
  const due = DateTime.fromISO(`${date}T${deliveryTime}`, { zone: timezone }).toMillis();
  const lateMinutes = Math.max(0, Math.ceil((deliveredAt.getTime() - due) / 60_000));
  return { lateMinutes, onTime: lateMinutes <= graceMinutes };
}
