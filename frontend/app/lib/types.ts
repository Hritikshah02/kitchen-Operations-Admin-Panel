// Response shapes of the companies/employees API, shared by the pages that use them.
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export type Option = { id: number; name: string };

export type CompanySummary = {
  id: number; name: string; isActive: boolean; defaultDeliveryTime: string; domains: string[];
  owner: Option | null; defaultAddress: { label: string; area: string | null } | null; activeEmployees: number;
};

export type Address = { id: number; label: string; line1: string; line2: string | null; area: string | null; city: string; pincode: string; isDefault: boolean; isActive: boolean };

export type CompanyDetail = {
  id: number; name: string; isActive: boolean;
  billingContactName: string; billingContactEmail: string; billingContactPhone: string | null;
  workingDays: number[]; defaultDeliveryTime: string; deliveryWindowStart: string; deliveryWindowEnd: string; dispatchLeadMinutes: number;
  defaultPackagingTypeId: number | null; defaultDriverId: number | null; driverInstructions: string | null;
  domains: { id: number; domain: string }[]; addresses: Address[]; holidays: { id: number; date: string; name: string }[];
  owner: { id: number; name: string; email: string } | null; defaultDriver: (Option & { isActive: boolean }) | null;
  defaultPackagingType: (Option & { isActive: boolean }) | null; priceTierId: number | null; priceTier: Option | null; activeEmployees: number; updatedAt: string; cancelledOrders?: number; lockedOrdersKept?: number;
};

export type Employee = {
  id: number; name: string; email: string; phone: string | null; isActive: boolean; isOwner: boolean; updatedAt: string;
  canChooseAddress: boolean; canChangeDeliveryTime: boolean; canChangePackaging: boolean;
  company: Option & { isActive: boolean }; allergens: Option[]; dietaryTags: Option[];
};

export type Dish = {
  id: number; sku: string; name: string; description: string; imageUrl: string | null; temperature: "HOT" | "COLD";
  costCents: number; minOrderQty: number; isActive: boolean; station: Option | null; stationId: number | null;
  allergens: Option[]; dietaryTags: Option[]; updatedAt: string;
  optionGroups: { id: number; name: string; required: boolean; minSelect: number; maxSelect: number; usesPortions: boolean; isActive: boolean }[];
};

export type CatalogueOption = {
  id: number; name: string; costCents: number; isActive: boolean; allergens: Option[]; dietaryTags: Option[];
  surcharges: { portionSizeId: number; surchargeCents: number; portionSize: Option }[]; groups: Option[];
};

export type OptionGroup = {
  id: number; name: string; minSelect: number; maxSelect: number; required: boolean; usesPortions: boolean; isActive: boolean;
  options: { id: number; name: string; costCents: number; isActive: boolean }[]; portionSizes: Option[]; dishCount: number;
};

export type PriceRule = "MANUAL" | "COST_MULTIPLIER" | "TIER_PERCENT";
export type PriceTier = {
  id: number; name: string; isDefault: boolean; rule: PriceRule; ruleValueBps: number | null; baseTierId: number | null;
  baseTier: Option | null; companyCount: number; unpricedDishes: number; unpricedOptions: number;
};
export type PriceSource = "manual" | "override" | "derived" | "unavailable" | "missing";
export type GridRow = {
  id: number; name: string; sku: string | null; costCents: number; typedCents: number | null; isUnavailable: boolean;
  derivedCents: number | null; priceCents: number | null; source: PriceSource;
};

export const describeRule = (tier: Pick<PriceTier, "rule" | "ruleValueBps" | "baseTier">) => {
  if (tier.rule === "MANUAL" || tier.ruleValueBps === null) return "Prices typed in";
  if (tier.rule === "COST_MULTIPLIER") return `Cost × ${(tier.ruleValueBps / 10000).toString()}`;
  const percent = tier.ruleValueBps / 100;
  return `${tier.baseTier?.name ?? "Base"} ${percent >= 0 ? "+" : "−"} ${Math.abs(percent)}%`;
};

export type MenuCategory = {
  id: number; name: string; description: string | null; sortOrder: number; isActive: boolean; isSecret: boolean; hiddenForCompanies: number;
  items: { id: number; dishId: number; sortOrder: number; isActive: boolean; dish: { id: number; sku: string; name: string; isActive: boolean } }[];
};

export type MenuOptionView = { id: number; name: string; priceCents: number; surcharges: Record<string, number>; allergens: Option[]; dietaryTags: Option[]; allergyConflicts: Option[] };
export type MenuGroupView = { id: number; name: string; required: boolean; minSelect: number; maxSelect: number; usesPortions: boolean; sizes: Option[]; options: MenuOptionView[] };
export type MenuDishView = {
  id: number; sku: string; name: string; description: string; imageUrl: string | null; temperature: string; minOrderQty: number;
  priceCents: number; allergens: Option[]; dietaryTags: Option[]; allergyConflicts: Option[]; groups: MenuGroupView[];
};
export type EmployeeMenu = {
  employee: { id: number; name: string; email: string; allergens: Option[]; dietaryTags: Option[] };
  company: { id: number; name: string; isActive: boolean }; tier: Option;
  categories: { id: number; name: string; description: string | null; items: MenuDishView[] }[];
  searchResults: MenuDishView[]; excluded: { dishId: number; name: string; category: string; reason: string }[];
};

