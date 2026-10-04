import { describe, expect, it } from 'vitest';
import { deliveryTiming, dispatchGate, stageOf, type Member } from './dispatch-rules.js';

const now = new Date('2026-10-06T05:00:00Z');
const minutes = (offset: number) => new Date(now.getTime() + offset * 60_000);
const member = (id: number, overrides: Partial<Member> = {}): Member => ({ id, kitchenReadyAt: null, dispatchReadyAt: null, outForDeliveryAt: null, deliveredAt: null, plannedKitchenReadyAt: minutes(20), ...overrides });
const ready = (id: number) => member(id, { kitchenReadyAt: minutes(-5) });

describe('stageOf', () => {
  it('follows the order of steps', () => {
    expect(stageOf(member(1))).toBe('COOKING');
    expect(stageOf(ready(1))).toBe('KITCHEN_READY');
    expect(stageOf({ ...ready(1), dispatchReadyAt: now })).toBe('DISPATCH_READY');
    expect(stageOf({ ...ready(1), dispatchReadyAt: now, outForDeliveryAt: now })).toBe('OUT_FOR_DELIVERY');
    expect(stageOf({ ...ready(1), dispatchReadyAt: now, outForDeliveryAt: now, deliveredAt: now })).toBe('DELIVERED');
  });
});

describe('dispatchGate', () => {
  it('sends everyone when all are ready', () => expect(dispatchGate([ready(1), ready(2)], now)).toEqual({ ids: [1, 2], blockedReason: null }));
  it('waits for an order that can still make its time', () => {
    const gate = dispatchGate([ready(1), ready(2), ready(3), member(4)], now);
    expect(gate.ids).toEqual([]);
    expect(gate.blockedReason).toMatch(/Waiting for 1 order/);
  });
  it('does not wait for a late order: the ready ones leave and it follows later', () => {
    const late = member(4, { plannedKitchenReadyAt: minutes(-10) });
    expect(dispatchGate([ready(1), ready(2), ready(3), member(5), late], now).ids).toEqual([]); // still waiting for 5 (on time)
    expect(dispatchGate([ready(1), ready(2), ready(3), late], now).ids).toEqual([1, 2, 3]);
  });
  it('does not repeat a step: already dispatch-ready orders are skipped', () => {
    const done = { ...ready(1), dispatchReadyAt: now };
    expect(dispatchGate([done], now)).toEqual({ ids: [], blockedReason: 'Nothing is waiting to be dispatched.' });
    expect(dispatchGate([done, ready(2)], now).ids).toEqual([2]);
  });
  it('explains when nothing is ready', () => expect(dispatchGate([member(1)], now).blockedReason).toMatch(/kitchen ready yet/));
});

describe('deliveryTiming', () => {
  const at = (iso: string) => new Date(iso);
  it('is on time when early or exactly on time', () => {
    expect(deliveryTiming('2026-10-06', '12:30', at('2026-10-06T06:50:00Z'), 5, 'Asia/Kolkata')).toEqual({ lateMinutes: 0, onTime: true }); // 12:20 IST
  });
  it('records the late minutes but stays on time inside the grace', () => {
    expect(deliveryTiming('2026-10-06', '12:30', at('2026-10-06T07:04:30Z'), 5, 'Asia/Kolkata')).toEqual({ lateMinutes: 5, onTime: true }); // 12:34:30 → 5 min
  });
  it('is late beyond the grace', () => {
    expect(deliveryTiming('2026-10-06', '12:30', at('2026-10-06T07:06:00Z'), 5, 'Asia/Kolkata')).toEqual({ lateMinutes: 6, onTime: false });
  });
});
