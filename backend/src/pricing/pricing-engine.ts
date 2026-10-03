import { PriceRule } from '@prisma/client';

// Pure price resolution (4.3). All money is integer cents; arithmetic uses BigInt so rounding is exact.

export type TierRule = { id: number; name: string; rule: PriceRule; ruleValueBps: number | null; baseTierId: number | null };
export type PriceEntry = { priceCents: number | null; isUnavailable: boolean };
export type PriceSource = 'manual' | 'override' | 'derived' | 'unavailable' | 'missing';
export type ResolvedPrice = { priceCents: number | null; source: PriceSource };

const MAX_CHAIN = 10;

/** Smallest multiple of 5 cents that is >= numerator / denominator (the exact value), e.g. 211.2 -> 215. */
export function roundUpToFiveCents(numerator: bigint, denominator: bigint): number {
  const step = denominator * 5n;
  const steps = (numerator + step - 1n) / step; // ceiling division for non-negative values
  return Number(steps * 5n);
}

export function applyRule(rule: PriceRule, ruleValueBps: number, baseCents: number): number {
  const base = BigInt(Math.max(0, baseCents));
  if (rule === PriceRule.COST_MULTIPLIER) return roundUpToFiveCents(base * BigInt(ruleValueBps), 10_000n);
  if (rule === PriceRule.TIER_PERCENT) return roundUpToFiveCents(base * BigInt(10_000 + ruleValueBps), 10_000n);
  throw new Error(`Rule ${rule} does not derive prices.`);
}

/**
 * Price of one item (dish or option) on one tier:
 *   1. marked unavailable on the tier -> no price;
 *   2. a typed price (MANUAL tier) or override (derived tier) wins;
 *   3. MANUAL tier without a typed price -> missing;
 *   4. otherwise derive from cost or from the base tier's resolved price (which may itself be derived).
 * No price means the item must not appear on that tier's menus at all.
 */
export function resolvePrice(
  tierId: number,
  costCents: number,
  tiers: ReadonlyMap<number, TierRule>,
  entries: ReadonlyMap<number, PriceEntry>, // this item's rows, keyed by tier id
  depth = 0,
): ResolvedPrice {
  const tier = tiers.get(tierId);
  if (!tier || depth > MAX_CHAIN) return { priceCents: null, source: 'missing' };
  const entry = entries.get(tierId);
  if (entry?.isUnavailable) return { priceCents: null, source: 'unavailable' };
  if (entry?.priceCents !== null && entry?.priceCents !== undefined) {
    return { priceCents: entry.priceCents, source: tier.rule === PriceRule.MANUAL ? 'manual' : 'override' };
  }
  if (tier.rule === PriceRule.MANUAL || tier.ruleValueBps === null) return { priceCents: null, source: 'missing' };
  if (tier.rule === PriceRule.COST_MULTIPLIER) {
    return { priceCents: applyRule(tier.rule, tier.ruleValueBps, costCents), source: 'derived' };
  }
  if (tier.baseTierId === null) return { priceCents: null, source: 'missing' };
  const base = resolvePrice(tier.baseTierId, costCents, tiers, entries, depth + 1);
  if (base.priceCents === null) return { priceCents: null, source: 'missing' };
  return { priceCents: applyRule(tier.rule, tier.ruleValueBps, base.priceCents), source: 'derived' };
}

/** True if making `tierId` derive from `baseTierId` would create a loop. */
export function createsCycle(tierId: number, baseTierId: number, tiers: ReadonlyMap<number, TierRule>): boolean {
  let current: number | null = baseTierId;
  for (let hops = 0; current !== null && hops <= tiers.size; hops++) {
    if (current === tierId) return true;
    current = tiers.get(current)?.baseTierId ?? null;
  }
  return false;
}
