import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Sign-in attempts are limited per account (the email), so spreading them over many addresses or forging
 * X-Forwarded-For doesn't help an attacker, and a shared office IP can't lock everyone out. Everything else is
 * limited per client IP.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const body = req.body as { email?: unknown } | undefined;
    const path = typeof req.path === 'string' ? req.path : '';
    if (path.endsWith('/auth/login') && typeof body?.email === 'string') return `login:${body.email.trim().toLowerCase()}`;
    return String(req.ip ?? '');
  }
}
