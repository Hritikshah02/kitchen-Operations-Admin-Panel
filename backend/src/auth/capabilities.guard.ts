import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasCapabilities, type Capability } from './capabilities.js';
import { REQUIRED_CAPABILITIES } from './require-capabilities.decorator.js';
import type { AuthenticatedRequest } from './auth.types.js';

@Injectable()
export class CapabilitiesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Capability[]>(REQUIRED_CAPABILITIES, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user || !hasCapabilities(request.user.capabilities, required)) {
      throw new ForbiddenException('You do not have access to this resource.');
    }

    return true;
  }
}
