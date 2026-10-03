// Mirrors backend/src/auth/capabilities.ts. The UI only hides what the server already forbids.
export const Capability = {
  DASHBOARD_VIEW: "dashboard:view",
  STAFF_MANAGE: "staff:manage",
  SETTINGS_MANAGE: "settings:manage",
  REFERENCE_DATA_MANAGE: "reference-data:manage",
  COMPANIES_MANAGE: "companies:manage",
  CATALOGUE_MANAGE: "catalogue:manage",
  ORDERS_MANAGE: "orders:manage",
  ORDERS_OVERRIDE: "orders:override",
  KITCHEN_BOARD_VIEW: "kitchen-board:view",
  KITCHEN_BOARD_UPDATE: "kitchen-board:update",
  DISPATCH_BOARD_VIEW: "dispatch-board:view",
  DISPATCH_BOARD_UPDATE: "dispatch-board:update",
  DRIVER_DROPS_VIEW: "driver-drops:view",
  DRIVER_DROPS_UPDATE: "driver-drops:update",
} as const;
export type Capability = (typeof Capability)[keyof typeof Capability];
