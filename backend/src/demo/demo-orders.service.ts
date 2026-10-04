import { Injectable, Logger } from '@nestjs/common';
import { CreditKind, InvoiceLineType, InvoiceStatus, OrderEventType, OrderStatus, type Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { issueCredit } from '../billing/credits.js';
import { formatInvoiceNumber } from '../billing/invoice-rules.js';
import { checkDeliveryDay } from '../companies/company-calendar.js';
import type { MenuDish } from '../menu/menu-engine.js';
import { planFor } from '../kitchen/kitchen-plan.js';
import { MenuService } from '../menu/menu.service.js';
import { priceLines, type LineInput } from '../orders/order-rules.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDays, cutoffFor, fromDbDate, isKitchenWorkingDay, toDbDate, type IsoDate } from '../settings/kitchen-calendar.js';
import { SettingsService } from '../settings/settings.service.js';

const PAST_WORKING_DAYS = 7;
const FUTURE_WORKING_DAYS = 6;
const REJECTION_REASONS = ['Paneer supplier short-delivered; could not fulfil', 'Tandoor down for repair this morning', 'Order could not be fulfilled: dal batch failed quality check'];

/** Deterministic pseudo-random in [0, 1) from a string, so every environment generates the same demo data. */
function chance(key: string): number {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 10_000) / 10_000;
}
const pick = <T>(items: T[], key: string) => items[Math.floor(chance(key) * items.length)];

/**
 * Realistic demo orders around "today" (whatever day the app is opened): delivered/cancelled/rejected in the
 * past week, confirmed today, placed/draft in the coming week. Orders are built with the same pure menu and
 * pricing rules as real orders, so they are valid. Only dates without any orders are filled, so it is safe to
 * re-run (daily), and it never touches orders staff created.
 */
@Injectable()
export class DemoOrdersService {
  private readonly logger = new Logger(DemoOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly menu: MenuService,
  ) {}

  async ensure(now = new Date()) {
    const settings = await this.settings.get();
    const calendar = await this.settings.calendar(addDays(settings.today, -30), addDays(settings.today, 30));
    const dates = this.workingDays(settings.today, calendar);
    await this.closeOutPastDays(settings.today, settings.timezone, settings.kitchenReadyBufferMinutes, settings.onTimeGraceMinutes, now);

    const ctx = await this.context(settings.timezone, calendar, settings.today, now);
    const existing = new Set((await this.prisma.order.groupBy({ by: ['deliveryDate'], where: { deliveryDate: { in: dates.map(toDbDate) } } })).map((row) => fromDbDate(row.deliveryDate)));
    const todo = dates.filter((date) => !existing.has(date));
    let created = 0;

    for (const date of todo) {
      for (const company of ctx.companies) {
        if (!this.deliverable(ctx, company, date)) continue;
        for (const employee of company.employees) {
          const key = `${date}:${employee.id}`;
          if (chance(`${key}:orders`) > 0.45) continue; // roughly 45% of staff order on a given day
          const status = this.statusFor(date, settings.today, this.cutoffOf(ctx, date), now, key);
          if (await this.createOrder(ctx, company, employee, date, status, key)) created++;
        }
      }
    }
    created += await this.ensureCoverage(ctx, dates);
    await this.simulateKitchen(dates, settings.timezone, settings.kitchenReadyBufferMinutes);
    await this.simulateDispatch(dates, settings.timezone, settings.onTimeGraceMinutes);
    await this.advanceToday(settings.today, settings.timezone, settings.kitchenReadyBufferMinutes, settings.onTimeGraceMinutes, now);
    await this.simulateBilling(settings.today, now);
    await this.ensureDriverHasDrops(settings.today);
    if (created) this.logger.log(`Demo orders: created ${created}${todo.length ? ` (new dates: ${todo.join(', ')})` : ''}.`);
    return { created, dates: todo };
  }

  // ---------- Building orders ----------

