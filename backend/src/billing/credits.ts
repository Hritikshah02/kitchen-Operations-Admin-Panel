import { ConflictException } from '@nestjs/common';
import { CreditKind, CreditStatus, InvoiceLineType, OrderEventType, Prisma } from '@prisma/client';
import { creditPlacement } from './invoice-rules.js';

type Tx = Prisma.TransactionClient;

/** Credit already netted off an order that has not been invoiced yet. */
export async function nettedCredit(tx: Tx, orderId: number) {
  const sum = await tx.orderCredit.aggregate({ where: { orderId, status: CreditStatus.APPLIED, appliedInvoiceId: null }, _sum: { amountCents: true } });
  return sum._sum.amountCents ?? 0;
}

/** What is still creditable on an order: its invoiced line (or its total, if not invoiced) less credits already taken. */
async function creditable(tx: Tx, order: { id: number; totalCents: number; invoiceId: number | null }) {
  if (!order.invoiceId) return Math.max(0, order.totalCents - (await nettedCredit(tx, order.id)));
  const line = await tx.invoiceLine.findFirst({ where: { invoiceId: order.invoiceId, orderId: order.id, type: InvoiceLineType.ORDER } });
  const taken = await tx.orderCredit.aggregate({ where: { orderId: order.id, sourceInvoiceId: order.invoiceId, status: { not: CreditStatus.DISCARDED } }, _sum: { amountCents: true } });
  return Math.max(0, (line?.amountCents ?? 0) - (taken._sum.amountCents ?? 0));
}

/**
 * Issues a credit for an order. The original invoice lines are never edited: on an unpaid invoice the credit is
 * added as its own negative line, on a paid one it stays open and is carried onto the company's next invoice,
 * and for an order not invoiced yet it is netted off the amount that will be invoiced.
 */
export async function issueCredit(tx: Tx, input: { orderId: number; kind: CreditKind; amountCents?: number; reason: string; actorId: number; description?: string }) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
  const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, select: { id: true, companyId: true, totalCents: true, invoiceId: true } });
  const available = await creditable(tx, order);
  const amountCents = input.amountCents ?? available; // cancelled and rejected orders: credit whatever is left
  if (amountCents <= 0) return null;
  if (amountCents > available) throw new ConflictException(`Only ${(available / 100).toFixed(2)} of this order can still be credited.`);

  const invoice = order.invoiceId ? await tx.invoice.findUniqueOrThrow({ where: { id: order.invoiceId } }) : null;
  const placement = invoice ? creditPlacement(invoice.status) : null;
  const credit = await tx.orderCredit.create({
    data: {
      companyId: order.companyId, orderId: order.id, kind: input.kind, amountCents, reason: input.reason, createdById: input.actorId,
      sourceInvoiceId: invoice?.id ?? null,
      status: placement === 'CARRY_FORWARD' ? CreditStatus.OPEN : CreditStatus.APPLIED,
      appliedInvoiceId: placement === 'APPLY_TO_INVOICE' ? invoice!.id : null,
    },
  });
  if (invoice && placement === 'APPLY_TO_INVOICE') await addCreditLine(tx, invoice.id, credit.id, order.id, amountCents, input.description ?? input.reason);
  const where = invoice ? (placement === 'APPLY_TO_INVOICE' ? `taken off ${invoice.number}` : `carried forward (${invoice.number} is paid)`) : 'netted off the order before invoicing';
  await tx.orderEvent.create({ data: { orderId: order.id, type: OrderEventType.CREDITED, actorId: input.actorId, message: `Credit of $${(amountCents / 100).toFixed(2)} (${input.reason}): ${where}.` } });
  return credit;
}

export async function addCreditLine(tx: Tx, invoiceId: number, creditId: number, orderId: number | null, amountCents: number, description: string) {
  const last = await tx.invoiceLine.aggregate({ where: { invoiceId }, _max: { sortOrder: true } });
  await tx.invoiceLine.create({ data: { invoiceId, type: InvoiceLineType.CREDIT, orderId, creditId, description: `Credit: ${description}`, amountCents: -amountCents, sortOrder: (last._max.sortOrder ?? 0) + 10 } });
  await tx.invoice.update({ where: { id: invoiceId }, data: { totalCents: { decrement: amountCents } } });
}
