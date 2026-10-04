import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderEventType, OrderStatus, Prisma } from '@prisma/client';
import type { AuthenticatedStaff } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toDbDate } from '../settings/kitchen-calendar.js';
import { SettingsService } from '../settings/settings.service.js';
import type { BoardQueryDto } from './kitchen.dto.js';
import { planFor, timingOf, unitState, type Timing, type UnitState } from './kitchen-plan.js';

type Tx = Prisma.TransactionClient;
const TIMING_ORDER: Record<Timing, number> = { LATE: 0, AT_RISK: 1, ON_TRACK: 2, DONE: 3 };

const orderInclude = {
  employee: { select: { name: true } },
  company: { select: { name: true, dispatchLeadMinutes: true } },
  address: { select: { label: true } },
  packagingType: { select: { name: true } },
  lines: {
    orderBy: { sortOrder: 'asc' },
    include: {
      dish: { select: { station: { select: { id: true, name: true } } } },
      combinations: { orderBy: { id: 'asc' }, include: { choices: { orderBy: { id: 'asc' } }, startedBy: { select: { name: true } }, doneBy: { select: { name: true } } } },
    },
  },
} satisfies Prisma.OrderInclude;

const labelOf = (choices: { optionName: string; portionName: string | null }[]) => choices.map((choice) => (choice.portionName ? `${choice.optionName} (${choice.portionName})` : choice.optionName)).join(', ');

