import type { Request } from 'express';
import type { Capability } from './capabilities.js';

export type AuthenticatedStaff = {
  id: number;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  capabilities: Capability[];
};

// Role and capabilities are deliberately not in the token: they are re-read on every request,
// so a role change or deactivation takes effect immediately.
export type JwtPayload = {
  sub: number;
  email: string;
};

export type AuthenticatedRequest = Request & { user: AuthenticatedStaff };
