import { OrderEventType, OrderStatus, type Prisma } from '@prisma/client';

const OPEN: OrderStatus[] = [OrderStatus.DRAFT, OrderStatus.PLACED];

/**
 * Cancels draft/placed orders because of something done to the employee or company (a move, a deactivation).
 * Same bookkeeping as a staff cancellation: cancelled time and reason, version bump (so a stale edit is refused),
 * and a timeline event. The status guard leaves alone an order that cut-off processing confirmed in the meantime.
 */
export async function cancelOpenOrders(tx: Prisma.TransactionClient, orderIds: number[], reason: string) {
  if (!orderIds.length) return 0;
  const open = await tx.order.findMany({ where: { id: { in: orderIds }, status: { in: OPEN } }, select: { id: true } });
  if (!open.length) return 0;
  await tx.order.updateMany({
    where: { id: { in: open.map((order) => order.id) }, status: { in: OPEN } },
    data: { status: OrderStatus.CANCELLED, cancelledAt: new Date(), cancellationReason: reason, version: { increment: 1 } },
  });
  await tx.orderEvent.createMany({ data: open.map((order) => ({ orderId: order.id, type: OrderEventType.CANCELLED, message: `Cancelled automatically: ${reason}.`, actorId: null })) });
  return open.length;
}