  private async context(timezone: string, calendar: Awaited<ReturnType<SettingsService['calendar']>>, today: IsoDate, now: Date) {
    const admin = await this.prisma.staff.findUniqueOrThrow({ where: { email: 'admin@test.com' } });
    const companies = await this.prisma.company.findMany({
      where: { isActive: true, addresses: { some: { isDefault: true, isActive: true } } },
      include: { addresses: true, holidays: true, employees: { where: { isActive: true }, include: { allergens: true }, orderBy: { id: 'asc' } } },
      orderBy: { id: 'asc' },
    });
    return { admin, companies, calendar, today, now, timezone, menus: new Map<number, { tierId: number; dishes: Map<number, MenuDish> }>() };
  }

  private deliverable(ctx: Ctx, company: Ctx['companies'][number], date: IsoDate) {
    return checkDeliveryDay(date, { workingDays: company.workingDays, holidays: new Set(company.holidays.map((holiday) => fromDbDate(holiday.date))) }, ctx.calendar).ok;
  }

  private cutoffOf(ctx: Ctx, date: IsoDate) {
    return cutoffFor(date, ctx.calendar, ctx.calendar).toJSDate();
  }

  /** Builds one valid order (same menu and pricing rules as a real one) in the given status; false if the employee can't order a meal. */
  private async createOrder(ctx: Ctx, company: Ctx['companies'][number], employee: Ctx['companies'][number]['employees'][number], date: IsoDate, status: OrderStatus, key: string) {
    if (!ctx.menus.has(employee.id)) {
      const orderable = await this.menu.orderableFor(employee.id);
      ctx.menus.set(employee.id, { tierId: orderable.tier.id, dishes: orderable.dishes });
    }
    const { tierId, dishes } = ctx.menus.get(employee.id)!;
    const priced = priceLines(this.buildLines([...dishes.values()], key), dishes);
    if (priced.errors.length || !priced.lines.length) return false;
    const address = company.addresses.find((entry) => entry.isDefault)!;
    const cutoff = this.cutoffOf(ctx, date);
    const deliveredAt = DateTime.fromISO(`${date}T${company.defaultDeliveryTime}`, { zone: ctx.timezone }).minus({ minutes: Math.round(chance(`${key}:late`) * 20) - 5 }).toJSDate();
    const placedAt = DateTime.fromJSDate(cutoff).minus({ hours: 2 + Math.round(chance(`${key}:placed`) * 40) }).toJSDate();
    const rejectionReason = status === OrderStatus.REJECTED ? pick(REJECTION_REASONS, `${key}:reason`) : null;
    const confirmed = ([OrderStatus.CONFIRMED, OrderStatus.DELIVERED] as OrderStatus[]).includes(status);
    await this.prisma.order.create({
      data: {
        employeeId: employee.id, companyId: company.id, status, deliveryDate: toDbDate(date), deliveryTime: company.defaultDeliveryTime,
        addressId: address.id, packagingTypeId: company.defaultPackagingTypeId, priceTierId: tierId, totalCents: priced.totalCents,
        allergyAcknowledged: priced.allergyConflicts.length > 0, createdById: ctx.admin.id,
        placedAt: status === OrderStatus.DRAFT ? null : placedAt,
        confirmedAt: confirmed || (status === OrderStatus.REJECTED && cutoff <= ctx.now) ? cutoff : null,
        deliveredAt: status === OrderStatus.DELIVERED ? deliveredAt : null,
        cancelledAt: status === OrderStatus.CANCELLED ? DateTime.fromJSDate(cutoff).minus({ hours: 3 }).toJSDate() : null,
        cancellationReason: status === OrderStatus.CANCELLED ? 'Employee on leave' : null,
        rejectedAt: status === OrderStatus.REJECTED ? (cutoff <= ctx.now ? cutoff : ctx.now) : null,
        rejectionReason,
        lines: {
          create: priced.lines.map((line, index) => ({
            dishId: line.dishId, dishName: line.dishName, dishSku: line.dishSku, quantity: line.quantity, unitPriceCents: line.unitPriceCents, totalCents: line.totalCents, sortOrder: (index + 1) * 10,
            combinations: { create: line.combinations.map((combination) => ({ signature: combination.signature, quantity: combination.quantity, unitPriceCents: combination.unitPriceCents, totalCents: combination.totalCents, choices: { create: combination.choices } })) },
          })),
        },
        events: { create: this.events(status, ctx.admin.id, priced.totalCents, rejectionReason, cutoff <= ctx.now) },
      },
    });
    return true;
  }

