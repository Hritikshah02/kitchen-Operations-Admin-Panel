import { Injectable, Logger } from '@nestjs/common';
import { OrderEventType, OrderStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { checkDeliveryDay } from '../companies/company-calendar.js';
import type { MenuDish } from '../menu/menu-engine.js';
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
    const existing = new Set((await this.prisma.order.groupBy({ by: ['deliveryDate'], where: { deliveryDate: { in: dates.map(toDbDate) } } })).map((row) => fromDbDate(row.deliveryDate)));
    const todo = dates.filter((date) => !existing.has(date));
    if (!todo.length) return { created: 0, dates: [] as string[] };

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
    this.logger.log(`Demo orders: created ${created} for ${todo.join(', ')}.`);
    return { created, dates: todo };
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
