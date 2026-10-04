import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreditKind, OrderEventType, OrderStatus, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import type { AuthenticatedStaff } from '../auth/auth.types.js';
import { Capability } from '../auth/capabilities.js';
import { pageArgs } from '../common/pagination.js';
import { minutesOf } from '../common/validation.js';
import { checkDeliveryDay } from '../companies/company-calendar.js';
import { MenuService } from '../menu/menu.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { cutoffFor, fromDbDate, toDbDate } from '../settings/kitchen-calendar.js';
import { SettingsService } from '../settings/settings.service.js';
import { issueCredit } from '../billing/credits.js';
import { planFor, timingOf } from '../kitchen/kitchen-plan.js';
import { CutoffService } from './cutoff.service.js';
import type { CreateOrderDto, DeliveryOverrideDto, ListOrdersQueryDto, QuoteOrderDto, ReasonDto, RejectDto, UpdateOrderDto, VersionDto } from './orders.dto.js';
import { priceLines, snapshotOf, type LineInput, type PricedLine } from './order-rules.js';

type Tx = Prisma.TransactionClient;
type Content = { deliveryDate: string; deliveryTime?: string; addressId?: number; packagingTypeId?: number; lines: LineInput[] };

const lineInclude = { combinations: { include: { choices: true }, orderBy: { id: 'asc' } } } satisfies Prisma.OrderLineInclude;
const detailInclude = {
  employee: { select: { id: true, name: true, email: true, canChooseAddress: true, canChangeDeliveryTime: true, canChangePackaging: true, allergens: { select: { id: true, name: true } } } },
  company: { select: { id: true, name: true, isActive: true, dispatchLeadMinutes: true } },
  address: true,
  packagingType: { select: { id: true, name: true } },
  priceTier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  driver: { select: { id: true, name: true } },
  invoice: { select: { id: true, number: true, status: true } },
  credits: { select: { id: true, kind: true, amountCents: true, reason: true, status: true }, orderBy: { id: 'asc' } },
  lines: { include: lineInclude, orderBy: { sortOrder: 'asc' } },
  events: { include: { actor: { select: { id: true, name: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.OrderInclude;

const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const canOverride = (actor: AuthenticatedStaff) => actor.capabilities.includes(Capability.ORDERS_OVERRIDE);

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly menu: MenuService,
    private readonly cutoff: CutoffService,
  ) {}

  // ---------- Validation and pricing shared by quote/create/update/place ----------

  /**
   * Everything the server checks for an order's content (4.6 "every rule validated on the server"):
   * employee and company active, a deliverable date, delivery details only where the employee may choose,
   * dishes on their menu, combinations valid, prices from their tier (or the locked snapshot of a placed order).
   */
  private async prepare(employeeId: number, input: Content, existing?: { companyId: number; snapshotLines?: Parameters<typeof snapshotOf>[0] }) {
    const errors: string[] = [];
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { company: { include: { addresses: true, holidays: true } }, allergens: { select: { id: true, name: true } } },
    });
    if (!employee) throw new NotFoundException('Employee not found.');
    const company = employee.company;
    if (existing && existing.companyId !== company.id) throw new BadRequestException('This employee has moved to another company; the order can no longer be edited.');
    if (!employee.isActive) errors.push(`${employee.name} is deactivated.`);
    if (!company.isActive) errors.push(`${company.name} is deactivated and cannot receive new orders.`);

    const date = input.deliveryDate;
    if (!DateTime.fromISO(date).isValid) throw new BadRequestException(`${date} is not a real date.`);
    const calendar = await this.settings.calendar(date, date);
    const day = checkDeliveryDay(date, { workingDays: company.workingDays, holidays: new Set(company.holidays.map((holiday) => fromDbDate(holiday.date))) }, calendar);
    if (!day.ok) errors.push(`${DateTime.fromISO(date).toFormat('ccc d LLL yyyy')}: ${day.reason}`);
    const cutoffAt = cutoffFor(date, calendar, calendar);

    // Delivery details: company defaults unless the employee is allowed to choose (4.5).
    const defaultAddress = company.addresses.find((address) => address.isDefault && address.isActive);
    let addressId = defaultAddress?.id;
    if (input.addressId !== undefined && input.addressId !== defaultAddress?.id) {
      if (!employee.canChooseAddress) errors.push(`${employee.name} is not allowed to choose a delivery address; the company default is used.`);
      else if (!company.addresses.some((address) => address.id === input.addressId && address.isActive)) errors.push('Choose one of the company\'s active delivery addresses.');
      else addressId = input.addressId;
    }
    if (!addressId) errors.push(`${company.name} has no active default delivery address.`);

    let deliveryTime = company.defaultDeliveryTime;
    if (input.deliveryTime !== undefined && input.deliveryTime !== company.defaultDeliveryTime) {
      if (!employee.canChangeDeliveryTime) errors.push(`${employee.name} is not allowed to change the delivery time; ${company.defaultDeliveryTime} is used.`);
      else if (minutesOf(input.deliveryTime) < minutesOf(company.deliveryWindowStart) || minutesOf(input.deliveryTime) > minutesOf(company.deliveryWindowEnd)) {
        errors.push(`Pick a delivery time between ${company.deliveryWindowStart} and ${company.deliveryWindowEnd}.`);
      } else deliveryTime = input.deliveryTime;
    }

    let packagingTypeId = company.defaultPackagingTypeId ?? undefined;
    if (input.packagingTypeId !== undefined && input.packagingTypeId !== company.defaultPackagingTypeId) {
      if (!employee.canChangePackaging) errors.push(`${employee.name} is not allowed to change packaging; the company default is used.`);
      else if (!(await this.prisma.packagingType.findFirst({ where: { id: input.packagingTypeId, isActive: true } }))) errors.push('Choose an active packaging type.');
      else packagingTypeId = input.packagingTypeId;
    }

    const { tier, dishes } = await this.menu.orderableFor(employeeId);
    const priced = priceLines(input.lines, dishes, existing?.snapshotLines ? snapshotOf(existing.snapshotLines) : undefined);
    errors.push(...priced.errors);

    return { employee, company, tier, deliveryDate: date, deliveryTime, addressId, packagingTypeId, priced, cutoffAt, pastCutoff: cutoffAt.toJSDate() <= new Date(), errors };
  }

  private assertValid(prepared: { errors: string[] }) {
    if (prepared.errors.length) throw new BadRequestException(prepared.errors);
  }

  private assertAllergiesAcknowledged(prepared: Awaited<ReturnType<OrdersService['prepare']>>, acknowledged?: boolean) {
    if (prepared.priced.allergyConflicts.length && !acknowledged) {
      throw new BadRequestException(
        `${prepared.employee.name} is allergic to ${prepared.priced.allergyConflicts.map((allergen) => allergen.name).join(', ')}, which this order contains. Confirm with the employee and tick the acknowledgement to continue.`,
      );
    }
  }

  private assertCanWriteAfterCutoff(pastCutoff: boolean, actor: AuthenticatedStaff, date: string) {
    if (pastCutoff && !canOverride(actor)) {
      throw new ForbiddenException(`Orders for ${date} are locked: the cut-off has passed. Only an admin can change them now.`);
    }
  }

  /** Live price breakdown and validation for the order builder; never saves. */
  async quote(dto: QuoteOrderDto) {
    const existing = dto.orderId ? await this.prisma.order.findUnique({ where: { id: dto.orderId }, include: { lines: { include: lineInclude } } }) : null;
    const prepared = await this.prepare(dto.employeeId, dto, existing ? { companyId: existing.companyId, snapshotLines: existing.status === OrderStatus.PLACED ? existing.lines : undefined } : undefined);
    return {
      lines: prepared.priced.lines,
      totalCents: prepared.priced.totalCents,
      allergyConflicts: prepared.priced.allergyConflicts,
      errors: prepared.errors,
      tier: prepared.tier,
      delivery: { deliveryDate: prepared.deliveryDate, deliveryTime: prepared.deliveryTime, addressId: prepared.addressId, packagingTypeId: prepared.packagingTypeId },
      cutoffAt: prepared.cutoffAt.toISO(),
      pastCutoff: prepared.pastCutoff,
    };
  }

  // ---------- Writes ----------

  async create(dto: CreateOrderDto, actor: AuthenticatedStaff) {
    const prepared = await this.prepare(dto.employeeId, dto);
    this.assertValid(prepared);
    this.assertCanWriteAfterCutoff(prepared.pastCutoff, actor, dto.deliveryDate);
    if (dto.place) this.assertAllergiesAcknowledged(prepared, dto.allergyAcknowledged);
    await this.assertNoOtherActiveOrder(dto.employeeId, dto.deliveryDate);

    // Placing after the cut-off (admin only) confirms immediately: that date's cut-off processing has already run.
    const status = !dto.place ? OrderStatus.DRAFT : prepared.pastCutoff ? OrderStatus.CONFIRMED : OrderStatus.PLACED;
    const now = new Date();
    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          employeeId: dto.employeeId,
          companyId: prepared.company.id,
          status,
          deliveryDate: toDbDate(dto.deliveryDate),
          deliveryTime: prepared.deliveryTime,
          addressId: prepared.addressId!,
          packagingTypeId: prepared.packagingTypeId ?? null,
          priceTierId: prepared.tier.id,
          totalCents: prepared.priced.totalCents,
          allergyAcknowledged: Boolean(dto.allergyAcknowledged && prepared.priced.allergyConflicts.length),
          notes: dto.notes ?? null,
          createdById: actor.id,
          placedAt: dto.place ? now : null,
          confirmedAt: status === OrderStatus.CONFIRMED ? now : null,
        },
      });
      await this.writeLines(tx, created.id, prepared.priced.lines);
      await this.addEvents(tx, created.id, actor.id, [
        [OrderEventType.CREATED, `Created for ${prepared.employee.name} (${prepared.tier.name} prices), total ${formatCents(prepared.priced.totalCents)}.`],
        ...(dto.place ? [[OrderEventType.PLACED, 'Placed.'] as const] : []),
        ...(status === OrderStatus.CONFIRMED ? [[OrderEventType.CONFIRMED, 'Placed after the cut-off by an admin: confirmed immediately and billable.'] as const] : []),
        ...this.allergyEvent(prepared, dto.allergyAcknowledged),
      ]);
      return created;
    });
    return this.get(order.id, actor);
  }

  /** Edits a draft or placed order. Placed orders keep their locked prices for unchanged items. */
  async update(id: number, dto: UpdateOrderDto, actor: AuthenticatedStaff) {
    const order = await this.findOrThrow(id, { lines: { include: lineInclude } });
    this.assertStatus(order.status, [OrderStatus.DRAFT, OrderStatus.PLACED], 'edited');
    this.assertCanWriteAfterCutoff(await this.isPastCutoff(fromDbDate(order.deliveryDate)), actor, fromDbDate(order.deliveryDate));
    const prepared = await this.prepare(order.employeeId, dto, { companyId: order.companyId, snapshotLines: order.status === OrderStatus.PLACED ? order.lines : undefined });
    this.assertValid(prepared);
    this.assertCanWriteAfterCutoff(prepared.pastCutoff, actor, dto.deliveryDate);
    if (order.status === OrderStatus.PLACED) this.assertAllergiesAcknowledged(prepared, dto.allergyAcknowledged);
    if (dto.deliveryDate !== fromDbDate(order.deliveryDate)) await this.assertNoOtherActiveOrder(order.employeeId, dto.deliveryDate, id);

    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, id, dto.version, {
        deliveryDate: toDbDate(dto.deliveryDate),
        deliveryTime: prepared.deliveryTime,
        addressId: prepared.addressId!,
        packagingTypeId: prepared.packagingTypeId ?? null,
        totalCents: prepared.priced.totalCents,
        notes: dto.notes ?? null,
        allergyAcknowledged: Boolean(dto.allergyAcknowledged && prepared.priced.allergyConflicts.length),
      });
      await tx.orderLine.deleteMany({ where: { orderId: id } });
      await this.writeLines(tx, id, prepared.priced.lines);
      await this.addEvents(tx, id, actor.id, [
        [OrderEventType.UPDATED, `Edited: total ${formatCents(order.totalCents)} → ${formatCents(prepared.priced.totalCents)}${order.status === OrderStatus.PLACED ? ' (placed prices kept for unchanged items)' : ''}.`],
        ...this.allergyEvent(prepared, dto.allergyAcknowledged),
      ]);
    });
    return this.get(id, actor);
  }

  /** Draft → placed. Drafts are re-priced at today's prices; from now on the prices are locked. */
  async place(id: number, dto: VersionDto, actor: AuthenticatedStaff) {
    const order = await this.findOrThrow(id, { lines: { include: lineInclude } });
    this.assertStatus(order.status, [OrderStatus.DRAFT], 'placed');
    const content: Content = {
      deliveryDate: fromDbDate(order.deliveryDate),
      deliveryTime: order.deliveryTime,
      addressId: order.addressId,
      packagingTypeId: order.packagingTypeId ?? undefined,
      lines: order.lines.map((line) => ({
        dishId: line.dishId,
        quantity: line.quantity,
        combinations: line.combinations.map((combination) => ({ quantity: combination.quantity, choices: combination.choices.map(({ groupId, optionId, portionSizeId }) => ({ groupId, optionId, portionSizeId })) })),
      })),
    };
    const prepared = await this.prepare(order.employeeId, content, { companyId: order.companyId });
    this.assertValid(prepared);
    this.assertCanWriteAfterCutoff(prepared.pastCutoff, actor, content.deliveryDate);
    this.assertAllergiesAcknowledged(prepared, dto.allergyAcknowledged ?? order.allergyAcknowledged);
    const status = prepared.pastCutoff ? OrderStatus.CONFIRMED : OrderStatus.PLACED;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, id, dto.version, {
        status, placedAt: now, confirmedAt: status === OrderStatus.CONFIRMED ? now : null, priceTierId: prepared.tier.id, totalCents: prepared.priced.totalCents,
        allergyAcknowledged: Boolean((dto.allergyAcknowledged ?? order.allergyAcknowledged) && prepared.priced.allergyConflicts.length),
      });
      await tx.orderLine.deleteMany({ where: { orderId: id } });
      await this.writeLines(tx, id, prepared.priced.lines);
      const repriced = prepared.priced.totalCents !== order.totalCents ? ` Re-priced at today's prices: ${formatCents(order.totalCents)} → ${formatCents(prepared.priced.totalCents)}.` : '';
      await this.addEvents(tx, id, actor.id, [
        [OrderEventType.PLACED, `Placed.${repriced}`],
        ...(status === OrderStatus.CONFIRMED ? [[OrderEventType.CONFIRMED, 'Placed after the cut-off by an admin: confirmed immediately and billable.'] as const] : []),
        ...(dto.allergyAcknowledged && !order.allergyAcknowledged ? this.allergyEvent(prepared, true) : []),
      ]);
    });
    return this.get(id, actor);
  }

  /** Before cut-off, drafts and placed orders can be cancelled; afterwards (or once confirmed) only by an admin. */
  async cancel(id: number, dto: ReasonDto, actor: AuthenticatedStaff) {
    const order = await this.findOrThrow(id);
    this.assertStatus(order.status, [OrderStatus.DRAFT, OrderStatus.PLACED, OrderStatus.CONFIRMED], 'cancelled');
    const locked = order.status === OrderStatus.CONFIRMED || (await this.isPastCutoff(fromDbDate(order.deliveryDate)));
    if (locked && !canOverride(actor)) throw new ForbiddenException('This order is past its cut-off; only an admin can cancel it now.');
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, id, dto.version, { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancellationReason: dto.reason ?? null });
      await this.addEvents(tx, id, actor.id, [[OrderEventType.CANCELLED, `Cancelled${locked ? ' by an admin after the cut-off' : ''}${dto.reason ? `: ${dto.reason}` : '.'}`]]);
      if (order.invoiceId) await issueCredit(tx, { orderId: id, kind: CreditKind.CANCELLED, reason: dto.reason ?? 'Order cancelled', actorId: actor.id }); // already invoiced: a full credit, the invoice lines stay as issued
    });
    return this.get(id, actor);
  }

  /** The kitchen can't fulfil it: never billable. */
  async reject(id: number, dto: RejectDto, actor: AuthenticatedStaff) {
    if (!canOverride(actor)) throw new ForbiddenException('Only an admin can reject orders.');
    const order = await this.findOrThrow(id);
    this.assertStatus(order.status, [OrderStatus.PLACED, OrderStatus.CONFIRMED], 'rejected');
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, id, dto.version, { status: OrderStatus.REJECTED, rejectedAt: new Date(), rejectionReason: dto.reason });
      await this.addEvents(tx, id, actor.id, [[OrderEventType.REJECTED, `Rejected: ${dto.reason}`]]);
      if (order.invoiceId) await issueCredit(tx, { orderId: id, kind: CreditKind.REJECTED, reason: dto.reason, actorId: actor.id });
    });
    return this.get(id, actor);
  }

  /** 4.6 admin override: delivery time, address or packaging after confirmation (ignores the employee's flags). */
  async overrideDelivery(id: number, dto: DeliveryOverrideDto, actor: AuthenticatedStaff) {
    if (!canOverride(actor)) throw new ForbiddenException('Only an admin can override delivery details.');
    const order = await this.findOrThrow(id, { address: true, packagingType: true });
    this.assertStatus(order.status, [OrderStatus.PLACED, OrderStatus.CONFIRMED], 'changed');
    const changes: string[] = [];
    const data: Prisma.OrderUncheckedUpdateInput = {};
    if (dto.deliveryTime !== undefined && dto.deliveryTime !== order.deliveryTime) {
      data.deliveryTime = dto.deliveryTime;
      changes.push(`time ${order.deliveryTime} → ${dto.deliveryTime}`);
    }
    if (dto.addressId !== undefined && dto.addressId !== order.addressId) {
      const address = await this.prisma.companyAddress.findFirst({ where: { id: dto.addressId, companyId: order.companyId, isActive: true } });
      if (!address) throw new BadRequestException("Choose one of the company's active addresses.");
      data.addressId = address.id;
      changes.push(`address ${order.address.label} → ${address.label}`);
    }
    if (dto.packagingTypeId !== undefined && dto.packagingTypeId !== order.packagingTypeId) {
      const packaging = dto.packagingTypeId === null ? null : await this.prisma.packagingType.findFirst({ where: { id: dto.packagingTypeId, isActive: true } });
      if (dto.packagingTypeId !== null && !packaging) throw new BadRequestException('Choose an active packaging type.');
      data.packagingTypeId = dto.packagingTypeId;
      changes.push(`packaging ${order.packagingType?.name ?? 'none'} → ${packaging?.name ?? 'none'}`);
    }
    if (!changes.length) throw new BadRequestException('Nothing to change.');
    await this.prisma.$transaction(async (tx) => {
      await this.bump(tx, id, dto.version, data);
      await this.addEvents(tx, id, actor.id, [[OrderEventType.DELIVERY_CHANGED, `Admin override: ${changes.join('; ')}.`]]);
    });
    return this.get(id, actor);
  }

  // ---------- Reads ----------

  async list(query: ListOrdersQueryDto) {
    await this.cutoff.processDue('lazy');
    const search = query.search?.replace(/^#/, '');
    const where: Prisma.OrderWhereInput = {
      ...(query.from || query.to ? { deliveryDate: { ...(query.from ? { gte: toDbDate(query.from) } : {}), ...(query.to ? { lte: toDbDate(query.to) } : {}) } } : {}),
      ...(query.status?.length ? { status: { in: query.status } } : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.invoiced === undefined ? {} : { invoiceId: query.invoiced === 'true' ? { not: null } : null }),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(search
        ? {
            OR: [
              ...(/^\d+$/.test(search) ? [{ id: Number(search) }] : []),
              { employee: { name: { contains: search, mode: 'insensitive' as const } } },
              { employee: { email: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: { employee: { select: { id: true, name: true } }, company: { select: { id: true, name: true } }, _count: { select: { lines: true } }, lines: { select: { quantity: true } } },
        orderBy: [{ deliveryDate: 'desc' }, { deliveryTime: 'asc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.order.count({ where }),
    ]);
    const items = rows.map(({ lines, _count, ...order }) => ({
      id: order.id, status: order.status, deliveryDate: fromDbDate(order.deliveryDate), deliveryTime: order.deliveryTime,
      totalCents: order.totalCents, employee: order.employee, company: order.company, placedAt: order.placedAt,
      lineCount: _count.lines, boxCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    }));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: number, actor: AuthenticatedStaff) {
    await this.cutoff.processDue('lazy');
    const order = await this.prisma.order.findUnique({ where: { id }, include: detailInclude });
    if (!order) throw new NotFoundException('Order not found.');
    const date = fromDbDate(order.deliveryDate);
    const calendar = await this.settings.calendar(date, date);
    const cutoffAt = cutoffFor(date, calendar, calendar);
    const pastCutoff = cutoffAt.toJSDate() <= new Date();
    const override = canOverride(actor);
    const open = order.status === OrderStatus.DRAFT || order.status === OrderStatus.PLACED;
    const settings = await this.settings.get();
    const plan = planFor(date, order.deliveryTime, order.company.dispatchLeadMinutes, settings.kitchenReadyBufferMinutes, settings.timezone);
    return {
      ...order,
      kitchen: { plannedDispatchReadyAt: plan.dispatchReadyAt, plannedKitchenReadyAt: plan.kitchenReadyAt, timing: order.status === OrderStatus.CONFIRMED ? timingOf(plan, order.kitchenReadyAt, new Date()) : null },
      deliveryDate: date,
      cutoffAt: cutoffAt.toISO(),
      pastCutoff,
      permissions: {
        edit: open && (!pastCutoff || override),
        place: order.status === OrderStatus.DRAFT && (!pastCutoff || override),
        cancel: (open && (!pastCutoff || override)) || (order.status === OrderStatus.CONFIRMED && override),
        reject: override && (order.status === OrderStatus.PLACED || order.status === OrderStatus.CONFIRMED),
        overrideDelivery: override && (order.status === OrderStatus.PLACED || order.status === OrderStatus.CONFIRMED),
      },
    };
  }

  // ---------- Helpers ----------

  private async findOrThrow<T extends Prisma.OrderInclude>(id: number, include?: T) {
    const order = await this.prisma.order.findUnique({ where: { id }, include });
    if (!order) throw new NotFoundException('Order not found.');
    return order as Prisma.OrderGetPayload<{ include: T }>;
  }

  private assertStatus(status: OrderStatus, allowed: OrderStatus[], action: string) {
    if (!allowed.includes(status)) throw new ConflictException(`A ${status.toLowerCase()} order cannot be ${action}.`);
  }

  private async isPastCutoff(date: string) {
    const calendar = await this.settings.calendar(date, date);
    return cutoffFor(date, calendar, calendar).toJSDate() <= new Date();
  }

  private async assertNoOtherActiveOrder(employeeId: number, date: string, exceptId?: number) {
    const other = await this.prisma.order.findFirst({
      where: { employeeId, deliveryDate: toDbDate(date), status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    });
    if (other) throw new ConflictException(`This employee already has order #${other.id} for ${date}. Edit that order instead.`);
  }

  /** Optimistic concurrency: the write only lands if nobody changed the order since the caller read it. */
  private async bump(tx: Tx, id: number, version: number, data: Prisma.OrderUncheckedUpdateManyInput) {
    const { count } = await tx.order.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
    if (!count) throw new ConflictException('Someone else changed this order a moment ago. Reload it and try again.');
  }

  private async writeLines(tx: Tx, orderId: number, lines: PricedLine[]) {
    for (const [index, line] of lines.entries()) {
      await tx.orderLine.create({
        data: {
          orderId, dishId: line.dishId, dishName: line.dishName, dishSku: line.dishSku, quantity: line.quantity,
          unitPriceCents: line.unitPriceCents, totalCents: line.totalCents, sortOrder: (index + 1) * 10,
          combinations: {
            create: line.combinations.map((combination) => ({
              signature: combination.signature, quantity: combination.quantity, unitPriceCents: combination.unitPriceCents, totalCents: combination.totalCents,
              choices: { create: combination.choices },
            })),
          },
        },
      });
    }
  }

  private allergyEvent(prepared: Awaited<ReturnType<OrdersService['prepare']>>, acknowledged?: boolean): (readonly [OrderEventType, string])[] {
    if (!prepared.priced.allergyConflicts.length || !acknowledged) return [];
    return [[OrderEventType.ALLERGY_ACKNOWLEDGED, `Contains ${prepared.priced.allergyConflicts.map((allergen) => allergen.name).join(', ')}, which ${prepared.employee.name} is allergic to; confirmed with the employee.`]];
  }

  private async addEvents(tx: Tx, orderId: number, actorId: number, events: (readonly [OrderEventType, string])[]) {
    if (events.length) await tx.orderEvent.createMany({ data: events.map(([type, message]) => ({ orderId, type, message, actorId })) });
  }
}
