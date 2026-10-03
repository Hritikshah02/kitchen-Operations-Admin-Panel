import { SetMetadata } from '@nestjs/common';
import type { Capability } from './capabilities.js';

export const REQUIRED_CAPABILITIES = 'requiredCapabilities';
export const RequireCapabilities = (...capabilities: Capability[]) =>
  SetMetadata(REQUIRED_CAPABILITIES, capabilities);