@Injectable()
export class KitchenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** 4.7: what has to be cooked for a date, as prep units (one per distinct combination), grouped by order. */
  async board(query: BoardQueryDto) {
    const settings = await this.settings.get();
    const now = new Date();
    const orders = await this.prisma.order.findMany({
      where: { deliveryDate: toDbDate(query.date), status: OrderStatus.CONFIRMED },
      include: orderInclude,
      orderBy: [{ deliveryTime: 'asc' }, { id: 'asc' }],
    });
    const stationFilter = query.station === undefined ? undefined : query.station === 'unassigned' ? null : Number(query.station);
    const stations = new Map<number | null, { id: number | null; name: string; pending: number; started: number; done: number }>();
    const prep = new Map<string, { stationId: number | null; dish: string; sku: string; choices: string; total: number; remaining: number }>();
    const totals = { orders: orders.length, ready: 0, late: 0, atRisk: 0 };

    const cards = orders.map((order) => {
      const plan = planFor(query.date, order.deliveryTime, order.company.dispatchLeadMinutes, settings.kitchenReadyBufferMinutes, settings.timezone);
      const timing = timingOf(plan, order.kitchenReadyAt, now);
      if (timing === 'DONE') totals.ready++; else if (timing === 'LATE') totals.late++; else if (timing === 'AT_RISK') totals.atRisk++;
      const units = order.lines.flatMap((line) => line.combinations.map((combination) => {
        const station = line.dish.station;
        const state = unitState(combination);
        const summary = stations.get(station?.id ?? null) ?? { id: station?.id ?? null, name: station?.name ?? 'Unassigned', pending: 0, started: 0, done: 0 };
        summary[state === 'PENDING' ? 'pending' : state === 'STARTED' ? 'started' : 'done']++;
        stations.set(summary.id, summary);
        const choices = labelOf(combination.choices);
        const visible = (stationFilter === undefined || stationFilter === (station?.id ?? null)) && (!query.state || query.state === state);
        if (visible) {
          const key = `${station?.id ?? 'none'}|${line.dishId}|${combination.signature}`;
          const entry = prep.get(key) ?? { stationId: station?.id ?? null, dish: line.dishName, sku: line.dishSku, choices, total: 0, remaining: 0 };
          entry.total += combination.quantity; if (state !== 'DONE') entry.remaining += combination.quantity;
          prep.set(key, entry);
        }
        return visible ? {
          id: combination.id, dish: line.dishName, sku: line.dishSku, quantity: combination.quantity, choices, station: station?.name ?? 'Unassigned', stationId: station?.id ?? null,
          state: state as UnitState, startedAt: combination.startedAt, startedBy: combination.startedBy?.name ?? null, doneAt: combination.doneAt, doneBy: combination.doneBy?.name ?? null,
        } : null;
      })).filter((unit) => unit !== null);
      return {
        orderId: order.id, employee: order.employee.name, company: order.company.name, address: order.address.label, packaging: order.packagingType?.name ?? null,
        deliveryTime: order.deliveryTime, plannedDispatchReadyAt: plan.dispatchReadyAt, plannedKitchenReadyAt: plan.kitchenReadyAt, timing,
        kitchenStartedAt: order.kitchenStartedAt, kitchenReadyAt: order.kitchenReadyAt, version: order.version, units,
      };
    });

    const shown = cards
      .filter((card) => card.units.length && (!query.timing || card.timing === query.timing))
      .sort((a, b) => TIMING_ORDER[a.timing] - TIMING_ORDER[b.timing] || a.plannedKitchenReadyAt.getTime() - b.plannedKitchenReadyAt.getTime() || a.orderId - b.orderId);
    const start = (query.page - 1) * query.pageSize;
    return {
      date: query.date, now, timezone: settings.timezone, atRiskMinutes: 30, totals,
      stations: [...stations.values()].sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.name.localeCompare(b.name))),
      prep: [...prep.values()].sort((a, b) => a.dish.localeCompare(b.dish) || a.choices.localeCompare(b.choices)),
      orders: { items: shown.slice(start, start + query.pageSize), total: shown.length, page: query.page, pageSize: query.pageSize },
    };
  }

  /** Marks a unit started. Atomic per order, so two people clicking at once can't both win. */
  async start(unitId: number, actor: AuthenticatedStaff) {
    return this.mutate(unitId, async (tx, unit, order, now) => {
      if (unit.startedAt) throw new ConflictException(`Already started${unit.startedBy ? ` by ${unit.startedBy.name}` : ''}.`);
      await tx.orderCombination.update({ where: { id: unit.id }, data: { startedAt: now, startedById: actor.id } });
      await this.noteStart(tx, order, now, actor.id, `Kitchen started: ${unit.label}.`);
    });
  }

  /** Marks a unit done; a unit never started is started at the same moment. The order is ready once every unit is done. */
  async finish(unitId: number, actor: AuthenticatedStaff) {
    return this.mutate(unitId, async (tx, unit, order, now) => {
      if (unit.doneAt) throw new ConflictException(`Already finished${unit.doneBy ? ` by ${unit.doneBy.name}` : ''}.`);
      await tx.orderCombination.update({ where: { id: unit.id }, data: { startedAt: unit.startedAt ?? now, startedById: unit.startedAt ? unit.startedById : actor.id, doneAt: now, doneById: actor.id } });
      if (!unit.startedAt) await this.noteStart(tx, order, now, actor.id, `Kitchen started: ${unit.label}.`);
      const open = await tx.orderCombination.count({ where: { line: { orderId: order.id }, doneAt: null } });
      if (!open) await this.markReady(tx, order.id, now, actor.id, 'Every unit is done: kitchen ready.');
    });
  }

  /** An admin finishes everything still open on an order in one step. */
  async forceComplete(orderId: number, actor: AuthenticatedStaff) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, orderId);
      const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, kitchenReadyAt: true, kitchenStartedAt: true } });
      if (!order) throw new NotFoundException('Order not found.');
      this.assertWorkable(order.status);
      if (order.kitchenReadyAt) throw new ConflictException('This order is already kitchen ready.');
      const open = await tx.orderCombination.findMany({ where: { line: { orderId }, doneAt: null }, select: { id: true, startedAt: true, startedById: true } });
      for (const unit of open) await tx.orderCombination.update({ where: { id: unit.id }, data: { startedAt: unit.startedAt ?? now, startedById: unit.startedAt ? unit.startedById : actor.id, doneAt: now, doneById: actor.id } });
      if (!order.kitchenStartedAt) await tx.order.update({ where: { id: orderId }, data: { kitchenStartedAt: now } });
      await tx.orderEvent.create({ data: { orderId, type: OrderEventType.FORCE_COMPLETED, message: `Admin force-completed the order (${open.length} unit${open.length === 1 ? '' : 's'} finished).`, actorId: actor.id } });
      await this.markReady(tx, orderId, now, actor.id, 'Kitchen ready (forced by an admin).');
    });
    return { orderId, kitchenReadyAt: now };
  }

  // ---------- Helpers ----------

  /** Locks the order row for the transaction: kitchen actions on one order run one at a time. */
  private async lock(tx: Tx, orderId: number) {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  }

  private assertWorkable(status: OrderStatus) {
    if (status !== OrderStatus.CONFIRMED) throw new ConflictException(`Only confirmed orders can be worked on (this one is ${status.toLowerCase()}).`);
  }

  private async mutate(
    unitId: number,
    action: (tx: Tx, unit: { id: number; startedAt: Date | null; startedById: number | null; doneAt: Date | null; label: string; startedBy: { name: string } | null; doneBy: { name: string } | null }, order: { id: number; kitchenStartedAt: Date | null }, now: Date) => Promise<void>,
  ) {
    const found = await this.prisma.orderCombination.findUnique({ where: { id: unitId }, select: { line: { select: { orderId: true } } } });
    if (!found) throw new NotFoundException('Prep unit not found.');
    const orderId = found.line.orderId;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, orderId);
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, status: true, kitchenStartedAt: true } });
      this.assertWorkable(order.status);
      const unit = await tx.orderCombination.findUniqueOrThrow({ where: { id: unitId }, include: { line: { select: { dishName: true } }, choices: true, startedBy: { select: { name: true } }, doneBy: { select: { name: true } } } });
      await action(tx, { ...unit, label: `${unit.line.dishName} × ${unit.quantity}${unit.choices.length ? ` (${labelOf(unit.choices)})` : ''}` }, order, now);
    });
    return { unitId, orderId };
  }

  private async noteStart(tx: Tx, order: { id: number; kitchenStartedAt: Date | null }, now: Date, actorId: number, message: string) {
    if (order.kitchenStartedAt) return;
    await tx.order.update({ where: { id: order.id }, data: { kitchenStartedAt: now } });
    await tx.orderEvent.create({ data: { orderId: order.id, type: OrderEventType.KITCHEN_STARTED, message, actorId } });
  }

  private async markReady(tx: Tx, orderId: number, now: Date, actorId: number, message: string) {
    await tx.order.update({ where: { id: orderId }, data: { kitchenReadyAt: now } });
    await tx.orderEvent.create({ data: { orderId, type: OrderEventType.KITCHEN_READY, message, actorId } });
  }
}