  /**
   * Whatever the day, every status that can exist then is on screen: past days have delivered, cancelled and
   * rejected orders; today has confirmed, cancelled and rejected ones (kitchen and dispatch progress is simulated
   * separately); coming days have drafts and placed orders (or confirmed ones once their cut-off has passed).
   * Random generation can miss a rare status on a day, so a missing one is added as an extra order.
   */
  private async ensureCoverage(ctx: Ctx, dates: IsoDate[]) {
    let created = 0;
    const rows = await this.prisma.order.findMany({ where: { deliveryDate: { in: dates.map(toDbDate) } }, select: { deliveryDate: true, status: true, employeeId: true } });
    for (const date of dates) {
      const here = rows.filter((row) => fromDbDate(row.deliveryDate) === date);
      const have = new Set(here.map((row) => row.status));
      if (date === ctx.today && have.has('DELIVERED')) have.add('CONFIRMED'); // today's orders get delivered as the day goes on
      const cutoffPassed = this.cutoffOf(ctx, date) <= ctx.now;
      const needed: OrderStatus[] = date < ctx.today ? ['DELIVERED', 'CANCELLED', 'REJECTED']
        : date === ctx.today || cutoffPassed ? ['CONFIRMED', 'CANCELLED', 'REJECTED']
        : ['DRAFT', 'PLACED', 'CANCELLED', 'REJECTED'];
      const busy = new Set(here.filter((row) => row.status !== 'CANCELLED' && row.status !== 'REJECTED').map((row) => row.employeeId));
      for (const status of needed.filter((entry) => !have.has(entry))) {
        const candidates = ctx.companies.flatMap((company) => (this.deliverable(ctx, company, date) ? company.employees.map((employee) => ({ company, employee })) : []))
          .filter(({ employee }) => !busy.has(employee.id))
          .sort((a, b) => chance(`${date}:${status}:${a.employee.id}`) - chance(`${date}:${status}:${b.employee.id}`));
        for (const { company, employee } of candidates.slice(0, 20)) {
          if (await this.createOrder(ctx, company, employee, date, status, `${date}:${employee.id}:cover:${status}`)) {
            created++;
            if (status !== 'CANCELLED' && status !== 'REJECTED') busy.add(employee.id);
            break;
          }
        }
      }
    }
    return created;
  }

  /** Kitchen history for delivered orders that have none yet: cooked in time, a little before the planned kitchen-ready time. */
  private async simulateKitchen(dates: IsoDate[], timezone: string, bufferMinutes: number) {
    const orders = await this.prisma.order.findMany({
      where: { deliveryDate: { in: dates.map(toDbDate) }, status: OrderStatus.DELIVERED, kitchenStartedAt: null },
      include: { company: { select: { dispatchLeadMinutes: true } }, lines: { include: { combinations: true } } },
    });
    for (const order of orders) {
      const plan = planFor(fromDbDate(order.deliveryDate), order.deliveryTime, order.company.dispatchLeadMinutes, bufferMinutes, timezone);
      const key = `${order.id}:kitchen`;
      const units = order.lines.flatMap((line) => line.combinations);
      const startedAt = new Date(plan.kitchenReadyAt.getTime() - (40 + Math.round(chance(`${key}:s`) * 30)) * 60_000);
      const readyAt = new Date(plan.kitchenReadyAt.getTime() - (Math.round(chance(`${key}:r`) * 12) - 2) * 60_000);
      for (const [index, unit] of units.entries()) {
        await this.prisma.orderCombination.update({ where: { id: unit.id }, data: { startedAt, doneAt: new Date(startedAt.getTime() + ((index + 1) / units.length) * (readyAt.getTime() - startedAt.getTime())) } });
      }
      await this.prisma.order.update({ where: { id: order.id }, data: { kitchenStartedAt: startedAt, kitchenReadyAt: readyAt } });
    }
  }

