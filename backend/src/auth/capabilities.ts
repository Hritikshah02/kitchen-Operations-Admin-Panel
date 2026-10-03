import type { RoleName } from './auth.types.js';

export enum Capability {
  COMPANIES_MANAGE = 'companies:manage',
  CATALOGUE_MANAGE = 'catalogue:manage',
  ORDERS_MANAGE = 'orders:manage',
  KITCHEN_BOARD_VIEW = 'kitchen-board:view',
  KITCHEN_BOARD_UPDATE = 'kitchen-board:update',
  DISPATCH_BOARD_VIEW = 'dispatch-board:view',
  DISPATCH_BOARD_UPDATE = 'dispatch-board:update',
  DRIVER_DROPS_VIEW = 'driver-drops:view',
  DRIVER_DROPS_UPDATE = 'driver-drops:update',
  DASHBOARD_VIEW = 'dashboard:view',
}

const allCapabilities = Object.values(Capability);

export const roleCapabilities: Readonly<Record<RoleName, readonly Capability[]>> = {
  ADMIN: allCapabilities,
  KITCHEN: [Capability.DASHBOARD_VIEW, Capability.KITCHEN_BOARD_VIEW, Capability.KITCHEN_BOARD_UPDATE],
  DISPATCH: [Capability.DASHBOARD_VIEW, Capability.DISPATCH_BOARD_VIEW, Capability.DISPATCH_BOARD_UPDATE],
  DRIVER: [Capability.DASHBOARD_VIEW, Capability.DRIVER_DROPS_VIEW, Capability.DRIVER_DROPS_UPDATE],
};

export function hasCapabilities(role: RoleName, required: readonly Capability[]): boolean {
  const granted = roleCapabilities[role] ?? [];
  return required.every((capability) => granted.includes(capability));
}
