import { Controller, ForbiddenException, Headers, NotFoundException, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import { DemoOrdersService } from './demo-orders.service.js';

/**
 * Keeps the live demo realistic as days pass: a daily scheduled job (GitHub Actions) calls this to finish past
 * days' work and generate orders around the new "today". Guarded by a shared secret; the route does not exist
 * unless DEMO_REFRESH_TOKEN is set. It is idempotent, so extra calls change nothing.
 */
@Controller('demo')
@SkipThrottle()
export class DemoController {
  constructor(private readonly demo: DemoOrdersService) {}

  @Post('refresh')
  async refresh(@Headers('x-demo-token') token?: string) {
    const expected = process.env.DEMO_REFRESH_TOKEN;
    if (!expected) throw new NotFoundException();
    const given = Buffer.from(token ?? '');
    const wanted = Buffer.from(expected);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) throw new ForbiddenException('Invalid demo token.');
    return this.demo.ensure();
  }
}
