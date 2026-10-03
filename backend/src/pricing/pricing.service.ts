import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PriceRule, Prisma } from '@prisma/client';
import { definedOnly } from '../common/validation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateTierDto, GridQueryDto, PriceCellDto, SavePricesDto, UpdateTierDto } from './pricing.dto.js';
import { createsCycle, resolvePrice, type PriceEntry, type ResolvedPrice, type TierRule } from './pricing-engine.js';

type Item = { id: number; costCents: number; prices: (PriceEntry & { tierId: number })[] };
const byTier = (prices: Item['prices']) => new Map(prices.map((price) => [price.tierId, price]));

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async tierRules(): Promise<Map<number, TierRule>> {
    const tiers = await this.prisma.priceTier.findMany();
    return new Map(tiers.map((tier) => [tier.id, tier]));
  }

  async defaultTierId(): Promise<number> {
    const tier = await this.prisma.priceTier.findFirst({ where: { isDefault: true } });
    if (!tier) throw new BadRequestException('No default price tier is configured.');
    return tier.id;
  }

  /** 4.3: a company's tier, or the default tier when it has none. */
  async tierIdForCompany(companyId: number): Promise<number> {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { priceTierId: true } });
    return company.priceTierId ?? this.defaultTierId();
  }

  /** Resolved prices for the given dishes and options on one tier (what menus and orders use). */
  async priceBook(tierId: number, dishIds: number[], optionIds: number[]) {
    const [tiers, dishes, options] = await Promise.all([
      this.tierRules(),
      this.prisma.dish.findMany({ where: { id: { in: dishIds } }, select: { id: true, costCents: true, prices: true } }),
      this.prisma.option.findMany({ where: { id: { in: optionIds } }, select: { id: true, costCents: true, prices: true } }),
    ]);
    const resolve = (items: Item[]) => new Map<number, ResolvedPrice>(items.map((item) => [item.id, resolvePrice(tierId, item.costCents, tiers, byTier(item.prices))]));
    return { dishes: resolve(dishes), options: resolve(options) };
  }

  // ---------- Tiers ----------

  async listTiers() {
    const [tiers, rules, dishes, options] = await Promise.all([
      this.prisma.priceTier.findMany({ include: { baseTier: { select: { id: true, name: true } }, _count: { select: { companies: true } } }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
      this.tierRules(),
      this.prisma.dish.findMany({ where: { isActive: true }, select: { id: true, costCents: true, prices: true } }),
      this.prisma.option.findMany({ where: { isActive: true }, select: { id: true, costCents: true, prices: true } }),
    ]);
    const missing = (tierId: number, items: Item[]) => items.filter((item) => resolvePrice(tierId, item.costCents, rules, byTier(item.prices)).priceCents === null).length;
    return tiers.map(({ _count, ...tier }) => ({
      ...tier,
      companyCount: _count.companies,
      unpricedDishes: missing(tier.id, dishes),
      unpricedOptions: missing(tier.id, options),
    }));
  }

  async createTier(data: CreateTierDto) {
    const fields = await this.validateRule(null, data);
    const isFirst = (await this.prisma.priceTier.count()) === 0;
    const tier = await this.prisma.priceTier.create({ data: { name: data.name, ...fields, isDefault: isFirst } });
    return tier;
  }

  async updateTier(id: number, data: UpdateTierDto) {
    const current = await this.prisma.priceTier.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Price tier not found.');
    const fields = await this.validateRule(id, { ...current, ...definedOnly(data) });
    return this.prisma.priceTier.update({ where: { id }, data: { ...(data.name ? { name: data.name } : {}), ...fields } });
  }

  async makeDefault(id: number) {
    if (!(await this.prisma.priceTier.findUnique({ where: { id } }))) throw new NotFoundException('Price tier not found.');
    await this.prisma.$transaction([
      this.prisma.priceTier.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
      this.prisma.priceTier.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return this.listTiers();
  }

  private async validateRule(id: number | null, data: { name?: string; rule?: PriceRule; ruleValueBps?: number | null; baseTierId?: number | null }) {
    if (data.name) {
      const clash = await this.prisma.priceTier.findFirst({ where: { name: { equals: data.name, mode: 'insensitive' }, ...(id ? { NOT: { id } } : {}) } });
      if (clash) throw new ConflictException(`A tier named "${clash.name}" already exists.`);
    }
    const rule = data.rule ?? PriceRule.MANUAL;
    if (rule === PriceRule.MANUAL) return { rule, ruleValueBps: null, baseTierId: null };
    if (data.ruleValueBps === null || data.ruleValueBps === undefined) throw new BadRequestException('Enter the multiplier or percentage for a derived tier.');
    if (rule === PriceRule.COST_MULTIPLIER) {
      if (data.ruleValueBps <= 0) throw new BadRequestException('The cost multiplier must be greater than zero.');
      return { rule, ruleValueBps: data.ruleValueBps, baseTierId: null };
    }
    if (!data.baseTierId) throw new BadRequestException('Choose the tier this one is derived from.');
    const tiers = await this.tierRules();
    if (!tiers.has(data.baseTierId)) throw new BadRequestException('The base tier does not exist.');
    if (id !== null && createsCycle(id, data.baseTierId, tiers)) throw new BadRequestException('That would make tiers derive from each other in a loop.');
    return { rule, ruleValueBps: data.ruleValueBps, baseTierId: data.baseTierId };
  }

  // ---------- Grid ----------

  /** Every active dish or option with its cost, typed/override price, derived price and the price that applies. */
  async grid(tierId: number, query: GridQueryDto) {
    const tiers = await this.tierRules();
    const tier = tiers.get(tierId);
    if (!tier) throw new NotFoundException('Price tier not found.');
    const search = query.search ? { contains: query.search, mode: 'insensitive' as const } : undefined;
    const items: (Item & { name: string; sku?: string })[] =
      query.kind === 'dishes'
        ? await this.prisma.dish.findMany({
            where: { isActive: true, ...(search ? { OR: [{ name: search }, { sku: search }] } : {}) },
            select: { id: true, name: true, sku: true, costCents: true, prices: true },
            orderBy: { sku: 'asc' },
          })
        : await this.prisma.option.findMany({
            where: { isActive: true, ...(search ? { name: search } : {}) },
            select: { id: true, name: true, costCents: true, prices: true },
            orderBy: { name: 'asc' },
          });

    const rows = items.map((item) => {
      const entries = byTier(item.prices);
      const entry = entries.get(tierId);
      const effective = resolvePrice(tierId, item.costCents, tiers, entries);
      // What the rule alone would give, ignoring this tier's own row (so staff can compare with an override).
      const withoutOwnRow = new Map(entries);
      withoutOwnRow.delete(tierId);
      const derived = tier.rule === PriceRule.MANUAL ? null : resolvePrice(tierId, item.costCents, tiers, withoutOwnRow).priceCents;
      return {
        id: item.id,
        name: item.name,
        sku: item.sku ?? null,
        costCents: item.costCents,
        typedCents: entry?.priceCents ?? null,
        isUnavailable: entry?.isUnavailable ?? false,
        derivedCents: derived,
        priceCents: effective.priceCents,
        source: effective.source,
      };
    });
    return { tier, rows: query.missingOnly ? rows.filter((row) => row.priceCents === null) : rows };
  }

  /** Bulk upsert of a tier's cells. A cell with no price and not unavailable is removed (falls back to the rule). */
  async savePrices(tierId: number, { dishes = [], options = [] }: SavePricesDto) {
    if (!(await this.prisma.priceTier.findUnique({ where: { id: tierId } }))) throw new NotFoundException('Price tier not found.');
    const split = (cells: PriceCellDto[]) => ({
      upserts: cells.filter((cell) => cell.isUnavailable || (cell.priceCents !== null && cell.priceCents !== undefined)),
      clears: cells.filter((cell) => !cell.isUnavailable && (cell.priceCents === null || cell.priceCents === undefined)).map((cell) => cell.id),
    });
    const dishCells = split(dishes);
    const optionCells = split(options);
    const value = (cell: PriceCellDto) => ({ priceCents: cell.isUnavailable ? null : (cell.priceCents ?? null), isUnavailable: cell.isUnavailable ?? false });

    const writes: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.dishPrice.deleteMany({ where: { tierId, dishId: { in: dishCells.clears } } }),
      this.prisma.optionPrice.deleteMany({ where: { tierId, optionId: { in: optionCells.clears } } }),
      ...dishCells.upserts.map((cell) =>
        this.prisma.dishPrice.upsert({ where: { tierId_dishId: { tierId, dishId: cell.id } }, update: value(cell), create: { tierId, dishId: cell.id, ...value(cell) } }),
      ),
      ...optionCells.upserts.map((cell) =>
        this.prisma.optionPrice.upsert({ where: { tierId_optionId: { tierId, optionId: cell.id } }, update: value(cell), create: { tierId, optionId: cell.id, ...value(cell) } }),
      ),
    ];
    await this.prisma.$transaction(writes);
    return { saved: dishes.length + options.length };
  }
}
