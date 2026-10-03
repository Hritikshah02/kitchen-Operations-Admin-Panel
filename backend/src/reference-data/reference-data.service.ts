import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateReferenceItemDto, ReferenceKind, UpdateReferenceItemDto } from './reference-data.dto.js';

export type ReferenceItem = { id: number; name: string; description: string | null; sortOrder: number; isActive: boolean };

// The four lists share one shape; this narrow interface lets one service drive all four Prisma delegates.
type ReferenceDelegate = {
  findMany(args: object): Promise<ReferenceItem[]>;
  findFirst(args: object): Promise<ReferenceItem | null>;
  create(args: object): Promise<ReferenceItem>;
  update(args: object): Promise<ReferenceItem>;
};

const LABELS: Record<ReferenceKind, string> = {
  allergens: 'allergen',
  'dietary-tags': 'dietary tag',
  stations: 'kitchen station',
  'portion-sizes': 'portion size',
  'packaging-types': 'packaging type',
};

@Injectable()
export class ReferenceDataService {
  constructor(private readonly prisma: PrismaService) {}

  private delegate(kind: ReferenceKind): ReferenceDelegate {
    const delegates: Record<ReferenceKind, unknown> = {
      allergens: this.prisma.allergen,
      'dietary-tags': this.prisma.dietaryTag,
      stations: this.prisma.kitchenStation,
      'portion-sizes': this.prisma.portionSize,
      'packaging-types': this.prisma.packagingType,
    };
    return delegates[kind] as ReferenceDelegate;
  }

  list(kind: ReferenceKind, includeInactive = false) {
    return this.delegate(kind).findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(kind: ReferenceKind, data: CreateReferenceItemDto) {
    await this.assertNameFree(kind, data.name);
    return this.delegate(kind).create({ data });
  }

  async update(kind: ReferenceKind, id: number, data: UpdateReferenceItemDto) {
    if (data.name) await this.assertNameFree(kind, data.name, id);
    return this.delegate(kind).update({ where: { id }, data });
  }

  /** "Paneer" and "paneer" are the same item; the DB index is case-sensitive, so check here too. */
  private async assertNameFree(kind: ReferenceKind, name: string, exceptId?: number) {
    const clash = await this.delegate(kind).findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    });
    if (clash) throw new ConflictException(`Another ${LABELS[kind]} named "${clash.name}" already exists.`);
  }
}
