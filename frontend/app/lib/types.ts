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
  defaultPackagingType: (Option & { isActive: boolean }) | null; activeEmployees: number; updatedAt: string; cancelledOrders?: number; lockedOrdersKept?: number;
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
