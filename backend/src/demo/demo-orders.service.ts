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
const FUTURE_WORKING_DAYS = 5;
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
    const existing = new Set((await this.prisma.order.groupBy({ by: ['deliveryDate'], where: { deliveryDate: { in: dates.map(toDbDate) } } })).map((row) => fromDbDate(row.deliveryDate)));
    const todo = dates.filter((date) => !existing.has(date));
    if (!todo.length) {
      await this.simulateKitchen(dates, settings.today, settings.timezone, settings.kitchenReadyBufferMinutes, now);
      await this.simulateDispatch(dates, settings.today, settings.timezone, settings.onTimeGraceMinutes, now);
      await this.simulateBilling(settings.today, now);
      await this.ensureDriverHasDrops(settings.today);
      return { created: 0, dates: [] as string[] };
    }

    const admin = await this.prisma.staff.findUniqueOrThrow({ where: { email: 'admin@test.com' } });
    const companies = await this.prisma.company.findMany({
      where: { isActive: true, addresses: { some: { isDefault: true, isActive: true } } },
      include: { addresses: true, holidays: true, employees: { where: { isActive: true }, include: { allergens: true }, orderBy: { id: 'asc' } } },
    });
    const menus = new Map<number, { tierId: number; dishes: Map<number, MenuDish> }>();
    let created = 0;

    for (const date of todo) {
      const cutoff = cutoffFor(date, calendar, calendar).toJSDate();
      for (const company of companies) {
        const day = checkDeliveryDay(date, { workingDays: company.workingDays, holidays: new Set(company.holidays.map((holiday) => fromDbDate(holiday.date))) }, calendar);
        if (!day.ok) continue;
        const address = company.addresses.find((entry) => entry.isDefault)!;
        for (const employee of company.employees) {
          const key = `${date}:${employee.id}`;
          if (chance(`${key}:orders`) > 0.45) continue; // roughly 45% of staff order on a given day
          if (!menus.has(employee.id)) {
            const orderable = await this.menu.orderableFor(employee.id);
            menus.set(employee.id, { tierId: orderable.tier.id, dishes: orderable.dishes });
          }
          const { tierId, dishes } = menus.get(employee.id)!;
          const lines = this.buildLines([...dishes.values()], key);
          const priced = priceLines(lines, dishes);
          if (priced.errors.length || !priced.lines.length) continue;

          const status = this.statusFor(date, settings.today, cutoff, now, key);
          const deliveredAt = DateTime.fromISO(`${date}T${company.defaultDeliveryTime}`, { zone: settings.timezone }).minus({ minutes: Math.round(chance(`${key}:late`) * 20) - 5 }).toJSDate();
          const placedAt = DateTime.fromJSDate(cutoff).minus({ hours: 2 + Math.round(chance(`${key}:placed`) * 40) }).toJSDate();
          const rejectionReason = status === OrderStatus.REJECTED ? pick(REJECTION_REASONS, `${key}:reason`) : null;
          await this.prisma.order.create({
            data: {
              employeeId: employee.id, companyId: company.id, status, deliveryDate: toDbDate(date), deliveryTime: company.defaultDeliveryTime,
              addressId: address.id, packagingTypeId: company.defaultPackagingTypeId, priceTierId: tierId, totalCents: priced.totalCents,
              allergyAcknowledged: priced.allergyConflicts.length > 0, createdById: admin.id,
              placedAt: status === OrderStatus.DRAFT ? null : placedAt,
              confirmedAt: ([OrderStatus.CONFIRMED, OrderStatus.DELIVERED, OrderStatus.REJECTED] as OrderStatus[]).includes(status) ? cutoff : null,
              deliveredAt: status === OrderStatus.DELIVERED ? deliveredAt : null,
              cancelledAt: status === OrderStatus.CANCELLED ? DateTime.fromJSDate(cutoff).minus({ hours: 3 }).toJSDate() : null,
              cancellationReason: status === OrderStatus.CANCELLED ? 'Employee on leave' : null,
              rejectedAt: status === OrderStatus.REJECTED ? cutoff : null,
              rejectionReason,
              lines: {
                create: priced.lines.map((line, index) => ({
                  dishId: line.dishId, dishName: line.dishName, dishSku: line.dishSku, quantity: line.quantity, unitPriceCents: line.unitPriceCents, totalCents: line.totalCents, sortOrder: (index + 1) * 10,
                  combinations: { create: line.combinations.map((combination) => ({ signature: combination.signature, quantity: combination.quantity, unitPriceCents: combination.unitPriceCents, totalCents: combination.totalCents, choices: { create: combination.choices } })) },
                })),
              },
              events: { create: this.events(status, admin.id, priced.totalCents, rejectionReason) },
            },
          });
          created++;
        }
      }
    }
    await this.simulateKitchen(dates, settings.today, settings.timezone, settings.kitchenReadyBufferMinutes, now);
    await this.simulateDispatch(dates, settings.today, settings.timezone, settings.onTimeGraceMinutes, now);
    await this.simulateBilling(settings.today, now);
    await this.ensureDriverHasDrops(settings.today);
    this.logger.log(`Demo orders: created ${created} for ${todo.join(', ')}.`);
    return { created, dates: todo };
  }

  /**
   * Kitchen history for orders that have none yet (so it also backfills older demo data, and re-running moves today's work along): delivered ones were cooked on time; today's confirmed ones are part-way
   * through (more done the closer it is to their planned kitchen-ready time, a few running late).
   */
  private async simulateKitchen(dates: IsoDate[], today: IsoDate, timezone: string, bufferMinutes: number, now: Date) {
    const orders = await this.prisma.order.findMany({
      where: { deliveryDate: { in: dates.map(toDbDate) }, status: { in: [OrderStatus.CONFIRMED, OrderStatus.DELIVERED] }, kitchenStartedAt: null },
      include: { company: { select: { dispatchLeadMinutes: true } }, lines: { include: { combinations: true } } },
    });
    for (const order of orders) {
      const date = fromDbDate(order.deliveryDate);
      const plan = planFor(date, order.deliveryTime, order.company.dispatchLeadMinutes, bufferMinutes, timezone);
      const key = `${order.id}:kitchen`;
      const units = order.lines.flatMap((line) => line.combinations);
      const begin = (minutes: number) => new Date(plan.kitchenReadyAt.getTime() - minutes * 60_000);
      let startedAt: Date | null = null; let readyAt: Date | null = null;
      const unitTimes = new Map<number, { startedAt: Date; doneAt: Date | null }>();
      if (order.status === OrderStatus.DELIVERED) {
        startedAt = begin(40 + Math.round(chance(`${key}:s`) * 30));
        readyAt = begin(Math.round(chance(`${key}:r`) * 12) - 2);
        units.forEach((unit, index) => unitTimes.set(unit.id, { startedAt: startedAt!, doneAt: new Date(startedAt!.getTime() + ((index + 1) / units.length) * (readyAt!.getTime() - startedAt!.getTime())) }));
      } else if (date === today) {
        const progress = chance(`${key}:p`); // how far along this order is
        const behind = now.getTime() > plan.kitchenReadyAt.getTime() - 20 * 60_000; // due soon or overdue
        const target = behind ? progress * 1.15 : Math.max(0, progress - 0.55) * 1.5; // far-off orders are mostly untouched
        units.forEach((unit, index) => {
          const unitProgress = (index + 1) / units.length;
          if (target >= unitProgress) unitTimes.set(unit.id, { startedAt: new Date(now.getTime() - (20 + chance(`${key}:${unit.id}:a`) * 20) * 60_000), doneAt: new Date(now.getTime() - chance(`${key}:${unit.id}:b`) * 15 * 60_000) });
          else if (target >= unitProgress - 0.5 || (behind && chance(`${key}:${unit.id}:c`) < 0.4)) unitTimes.set(unit.id, { startedAt: new Date(now.getTime() - chance(`${key}:${unit.id}:d`) * 12 * 60_000), doneAt: null });
        });
        const all = units.length > 0 && units.every((unit) => unitTimes.get(unit.id)?.doneAt);
        const first = [...unitTimes.values()].map((entry) => entry.startedAt.getTime());
        startedAt = first.length ? new Date(Math.min(...first)) : null;
        readyAt = all ? new Date(Math.max(...[...unitTimes.values()].map((entry) => entry.doneAt!.getTime()))) : null;
      }
      if (!unitTimes.size) continue;
      for (const [id, times] of unitTimes) await this.prisma.orderCombination.update({ where: { id }, data: { startedAt: times.startedAt, doneAt: times.doneAt } });
      await this.prisma.order.update({ where: { id: order.id }, data: { kitchenStartedAt: startedAt, kitchenReadyAt: readyAt } });
      if (order.status !== OrderStatus.CONFIRMED) continue; // delivered orders keep their original timeline
      const events: Prisma.OrderEventCreateManyInput[] = [{ orderId: order.id, type: OrderEventType.KITCHEN_STARTED, message: 'Kitchen started.', actorId: null, createdAt: startedAt! }];
      if (readyAt) events.push({ orderId: order.id, type: OrderEventType.KITCHEN_READY, message: 'Every unit is done: kitchen ready.', actorId: null, createdAt: readyAt });
      await this.prisma.orderEvent.createMany({ data: events });
    }
  }

  /**
   * Dispatch history: delivered orders left the kitchen with their company's driver and arrived around the
   * delivery time (a few late); on today's confirmed orders, drops whose orders are all kitchen-ready are part-way
   * through dispatch.
   */
  private async simulateDispatch(dates: IsoDate[], today: IsoDate, timezone: string, graceMinutes: number, now: Date) {
    const orders = await this.prisma.order.findMany({
      where: { deliveryDate: { in: dates.map(toDbDate) }, status: { in: [OrderStatus.CONFIRMED, OrderStatus.DELIVERED] }, kitchenReadyAt: { not: null }, dispatchReadyAt: null },
      include: { company: { select: { defaultDriverId: true } } },
      orderBy: { id: 'asc' },
    });
    const drivers = await this.prisma.staff.findMany({ where: { role: { capabilities: { has: 'driver-drops:update' } }, isActive: true }, orderBy: { id: 'asc' } });
    const drops = new Map<string, typeof orders>();
    for (const order of orders) {
      const id = `${fromDbDate(order.deliveryDate)}|${order.companyId}|${order.addressId}|${order.deliveryTime}`;
      drops.set(id, [...(drops.get(id) ?? []), order]);
    }
    for (const [id, members] of drops) {
      const date = fromDbDate(members[0].deliveryDate);
      const driverId = members[0].company.defaultDriverId ?? pick(drivers, `${id}:driver`)?.id ?? null;
      if (!driverId) continue;
      const delivery = DateTime.fromISO(`${date}T${members[0].deliveryTime}`, { zone: timezone }).toJSDate();
      let stage: 'DISPATCH_READY' | 'OUT' | 'DELIVERED' = 'DELIVERED';
      if (members.some((member) => member.status === OrderStatus.CONFIRMED)) {
        if (date !== today || members.some((member) => member.status !== OrderStatus.CONFIRMED) || members.some((member) => member.kitchenReadyAt!.getTime() > now.getTime())) continue;
        const roll = chance(`${id}:dispatch`);
        stage = roll < 0.35 ? 'DISPATCH_READY' : roll < 0.65 ? 'OUT' : 'DELIVERED';
        if (stage === 'DELIVERED' && delivery.getTime() > now.getTime() + 15 * 60_000) stage = 'OUT'; // can't have arrived long before it is due
      }
      const lastReady = Math.max(...members.map((member) => member.kitchenReadyAt!.getTime()));
      const dispatchReadyAt = new Date(Math.min(lastReady + 3 * 60_000, now.getTime()));
      const outAt = new Date(Math.min(dispatchReadyAt.getTime() + (5 + Math.round(chance(`${id}:out`) * 10)) * 60_000, now.getTime()));
      for (const member of members) {
        const data: Prisma.OrderUncheckedUpdateInput = { driverId, dispatchReadyAt };
        const events: Prisma.OrderEventCreateManyInput[] = [{ orderId: member.id, type: OrderEventType.DISPATCH_READY, message: 'Dispatch ready: packed and waiting for the driver.', actorId: null, createdAt: dispatchReadyAt }];
        if (stage !== 'DISPATCH_READY') {
          data.outForDeliveryAt = outAt;
          events.push({ orderId: member.id, type: OrderEventType.OUT_FOR_DELIVERY, message: 'Out for delivery.', actorId: null, createdAt: outAt });
        }
        if (stage === 'DELIVERED') {
          const deliveredAt = new Date(Math.min(delivery.getTime() + (Math.round(chance(`${member.id}:arrive`) ** 2 * 30) - 10) * 60_000, now.getTime())); // mostly early, a fifth beyond the grace
          const lateMinutes = Math.max(0, Math.ceil((deliveredAt.getTime() - delivery.getTime()) / 60_000));
          events.push({ orderId: member.id, type: OrderEventType.DELIVERED, message: 'Delivered.', actorId: null, createdAt: deliveredAt });
          Object.assign(data, { deliveredById: driverId, deliveredAt, deliveryLateMinutes: lateMinutes, deliveredOnTime: lateMinutes <= graceMinutes, status: OrderStatus.DELIVERED, deliveryNote: chance(`${member.id}:note`) < 0.25 ? 'Handed over at reception' : null });
        }
        await this.prisma.order.update({ where: { id: member.id }, data });
        if (member.status === OrderStatus.CONFIRMED) await this.prisma.orderEvent.createMany({ data: events }); // delivered history keeps its original timeline
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

  private events(status: OrderStatus, actorId: number, totalCents: number, rejectionReason: string | null) {
    const events: { type: OrderEventType; message: string; actorId: number | null }[] = [
      { type: OrderEventType.CREATED, message: `Created, total $${(totalCents / 100).toFixed(2)}.`, actorId },
    ];
    if (status !== OrderStatus.DRAFT) events.push({ type: OrderEventType.PLACED, message: 'Placed.', actorId });
    if (([OrderStatus.CONFIRMED, OrderStatus.DELIVERED, OrderStatus.REJECTED] as OrderStatus[]).includes(status)) events.push({ type: OrderEventType.CONFIRMED, message: 'Cut-off passed: confirmed and billable to the company.', actorId: null });
    if (status === OrderStatus.DELIVERED) events.push({ type: OrderEventType.DELIVERED, message: 'Delivered.', actorId: null });
    if (status === OrderStatus.CANCELLED) events.push({ type: OrderEventType.CANCELLED, message: 'Cancelled: Employee on leave', actorId });
    if (status === OrderStatus.REJECTED) events.push({ type: OrderEventType.REJECTED, message: `Rejected: ${rejectionReason}`, actorId });
    return events;
  }
}
