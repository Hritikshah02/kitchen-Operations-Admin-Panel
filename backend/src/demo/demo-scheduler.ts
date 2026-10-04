import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { DemoOrdersService } from './demo-orders.service.js';

const FIRST_RUN_MS = 15_000; // after start-up, so a cold start isn't slowed down
const EVERY_MS = 30 * 60_000;

/**
 * Keeps the live demo fresh without anyone calling anything: when the API starts (including when it wakes up for a
 * reviewer) and every 30 minutes while it is awake, the demo data is topped up for "today" and the days around it
 * and today's kitchen and dispatch progress moves along with the clock. Only runs where DEMO_AUTO_REFRESH=true,
 * so local development and tests are untouched.
 */
@Injectable()
export class DemoScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DemoScheduler.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(private readonly demo: DemoOrdersService) {}

  onApplicationBootstrap() {
    if (process.env.DEMO_AUTO_REFRESH !== 'true') return;
    this.timers.push(setTimeout(() => void this.run(), FIRST_RUN_MS), setInterval(() => void this.run(), EVERY_MS));
  }

  onModuleDestroy() {
    this.timers.forEach((timer) => clearTimeout(timer));
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      await this.demo.ensure();
    } catch (error) {
      this.logger.error(`Demo refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