  /** Dispatch history for delivered orders that have none yet: left with the company's driver and arrived around the delivery time (a few late). */
  private async simulateDispatch(dates: IsoDate[], timezone: string, graceMinutes: number) {
    const orders = await this.prisma.order.findMany({
      where: { deliveryDate: { in: dates.map(toDbDate) }, status: OrderStatus.DELIVERED, kitchenReadyAt: { not: null }, dispatchReadyAt: null },
      include: { company: { select: { defaultDriverId: true } } },
      orderBy: { id: 'asc' },
    });
    const drivers = await this.prisma.staff.findMany({ where: { role: { capabilities: { has: 'driver-drops:update' } }, isActive: true }, orderBy: { id: 'asc' } });
    for (const order of orders) {
      const key = `${order.id}:dispatch`;
      const driverId = order.company.defaultDriverId ?? pick(drivers, `${key}:driver`)?.id ?? null;
      if (!driverId) continue;
      const delivery = DateTime.fromISO(`${fromDbDate(order.deliveryDate)}T${order.deliveryTime}`, { zone: timezone }).toJSDate();
      const dispatchReadyAt = new Date(order.kitchenReadyAt!.getTime() + 3 * 60_000);
      const outForDeliveryAt = new Date(dispatchReadyAt.getTime() + (5 + Math.round(chance(`${key}:out`) * 10)) * 60_000);
      const deliveredAt = new Date(delivery.getTime() + (Math.round(chance(`${order.id}:arrive`) ** 2 * 30) - 10) * 60_000); // mostly early, a fifth beyond the grace
      const lateMinutes = Math.max(0, Math.ceil((deliveredAt.getTime() - delivery.getTime()) / 60_000));
      await this.prisma.order.update({
        where: { id: order.id },
        data: { driverId, dispatchReadyAt, outForDeliveryAt, deliveredById: driverId, deliveredAt, deliveryLateMinutes: lateMinutes, deliveredOnTime: lateMinutes <= graceMinutes, deliveryNote: chance(`${order.id}:note`) < 0.25 ? 'Handed over at reception' : null },
      });
    }
  }

