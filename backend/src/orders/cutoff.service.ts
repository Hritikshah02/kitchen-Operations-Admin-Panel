import { BadRequestException, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { OrderEventType, OrderStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDays, cutoffFor, fromDbDate, toDbDate, type IsoDate } from '../settings/kitchen-calendar.js';
import { SettingsService } from '../settings/settings.service.js';

const OPEN = [OrderStatus.DRAFT, OrderStatus.PLACED];
const SCHEDULE_MS = 60_000;
const LAZY_THROTTLE_MS = 30_000;

/**
 * Cut-off processing (4.6): when a delivery date's cut-off passes, drafts are cancelled and placed orders
 * are confirmed (and become billable). Runs every minute while the server is up, catches up on boot
 * (the free Render instance sleeps), before order reads, and on demand for a past cut-off.
 * Safe to run any number of times: a per-date advisory lock serialises runs, and only still-open orders change.
 */
@Injectable()
export class CutoffService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CutoffService.name);
  private timer?: NodeJS.Timeout;
  private lastDueCheck = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    void this.processDue('scheduler');
    this.timer = setInterval(() => void this.processDue('scheduler'), SCHEDULE_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Processes every delivery date whose cut-off has passed and that still has open orders. */
  async processDue(trigger: 'scheduler' | 'lazy' = 'lazy', now = new Date()) {
    if (trigger === 'lazy' && Date.now() - this.lastDueCheck < LAZY_THROTTLE_MS) return [];
    this.lastDueCheck = Date.now();
    try {
      const dates = await this.prisma.order.groupBy({ by: ['deliveryDate'], where: { status: { in: OPEN } } });
      if (!dates.length) return [];
      const isoDates = dates.map((entry) => fromDbDate(entry.deliveryDate)).sort();
      const calendar = await this.settings.calendar(isoDates[0], isoDates[isoDates.length - 1]);
      const due = isoDates.filter((date) => cutoffFor(date, calendar, calendar).toJSDate() <= now);
      const results = [];
      for (const date of due) results.push(await this.processDate(date, trigger === 'lazy' ? 'scheduler' : trigger));
      return results;
    } catch (error) {
      this.logger.error(`Cut-off processing failed: ${(error as Error).message}`);
      return [];
    }
  }

  /** Manual trigger for a past cut-off, so a reviewer can try it without waiting. */
  async runManually(date: IsoDate, actorId: number, now = new Date()) {
    const calendar = await this.settings.calendar(date, date);
    const cutoff = cutoffFor(date, calendar, calendar);
    if (cutoff.toJSDate() > now) {
      throw new BadRequestException(`The cut-off for ${date} is ${cutoff.toFormat('ccc d LLL, HH:mm')}; it can only be processed after that.`);
    }
    return this.processDate(date, 'manual', actorId);
  }

  async processDate(date: IsoDate, trigger: 'scheduler' | 'manual', actorId?: number) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cutoff:${date}`}))`;
      const open = await tx.order.findMany({ where: { deliveryDate: toDbDate(date), status: { in: OPEN } }, select: { id: true, status: true } });
      const drafts = open.filter((order) => order.status === OrderStatus.DRAFT).map((order) => order.id);
      const placed = open.filter((order) => order.status === OrderStatus.PLACED).map((order) => order.id);
      const now = new Date();
      if (drafts.length) {
        await tx.order.updateMany({
          where: { id: { in: drafts }, status: OrderStatus.DRAFT },
          data: { status: OrderStatus.CANCELLED, cancelledAt: now, cancellationReason: 'Still a draft when the cut-off passed', version: { increment: 1 } },
        });
      }
      if (placed.length) {
        await tx.order.updateMany({ where: { id: { in: placed }, status: OrderStatus.PLACED }, data: { status: OrderStatus.CONFIRMED, confirmedAt: now, version: { increment: 1 } } });
      }
      const how = trigger === 'manual' ? 'Cut-off processed manually' : 'Cut-off passed';
      await tx.orderEvent.createMany({
        data: [
          ...drafts.map((orderId) => ({ orderId, type: OrderEventType.CANCELLED, message: `${how}: draft cancelled.`, actorId: actorId ?? null })),
          ...placed.map((orderId) => ({ orderId, type: OrderEventType.CONFIRMED, message: `${how}: confirmed and billable to the company.`, actorId: actorId ?? null })),
        ],
      });
      await tx.cutoffRun.create({ data: { deliveryDate: toDbDate(date), trigger, actorId: actorId ?? null, confirmedCount: placed.length, cancelledCount: drafts.length } });
      if (open.length) this.logger.log(`Cut-off ${date} (${trigger}): ${placed.length} confirmed, ${drafts.length} drafts cancelled.`);
      return { deliveryDate: date, confirmed: placed.length, cancelled: drafts.length };
    });
  }

  /** Recent and upcoming delivery dates with their cut-off and how many orders are still open. */
  async overview(now = new Date()) {
    const settings = await this.settings.get();
    const from = addDays(settings.today, -7);
    const to = addDays(settings.today, 14);
    const calendar = await this.settings.calendar(from, to);
    const [counts, runs] = await Promise.all([
      this.prisma.order.groupBy({ by: ['deliveryDate', 'status'], where: { deliveryDate: { gte: toDbDate(from), lte: toDbDate(to) } }, _count: { _all: true } }),
      this.prisma.cutoffRun.findMany({ where: { deliveryDate: { gte: toDbDate(from), lte: toDbDate(to) } }, orderBy: { ranAt: 'desc' } }),
    ]);
    const dates = [...new Set(counts.map((entry) => fromDbDate(entry.deliveryDate)))].sort();
    return dates.map((date) => {
      const cutoff = cutoffFor(date, calendar, calendar);
      const count = (status: OrderStatus) => counts.find((entry) => fromDbDate(entry.deliveryDate) === date && entry.status === status)?._count._all ?? 0;
      const lastRun = runs.find((run) => fromDbDate(run.deliveryDate) === date);
      return {
        deliveryDate: date,
        weekday: DateTime.fromISO(date).toFormat('cccc'),
        cutoffAt: cutoff.toISO(),
        cutoffPassed: cutoff.toJSDate() <= now,
        draft: count(OrderStatus.DRAFT),
        placed: count(OrderStatus.PLACED),
        confirmed: count(OrderStatus.CONFIRMED),
        delivered: count(OrderStatus.DELIVERED),
        cancelled: count(OrderStatus.CANCELLED),
        rejected: count(OrderStatus.REJECTED),
        lastRun: lastRun ? { ranAt: lastRun.ranAt, trigger: lastRun.trigger, confirmed: lastRun.confirmedCount, cancelled: lastRun.cancelledCount } : null,
      };
    });
  }
}
