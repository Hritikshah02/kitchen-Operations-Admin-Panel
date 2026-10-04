import { describe, expect, it } from 'vitest';
import type { ResolvedPrice } from '../pricing/pricing-engine.js';
import { buildMenu, orderableDishIds, type CategoryInput, type DishInput, type GroupInput, type MenuContext } from './menu-engine.js';

const priced = (priceCents: number): ResolvedPrice => ({ priceCents, source: 'manual' });
const PEANUT = { id: 1, name: 'Peanuts' };
const regular = { id: 10, name: 'Regular' };
const large = { id: 11, name: 'Large' };

const roti: GroupInput = {
  id: 100, name: 'Choose your roti', isActive: true, minSelect: 1, maxSelect: 1, usesPortions: true, sizes: [regular, large],
  options: [
    { id: 1000, name: 'Phulka', isActive: true, allergens: [], dietaryTags: [], surcharges: new Map([[10, 0], [11, 15]]) },
    { id: 1001, name: 'Thepla', isActive: true, allergens: [PEANUT], dietaryTags: [], surcharges: new Map([[10, 0], [11, 15]]) },
    { id: 1002, name: 'No large size', isActive: true, allergens: [], dietaryTags: [], surcharges: new Map([[10, 0]]) },
  ],
};
const dish = (id: number, overrides: Partial<DishInput> = {}): DishInput => ({
  id, sku: `D-${id}`, name: `Dish ${id}`, description: '', imageUrl: null, temperature: 'HOT', isActive: true, minOrderQty: 1,
  allergens: [], dietaryTags: [], groups: [], ...overrides,
});
const dishes = new Map([
  [1, dish(1, { name: 'Thali', groups: [roti], allergens: [PEANUT] })],
  [2, dish(2, { name: 'Unpriced' })],
  [3, dish(3, { name: 'Hidden dish' })],
  [4, dish(4, { name: 'Inactive', isActive: false })],
  [5, dish(5, { name: 'Meeting tray' })],
  [6, dish(6, { name: 'Lassi' })],
]);
const categories: CategoryInput[] = [
  { id: 1, name: 'Thalis', description: null, isActive: true, isSecret: false, items: [1, 2, 3, 4].map((dishId) => ({ dishId, isActive: true })) },
  { id: 2, name: 'Meeting specials', description: null, isActive: true, isSecret: true, items: [{ dishId: 5, isActive: true }] },
  { id: 3, name: 'Drinks', description: null, isActive: true, isSecret: false, items: [{ dishId: 6, isActive: true }] },
  { id: 4, name: 'Old', description: null, isActive: false, isSecret: false, items: [{ dishId: 6, isActive: true }] },
];
const ctx = (overrides: Partial<MenuContext> = {}): MenuContext => ({
  tierName: 'Standard',
  hiddenCategoryIds: new Set(),
  hiddenDishIds: new Set([3]),
  dishPrices: new Map([[1, priced(155)], [3, priced(100)], [4, priced(100)], [5, priced(900)], [6, priced(30)]]),
  optionPrices: new Map([[1000, priced(10)], [1001, priced(15)], [1002, priced(10)]]),
  employeeAllergenIds: new Set([PEANUT.id]),
  ...overrides,
});

describe('menu resolution', () => {
  it('lists active, non-secret categories in order with only orderable dishes', () => {
    const menu = buildMenu(categories, dishes, ctx());
    expect(menu.categories.map((category) => [category.name, category.items.map((item) => item.name)])).toEqual([
      ['Thalis', ['Thali']],
      ['Drinks', ['Lassi']],
    ]);
  });

  it('explains why each dish was left out', () => {
    const reasons = Object.fromEntries(buildMenu(categories, dishes, ctx()).excluded.map((entry) => [`${entry.name}@${entry.category}`, entry.reason]));
    expect(reasons).toMatchObject({
      'Unpriced@Thalis': 'No price on the Standard tier',
      'Hidden dish@Thalis': 'Dish is hidden for this company',
      'Inactive@Thalis': 'Dish is deactivated',
      'Lassi@Old': 'Category is switched off',
    });
  });

  it('never shows a dish priced at $0: it counts as unpriced', () => {
    const zero = ctx({ dishPrices: new Map([[1, priced(155)], [6, priced(0)]]) });
    const menu = buildMenu(categories, dishes, zero);
    expect(menu.categories.flatMap((category) => category.items).map((item) => item.name)).not.toContain('Lassi');
    expect(menu.excluded.find((entry) => entry.name === 'Lassi' && entry.category === 'Drinks')?.reason).toBe('No price on the Standard tier');
  });

  it('keeps secret categories out of the listing but reachable by search', () => {
    const menu = buildMenu(categories, dishes, ctx(), 'tray');
    expect(menu.categories.some((category) => category.name === 'Meeting specials')).toBe(false);
    expect(menu.searchResults.map((item) => item.name)).toEqual(['Meeting tray']);
  });

  it('lets company hiding beat secrecy: a hidden secret category is not reachable at all', () => {
    const menu = buildMenu(categories, dishes, ctx({ hiddenCategoryIds: new Set([2]) }), 'tray');
    expect(menu.searchResults).toEqual([]);
    expect(orderableDishIds(categories, dishes, ctx({ hiddenCategoryIds: new Set([2]) })).has(5)).toBe(false);
    expect(orderableDishIds(categories, dishes, ctx()).has(5)).toBe(true);
  });

  it('applies tier prices to options and drops options that cannot be sold in every size of a portioned group', () => {
    const [thali] = buildMenu(categories, dishes, ctx()).categories[0].items;
    expect(thali.priceCents).toBe(155);
    expect(thali.groups[0].options.map((option) => [option.name, option.priceCents, option.surcharges])).toEqual([
      ['Phulka', 10, { 10: 0, 11: 15 }],
      ['Thepla', 15, { 10: 0, 11: 15 }],
    ]);
  });

  it('removes a dish whose required group has no priced options on the tier', () => {
    const menu = buildMenu(categories, dishes, ctx({ optionPrices: new Map() }));
    expect(menu.categories[0]?.name).not.toBe('Thalis');
    expect(menu.excluded.find((entry) => entry.name === 'Thali')?.reason).toMatch(/too few available options/);
  });

  it("flags the employee's allergies on dishes and options", () => {
    const [thali] = buildMenu(categories, dishes, ctx()).categories[0].items;
    expect(thali.allergyConflicts).toEqual([PEANUT]);
    expect(thali.groups[0].options.find((option) => option.name === 'Thepla')?.allergyConflicts).toEqual([PEANUT]);
  });
});