  /**
   * Today's work follows the clock: from the planned times, each order's units are started and finished, its drop
   * is marked dispatch ready, sent out and delivered at the moments they would have happened (with a little
   * per-drop jitter, so some run late), and only the moments already behind "now" are recorded. Progress only
   * moves forward, so running it again every half hour keeps the kitchen and dispatch boards realistic all day.
   */
  private async advanceToday(today: IsoDate, timezone: string, bufferMinutes: number, graceMinutes: number, now: Date) {
    const orders = await this.prisma.order.findMany({
      where: { deliveryDate: toDbDate(today), status: OrderStatus.CONFIRMED },
      include: { company: { select: { dispatchLeadMinutes: true, defaultDriverId: true } }, lines: { include: { combinations: true } } },
      orderBy: { id: 'asc' },
    });
    const drivers = await this.prisma.staff.findMany({ where: { role: { capabilities: { has: 'driver-drops:update' } }, isActive: true }, orderBy: { id: 'asc' } });
    const drops = new Map<string, typeof orders>();
    for (const order of orders) drops.set(`${order.companyId}|${order.addressId}|${order.deliveryTime}`, [...(drops.get(`${order.companyId}|${order.addressId}|${order.deliveryTime}`) ?? []), order]);
    const minute = 60_000;
    const nowMs = now.getTime();

    for (const [dropKey, members] of drops) {
      const first = members[0];
      const plan = planFor(today, first.deliveryTime, first.company.dispatchLeadMinutes, bufferMinutes, timezone);
      const delivery = DateTime.fromISO(`${today}T${first.deliveryTime}`, { zone: timezone }).toMillis();
      const jitter = (chance(`${dropKey}:jitter`) - 0.4) * 40 * minute; // from 16 min early to 24 min late
      const readyAt = (order: (typeof orders)[number]) => plan.kitchenReadyAt.getTime() + jitter + (chance(`${order.id}:own`) - 0.5) * 10 * minute;
      const dropReady = Math.max(...members.map(readyAt));
      const dispatchAt = dropReady + 5 * minute;
      const outAt = dispatchAt + (5 + chance(`${dropKey}:out`) * 8) * minute;
      const driverId = first.company.defaultDriverId ?? pick(drivers, `${dropKey}:driver`)?.id ?? null;

      for (const order of members) {
        const units = order.lines.flatMap((line) => line.combinations);
        const ready = readyAt(order);
        const startedAt = ready - (35 + chance(`${order.id}:len`) * 25) * minute;
        const data: Prisma.OrderUncheckedUpdateInput = {};
        const events: Prisma.OrderEventCreateManyInput[] = [];
        const note = (type: OrderEventType, message: string, at: number) => events.push({ orderId: order.id, type, message, actorId: null, createdAt: new Date(at) });

        for (const [index, unit] of units.entries()) {
          const doneAt = startedAt + ((index + 1) / units.length) * (ready - startedAt);
          const unitStart = startedAt + (index / units.length) * (ready - startedAt) * 0.6;
          if (!unit.doneAt && nowMs >= doneAt) await this.prisma.orderCombination.update({ where: { id: unit.id }, data: { startedAt: unit.startedAt ?? new Date(unitStart), doneAt: new Date(doneAt) } });
          else if (!unit.startedAt && nowMs >= unitStart) await this.prisma.orderCombination.update({ where: { id: unit.id }, data: { startedAt: new Date(unitStart) } });
        }
        if (!order.kitchenStartedAt && nowMs >= startedAt) { data.kitchenStartedAt = new Date(startedAt); note(OrderEventType.KITCHEN_STARTED, 'Kitchen started.', startedAt); }
        if (!order.kitchenReadyAt && nowMs >= ready) { data.kitchenReadyAt = new Date(ready); note(OrderEventType.KITCHEN_READY, 'Every unit is done: kitchen ready.', ready); }
        const kitchenReady = Boolean(order.kitchenReadyAt) || nowMs >= ready;
        if (kitchenReady && driverId && !order.dispatchReadyAt && nowMs >= dispatchAt) { data.dispatchReadyAt = new Date(dispatchAt); data.driverId = driverId; note(OrderEventType.DISPATCH_READY, 'Dispatch ready: packed and waiting for the driver.', dispatchAt); }
        if (kitchenReady && driverId && !order.outForDeliveryAt && nowMs >= outAt) { data.outForDeliveryAt = new Date(outAt); data.driverId = order.driverId ?? driverId; note(OrderEventType.OUT_FOR_DELIVERY, 'Out for delivery.', outAt); }
        const arrival = delivery + (Math.round(chance(`${order.id}:arrive`) ** 2 * 30) - 10) * minute;
        if (kitchenReady && driverId && nowMs >= Math.max(arrival, outAt + 10 * minute)) {
          const deliveredAt = Math.max(arrival, outAt + 10 * minute);
          const lateMinutes = Math.max(0, Math.ceil((deliveredAt - delivery) / minute));
          Object.assign(data, { status: OrderStatus.DELIVERED, deliveredAt: new Date(deliveredAt), deliveredById: order.driverId ?? driverId, deliveryLateMinutes: lateMinutes, deliveredOnTime: lateMinutes <= graceMinutes, deliveryNote: chance(`${order.id}:note`) < 0.25 ? 'Handed over at reception' : null,
            dispatchReadyAt: order.dispatchReadyAt ?? new Date(dispatchAt), outForDeliveryAt: order.outForDeliveryAt ?? new Date(outAt), driverId: order.driverId ?? driverId });
          note(OrderEventType.DELIVERED, lateMinutes > graceMinutes ? `Delivered ${lateMinutes} min late.` : 'Delivered on time.', deliveredAt);
        }
        if (Object.keys(data).length) {
          await this.prisma.order.update({ where: { id: order.id }, data });
          await this.prisma.orderEvent.createMany({ data: events });
        }
      }
    }
  }