export type OrderStatus = "DRAFT" | "PLACED" | "CONFIRMED" | "DELIVERED" | "CANCELLED" | "REJECTED";
export const ORDER_STATUSES: OrderStatus[] = ["DRAFT", "PLACED", "CONFIRMED", "DELIVERED", "CANCELLED", "REJECTED"];
export const STATUS_TONE: Record<OrderStatus, string> = { DRAFT: "grey", PLACED: "amber", CONFIRMED: "green", DELIVERED: "green", CANCELLED: "grey", REJECTED: "red" };

export type OrderSummary = {
  id: number; status: OrderStatus; deliveryDate: string; deliveryTime: string; totalCents: number;
  employee: Option; company: Option; placedAt: string | null; lineCount: number; boxCount: number;
};

export type OrderChoiceView = { groupId: number; groupName: string; optionId: number; optionName: string; portionSizeId: number | null; portionName: string | null; unitPriceCents: number };
export type OrderCombinationView = { id?: number; signature: string; quantity: number; unitPriceCents: number; totalCents: number; choices: OrderChoiceView[] };
export type OrderLineView = { dishId: number; dishName: string; dishSku: string; quantity: number; unitPriceCents: number; totalCents: number; combinations: OrderCombinationView[] };

export type OrderDetail = {
  id: number; status: OrderStatus; version: number; deliveryDate: string; deliveryTime: string; totalCents: number; notes: string | null;
  allergyAcknowledged: boolean; cutoffAt: string; pastCutoff: boolean; addressId: number; packagingTypeId: number | null;
  placedAt: string | null; confirmedAt: string | null; deliveredAt: string | null; cancelledAt: string | null; cancellationReason: string | null; rejectedAt: string | null; rejectionReason: string | null;
  employee: Option & { email: string; canChooseAddress: boolean; canChangeDeliveryTime: boolean; canChangePackaging: boolean; allergens: Option[] };
  company: Option & { isActive: boolean }; address: Address; packagingType: Option | null; priceTier: Option; createdBy: Option;
  lines: (OrderLineView & { id: number })[];
  events: { id: number; type: string; message: string; createdAt: string; actor: Option | null }[];
  permissions: { edit: boolean; place: boolean; cancel: boolean; reject: boolean; overrideDelivery: boolean };
  kitchenStartedAt: string | null; kitchenReadyAt: string | null; dispatchReadyAt: string | null; outForDeliveryAt: string | null;
  driver: Option | null; deliveryNote: string | null; deliveryPhotoUrl: string | null; deliveryLateMinutes: number | null; deliveredOnTime: boolean | null;
  kitchen: { plannedDispatchReadyAt: string; plannedKitchenReadyAt: string; timing: KitchenTiming | null };
  invoice: { id: number; number: string; status: InvoiceStatus } | null;
  credits: { id: number; kind: string; amountCents: number; reason: string; status: string }[];
};

export type Quote = {
  lines: OrderLineView[]; totalCents: number; allergyConflicts: Option[]; errors: string[]; tier: Option;
  delivery: { deliveryDate: string; deliveryTime: string; addressId: number | null; packagingTypeId: number | null };
  cutoffAt: string; pastCutoff: boolean;
};

export type KitchenTiming = "LATE" | "AT_RISK" | "ON_TRACK" | "DONE";
export type KitchenUnit = {
  id: number; dish: string; sku: string; quantity: number; choices: string; station: string; stationId: number | null;
  state: "PENDING" | "STARTED" | "DONE"; startedAt: string | null; startedBy: string | null; doneAt: string | null; doneBy: string | null;
};
export type KitchenCard = {
  orderId: number; employee: string; company: string; address: string; packaging: string | null; deliveryTime: string;
  plannedDispatchReadyAt: string; plannedKitchenReadyAt: string; timing: KitchenTiming; kitchenStartedAt: string | null; kitchenReadyAt: string | null; units: KitchenUnit[];
};
export type KitchenBoard = {
  date: string; today: string; closedToday: boolean; now: string; timezone: string; atRiskMinutes: number;
  totals: { orders: number; ready: number; late: number; atRisk: number };
  stations: { id: number | null; name: string; pending: number; started: number; done: number }[];
  prep: { stationId: number | null; dish: string; sku: string; choices: string; total: number; remaining: number }[];
  orders: Page<KitchenCard>;
};

