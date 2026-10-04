import type { ResolvedPrice } from '../pricing/pricing-engine.js';

// Pure menu resolution (4.2 + 4.3). The order builder uses the same rules, so what the menu shows is exactly
// what the server will accept on an order.

export type Ref = { id: number; name: string };

export type OptionInput = { id: number; name: string; isActive: boolean; allergens: Ref[]; dietaryTags: Ref[]; surcharges: Map<number, number> };
export type GroupInput = {
  id: number; name: string; isActive: boolean; minSelect: number; maxSelect: number; usesPortions: boolean;
  sizes: Ref[]; options: OptionInput[];
};
export type DishInput = {
  id: number; sku: string; name: string; description: string; imageUrl: string | null; temperature: string;
  isActive: boolean; minOrderQty: number; allergens: Ref[]; dietaryTags: Ref[]; groups: GroupInput[];
};
export type CategoryInput = { id: number; name: string; description: string | null; isActive: boolean; isSecret: boolean; items: { dishId: number; isActive: boolean }[] };

export type MenuContext = {
  tierName: string;
  hiddenCategoryIds: ReadonlySet<number>;
  hiddenDishIds: ReadonlySet<number>;
  dishPrices: ReadonlyMap<number, ResolvedPrice>;
  optionPrices: ReadonlyMap<number, ResolvedPrice>;
  employeeAllergenIds: ReadonlySet<number>;
};

export type MenuOption = { id: number; name: string; priceCents: number; surcharges: Record<number, number>; allergens: Ref[]; dietaryTags: Ref[]; allergyConflicts: Ref[] };
export type MenuGroup = { id: number; name: string; required: boolean; minSelect: number; maxSelect: number; usesPortions: boolean; sizes: Ref[]; options: MenuOption[] };
export type MenuDish = Omit<DishInput, 'groups' | 'isActive'> & { priceCents: number; allergyConflicts: Ref[]; groups: MenuGroup[] };
export type Exclusion = { dishId: number; name: string; category: string; reason: string };

const conflicts = (allergens: Ref[], employee: ReadonlySet<number>) => allergens.filter((allergen) => employee.has(allergen.id));

/** A dish as this employee can order it, or the reason they can't. Ignores category placement (handled by buildMenu). */
export function orderableDish(dish: DishInput, ctx: MenuContext): { dish: MenuDish } | { reason: string } {
  if (!dish.isActive) return { reason: 'Dish is deactivated' };
  if (ctx.hiddenDishIds.has(dish.id)) return { reason: 'Dish is hidden for this company' };
  const price = ctx.dishPrices.get(dish.id)?.priceCents ?? null;
  if (price === null || price <= 0) return { reason: `No price on the ${ctx.tierName} tier` }; // a $0 dish is treated as unpriced, never shown

  const groups: MenuGroup[] = [];
  for (const group of dish.groups) {
    if (!group.isActive) continue;
    const options = group.options.flatMap((option): MenuOption[] => {
      const optionPrice = ctx.optionPrices.get(option.id)?.priceCents ?? null;
      if (!option.isActive || optionPrice === null) return [];
      // A portioned group can only offer an option that is sellable in every one of its sizes.
      if (group.usesPortions && group.sizes.some((size) => !option.surcharges.has(size.id))) return [];
      return [{
        id: option.id, name: option.name, priceCents: optionPrice,
        surcharges: Object.fromEntries(group.usesPortions ? [...option.surcharges].filter(([sizeId]) => group.sizes.some((size) => size.id === sizeId)) : []),
        allergens: option.allergens, dietaryTags: option.dietaryTags, allergyConflicts: conflicts(option.allergens, ctx.employeeAllergenIds),
      }];
    });
    if (options.length < group.minSelect) return { reason: `"${group.name}" has too few available options on the ${ctx.tierName} tier` };
    if (!options.length) continue; // optional group with nothing to offer is simply not shown
    groups.push({ id: group.id, name: group.name, required: group.minSelect > 0, minSelect: group.minSelect, maxSelect: Math.min(group.maxSelect, options.length), usesPortions: group.usesPortions, sizes: group.usesPortions ? group.sizes : [], options });
  }
  const { groups: _inputGroups, isActive: _isActive, ...rest } = dish;
  return { dish: { ...rest, priceCents: price, allergyConflicts: conflicts(dish.allergens, ctx.employeeAllergenIds), groups } };
}

/**
 * The employee's browsable menu: active, non-secret categories not hidden for the company, each listing its
 * orderable dishes in order. Secret categories are only reachable by `search`. Also explains every dish left out.
 */
export function buildMenu(categories: CategoryInput[], dishes: ReadonlyMap<number, DishInput>, ctx: MenuContext, search?: string) {
  const visible: { id: number; name: string; description: string | null; items: MenuDish[] }[] = [];
  const excluded: Exclusion[] = [];
  const searchable = new Map<number, MenuDish>();

  for (const category of categories) {
    const hidden = ctx.hiddenCategoryIds.has(category.id);
    const items: MenuDish[] = [];
    for (const item of category.items) {
      const dish = dishes.get(item.dishId);
      if (!dish) continue;
      const exclude = (reason: string) => excluded.push({ dishId: dish.id, name: dish.name, category: category.name, reason });
      if (!category.isActive) { exclude('Category is switched off'); continue; }
      if (hidden) { exclude('Category is hidden for this company'); continue; }
      if (!item.isActive) { exclude('Switched off in this category'); continue; }
      const result = orderableDish(dish, ctx);
      if ('reason' in result) { exclude(result.reason); continue; }
      searchable.set(dish.id, result.dish);
      if (!category.isSecret) items.push(result.dish);
    }
    if (items.length && !category.isSecret) visible.push({ id: category.id, name: category.name, description: category.description, items });
  }

  const term = search?.trim().toLowerCase();
  const matches = term ? [...searchable.values()].filter((dish) => dish.name.toLowerCase().includes(term) || dish.sku.toLowerCase().includes(term)) : [];
  return { categories: visible, searchResults: matches, excluded };
}

/** Every dish the employee can order, from any category including secret ones (used to validate orders). */
export function orderableDishIds(categories: CategoryInput[], dishes: ReadonlyMap<number, DishInput>, ctx: MenuContext): Map<number, MenuDish> {
  const result = new Map<number, MenuDish>();
  for (const category of categories) {
    if (!category.isActive || ctx.hiddenCategoryIds.has(category.id)) continue;
    for (const item of category.items) {
      const dish = dishes.get(item.dishId);
      if (!dish || !item.isActive || result.has(dish.id)) continue;
      const resolved = orderableDish(dish, ctx);
      if ('dish' in resolved) result.set(dish.id, resolved.dish);
    }
  }
  return result;
}
