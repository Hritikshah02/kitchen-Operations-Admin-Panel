import { PriceRule } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { applyRule, createsCycle, resolvePrice, roundUpToFiveCents, type PriceEntry, type TierRule } from './pricing-engine.js';

const tiers = new Map<number, TierRule>([
  [1, { id: 1, name: 'Standard', rule: PriceRule.MANUAL, ruleValueBps: null, baseTierId: null }],
  [2, { id: 2, name: 'Enterprise', rule: PriceRule.TIER_PERCENT, ruleValueBps: -800, baseTierId: 1 }],
  [3, { id: 3, name: 'Partner', rule: PriceRule.COST_MULTIPLIER, ruleValueBps: 24_000, baseTierId: null }],
  [4, { id: 4, name: 'Premium', rule: PriceRule.TIER_PERCENT, ruleValueBps: 1500, baseTierId: 2 }], // derived from a derived tier
]);
const entries = (rows: Record<number, PriceEntry>) => new Map(Object.entries(rows).map(([tier, entry]) => [Number(tier), entry]));
const typed = (priceCents: number): PriceEntry => ({ priceCents, isUnavailable: false });

describe('rounding up to the next 5 cents', () => {
  it('rounds $2.11 up to $2.15 (spec example) and leaves exact multiples alone', () => {
    expect(roundUpToFiveCents(211n, 1n)).toBe(215);
    expect(roundUpToFiveCents(215n, 1n)).toBe(215);
    expect(roundUpToFiveCents(210n, 1n)).toBe(210);
    expect(roundUpToFiveCents(0n, 1n)).toBe(0);
  });

  it('rounds the exact rational value, not a float approximation', () => {
    expect(roundUpToFiveCents(2_100_001n, 10_000n)).toBe(215); // 210.0001 -> 215
    expect(roundUpToFiveCents(2_100_000n, 10_000n)).toBe(210); // exactly 210
  });

  it('applies "cost × 2.4" and "Standard + 15%"', () => {
    expect(applyRule(PriceRule.COST_MULTIPLIER, 24_000, 88)).toBe(215); // 88 × 2.4 = 211.2
    expect(applyRule(PriceRule.TIER_PERCENT, 1500, 200)).toBe(230); // exactly 230
    expect(applyRule(PriceRule.TIER_PERCENT, 1500, 199)).toBe(230); // 228.85
    expect(applyRule(PriceRule.TIER_PERCENT, -800, 155)).toBe(145); // 142.6
  });
});

describe('resolving a price on a tier', () => {
  it('uses typed prices on a manual tier and reports missing ones', () => {
    expect(resolvePrice(1, 80, tiers, entries({ 1: typed(155) }))).toEqual({ priceCents: 155, source: 'manual' });
    expect(resolvePrice(1, 80, tiers, entries({}))).toEqual({ priceCents: null, source: 'missing' });
  });

  it('derives from cost or from another tier, including chains', () => {
    expect(resolvePrice(3, 88, tiers, entries({}))).toEqual({ priceCents: 215, source: 'derived' });
    expect(resolvePrice(2, 80, tiers, entries({ 1: typed(155) }))).toEqual({ priceCents: 145, source: 'derived' });
    expect(resolvePrice(4, 80, tiers, entries({ 1: typed(155) }))).toEqual({ priceCents: 170, source: 'derived' }); // 145 × 1.15 = 166.75
  });

  it('lets staff override a derived price; the override is used as typed (no rounding)', () => {
    expect(resolvePrice(2, 80, tiers, entries({ 1: typed(155), 2: typed(149) }))).toEqual({ priceCents: 149, source: 'override' });
  });

  it('has no price when the base tier has none, or the item is marked unavailable', () => {
    expect(resolvePrice(2, 80, tiers, entries({}))).toEqual({ priceCents: null, source: 'missing' });
    expect(resolvePrice(3, 88, tiers, entries({ 3: { priceCents: null, isUnavailable: true } }))).toEqual({ priceCents: null, source: 'unavailable' });
    // Unavailable on the base tier propagates: Enterprise can't derive from a price that doesn't exist.
    expect(resolvePrice(2, 80, tiers, entries({ 1: { priceCents: null, isUnavailable: true } })).priceCents).toBeNull();
  });

  it('detects derivation loops', () => {
    expect(createsCycle(1, 4, tiers)).toBe(true); // Standard deriving from Premium: 4 -> 2 -> 1 loops back
    expect(createsCycle(2, 2, tiers)).toBe(true); // a tier deriving from itself
    expect(createsCycle(3, 1, tiers)).toBe(false); // Partner deriving from Standard is fine
  });
});
