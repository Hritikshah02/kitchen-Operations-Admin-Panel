import { describe, expect, it } from 'vitest';
import type { MenuDish } from '../menu/menu-engine.js';
import { priceLines, signatureOf, snapshotOf, type LineInput } from './order-rules.js';

const MILK = { id: 1, name: 'Milk / Dairy' };
const bowl: MenuDish = {
  id: 1, sku: 'NI-001', name: 'Paneer Rice Bowl', description: '', imageUrl: null, temperature: 'HOT', minOrderQty: 1,
  priceCents: 200, allergens: [], dietaryTags: [], allergyConflicts: [],
  groups: [
    { id: 10, name: 'Choose your rice', required: true, minSelect: 1, maxSelect: 1, usesPortions: true, sizes: [{ id: 100, name: 'Regular' }, { id: 101, name: 'Large' }],
      options: [
        { id: 1000, name: 'Brown rice', priceCents: 20, surcharges: { 100: 0, 101: 15 }, allergens: [], dietaryTags: [], allergyConflicts: [] },
        { id: 1001, name: 'Jeera rice', priceCents: 10, surcharges: { 100: 0, 101: 15 }, allergens: [MILK], dietaryTags: [], allergyConflicts: [MILK] },
      ] },
    { id: 20, name: 'Add a side', required: false, minSelect: 0, maxSelect: 2, usesPortions: false, sizes: [],
      options: [
        { id: 2000, name: 'Raita', priceCents: 25, surcharges: {}, allergens: [], dietaryTags: [], allergyConflicts: [] },
        { id: 2001, name: 'Papad', priceCents: 5, surcharges: {}, allergens: [], dietaryTags: [], allergyConflicts: [] },
      ] },
  ],
};
const tray: MenuDish = { ...bowl, id: 2, sku: 'MTG-001', name: 'Dhokla Tray', priceCents: 900, minOrderQty: 2, groups: [] };
const menu = new Map([[1, bowl], [2, tray]]);
const brown = { groupId: 10, optionId: 1000, portionSizeId: 100 };
const jeera = { groupId: 10, optionId: 1001, portionSizeId: 100 };

describe('order lines', () => {
  it('prices the spec example: 10 bowls, 6 with brown rice and 4 with jeera rice', () => {
    const result = priceLines([{ dishId: 1, quantity: 10, combinations: [{ quantity: 6, choices: [brown] }, { quantity: 4, choices: [jeera] }] }], menu);
    expect(result.errors).toEqual([]);
    expect(result.lines[0].combinations.map((combination) => [combination.quantity, combination.unitPriceCents, combination.totalCents])).toEqual([[6, 220, 1320], [4, 210, 840]]);
    expect(result.lines[0].totalCents).toBe(2160);
    expect(result.totalCents).toBe(2160);
  });

  it('requires combination quantities to add up exactly to the dish quantity', () => {
    const result = priceLines([{ dishId: 1, quantity: 10, combinations: [{ quantity: 6, choices: [brown] }, { quantity: 3, choices: [jeera] }] }], menu);
    expect(result.errors).toContain('Line 1 (Paneer Rice Bowl): combination quantities add up to 9, but the dish quantity is 10.');
  });

  it('requires every combination to satisfy every required group, and respects max choices', () => {
    const missing = priceLines([{ dishId: 1, quantity: 1, combinations: [{ quantity: 1, choices: [] }] }], menu);
    expect(missing.errors[0]).toMatch(/choose 1 for "Choose your rice"/);
    const tooMany = priceLines([{ dishId: 1, quantity: 1, combinations: [{ quantity: 1, choices: [brown, jeera] }] }], menu);
    expect(tooMany.errors[0]).toMatch(/at most 1 for "Choose your rice"/);
  });

  it('adds size surcharges and requires a size in portioned groups only', () => {
    const large = priceLines([{ dishId: 1, quantity: 1, combinations: [{ quantity: 1, choices: [{ ...brown, portionSizeId: 101 }, { groupId: 20, optionId: 2000 }] }] }], menu);
    expect(large.lines[0].combinations[0].unitPriceCents).toBe(200 + 20 + 15 + 25);
    expect(priceLines([{ dishId: 1, quantity: 1, combinations: [{ quantity: 1, choices: [{ groupId: 10, optionId: 1000 }] }] }], menu).errors[0]).toMatch(/pick a size/);
    expect(priceLines([{ dishId: 1, quantity: 1, combinations: [{ quantity: 1, choices: [brown, { groupId: 20, optionId: 2000, portionSizeId: 100 }] }] }], menu).errors[0]).toMatch(/not sold in sizes/);
  });

  it('merges identical combinations so the kitchen sees one unit per distinct combination', () => {
    const result = priceLines([{ dishId: 1, quantity: 5, combinations: [
      { quantity: 2, choices: [brown, { groupId: 20, optionId: 2000 }, { groupId: 20, optionId: 2001 }] },
      { quantity: 3, choices: [{ groupId: 20, optionId: 2001 }, brown, { groupId: 20, optionId: 2000 }] },
    ] }], menu);
    expect(result.lines[0].combinations).toHaveLength(1);
    expect(result.lines[0].combinations[0].quantity).toBe(5);
  });

  it('enforces minimum order quantity, menu membership and one line per dish', () => {
    expect(priceLines([{ dishId: 2, quantity: 1, combinations: [{ quantity: 1, choices: [] }] }], menu).errors[0]).toMatch(/minimum order for this dish is 2/);
    expect(priceLines([{ dishId: 99, quantity: 1, combinations: [{ quantity: 1, choices: [] }] }], menu).errors[0]).toMatch(/not on the employee's menu/);
    const twice: LineInput[] = [1, 1].map((dishId) => ({ dishId, quantity: 1, combinations: [{ quantity: 1, choices: [brown] }] }));
    expect(priceLines(twice, menu).errors[0]).toMatch(/appears twice/);
  });

  it("collects the employee's allergens from dishes and chosen options", () => {
    expect(priceLines([{ dishId: 1, quantity: 1, combinations: [{ quantity: 1, choices: [jeera] }] }], menu).allergyConflicts).toEqual([MILK]);
    expect(priceLines([{ dishId: 1, quantity: 1, combinations: [{ quantity: 1, choices: [brown] }] }], menu).allergyConflicts).toEqual([]);
  });

  it('keeps locked prices for unchanged combinations after a price change, and prices new ones at today\'s prices', () => {
    const placed = priceLines([{ dishId: 1, quantity: 2, combinations: [{ quantity: 2, choices: [brown] }] }], menu);
    const snapshot = snapshotOf(placed.lines);
    const repriced = new Map([[1, { ...bowl, priceCents: 300 }]]); // dish price went up by $1
    const edited = priceLines([{ dishId: 1, quantity: 3, combinations: [{ quantity: 2, choices: [brown] }, { quantity: 1, choices: [jeera] }] }], repriced, snapshot);
    const [locked, added] = edited.lines[0].combinations;
    expect(locked.unitPriceCents).toBe(220); // unchanged combination keeps its placed price
    expect(added.unitPriceCents).toBe(200 + 10); // new combination: the line's locked dish price + today's option price
  });

  it('builds stable signatures regardless of choice order', () => {
    expect(signatureOf([jeera, { groupId: 20, optionId: 2000 }])).toBe(signatureOf([{ groupId: 20, optionId: 2000 }, jeera]));
    expect(signatureOf([])).toBe('plain');
  });
});
