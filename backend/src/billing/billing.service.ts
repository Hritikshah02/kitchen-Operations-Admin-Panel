import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreditKind, CreditStatus, InvoiceLineType, InvoiceStatus, OrderEventType, OrderStatus, Prisma } from '@prisma/client';
import type { AuthenticatedStaff } from '../auth/auth.types.js';
import { pageArgs } from '../common/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { fromDbDate, toDbDate } from '../settings/kitchen-calendar.js';
import type { CreateInvoiceDto, InvoiceListQueryDto, ShortDeliveryDto, UninvoicedQueryDto } from './billing.dto.js';
import { addCreditLine, issueCredit, nettedCredit } from './credits.js';
import { applyCredits, billableAmount, creditedQuantities, formatInvoiceNumber, shortDeliveryCredit } from './invoice-rules.js';

const BILLABLE: OrderStatus[] = [OrderStatus.CONFIRMED, OrderStatus.DELIVERED]; // 4.9: every confirmed order is owed in full

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Per company: what is waiting to be invoiced, credits owed back, and unpaid invoices. */
  async companies() {
    const [companies, uninvoiced, netted, credits, unpaid] = await Promise.all([
      this.prisma.company.findMany({ select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.order.groupBy({ by: ['companyId'], where: { invoiceId: null, status: { in: BILLABLE } }, _count: true, _sum: { totalCents: true } }),
      this.prisma.orderCredit.groupBy({ by: ['companyId'], where: { status: CreditStatus.APPLIED, appliedInvoiceId: null, order: { invoiceId: null, status: { in: BILLABLE } } }, _sum: { amountCents: true } }),
      this.prisma.orderCredit.groupBy({ by: ['companyId'], where: { status: CreditStatus.OPEN }, _count: true, _sum: { amountCents: true } }),
      this.prisma.invoice.groupBy({ by: ['companyId'], where: { status: InvoiceStatus.UNPAID }, _count: true, _sum: { totalCents: true } }),
    ]);
    const by = <T extends { companyId: number }>(rows: T[]) => new Map(rows.map((row) => [row.companyId, row]));
    const [u, n, c, p] = [by(uninvoiced), by(netted), by(credits), by(unpaid)];
    return companies.map((company) => ({
      ...company,
      uninvoicedOrders: u.get(company.id)?._count ?? 0,
      uninvoicedCents: (u.get(company.id)?._sum.totalCents ?? 0) - (n.get(company.id)?._sum.amountCents ?? 0),
      openCreditCents: c.get(company.id)?._sum.amountCents ?? 0, openCredits: c.get(company.id)?._count ?? 0,
      unpaidInvoices: p.get(company.id)?._count ?? 0, unpaidCents: p.get(company.id)?._sum.totalCents ?? 0,
    }));
  }

  /** Every confirmed order of a company not yet on an invoice. */
  async uninvoiced(companyId: number, query: UninvoicedQueryDto) {
    await this.company(companyId);
    const where: Prisma.OrderWhereInput = {
      companyId, invoiceId: null, status: { in: BILLABLE },
      ...(query.from || query.to ? { deliveryDate: { ...(query.from ? { gte: toDbDate(query.from) } : {}), ...(query.to ? { lte: toDbDate(query.to) } : {}) } } : {}),
    };
    const [rows, total, sum] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, include: { employee: { select: { name: true } }, credits: { where: { status: CreditStatus.APPLIED, appliedInvoiceId: null }, select: { amountCents: true } } }, orderBy: [{ deliveryDate: 'asc' }, { id: 'asc' }], ...pageArgs(query) }),
      this.prisma.order.count({ where }),
      this.prisma.order.aggregate({ where, _sum: { totalCents: true } }),
    ]);
    const items = rows.map((order) => {
      const credited = order.credits.reduce((acc, credit) => acc + credit.amountCents, 0);
      return { id: order.id, deliveryDate: fromDbDate(order.deliveryDate), employee: order.employee.name, status: order.status, totalCents: order.totalCents, creditedCents: credited, amountCents: billableAmount(order.totalCents, credited) };
    });
    const credits = await this.prisma.orderCredit.findMany({ where: { companyId, status: CreditStatus.OPEN }, include: { order: { select: { id: true } } }, orderBy: { id: 'asc' } });
    return { items, total, page: query.page, pageSize: query.pageSize, allMatchingCents: sum._sum.totalCents ?? 0, openCredits: credits.map((credit) => ({ id: credit.id, orderId: credit.orderId, amountCents: credit.amountCents, kind: credit.kind, reason: credit.reason })) };
  }

  async createInvoice(dto: CreateInvoiceDto, actor: AuthenticatedStaff) {
    await this.company(dto.companyId);
    const orderIds = [...new Set(dto.orderIds)].sort((a, b) => a - b);
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id IN (${Prisma.join(orderIds)}) ORDER BY id FOR UPDATE`;
      const orders = await tx.order.findMany({ where: { id: { in: orderIds } }, include: { employee: { select: { name: true } } }, orderBy: { id: 'asc' } });
      const problems: string[] = [];
      for (const orderId of orderIds) {
        const order = orders.find((entry) => entry.id === orderId);
        if (!order) problems.push(`#${orderId} does not exist`);
        else if (order.companyId !== dto.companyId) problems.push(`#${orderId} belongs to another company`);
        else if (order.invoiceId) problems.push(`#${orderId} is already on an invoice`);
        else if (!BILLABLE.includes(order.status)) problems.push(`#${orderId} is ${order.status.toLowerCase()}, not billable`);
      }
      if (problems.length) throw new ConflictException(`These orders can't be invoiced: ${problems.join('; ')}. Reload the list.`);

      const lines: { orderId: number; description: string; amountCents: number }[] = [];
      for (const order of orders) {
        const amountCents = billableAmount(order.totalCents, await nettedCredit(tx, order.id));
        lines.push({ orderId: order.id, amountCents, description: `Order #${order.id} · ${order.employee.name} · ${fromDbDate(order.deliveryDate)}` });
      }
      const subtotal = lines.reduce((sum, line) => sum + line.amountCents, 0);
      const open = await tx.orderCredit.findMany({ where: { companyId: dto.companyId, status: CreditStatus.OPEN }, orderBy: { id: 'asc' } });
      const { applied } = applyCredits(subtotal, open.map((credit) => ({ id: credit.id, amountCents: credit.amountCents })));

      const invoice = await tx.invoice.create({ data: { number: `PENDING-${Date.now()}-${Math.random().toString(36).slice(2)}`, companyId: dto.companyId, totalCents: subtotal, notes: dto.notes ?? null, createdById: actor.id } });
      await tx.invoice.update({ where: { id: invoice.id }, data: { number: formatInvoiceNumber(invoice.id) } });
      await tx.invoiceLine.createMany({ data: lines.map((line, index) => ({ invoiceId: invoice.id, type: InvoiceLineType.ORDER, orderId: line.orderId, description: line.description, amountCents: line.amountCents, sortOrder: (index + 1) * 10 })) });
      await tx.order.updateMany({ where: { id: { in: orderIds } }, data: { invoiceId: invoice.id } });
      for (const credit of applied) {
        const source = open.find((entry) => entry.id === credit.id)!;
        await tx.orderCredit.update({ where: { id: credit.id }, data: { status: CreditStatus.APPLIED, appliedInvoiceId: invoice.id } });
        await addCreditLine(tx, invoice.id, credit.id, source.orderId, credit.amountCents, `${source.reason} (order #${source.orderId}, carried forward)`);
      }
      await tx.orderEvent.createMany({ data: orderIds.map((orderId) => ({ orderId, type: OrderEventType.INVOICED, message: `Added to invoice ${formatInvoiceNumber(invoice.id)}.`, actorId: actor.id })) });
      return invoice.id;
    });
    return this.get(id);
  }

  async list(query: InvoiceListQueryDto) {
    const where: Prisma.InvoiceWhereInput = { ...(query.companyId ? { companyId: query.companyId } : {}), ...(query.status ? { status: query.status } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({ where, include: { company: { select: { id: true, name: true } }, _count: { select: { lines: true } } }, orderBy: { id: 'desc' }, ...pageArgs(query) }),
      this.prisma.invoice.count({ where }),
    ]);
    return { items: items.map(({ _count, ...invoice }) => ({ ...invoice, lineCount: _count.lines })), total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: number) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { company: { select: { id: true, name: true, billingContactName: true, billingContactEmail: true } }, lines: { orderBy: { sortOrder: 'asc' } }, createdBy: { select: { name: true } }, paidBy: { select: { name: true } }, voidedBy: { select: { name: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    return { ...invoice, linesTotalCents: invoice.lines.reduce((sum, line) => sum + line.amountCents, 0) };
  }

  async pay(id: number, actor: AuthenticatedStaff) {
    const { count } = await this.prisma.invoice.updateMany({ where: { id, status: InvoiceStatus.UNPAID }, data: { status: InvoiceStatus.PAID, paidAt: new Date(), paidById: actor.id } });
    if (!count) {
      const current = await this.get(id);
      throw new ConflictException(`This invoice is already ${current.status.toLowerCase()}.`);
    }
    return this.get(id);
  }

  /** Unpaid invoices only. Releases the orders; credits that were on it go back to where they belong. */
  async voidInvoice(id: number, reason: string, actor: AuthenticatedStaff) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
      const invoice = await tx.invoice.findUnique({ where: { id } });
      if (!invoice) throw new NotFoundException('Invoice not found.');
      if (invoice.status === InvoiceStatus.PAID) throw new ConflictException('A paid invoice is final and can’t be voided. Issue a credit instead.');
      if (invoice.status === InvoiceStatus.VOID) throw new ConflictException('This invoice is already void.');
      const orders = await tx.order.findMany({ where: { invoiceId: id }, select: { id: true } });
      await tx.$queryRaw`SELECT id FROM "Order" WHERE "invoiceId" = ${id} ORDER BY id FOR UPDATE`;
      await tx.invoice.update({ where: { id }, data: { status: InvoiceStatus.VOID, voidedAt: new Date(), voidReason: reason, voidedById: actor.id } });
      await tx.order.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
      const applied = await tx.orderCredit.findMany({ where: { appliedInvoiceId: id }, include: { order: { select: { status: true } } } });
      for (const credit of applied) {
        const stillBillable = BILLABLE.includes(credit.order.status);
        // A credit carried from another invoice goes back to the company; one raised on this invoice's own order is dropped
        // if that order is no longer billable, otherwise netted off the order so it is invoiced correctly next time.
        const data = credit.sourceInvoiceId !== id ? { status: CreditStatus.OPEN } : !stillBillable ? { status: CreditStatus.DISCARDED } : { status: CreditStatus.APPLIED };
        await tx.orderCredit.update({ where: { id: credit.id }, data: { ...data, appliedInvoiceId: null } });
      }
      await tx.orderEvent.createMany({ data: orders.map((order) => ({ orderId: order.id, type: OrderEventType.INVOICED, message: `Invoice ${invoice.number} was voided (${reason}); the order can be invoiced again.`, actorId: actor.id })) });
    });
    return this.get(id);
  }

  /** A delivered order that turned out short: a partial credit for the missing items. */
  async shortDelivery(orderId: number, dto: ShortDeliveryDto, actor: AuthenticatedStaff) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { lines: { include: { combinations: { include: { choices: true } } } } } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status !== OrderStatus.DELIVERED) throw new ConflictException('Only a delivered order can be short; cancel or reject it otherwise.');
    const taken = creditedQuantities(await this.prisma.orderCredit.findMany({ where: { orderId, kind: CreditKind.SHORT_DELIVERY, status: { not: CreditStatus.DISCARDED } }, select: { items: true } }));
    const combinations = order.lines.flatMap((line) => line.combinations.map((combination) => ({
      id: combination.id, quantity: combination.quantity - (taken.get(combination.id) ?? 0), unitPriceCents: combination.unitPriceCents,
      label: `${line.dishName}${combination.choices.length ? ` (${combination.choices.map((choice) => choice.optionName).join(', ')})` : ''}`,
    })));
    const missing = dto.items.filter((item) => item.missingQuantity > 0);
    const credit = shortDeliveryCredit(combinations, missing);
    if (credit.errors.length) throw new BadRequestException(credit.errors.join(' '));
    await this.prisma.$transaction((tx) => issueCredit(tx, { orderId, kind: CreditKind.SHORT_DELIVERY, amountCents: credit.amountCents, reason: dto.reason, description: `${credit.description} (order #${orderId}, short delivery: ${dto.reason})`, items: missing.map((item) => ({ combinationId: item.combinationId, quantity: item.missingQuantity })), actorId: actor.id }));
    return { orderId, creditedCents: credit.amountCents };
  }

  private async company(id: number) {
    const company = await this.prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!company) throw new NotFoundException('Company not found.');
  }
}