  /**
   * Billing history: delivered orders of a finished week are invoiced per company (older weeks paid, the latest
   * unpaid), and one unpaid invoice gets a short-delivery credit so the credit flow is visible. Orders of the
   * current week stay uninvoiced, so there is always something to invoice.
   */
  private async simulateBilling(today: IsoDate, now: Date) {
    const weekEnd = (date: IsoDate) => { const day = DateTime.fromISO(date, { zone: 'utc' }); return day.plus({ days: 7 - day.weekday }).toISODate()!; }; // the Sunday
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.DELIVERED, invoiceId: null, deliveryDate: { lt: toDbDate(today) } },
      select: { id: true, companyId: true, totalCents: true, deliveryDate: true, employee: { select: { name: true } } }, orderBy: { id: 'asc' },
    });
    const groups = new Map<string, typeof orders>();
    for (const order of orders) {
      const end = weekEnd(fromDbDate(order.deliveryDate));
      if (end >= today) continue; // the week isn't over yet
      groups.set(`${order.companyId}|${end}`, [...(groups.get(`${order.companyId}|${end}`) ?? []), order]);
    }
    const admin = await this.prisma.staff.findUniqueOrThrow({ where: { email: 'admin@test.com' } });
    const latest = [...groups.keys()].map((key) => key.split('|')[1]).sort().at(-1);
    let credited = false;
    for (const [key, members] of groups) {
      const [companyId, end] = key.split('|');
      const paid = end !== latest;
      const subtotal = members.reduce((sum, order) => sum + order.totalCents, 0);
      await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({ data: { number: `PENDING-${key}`, companyId: Number(companyId), totalCents: subtotal, createdById: admin.id, issuedAt: DateTime.fromISO(end, { zone: 'utc' }).plus({ days: 1, hours: 10 }).toJSDate(), notes: 'Weekly invoice' } });
        await tx.invoice.update({ where: { id: invoice.id }, data: { number: formatInvoiceNumber(invoice.id), ...(paid ? { status: InvoiceStatus.PAID, paidAt: new Date(Math.min(now.getTime(), DateTime.fromISO(end, { zone: 'utc' }).plus({ days: 4 }).toMillis())), paidById: admin.id } : {}) } });
        await tx.invoiceLine.createMany({ data: members.map((order, index) => ({ invoiceId: invoice.id, type: InvoiceLineType.ORDER, orderId: order.id, description: `Order #${order.id} · ${order.employee.name} · ${fromDbDate(order.deliveryDate)}`, amountCents: order.totalCents, sortOrder: (index + 1) * 10 })) });
        await tx.order.updateMany({ where: { id: { in: members.map((order) => order.id) } }, data: { invoiceId: invoice.id } });
        if (!paid && !credited && members.length > 3) {
          const target = await tx.order.findFirst({ where: { id: members[2].id }, include: { lines: { include: { combinations: true } } } });
          const combination = target?.lines[0]?.combinations[0];
          if (target && combination) {
            await issueCredit(tx, { orderId: target.id, kind: CreditKind.SHORT_DELIVERY, amountCents: combination.unitPriceCents, reason: 'One box missing at delivery', description: `1 × ${target.lines[0].dishName} (order #${target.id}, short delivery)`, actorId: admin.id });
            credited = true;
          }
        }
      });
    }
  }

  /**
   * Yesterday's work is finished by the time anyone looks: confirmed orders from past days are completed through
   * the kitchen, dispatch and delivery (mostly on time), so the daily refresh moves "today" into history.
   */
  private async closeOutPastDays(today: IsoDate, timezone: string, bufferMinutes: number, graceMinutes: number, now: Date) {
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.CONFIRMED, deliveryDate: { lt: toDbDate(today) } },
      include: { company: { select: { dispatchLeadMinutes: true, defaultDriverId: true } }, lines: { include: { combinations: true } } },
    });
    if (!orders.length) return;
    const drivers = await this.prisma.staff.findMany({ where: { role: { capabilities: { has: 'driver-drops:update' } }, isActive: true }, orderBy: { id: 'asc' } });
    for (const order of orders) {
      const date = fromDbDate(order.deliveryDate);
      const plan = planFor(date, order.deliveryTime, order.company.dispatchLeadMinutes, bufferMinutes, timezone);
      const key = `${order.id}:closeout`;
      const delivery = DateTime.fromISO(`${date}T${order.deliveryTime}`, { zone: timezone }).toJSDate();
      const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60_000);
      const kitchenStartedAt = order.kitchenStartedAt ?? at(plan.kitchenReadyAt, -(40 + Math.round(chance(`${key}:s`) * 30)));
      const kitchenReadyAt = order.kitchenReadyAt ?? at(plan.kitchenReadyAt, Math.round(chance(`${key}:r`) * 10) - 4);
      const dispatchReadyAt = order.dispatchReadyAt ?? at(kitchenReadyAt, 3);
      const outForDeliveryAt = order.outForDeliveryAt ?? at(dispatchReadyAt, 5 + Math.round(chance(`${key}:o`) * 10));
      const driverId = order.driverId ?? order.company.defaultDriverId ?? pick(drivers, `${key}:driver`)?.id ?? null;
      const deliveredAt = at(delivery, Math.round(chance(`${key}:arrive`) ** 2 * 30) - 10);
      const lateMinutes = Math.max(0, Math.ceil((deliveredAt.getTime() - delivery.getTime()) / 60_000));
      await this.prisma.$transaction(async (tx) => {
        for (const unit of order.lines.flatMap((line) => line.combinations).filter((entry) => !entry.doneAt)) {
          await tx.orderCombination.update({ where: { id: unit.id }, data: { startedAt: unit.startedAt ?? kitchenStartedAt, doneAt: kitchenReadyAt } });
        }
        await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.DELIVERED, kitchenStartedAt, kitchenReadyAt, dispatchReadyAt, outForDeliveryAt, driverId, deliveredById: driverId, deliveredAt, deliveryLateMinutes: lateMinutes, deliveredOnTime: lateMinutes <= graceMinutes } });
        await tx.orderEvent.create({ data: { orderId: order.id, type: OrderEventType.DELIVERED, message: lateMinutes > graceMinutes ? `Delivered ${lateMinutes} min late.` : 'Delivered on time.', actorId: null, createdAt: now } });
      });
    }
    this.logger.log(`Demo orders: closed out ${orders.length} order(s) from past days.`);
  }

  /** The brief wants deliveries assigned to driver@test.com today: if none are, give them one of today's drops. */
  private async ensureDriverHasDrops(today: IsoDate) {
    const driver = await this.prisma.staff.findUnique({ where: { email: 'driver@test.com' } });
    if (!driver) return;
    const mine = await this.prisma.order.count({ where: { deliveryDate: toDbDate(today), status: { in: [OrderStatus.CONFIRMED, OrderStatus.DELIVERED] }, OR: [{ driverId: driver.id }, { driverId: null, company: { defaultDriverId: driver.id } }] } });
    if (mine) return;
    const first = await this.prisma.order.findFirst({ where: { deliveryDate: toDbDate(today), status: OrderStatus.CONFIRMED, outForDeliveryAt: null }, orderBy: [{ deliveryTime: 'asc' }, { id: 'asc' }] });
    if (!first) return;
    await this.prisma.order.updateMany({ where: { deliveryDate: toDbDate(today), companyId: first.companyId, addressId: first.addressId, deliveryTime: first.deliveryTime, status: OrderStatus.CONFIRMED, outForDeliveryAt: null }, data: { driverId: driver.id } });
  }

  private workingDays(today: IsoDate, calendar: Parameters<typeof isKitchenWorkingDay>[1]) {
    const back: IsoDate[] = [];
    for (let date = addDays(today, -1); back.length < PAST_WORKING_DAYS; date = addDays(date, -1)) if (isKitchenWorkingDay(date, calendar)) back.push(date);
    const forward: IsoDate[] = [];
    for (let date = addDays(today, 1); forward.length < FUTURE_WORKING_DAYS; date = addDays(date, 1)) if (isKitchenWorkingDay(date, calendar)) forward.push(date);
    return [...back.reverse(), ...(isKitchenWorkingDay(today, calendar) ? [today] : []), ...forward];
  }

  private statusFor(date: IsoDate, today: IsoDate, cutoff: Date, now: Date, key: string): OrderStatus {
    const roll = chance(`${key}:status`);
    if (date < today) return roll < 0.05 ? OrderStatus.CANCELLED : roll < 0.08 ? OrderStatus.REJECTED : OrderStatus.DELIVERED;
    if (cutoff <= now) return roll < 0.03 ? OrderStatus.REJECTED : OrderStatus.CONFIRMED; // today, or tomorrow after today's cut-off
    return roll < 0.2 ? OrderStatus.DRAFT : roll < 0.25 ? OrderStatus.CANCELLED : OrderStatus.PLACED;
  }

  /** One main (sometimes two portions split across combinations), sometimes a drink or dessert. */
  private buildLines(dishes: MenuDish[], key: string): LineInput[] {
    const mains = dishes.filter((dish) => dish.groups.some((group) => group.required) && dish.minOrderQty === 1);
    const extras = dishes.filter((dish) => !dish.groups.length && dish.minOrderQty === 1);
    if (!mains.length) return [];
    const main = pick(mains, `${key}:main`);
    const quantity = chance(`${key}:qty`) < 0.15 ? 2 : 1;
    const combination = (variant: number, qty: number) => ({
      quantity: qty,
      choices: main.groups.filter((group) => group.required).map((group) => ({
        groupId: group.id,
        optionId: pick(group.options, `${key}:${group.id}:${variant}`).id,
        portionSizeId: group.usesPortions ? (chance(`${key}:${group.id}:size:${variant}`) < 0.2 ? group.sizes.at(-1)!.id : group.sizes[0].id) : undefined,
      })),
    });
    const lines: LineInput[] = [{ dishId: main.id, quantity, combinations: quantity === 2 && chance(`${key}:split`) < 0.5 ? [combination(0, 1), combination(1, 1)] : [combination(0, quantity)] }];
    if (extras.length && chance(`${key}:extra`) < 0.35) lines.push({ dishId: pick(extras, `${key}:extraDish`).id, quantity: 1, combinations: [{ quantity: 1, choices: [] }] });
    return lines;
  }

  private events(status: OrderStatus, actorId: number, totalCents: number, rejectionReason: string | null, cutoffPassed = true) {
    const events: { type: OrderEventType; message: string; actorId: number | null }[] = [
      { type: OrderEventType.CREATED, message: `Created, total $${(totalCents / 100).toFixed(2)}.`, actorId },
    ];
    if (status !== OrderStatus.DRAFT) events.push({ type: OrderEventType.PLACED, message: 'Placed.', actorId });
    if (([OrderStatus.CONFIRMED, OrderStatus.DELIVERED] as OrderStatus[]).includes(status) || (status === OrderStatus.REJECTED && cutoffPassed)) events.push({ type: OrderEventType.CONFIRMED, message: 'Cut-off passed: confirmed and billable to the company.', actorId: null });
    if (status === OrderStatus.DELIVERED) events.push({ type: OrderEventType.DELIVERED, message: 'Delivered.', actorId: null });
    if (status === OrderStatus.CANCELLED) events.push({ type: OrderEventType.CANCELLED, message: 'Cancelled: Employee on leave', actorId });
    if (status === OrderStatus.REJECTED) events.push({ type: OrderEventType.REJECTED, message: `Rejected: ${rejectionReason}`, actorId });
    return events;
  }
}

type Ctx = Awaited<ReturnType<DemoOrdersService['context']>>;
