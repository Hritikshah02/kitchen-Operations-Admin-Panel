import type { Request } from 'express';

export const ROLE_NAMES = ['ADMIN', 'KITCHEN', 'DISPATCH', 'DRIVER'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export type AuthenticatedStaff = {
  id: number;
  name: string;
  email: string;
  role: RoleName;
};

export type JwtPayload = {
  sub: number;
  email: string;
  role: RoleName;
};

export type AuthenticatedRequest = Request & { user: AuthenticatedStaff };
