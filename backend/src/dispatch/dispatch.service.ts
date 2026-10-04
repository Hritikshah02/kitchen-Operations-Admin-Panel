import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { OrderEventType, OrderStatus, Prisma } from '@prisma/client';
import type { AuthenticatedStaff } from '../auth/auth.types.js';
import { Capability } from '../auth/capabilities.js';
import { ImagesService } from '../catalogue/images.service.js';
import { planFor, timingOf } from '../kitchen/kitchen-plan.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { fromDbDate, toDbDate } from '../settings/kitchen-calendar.js';
import { SettingsService } from '../settings/settings.service.js';
import { deliveryTiming, dispatchGate, dropId, stageOf, type DropKey, type Member, type Stage } from './dispatch-rules.js';
import type { DeliverDto, DispatchBoardQueryDto } from './dispatch.dto.js';

type Tx = Prisma.TransactionClient;
const STAGE_RANK: Record<Stage, number> = { NOT_STARTED: 0, COOKING: 0, KITCHEN_READY: 1, DISPATCH_READY: 2, OUT_FOR_DELIVERY: 3, DELIVERED: 4 };

const orderInclude = {
  employee: { select: { name: true } },
  company: { select: { id: true, name: true, dispatchLeadMinutes: true, defaultDriverId: true, driverInstructions: true, defaultDriver: { select: { id: true, name: true } } } },
  address: true,
  packagingType: { select: { name: true } },
  driver: { select: { id: true, name: true } },
  deliveredBy: { select: { name: true } },
  lines: { orderBy: { sortOrder: 'asc' }, select: { dishName: true, quantity: true } },
} satisfies Prisma.OrderInclude;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly images: ImagesService,
  ) {}

  // ---------- Reads ----------

  /** 4.8: the day's drops (company + address + exact delivery time) with each one's status at a glance. */
  async board(query: DispatchBoardQueryDto) {
    const settings = await this.settings.get();
    const day = await this.settings.operatingDay();
    const date = query.date ?? day.date;
    const now = new Date();
    const drops = (await this.dropsFor(date, settings)).map((drop) => this.view(drop, now));
    const filtered = drops.filter((drop) => (query.driverId === undefined || (drop.driver?.id ?? 0) === query.driverId) && (!query.stage || drop.orders.some((order) => order.stage === query.stage)));
    const start = (query.page - 1) * query.pageSize;
    return {
      date, today: day.today, closedToday: day.closedToday, now, timezone: settings.timezone, totals: this.totalsOf(drops),
      drops: { items: filtered.slice(start, start + query.pageSize), total: filtered.length, page: query.page, pageSize: query.pageSize },
    };
  }

  /** Day-wide summary for the dashboard, computed over every drop (never just a page of them). */
  async overview(date: string) {
    const settings = await this.settings.get();
    const now = new Date();
    const drops = (await this.dropsFor(date, settings)).map((drop) => this.view(drop, now));
    const pending = drops.filter((drop) => drop.status !== 'DELIVERED');
    const perDriver = new Map<string, { name: string; drops: number; delivered: number }>();
    for (const drop of drops) {
      const name = drop.driver?.name ?? 'No driver';
      const entry = perDriver.get(name) ?? { name, drops: 0, delivered: 0 };
      entry.drops++; if (drop.status === 'DELIVERED') entry.delivered++;
      perDriver.set(name, entry);
    }
    const count = (stage: Stage) => drops.filter((drop) => drop.status === stage).length;
    return {
      totals: this.totalsOf(drops),
      stages: { notStarted: count('NOT_STARTED'), cooking: count('COOKING'), kitchenReady: count('KITCHEN_READY'), dispatchReady: count('DISPATCH_READY'), outForDelivery: count('OUT_FOR_DELIVERY'), delivered: count('DELIVERED') },
      next: pending.filter((drop) => drop.status !== 'OUT_FOR_DELIVERY').sort((a, b) => a.plannedDispatchReadyAt.getTime() - b.plannedDispatchReadyAt.getTime()).slice(0, 6)
        .map((drop) => ({ id: drop.id, company: drop.company, deliveryTime: drop.deliveryTime, plannedDispatchReadyAt: drop.plannedDispatchReadyAt, status: drop.status, timing: drop.timing, driver: drop.driver?.name ?? null, blockedReason: drop.blockedReason })),
      outNow: pending.filter((drop) => drop.status === 'OUT_FOR_DELIVERY').map((drop) => ({ id: drop.id, company: drop.company, deliveryTime: drop.deliveryTime, driver: drop.driver?.name ?? null })),
      drivers: [...perDriver.values()].sort((a, b) => b.drops - a.drops),
    };
  }

  private totalsOf(drops: { status: Stage; timing: string; driver: unknown; orders: unknown[] }[]) {
    return {
      drops: drops.length, orders: drops.reduce((sum, drop) => sum + drop.orders.length, 0),
      delivered: drops.filter((drop) => drop.status === 'DELIVERED').length, outForDelivery: drops.filter((drop) => drop.status === 'OUT_FOR_DELIVERY').length,
      late: drops.filter((drop) => drop.timing === 'LATE').length, noDriver: drops.filter((drop) => !drop.driver && drop.status !== 'DELIVERED').length,
    };
  }

  async drivers() {
    return this.prisma.staff.findMany({
      where: { isActive: true, role: { capabilities: { has: Capability.DRIVER_DROPS_UPDATE } } },
      select: { id: true, name: true }, orderBy: { name: 'asc' },
    });
  }

  /** The driver's own drops for today, in time order. */
  async driverDrops(actor: AuthenticatedStaff) {
    const settings = await this.settings.get();
    const now = new Date();
    const own = async (date: string) => (await this.dropsFor(date, settings)).filter((drop) => drop.rows.some((row) => this.effectiveDriver(row)?.id === actor.id)).map((drop) => this.view(drop, now)).sort((a, b) => a.deliveryTime.localeCompare(b.deliveryTime));
    const day = await this.settings.operatingDay();
    // Today's drops only (the brief), but on a closed day also show what is coming on the next working day.
    return { date: settings.today, now, timezone: settings.timezone, drops: await own(settings.today), closedToday: day.closedToday, nextDay: day.closedToday ? { date: day.date, drops: await own(day.date) } : null };
  }

  // ---------- Actions ----------

  async assignDriver(key: DropKey, driverId: number, actor: AuthenticatedStaff) {
    const driver = (await this.drivers()).find((entry) => entry.id === driverId);
    if (!driver) throw new BadRequestException('Choose an active driver.');
    return this.act(key, async (tx, rows) => {
      const open = rows.filter((row) => STAGE_RANK[stageOf(row)] < STAGE_RANK.OUT_FOR_DELIVERY);
      if (!open.length) throw new ConflictException('This drop is already out for delivery, so its driver is locked.');
      const changing = open.filter((row) => row.driverId !== driverId);
      if (!changing.length) throw new ConflictException(`${driver.name} is already assigned to this drop.`);
      await tx.order.updateMany({ where: { id: { in: open.map((row) => row.id) } }, data: { driverId } });
      await this.events(tx, open.map((row) => row.id), OrderEventType.DRIVER_ASSIGNED, `Driver ${driver.name} assigned.`, actor.id);
    });
  }

  async dispatchReady(key: DropKey, actor: AuthenticatedStaff) {
    return this.act(key, async (tx, rows, now, plan) => {
      const gate = dispatchGate(rows.map((row) => this.member(row, plan)), now);
      if (!gate.ids.length) throw new ConflictException(gate.blockedReason ?? 'Nothing to dispatch.');
      await tx.order.updateMany({ where: { id: { in: gate.ids }, dispatchReadyAt: null }, data: { dispatchReadyAt: now } });
      await this.events(tx, gate.ids, OrderEventType.DISPATCH_READY, 'Dispatch ready: packed and waiting for the driver.', actor.id);
    });
  }

  async outForDelivery(key: DropKey, actor: AuthenticatedStaff) {
    return this.act(key, async (tx, rows, now) => {
      const eligible = rows.filter((row) => stageOf(row) === 'DISPATCH_READY');
      if (!eligible.length) throw new ConflictException(rows.some((row) => stageOf(row) === 'OUT_FOR_DELIVERY' || stageOf(row) === 'DELIVERED') ? 'This drop is already out for delivery.' : 'Mark the drop dispatch ready first.');
      const driverIds = new Set(eligible.map((row) => this.effectiveDriver(row)?.id ?? null));
      if (driverIds.has(null)) throw new BadRequestException('Assign a driver before sending the drop out for delivery.');
      for (const row of eligible) await tx.order.update({ where: { id: row.id }, data: { driverId: this.effectiveDriver(row)!.id, outForDeliveryAt: now } });
      const names = [...new Set(eligible.map((row) => this.effectiveDriver(row)!.name))].join(', ');
      await this.events(tx, eligible.map((row) => row.id), OrderEventType.OUT_FOR_DELIVERY, `Out for delivery with ${names}.`, actor.id);
    });
  }

  /** The driver marks their own drop delivered, with an optional note and photo; records whether it was on time. */
  async deliver(dto: DeliverDto, actor: AuthenticatedStaff) {
    if (dto.photoUrl && !this.images.isOwnUpload(dto.photoUrl)) throw new BadRequestException('Attach a photo taken or uploaded in the app.');
    const settings = await this.settings.get();
    return this.act(dto, async (tx, rows, now) => {
      const eligible = rows.filter((row) => stageOf(row) === 'OUT_FOR_DELIVERY');
      if (!eligible.length) throw new ConflictException(rows.every((row) => stageOf(row) === 'DELIVERED') ? 'This drop was already delivered.' : 'This drop is not out for delivery yet.');
      if (eligible.some((row) => row.driverId !== actor.id)) throw new ForbiddenException('This drop is assigned to another driver.');
      const timing = deliveryTiming(dto.deliveryDate, dto.deliveryTime, now, settings.onTimeGraceMinutes, settings.timezone);
      await tx.order.updateMany({
        where: { id: { in: eligible.map((row) => row.id) } },
        data: { status: OrderStatus.DELIVERED, deliveredAt: now, deliveredById: actor.id, deliveryNote: dto.note ?? null, deliveryPhotoUrl: dto.photoUrl ?? null, deliveryLateMinutes: timing.lateMinutes, deliveredOnTime: timing.onTime },
      });
      const message = timing.onTime ? (timing.lateMinutes ? `Delivered, ${timing.lateMinutes} min after the delivery time (within the grace, on time).` : 'Delivered on time.') : `Delivered ${timing.lateMinutes} min late.`;
      await this.events(tx, eligible.map((row) => row.id), OrderEventType.DELIVERED, `${message}${dto.note ? ` Note: ${dto.note}` : ''}`, actor.id);
    });
  }

  // ---------- Helpers ----------

  /** Runs an action on one drop with its order rows locked, so two people can't both advance it. */
  private async act(key: DropKey, action: (tx: Tx, rows: OrderRow[], now: Date, plan: Awaited<ReturnType<DispatchService['planFor']>>) => Promise<void>, statuses: OrderStatus[] = [OrderStatus.CONFIRMED, OrderStatus.DELIVERED]) {
    const now = new Date();
    const settings = await this.settings.get();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE "deliveryDate" = ${key.deliveryDate}::date AND "companyId" = ${key.companyId} AND "addressId" = ${key.addressId} AND "deliveryTime" = ${key.deliveryTime} AND status::text IN (${Prisma.join(statuses)}) ORDER BY id FOR UPDATE`;
      const rows = await tx.order.findMany({ where: { deliveryDate: toDbDate(key.deliveryDate), companyId: key.companyId, addressId: key.addressId, deliveryTime: key.deliveryTime, status: { in: statuses } }, include: orderInclude, orderBy: { id: 'asc' } });
      if (!rows.length) throw new ConflictException('There are no orders in this drop any more. Reload the board.');
      await action(tx, rows, now, this.planFor(key, rows[0], settings));
    });
    return { ok: true };
  }

  private planFor(key: DropKey, row: OrderRow, settings: { kitchenReadyBufferMinutes: number; timezone: string }) {
    return planFor(key.deliveryDate, key.deliveryTime, row.company.dispatchLeadMinutes, settings.kitchenReadyBufferMinutes, settings.timezone);
  }

  private async events(tx: Tx, orderIds: number[], type: OrderEventType, message: string, actorId: number) {
    await tx.orderEvent.createMany({ data: orderIds.map((orderId) => ({ orderId, type, message, actorId })) });
  }

  private effectiveDriver(row: OrderRow) { return row.driver ?? row.company.defaultDriver; }

  private member(row: OrderRow, plan: { kitchenReadyAt: Date }): Member {
    return { id: row.id, kitchenStartedAt: row.kitchenStartedAt, kitchenReadyAt: row.kitchenReadyAt, dispatchReadyAt: row.dispatchReadyAt, outForDeliveryAt: row.outForDeliveryAt, deliveredAt: row.deliveredAt, plannedKitchenReadyAt: plan.kitchenReadyAt };
  }

  private async dropsFor(date: string, settings: { kitchenReadyBufferMinutes: number; timezone: string }) {
    const rows = await this.prisma.order.findMany({
      where: { deliveryDate: toDbDate(date), status: { in: [OrderStatus.CONFIRMED, OrderStatus.DELIVERED] } },
      include: orderInclude, orderBy: [{ deliveryTime: 'asc' }, { companyId: 'asc' }, { id: 'asc' }],
    });
    const drops = new Map<string, { key: DropKey; rows: OrderRow[]; plan: ReturnType<DispatchService['planFor']> }>();
    for (const row of rows) {
      const key: DropKey = { companyId: row.companyId, addressId: row.addressId, deliveryDate: fromDbDate(row.deliveryDate), deliveryTime: row.deliveryTime };
      const entry = drops.get(dropId(key)) ?? { key, rows: [], plan: this.planFor(key, row, settings) };
      entry.rows.push(row);
      drops.set(dropId(key), entry);
    }
    return [...drops.values()];
  }

  private view(drop: { key: DropKey; rows: OrderRow[]; plan: { dispatchReadyAt: Date; kitchenReadyAt: Date } }, now: Date) {
    const first = drop.rows[0];
    const members = drop.rows.map((row) => this.member(row, drop.plan));
    const stages = drop.rows.map((row) => stageOf(row));
    const counts = Object.fromEntries((Object.keys(STAGE_RANK) as Stage[]).map((stage) => [stage, stages.filter((entry) => entry === stage).length])) as Record<Stage, number>;
    const active = drop.rows.filter((row) => !row.deliveredAt);
    const lead = active[0] ?? first;
    const driver = this.effectiveDriver(lead);
    const status = stages.reduce((lowest, stage) => (STAGE_RANK[stage] < STAGE_RANK[lowest] ? stage : lowest), stages[0]);
    const gate = dispatchGate(members, now);
    const dispatched = stages.every((stage) => STAGE_RANK[stage] >= STAGE_RANK.DISPATCH_READY);
    const dueMs = drop.plan.dispatchReadyAt.getTime() - now.getTime();
    const deliveredRows = drop.rows.filter((row) => row.deliveredAt);
    const lateDelivered = deliveredRows.some((row) => row.deliveredOnTime === false);
    // Late = the drop hasn't left by its dispatch time, or hasn't arrived by its delivery time (past the grace is judged on delivery).
    const timing = status === 'DELIVERED' ? (lateDelivered ? 'LATE' : 'DONE') : !dispatched && dueMs < 0 ? 'LATE' : !dispatched && dueMs <= 30 * 60_000 ? 'AT_RISK' : 'ON_TRACK';
    return {
      id: dropId(drop.key), ...drop.key, company: first.company.name, address: [first.address.label, first.address.line1, first.address.area, first.address.city].filter(Boolean).join(', '),
      instructions: first.company.driverInstructions, packaging: first.packagingType?.name ?? null,
      driver: driver ? { id: driver.id, name: driver.name, isDefault: !lead.driver } : null,
      plannedDispatchReadyAt: drop.plan.dispatchReadyAt, plannedKitchenReadyAt: drop.plan.kitchenReadyAt,
      status, counts, timing, canDispatchReady: gate.ids.length > 0, blockedReason: gate.ids.length ? null : (stages.some((stage) => stage === 'NOT_STARTED' || stage === 'COOKING' || stage === 'KITCHEN_READY') ? gate.blockedReason : null),
      canAssign: stages.some((stage) => STAGE_RANK[stage] < STAGE_RANK.OUT_FOR_DELIVERY),
      canOutForDelivery: stages.includes('DISPATCH_READY') && Boolean(driver),
      canDeliver: stages.includes('OUT_FOR_DELIVERY'),
      delivery: deliveredRows.length ? { deliveredAt: deliveredRows[0].deliveredAt, by: deliveredRows[0].deliveredBy?.name ?? null, note: deliveredRows[0].deliveryNote, photoUrl: deliveredRows[0].deliveryPhotoUrl, lateMinutes: Math.max(...deliveredRows.map((row) => row.deliveryLateMinutes ?? 0)), onTime: !lateDelivered } : null,
      orders: drop.rows.map((row) => ({
        id: row.id, employee: row.employee.name, stage: stageOf(row), boxes: row.lines.reduce((sum, line) => sum + line.quantity, 0), items: row.lines.map((line) => `${line.quantity}× ${line.dishName}`),
        kitchenReadyAt: row.kitchenReadyAt, timing: timingOf(drop.plan, row.kitchenReadyAt, now),
      })),
    };
  }
}
