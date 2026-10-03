// Capabilities are the only thing code checks. Roles are database rows that bundle capabilities,
// so a new role is a new row (see prisma/seed.js), never a new branch in the code.
export enum Capability {
  DASHBOARD_VIEW = 'dashboard:view',
  STAFF_MANAGE = 'staff:manage',
  SETTINGS_MANAGE = 'settings:manage',
  REFERENCE_DATA_MANAGE = 'reference-data:manage',
  COMPANIES_MANAGE = 'companies:manage',
  CATALOGUE_MANAGE = 'catalogue:manage',
  ORDERS_MANAGE = 'orders:manage',
  KITCHEN_BOARD_VIEW = 'kitchen-board:view',
  KITCHEN_BOARD_UPDATE = 'kitchen-board:update',
  DISPATCH_BOARD_VIEW = 'dispatch-board:view',
  DISPATCH_BOARD_UPDATE = 'dispatch-board:update',
  DRIVER_DROPS_VIEW = 'driver-drops:view',
  DRIVER_DROPS_UPDATE = 'driver-drops:update',
}

export const ALL_CAPABILITIES: readonly Capability[] = Object.values(Capability);
const known = new Set<string>(ALL_CAPABILITIES);

/** Drops values the code no longer knows, so a stale row can never grant something unexpected. */
export function parseCapabilities(values: readonly string[]): Capability[] {
  return values.filter((value): value is Capability => known.has(value));
}

export function hasCapabilities(granted: readonly Capability[], required: readonly Capability[]): boolean {
  return required.every((capability) => granted.includes(capability));
}
