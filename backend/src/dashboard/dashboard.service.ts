import { Injectable } from '@nestjs/common';
import { CreditStatus, InvoiceStatus, OrderStatus } from '@prisma/client';
import type { AuthenticatedStaff } from '../auth/auth.types.js';
import { Capability } from '../auth/capabilities.js';
import { DispatchService } from '../dispatch/dispatch.service.js';
import { KitchenService } from '../kitchen/kitchen.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDays, cutoffFor, fromDbDate, isKitchenWorkingDay, toDbDate, type IsoDate } from '../settings/kitchen-calendar.js';
import { SettingsService } from '../settings/settings.service.js';

const BILLABLE: OrderStatus[] = [OrderStatus.CONFIRMED, OrderStatus.DELIVERED];
const WINDOW_DAYS = 7; // "recent" = the last 7 kitchen working days before today

/**
 * One dashboard per staff member, chosen by capability (never by role name): the first of orders → kitchen →
 * dispatch → driver that they hold. Kitchen and dispatch figures come from the same services as the boards, so
 * a dashboard number can never disagree with the board it links to.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly kitchen: KitchenService,
    private readonly dispatch: DispatchService,
  ) {}

  async forStaff(actor: AuthenticatedStaff) {
    const settings = await this.settings.get();
    const calendar = await this.settings.calendar(addDays(settings.today, -30), addDays(settings.today, 30));
    const working = (date: IsoDate) => isKitchenWorkingDay(date, calendar);
    // The "operating day" is today when the kitchen works today, otherwise the next working day.
    let date = settings.today;
    while (!working(date)) date = addDays(date, 1);
    const nextDays: IsoDate[] = [];
    for (let day = addDays(date, 1); nextDays.length < 5; day = addDays(day, 1)) if (working(day)) nextDays.push(day);
    const recentDays: IsoDate[] = [];
    for (let day = addDays(settings.today, -1); recentDays.length < WINDOW_DAYS; day = addDays(day, -1)) if (working(day)) recentDays.push(day);
    recentDays.reverse();
    const context = { today: settings.today, operatingDate: date, isToday: date === settings.today, timezone: settings.timezone, nextDays, recentDays, calendar, settings };
    const has = (capability: Capability) => actor.capabilities.includes(capability);
    const base = { today: settings.today, operatingDate: date, isToday: date === settings.today, timezone: settings.timezone, staff: { name: actor.name } };
    if (has(Capability.ORDERS_MANAGE)) return { ...base, kind: 'ADMIN' as const, admin: await this.admin(context, has(Capability.BILLING_MANAGE)) };
    if (has(Capability.KITCHEN_BOARD_VIEW)) return { ...base, kind: 'KITCHEN' as const, kitchen: await this.kitchenLead(context) };
    if (has(Capability.DISPATCH_BOARD_VIEW)) return { ...base, kind: 'DISPATCH' as const, dispatch: await this.dispatcher(context) };
    if (has(Capability.DRIVER_DROPS_VIEW)) return { ...base, kind: 'DRIVER' as const, driver: await this.driver(context, actor) };
    return { ...base, kind: 'NONE' as const };
  }

  // ---------- Admin ----------

  private async admin(context: Context, withMoney: boolean) {
    const { operatingDate, nextDays, recentDays, calendar } = context;
    const [board, drops] = await Promise.all([
      this.kitchen.board({ date: operatingDate, page: 1, pageSize: 1 }),
      this.dispatch.board({ date: operatingDate, page: 1, pageSize: 1 }),
    ]);
    const ofDay = await this.countsByDay([operatingDate, ...nextDays]);
    const upcoming = [operatingDate, ...nextDays].map((day) => {
      const counts = ofDay.get(day) ?? emptyCounts();
      const cutoff = cutoffFor(day, calendar, calendar);
      return { date: day, cutoffAt: cutoff.toISO(), cutoffPassed: cutoff.toJSDate() <= new Date(), draft: counts.DRAFT, placed: counts.PLACED, confirmed: counts.CONFIRMED, delivered: counts.DELIVERED, cancelled: counts.CANCELLED, rejected: counts.REJECTED };
    });

    const recentCounts = await this.countsByDay(recentDays);
    const billable = await this.prisma.order.groupBy({ by: ['deliveryDate'], where: { deliveryDate: { in: recentDays.map(toDbDate) }, status: { in: BILLABLE } }, _sum: { totalCents: true } });
    const timed = await this.prisma.order.groupBy({ by: ['deliveryDate', 'deliveredOnTime'], where: { deliveryDate: { in: recentDays.map(toDbDate) }, status: OrderStatus.DELIVERED, deliveredOnTime: { not: null } }, _count: true });
    const lateAverage = await this.prisma.order.aggregate({ where: { deliveryDate: { in: recentDays.map(toDbDate) }, status: OrderStatus.DELIVERED, deliveredOnTime: false }, _avg: { deliveryLateMinutes: true } });
    const recent = recentDays.map((day) => {
      const counts = recentCounts.get(day) ?? emptyCounts();
      const onTime = timed.filter((row) => fromDbDate(row.deliveryDate) === day && row.deliveredOnTime === true).reduce((sum, row) => sum + row._count, 0);
      const late = timed.filter((row) => fromDbDate(row.deliveryDate) === day && row.deliveredOnTime === false).reduce((sum, row) => sum + row._count, 0);
      return {
        date: day, delivered: counts.DELIVERED, confirmedNotDelivered: counts.CONFIRMED, cancelled: counts.CANCELLED, rejected: counts.REJECTED,
        billableCents: billable.find((row) => fromDbDate(row.deliveryDate) === day)?._sum.totalCents ?? 0, onTime, late,
      };
    });
    const onTimeTotal = recent.reduce((sum, row) => sum + row.onTime, 0); const lateTotal = recent.reduce((sum, row) => sum + row.late, 0);

    const money = withMoney ? await this.money() : null;
    return {
      attention: { lateKitchenOrders: board.totals.late, atRiskKitchenOrders: board.totals.atRisk, dropsWithoutDriver: drops.totals.noDriver, lateDrops: drops.totals.late },
      operating: { kitchenOrders: board.totals.orders, kitchenReady: board.totals.ready, drops: drops.totals.drops, delivered: drops.totals.delivered },
      upcoming, recent,
      performance: { windowDays: recentDays.length, onTime: onTimeTotal, late: lateTotal, onTimeRate: onTimeTotal + lateTotal ? onTimeTotal / (onTimeTotal + lateTotal) : null, averageLateMinutes: lateAverage._avg.deliveryLateMinutes === null ? null : Math.round(lateAverage._avg.deliveryLateMinutes) },
      money,
    };
  }

  private async money() {
    const [uninvoiced, netted, unpaid, credits] = await Promise.all([
      this.prisma.order.aggregate({ where: { invoiceId: null, status: { in: BILLABLE } }, _sum: { totalCents: true }, _count: true }),
      this.prisma.orderCredit.aggregate({ where: { status: CreditStatus.APPLIED, appliedInvoiceId: null, order: { invoiceId: null, status: { in: BILLABLE } } }, _sum: { amountCents: true } }),
      this.prisma.invoice.aggregate({ where: { status: InvoiceStatus.UNPAID }, _sum: { totalCents: true }, _count: true }),
      this.prisma.orderCredit.aggregate({ where: { status: CreditStatus.OPEN }, _sum: { amountCents: true }, _count: true }),
    ]);
    return {
      uninvoicedOrders: uninvoiced._count, uninvoicedCents: (uninvoiced._sum.totalCents ?? 0) - (netted._sum.amountCents ?? 0),
      unpaidInvoices: unpaid._count, unpaidCents: unpaid._sum.totalCents ?? 0, openCredits: credits._count, openCreditCents: credits._sum.amountCents ?? 0,
    };
  }

  private async countsByDay(days: IsoDate[]) {
    const rows = await this.prisma.order.groupBy({ by: ['deliveryDate', 'status'], where: { deliveryDate: { in: days.map(toDbDate) } }, _count: true });
    const result = new Map<IsoDate, Record<OrderStatus, number>>();
    for (const row of rows) {
      const day = fromDbDate(row.deliveryDate);
      const counts = result.get(day) ?? emptyCounts();
      counts[row.status] += row._count;
      result.set(day, counts);
    }
    return result;
  }

  // ---------- Kitchen lead ----------

  private async kitchenLead(context: Context) {
    const { operatingDate, nextDays } = context;
    const board = await this.kitchen.board({ date: operatingDate, page: 1, pageSize: 100 });
    const cards = board.orders.items;
    const openCards = cards.filter((card) => card.timing !== 'DONE');
    const nextDay = nextDays[0];
    const [tomorrow, allergyOrders] = await Promise.all([
      nextDay ? this.countsByDay([nextDay]) : Promise.resolve(new Map<IsoDate, Record<OrderStatus, number>>()),
      this.prisma.order.count({ where: { deliveryDate: toDbDate(operatingDate), status: OrderStatus.CONFIRMED, allergyAcknowledged: true } }),
    ]);
    const tomorrowCounts = nextDay ? tomorrow.get(nextDay) ?? emptyCounts() : null;
    return {
      totals: board.totals,
      units: { pending: board.stations.reduce((sum, station) => sum + station.pending, 0), started: board.stations.reduce((sum, station) => sum + station.started, 0), done: board.stations.reduce((sum, station) => sum + station.done, 0) }, // whole day, not just this page
      stations: board.stations,
      prep: board.prep.filter((entry) => entry.remaining > 0).sort((a, b) => b.remaining - a.remaining).slice(0, 12),
      firstDeadline: openCards.length ? openCards.map((card) => card.plannedKitchenReadyAt).sort((a, b) => a.getTime() - b.getTime())[0] : null,
      mostUrgent: openCards.slice(0, 5).map((card) => ({ orderId: card.orderId, company: card.company, employee: card.employee, plannedKitchenReadyAt: card.plannedKitchenReadyAt, timing: card.timing, unitsLeft: card.units.filter((unit) => unit.state !== 'DONE').length })),
      allergyOrders,
      tomorrow: nextDay && tomorrowCounts ? { date: nextDay, placed: tomorrowCounts.PLACED, draft: tomorrowCounts.DRAFT, confirmed: tomorrowCounts.CONFIRMED } : null,
    };
  }

  // ---------- Dispatcher ----------

  private async dispatcher(context: Context) {
    const { operatingDate } = context;
    const board = await this.dispatch.board({ date: operatingDate, page: 1, pageSize: 100 });
    const drops = board.drops.items;
    const pending = drops.filter((drop) => drop.status !== 'DELIVERED');
    const perDriver = new Map<string, { name: string; drops: number; delivered: number }>();
    for (const drop of drops) {
      const name = drop.driver?.name ?? 'No driver';
      const entry = perDriver.get(name) ?? { name, drops: 0, delivered: 0 };
      entry.drops++; if (drop.status === 'DELIVERED') entry.delivered++;
      perDriver.set(name, entry);
    }
    const stages = { cooking: 0, kitchenReady: 0, dispatchReady: 0, outForDelivery: 0, delivered: 0 };
    for (const drop of drops) {
      if (drop.status === 'COOKING') stages.cooking++; else if (drop.status === 'KITCHEN_READY') stages.kitchenReady++; else if (drop.status === 'DISPATCH_READY') stages.dispatchReady++; else if (drop.status === 'OUT_FOR_DELIVERY') stages.outForDelivery++; else stages.delivered++;
    }
    return {
      totals: board.totals, stages,
      next: pending.filter((drop) => drop.status !== 'OUT_FOR_DELIVERY').sort((a, b) => new Date(a.plannedDispatchReadyAt).getTime() - new Date(b.plannedDispatchReadyAt).getTime()).slice(0, 6)
        .map((drop) => ({ id: drop.id, company: drop.company, deliveryTime: drop.deliveryTime, plannedDispatchReadyAt: drop.plannedDispatchReadyAt, status: drop.status, timing: drop.timing, driver: drop.driver?.name ?? null, blockedReason: drop.blockedReason })),
      outNow: pending.filter((drop) => drop.status === 'OUT_FOR_DELIVERY').map((drop) => ({ id: drop.id, company: drop.company, deliveryTime: drop.deliveryTime, driver: drop.driver?.name ?? null })),
      drivers: [...perDriver.values()].sort((a, b) => b.drops - a.drops),
    };
  }

  // ---------- Driver ----------

  private async driver(context: Context, actor: AuthenticatedStaff) {
    const mine = await this.dispatch.driverDrops(actor);
    const open = mine.drops.filter((drop) => drop.status !== 'DELIVERED');
    const from = context.recentDays[0] ?? context.today;
    const [onTime, late] = await Promise.all([
      this.prisma.order.count({ where: { deliveredById: actor.id, status: OrderStatus.DELIVERED, deliveredOnTime: true, deliveryDate: { gte: toDbDate(from), lt: toDbDate(context.today) } } }),
      this.prisma.order.count({ where: { deliveredById: actor.id, status: OrderStatus.DELIVERED, deliveredOnTime: false, deliveryDate: { gte: toDbDate(from), lt: toDbDate(context.today) } } }),
    ]);
    const next = open[0];
    return {
      date: mine.date,
      totals: { drops: mine.drops.length, delivered: mine.drops.length - open.length, outForDelivery: open.filter((drop) => drop.status === 'OUT_FOR_DELIVERY').length, waiting: open.filter((drop) => drop.status !== 'OUT_FOR_DELIVERY').length },
      next: next ? { company: next.company, address: next.address, deliveryTime: next.deliveryTime, status: next.status, instructions: next.instructions, boxes: next.orders.reduce((sum, order) => sum + order.boxes, 0), canDeliver: next.canDeliver } : null,
      record: { windowDays: WINDOW_DAYS, onTime, late, onTimeRate: onTime + late ? onTime / (onTime + late) : null },
    };
  }
}

type Context = {
  today: IsoDate; operatingDate: IsoDate; isToday: boolean; timezone: string; nextDays: IsoDate[]; recentDays: IsoDate[];
  calendar: Awaited<ReturnType<SettingsService['calendar']>>; settings: Awaited<ReturnType<SettingsService['get']>>;
};
const emptyCounts = (): Record<OrderStatus, number> => ({ DRAFT: 0, PLACED: 0, CONFIRMED: 0, DELIVERED: 0, CANCELLED: 0, REJECTED: 0 });
