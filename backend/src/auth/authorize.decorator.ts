import { applyDecorators, UseGuards } from '@nestjs/common';
import type { Capability } from './capabilities.js';
import { CapabilitiesGuard } from './capabilities.guard.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RequireCapabilities } from './require-capabilities.decorator.js';

/** Requires a signed-in staff member holding every listed capability (none = any signed-in staff). */
export const Authorize = (...capabilities: Capability[]) =>
  applyDecorators(UseGuards(JwtAuthGuard, CapabilitiesGuard), RequireCapabilities(...capabilities));
