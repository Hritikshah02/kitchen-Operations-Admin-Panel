import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { pageArgs, type Page } from '../common/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CatalogueQueryDto, CreateOptionDto, CreateOptionGroupDto, UpdateOptionDto, UpdateOptionGroupDto } from './catalogue.dto.js';

type Tx = Prisma.TransactionClient;
const ref = { select: { id: true, name: true } } as const;

const optionInclude = {
  allergens: ref,
  dietaryTags: ref,
  surcharges: { include: { portionSize: ref }, orderBy: { portionSize: { sortOrder: 'asc' } } },
  groups: { select: { group: ref } },
} satisfies Prisma.OptionInclude;

const groupInclude = {
  items: { orderBy: { sortOrder: 'asc' }, include: { option: { select: { id: true, name: true, costCents: true, isActive: true } } } },
  portionSizes: { include: { portionSize: ref } },
  _count: { select: { dishes: true } },
} satisfies Prisma.OptionGroupInclude;

const presentGroup = ({ items, portionSizes, _count, ...group }: Prisma.OptionGroupGetPayload<{ include: typeof groupInclude }>) => ({
  ...group,
  required: group.minSelect > 0,
  options: items.map((item) => item.option),
  portionSizes: portionSizes.map((entry) => entry.portionSize),
  dishCount: _count.dishes,
});

const connectIds = (ids: number[] | undefined, mode: 'connect' | 'set') => (ids ? { [mode]: ids.map((id) => ({ id })) } : undefined);

@Injectable()
export class OptionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Options ----------

  async listOptions(query: CatalogueQueryDto): Promise<Page<unknown>> {
    const where: Prisma.OptionWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.option.findMany({ where, include: optionInclude, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], ...pageArgs(query) }),
      this.prisma.option.count({ where }),
    ]);
    return { items: items.map(({ groups, ...option }) => ({ ...option, groups: groups.map((entry) => entry.group) })), total, page: query.page, pageSize: query.pageSize };
  }

  async getOption(id: number) {
    const option = await this.prisma.option.findUnique({ where: { id }, include: optionInclude });
    if (!option) throw new NotFoundException('Option not found.');
    const { groups, ...rest } = option;
    return { ...rest, groups: groups.map((entry) => entry.group) };
  }

  async createOption({ allergenIds, dietaryTagIds, surcharges, ...data }: CreateOptionDto) {
    await this.assertNameFree('option', data.name);
    const option = await this.prisma.option.create({
      data: {
        ...data,
        allergens: connectIds(allergenIds, 'connect'),
        dietaryTags: connectIds(dietaryTagIds, 'connect'),
        surcharges: surcharges?.length ? { create: surcharges } : undefined,
      },
    });
    return this.getOption(option.id);
  }

  async updateOption(id: number, { allergenIds, dietaryTagIds, surcharges, ...data }: UpdateOptionDto) {
    await this.getOption(id);
    if (data.name) await this.assertNameFree('option', data.name, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.option.update({
        where: { id },
        data: { ...data, allergens: connectIds(allergenIds, 'set'), dietaryTags: connectIds(dietaryTagIds, 'set') },
      });
      if (surcharges) {
        await tx.optionPortionSurcharge.deleteMany({ where: { optionId: id } });
        if (surcharges.length) await tx.optionPortionSurcharge.createMany({ data: surcharges.map((entry) => ({ ...entry, optionId: id })) });
        const groups = await tx.optionGroupItem.findMany({ where: { optionId: id }, select: { groupId: true } });
        for (const { groupId } of groups) await this.assertPortionsComplete(tx, groupId);
      }
    });
    return this.getOption(id);
  }

  // ---------- Option groups ----------

  async listGroups(includeInactive = false) {
    const groups = await this.prisma.optionGroup.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: groupInclude,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return groups.map(presentGroup);
  }

  async getGroup(id: number) {
    const group = await this.prisma.optionGroup.findUnique({ where: { id }, include: groupInclude });
    if (!group) throw new NotFoundException('Option group not found.');
    return presentGroup(group);
  }

  async createGroup(data: CreateOptionGroupDto) {
    await this.assertNameFree('group', data.name);
    const id = await this.prisma.$transaction(async (tx) => {
      const group = await tx.optionGroup.create({ data: { name: data.name } });
      await this.applyGroup(tx, group.id, data);
      return group.id;
    });
    return this.getGroup(id);
  }

  async updateGroup(id: number, data: UpdateOptionGroupDto) {
    await this.getGroup(id);
    if (data.name) await this.assertNameFree('group', data.name, id);
    await this.prisma.$transaction((tx) => this.applyGroup(tx, id, data));
    return this.getGroup(id);
  }

  /** Writes group fields, membership and sizes, then re-checks the group's invariants inside the transaction. */
  private async applyGroup(tx: Tx, id: number, { optionIds, portionSizeIds, ...fields }: UpdateOptionGroupDto) {
    await tx.optionGroup.update({ where: { id }, data: fields });
    if (optionIds) {
      await tx.optionGroupItem.deleteMany({ where: { groupId: id } });
      await tx.optionGroupItem.createMany({ data: optionIds.map((optionId, index) => ({ groupId: id, optionId, sortOrder: (index + 1) * 10 })) });
    }
    if (portionSizeIds) {
      await tx.optionGroupPortion.deleteMany({ where: { groupId: id } });
      await tx.optionGroupPortion.createMany({ data: portionSizeIds.map((portionSizeId) => ({ groupId: id, portionSizeId })) });
    }
    const group = await tx.optionGroup.findUniqueOrThrow({ where: { id }, include: { _count: { select: { items: true } } } });
    if (group.minSelect > group.maxSelect) throw new BadRequestException('Minimum choices cannot be more than maximum choices.');
    if (group.minSelect > group._count.items) {
      throw new BadRequestException(`A group requiring ${group.minSelect} choice(s) needs at least that many options.`);
    }
    await this.assertPortionsComplete(tx, id);
  }

  /** 4.1: if a group uses portions, every option in it must be sellable in every one of the group's sizes. */
  private async assertPortionsComplete(tx: Tx, groupId: number) {
    const group = await tx.optionGroup.findUniqueOrThrow({
      where: { id: groupId },
      include: { portionSizes: { include: { portionSize: true } }, items: { include: { option: { include: { surcharges: true } } } } },
    });
    if (!group.usesPortions) return;
    if (!group.portionSizes.length) throw new BadRequestException(`"${group.name}" uses portions, so pick at least one size.`);
    const missing = group.items.flatMap(({ option }) =>
      group.portionSizes
        .filter(({ portionSizeId }) => !option.surcharges.some((entry) => entry.portionSizeId === portionSizeId))
        .map(({ portionSize }) => `${option.name} (${portionSize.name})`),
    );
    if (missing.length) {
      throw new BadRequestException(`"${group.name}" sells portions, but these options have no surcharge set for a size: ${missing.join(', ')}.`);
    }
  }

  private async assertNameFree(kind: 'option' | 'group', name: string, exceptId?: number) {
    const where = { name: { equals: name, mode: 'insensitive' as const }, ...(exceptId ? { NOT: { id: exceptId } } : {}) };
    const clash = kind === 'option' ? await this.prisma.option.findFirst({ where }) : await this.prisma.optionGroup.findFirst({ where });
    if (clash) throw new ConflictException(`Another ${kind === 'option' ? 'option' : 'option group'} is already named "${clash.name}".`);
  }
}
