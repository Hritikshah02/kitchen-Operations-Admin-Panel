import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PricingService } from '../pricing/pricing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateCategoryDto, UpdateCategoryDto, VisibilityDto } from './menu.dto.js';
import { buildMenu, orderableDishIds, type CategoryInput, type DishInput, type MenuContext } from './menu-engine.js';

const ref = { select: { id: true, name: true } } as const;
const dishSelect = {
  id: true, sku: true, name: true, description: true, imageUrl: true, temperature: true, isActive: true, minOrderQty: true,
  allergens: ref, dietaryTags: ref,
  optionGroups: {
    orderBy: { sortOrder: 'asc' },
    select: {
      group: {
        select: {
          id: true, name: true, isActive: true, minSelect: true, maxSelect: true, usesPortions: true,
          portionSizes: { select: { portionSize: { select: { id: true, name: true, sortOrder: true } } } },
          items: { orderBy: { sortOrder: 'asc' }, select: { option: { select: { id: true, name: true, isActive: true, allergens: ref, dietaryTags: ref, surcharges: true } } } },
        },
      },
    },
  },
} satisfies Prisma.DishSelect;

type DishRow = Prisma.DishGetPayload<{ select: typeof dishSelect }>;

const toDishInput = (dish: DishRow): DishInput => ({
  ...dish,
  temperature: dish.temperature,
  groups: dish.optionGroups.map(({ group }) => ({
    id: group.id, name: group.name, isActive: group.isActive, minSelect: group.minSelect, maxSelect: group.maxSelect, usesPortions: group.usesPortions,
    sizes: group.portionSizes.map((entry) => entry.portionSize).sort((a, b) => a.sortOrder - b.sortOrder).map(({ id, name }) => ({ id, name })),
    options: group.items.map(({ option }) => ({ ...option, surcharges: new Map(option.surcharges.map((entry) => [entry.portionSizeId, entry.surchargeCents])) })),
  })),
});

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  // ---------- Resolution for an employee ----------

  private async inputs() {
    const [categories, dishes] = await Promise.all([
      this.prisma.menuCategory.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, description: true, isActive: true, isSecret: true, items: { orderBy: { sortOrder: 'asc' }, select: { dishId: true, isActive: true } } },
      }),
      this.prisma.dish.findMany({ where: { menuItems: { some: {} } }, select: dishSelect }),
    ]);
    return { categories: categories as CategoryInput[], dishes: new Map(dishes.map((dish) => [dish.id, toDishInput(dish)])) };
  }

  /** Everything that decides what an employee sees: their company's hiding, tier prices and their allergies. */
  async contextFor(employeeId: number, dishes: ReadonlyMap<number, DishInput>) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { allergens: ref, dietaryTags: ref, company: { include: { hiddenCategories: true, hiddenDishes: true, priceTier: true } } },
    });
    if (!employee) throw new NotFoundException('Employee not found.');
    const tierId = employee.company.priceTierId ?? (await this.pricing.defaultTierId());
    const tier = employee.company.priceTier ?? (await this.prisma.priceTier.findUniqueOrThrow({ where: { id: tierId } }));
    const optionIds = [...dishes.values()].flatMap((dish) => dish.groups.flatMap((group) => group.options.map((option) => option.id)));
    const prices = await this.pricing.priceBook(tierId, [...dishes.keys()], [...new Set(optionIds)]);
    const ctx: MenuContext = {
      tierName: tier.name,
      hiddenCategoryIds: new Set(employee.company.hiddenCategories.map((entry) => entry.categoryId)),
      hiddenDishIds: new Set(employee.company.hiddenDishes.map((entry) => entry.dishId)),
      dishPrices: prices.dishes,
      optionPrices: prices.options,
      employeeAllergenIds: new Set(employee.allergens.map((allergen) => allergen.id)),
    };
    return { employee, tier: { id: tier.id, name: tier.name }, ctx };
  }

  /** 4.2: the menu exactly as this employee would see it (plus search, which also reaches secret categories). */
  async employeeMenu(employeeId: number, search?: string) {
    const { categories, dishes } = await this.inputs();
    const { employee, tier, ctx } = await this.contextFor(employeeId, dishes);
    const menu = buildMenu(categories, dishes, ctx, search);
    return {
      employee: { id: employee.id, name: employee.name, email: employee.email, allergens: employee.allergens, dietaryTags: employee.dietaryTags },
      company: { id: employee.company.id, name: employee.company.name, isActive: employee.company.isActive },
      tier,
      ...menu,
    };
  }

  /** Dishes this employee may order (any category, secret included), with tier prices. Used to validate orders. */
  async orderableFor(employeeId: number) {
    const { categories, dishes } = await this.inputs();
    const { ctx, tier } = await this.contextFor(employeeId, dishes);
    return { tier, dishes: orderableDishIds(categories, dishes, ctx) };
  }

  // ---------- Category management ----------

  async listCategories() {
    const categories = await this.prisma.menuCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        items: { orderBy: { sortOrder: 'asc' }, include: { dish: { select: { id: true, sku: true, name: true, isActive: true } } } },
        _count: { select: { hiddenFor: true } },
      },
    });
    return categories.map(({ _count, ...category }) => ({ ...category, hiddenForCompanies: _count.hiddenFor }));
  }

  async createCategory(data: CreateCategoryDto) {
    await this.assertNameFree(data.name);
    const last = await this.prisma.menuCategory.aggregate({ _max: { sortOrder: true } });
    await this.prisma.menuCategory.create({ data: { ...data, sortOrder: (last._max.sortOrder ?? 0) + 10 } });
    return this.listCategories();
  }

  async updateCategory(id: number, data: UpdateCategoryDto) {
    await this.findCategory(id);
    if (data.name) await this.assertNameFree(data.name, id);
    await this.prisma.menuCategory.update({ where: { id }, data });
    return this.listCategories();
  }

  async reorderCategories(ids: number[]) {
    const count = await this.prisma.menuCategory.count();
    if (ids.length !== count) throw new BadRequestException('Send every category id in the new order.');
    await this.prisma.$transaction(ids.map((id, index) => this.prisma.menuCategory.update({ where: { id }, data: { sortOrder: (index + 1) * 10 } })));
    return this.listCategories();
  }

  /** Replaces the category's dishes in the given order; existing items keep their on/off state. */
  async setItems(categoryId: number, dishIds: number[]) {
    await this.findCategory(categoryId);
    if ((await this.prisma.dish.count({ where: { id: { in: dishIds } } })) !== dishIds.length) throw new BadRequestException('One or more dishes do not exist.');
    await this.prisma.$transaction([
      this.prisma.menuItem.deleteMany({ where: { categoryId, dishId: { notIn: dishIds } } }),
      ...dishIds.map((dishId, index) =>
        this.prisma.menuItem.upsert({
          where: { categoryId_dishId: { categoryId, dishId } },
          update: { sortOrder: (index + 1) * 10 },
          create: { categoryId, dishId, sortOrder: (index + 1) * 10 },
        }),
      ),
    ]);
    return this.listCategories();
  }

  async setItemActive(itemId: number, isActive: boolean) {
    await this.prisma.menuItem.update({ where: { id: itemId }, data: { isActive } });
    return this.listCategories();
  }

  // ---------- Company visibility ----------

  async visibility(companyId: number) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, include: { hiddenCategories: true, hiddenDishes: true } });
    if (!company) throw new NotFoundException('Company not found.');
    return { hiddenCategoryIds: company.hiddenCategories.map((entry) => entry.categoryId), hiddenDishIds: company.hiddenDishes.map((entry) => entry.dishId) };
  }

  async setVisibility(companyId: number, { hiddenCategoryIds, hiddenDishIds }: VisibilityDto) {
    await this.visibility(companyId);
    await this.prisma.$transaction([
      this.prisma.companyHiddenCategory.deleteMany({ where: { companyId } }),
      this.prisma.companyHiddenDish.deleteMany({ where: { companyId } }),
      this.prisma.companyHiddenCategory.createMany({ data: hiddenCategoryIds.map((categoryId) => ({ companyId, categoryId })) }),
      this.prisma.companyHiddenDish.createMany({ data: hiddenDishIds.map((dishId) => ({ companyId, dishId })) }),
    ]);
    return this.visibility(companyId);
  }

  private async findCategory(id: number) {
    const category = await this.prisma.menuCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Menu category not found.');
    return category;
  }

  private async assertNameFree(name: string, exceptId?: number) {
    const clash = await this.prisma.menuCategory.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
    if (clash) throw new ConflictException(`A category named "${clash.name}" already exists.`);
  }
}
