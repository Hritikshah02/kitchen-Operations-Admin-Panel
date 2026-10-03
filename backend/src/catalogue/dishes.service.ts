import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { pageArgs, type Page } from '../common/pagination.js';
import { definedOnly } from '../common/validation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CatalogueQueryDto, CreateDishDto, UpdateDishDto } from './catalogue.dto.js';

const ref = { select: { id: true, name: true } } as const;
const dishInclude = {
  station: ref,
  allergens: ref,
  dietaryTags: ref,
  optionGroups: { orderBy: { sortOrder: 'asc' }, include: { group: { select: { id: true, name: true, minSelect: true, maxSelect: true, usesPortions: true, isActive: true } } } },
} satisfies Prisma.DishInclude;

const present = ({ optionGroups, ...dish }: Prisma.DishGetPayload<{ include: typeof dishInclude }>) => ({
  ...dish,
  optionGroups: optionGroups.map(({ group }) => ({ ...group, required: group.minSelect > 0 })),
});

const connectIds = (ids: number[] | undefined, mode: 'connect' | 'set') => (ids ? { [mode]: ids.map((id) => ({ id })) } : undefined);

@Injectable()
export class DishesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: CatalogueQueryDto): Promise<Page<ReturnType<typeof present>>> {
    const where: Prisma.DishWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.stationId ? { stationId: query.stationId } : {}),
      ...(query.search
        ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { sku: { contains: query.search, mode: 'insensitive' } }] }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dish.findMany({ where, include: dishInclude, orderBy: [{ isActive: 'desc' }, { sku: 'asc' }], ...pageArgs(query) }),
      this.prisma.dish.count({ where }),
    ]);
    return { items: items.map(present), total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: number) {
    const dish = await this.prisma.dish.findUnique({ where: { id }, include: dishInclude });
    if (!dish) throw new NotFoundException('Dish not found.');
    return present(dish);
  }

  async create({ allergenIds, dietaryTagIds, ...data }: CreateDishDto) {
    await this.assertSkuFree(data.sku);
    await this.assertStation(data.stationId);
    const dish = await this.prisma.dish.create({
      data: { description: '', ...(definedOnly(data) as typeof data), allergens: connectIds(allergenIds, 'connect'), dietaryTags: connectIds(dietaryTagIds, 'connect') },
    });
    return this.get(dish.id);
  }

  /** Dishes are deactivated (isActive=false), never deleted: past orders reference them. */
  async update(id: number, { allergenIds, dietaryTagIds, ...data }: UpdateDishDto) {
    await this.get(id);
    if (data.sku) await this.assertSkuFree(data.sku, id);
    await this.assertStation(data.stationId);
    await this.prisma.dish.update({
      where: { id },
      data: { ...data, allergens: connectIds(allergenIds, 'set'), dietaryTags: connectIds(dietaryTagIds, 'set') },
    });
    return this.get(id);
  }

  /** Replaces the dish's option groups; array order is display order. */
  async setGroups(id: number, groupIds: number[]) {
    await this.get(id);
    const found = await this.prisma.optionGroup.count({ where: { id: { in: groupIds } } });
    if (found !== groupIds.length) throw new BadRequestException('One or more option groups do not exist.');
    await this.prisma.$transaction([
      this.prisma.dishOptionGroup.deleteMany({ where: { dishId: id } }),
      this.prisma.dishOptionGroup.createMany({ data: groupIds.map((groupId, index) => ({ dishId: id, groupId, sortOrder: (index + 1) * 10 })) }),
    ]);
    return this.get(id);
  }

  private async assertSkuFree(sku: string, exceptId?: number) {
    const clash = await this.prisma.dish.findFirst({ where: { sku, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
    if (clash) throw new ConflictException(`SKU ${sku} is already used by "${clash.name}".`);
  }

  private async assertStation(stationId: number | null | undefined) {
    if (!stationId) return;
    if (!(await this.prisma.kitchenStation.findFirst({ where: { id: stationId, isActive: true } }))) {
      throw new BadRequestException('Choose an active kitchen station, or leave it unassigned.');
    }
  }
}