export type DropStage = "NOT_STARTED" | "COOKING" | "KITCHEN_READY" | "DISPATCH_READY" | "OUT_FOR_DELIVERY" | "DELIVERED";
export type Drop = {
  id: string; deliveryDate: string; deliveryTime: string; companyId: number; addressId: number; company: string; address: string; instructions: string | null; packaging: string | null;
  driver: { id: number; name: string; isDefault: boolean } | null; plannedDispatchReadyAt: string; plannedKitchenReadyAt: string;
  status: DropStage; counts: Record<DropStage, number>; timing: "LATE" | "AT_RISK" | "ON_TRACK" | "DONE";
  canDispatchReady: boolean; blockedReason: string | null; canAssign: boolean; canOutForDelivery: boolean; canDeliver: boolean;
  delivery: { deliveredAt: string; by: string | null; note: string | null; photoUrl: string | null; lateMinutes: number; onTime: boolean } | null;
  orders: { id: number; employee: string; stage: DropStage; boxes: number; items: string[]; kitchenReadyAt: string | null; timing: KitchenTiming }[];
};
export type DispatchBoard = {
  date: string; today: string; closedToday: boolean; now: string; timezone: string;
  totals: { drops: number; orders: number; delivered: number; outForDelivery: number; late: number; noDriver: number };
  drops: Page<Drop>;
};
export type DriverDrops = { date: string; now: string; timezone: string; drops: Drop[]; closedToday: boolean; nextDay: { date: string; drops: Drop[] } | null };

export type InvoiceStatus = "UNPAID" | "PAID" | "VOID";
export type BillingCompany = { id: number; name: string; isActive: boolean; uninvoicedOrders: number; uninvoicedCents: number; openCredits: number; openCreditCents: number; unpaidInvoices: number; unpaidCents: number };
export type InvoiceSummary = { id: number; number: string; status: InvoiceStatus; totalCents: number; issuedAt: string; paidAt: string | null; lineCount: number; company: Option };
export type InvoiceDetail = {
  id: number; number: string; status: InvoiceStatus; totalCents: number; linesTotalCents: number; notes: string | null; issuedAt: string; paidAt: string | null; voidedAt: string | null; voidReason: string | null;
  company: Option & { billingContactName: string; billingContactEmail: string }; createdBy: { name: string }; paidBy: { name: string } | null; voidedBy: { name: string } | null;
  lines: { id: number; type: "ORDER" | "CREDIT"; orderId: number | null; description: string; amountCents: number }[];
};
export type Uninvoiced = {
  items: { id: number; deliveryDate: string; employee: string; status: OrderStatus; totalCents: number; creditedCents: number; amountCents: number }[];
  total: number; page: number; pageSize: number; allMatchingCents: number;
  openCredits: { id: number; orderId: number; amountCents: number; kind: string; reason: string }[];
};

export type DashboardTiming = KitchenTiming;
export type Dashboard = {
  kind: "ADMIN" | "KITCHEN" | "DISPATCH" | "DRIVER" | "NONE"; today: string; operatingDate: string; isToday: boolean; timezone: string; staff: { name: string };
  admin?: {
    attention: { lateKitchenOrders: number; atRiskKitchenOrders: number; dropsWithoutDriver: number; lateDrops: number };
    operating: { kitchenOrders: number; kitchenReady: number; drops: number; delivered: number };
    upcoming: { date: string; cutoffAt: string; cutoffPassed: boolean; draft: number; placed: number; confirmed: number; delivered: number; cancelled: number; rejected: number }[];
    recent: { date: string; delivered: number; confirmedNotDelivered: number; cancelled: number; rejected: number; billableCents: number; onTime: number; late: number }[];
    performance: { windowDays: number; onTime: number; late: number; onTimeRate: number | null; averageLateMinutes: number | null };
    money: { uninvoicedOrders: number; uninvoicedCents: number; unpaidInvoices: number; unpaidCents: number; openCredits: number; openCreditCents: number } | null;
  };
  kitchen?: {
    totals: { orders: number; ready: number; late: number; atRisk: number }; units: { pending: number; started: number; done: number };
    stations: { id: number | null; name: string; pending: number; started: number; done: number }[];
    prep: { dish: string; choices: string; total: number; remaining: number }[];
    firstDeadline: string | null; mostUrgent: { orderId: number; company: string; employee: string; plannedKitchenReadyAt: string; timing: KitchenTiming; unitsLeft: number }[];
    allergyOrders: number; tomorrow: { date: string; placed: number; draft: number; confirmed: number } | null;
  };
  dispatch?: {
    totals: { drops: number; orders: number; delivered: number; outForDelivery: number; late: number; noDriver: number };
    stages: { notStarted: number; cooking: number; kitchenReady: number; dispatchReady: number; outForDelivery: number; delivered: number };
    next: { id: string; company: string; deliveryTime: string; plannedDispatchReadyAt: string; status: DropStage; timing: KitchenTiming; driver: string | null; blockedReason: string | null }[];
    outNow: { id: string; company: string; deliveryTime: string; driver: string | null }[];
    drivers: { name: string; drops: number; delivered: number }[];
  };
  driver?: {
    date: string; totals: { drops: number; delivered: number; outForDelivery: number; waiting: number };
    next: { date: string; company: string; address: string; deliveryTime: string; status: DropStage; instructions: string | null; boxes: number; canDeliver: boolean } | null;
    record: { windowDays: number; onTime: number; late: number; onTimeRate: number | null };
  };
};
