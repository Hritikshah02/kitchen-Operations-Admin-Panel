import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import argon2 from 'argon2';
import { Capability, parseCapabilities } from '../auth/capabilities.js';
import { pageArgs, type Page } from '../common/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateStaffDto, ListStaffQueryDto, UpdateStaffDto } from './staff.dto.js';

const staffSelect = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  createdAt: true,
  role: { select: { id: true, name: true, label: true } },
} satisfies Prisma.StaffSelect;

export type StaffSummary = Prisma.StaffGetPayload<{ select: typeof staffSelect }>;

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListStaffQueryDto): Promise<Page<StaffSummary>> {
    const where: Prisma.StaffWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.roleId ? { roleId: query.roleId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.staff.findMany({ where, select: staffSelect, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], ...pageArgs(query) }),
      this.prisma.staff.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async listRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: { id: 'asc' },
      include: { _count: { select: { staff: { where: { isActive: true } } } } },
    });
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      label: role.label,
      capabilities: parseCapabilities(role.capabilities),
      activeStaff: role._count.staff,
    }));
  }

  async create(data: CreateStaffDto) {
    await this.assertRoleExists(data.roleId);
    if (await this.prisma.staff.findUnique({ where: { email: data.email } })) {
      throw new ConflictException(`A staff account for ${data.email} already exists.`);
    }
    const passwordHash = await argon2.hash(data.password, { type: argon2.argon2id });
    return this.prisma.staff.create({
      data: { name: data.name, email: data.email, passwordHash, roleId: data.roleId },
      select: staffSelect,
    });
  }

  async update(actorId: number, id: number, data: UpdateStaffDto) {
    await this.findOrThrow(id);
    if (data.roleId) await this.assertRoleExists(data.roleId);
    if (id === actorId && data.isActive === false) throw new BadRequestException('You cannot deactivate your own account.');

    // Apply the change and verify that someone can still manage staff, atomically.
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.staff.update({ where: { id }, data, select: staffSelect });
      const managers = await tx.staff.count({
        where: { isActive: true, role: { capabilities: { has: Capability.STAFF_MANAGE } } },
      });
      if (managers === 0) {
        throw new BadRequestException('This change would leave no active staff member who can manage staff.');
      }
      return updated;
    });
  }

  async resetPassword(id: number, password: string) {
    await this.findOrThrow(id);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.staff.update({ where: { id }, data: { passwordHash } });
  }

  private async findOrThrow(id: number) {
    const staff = await this.prisma.staff.findUnique({ where: { id }, select: { id: true } });
    if (!staff) throw new NotFoundException('Staff member not found.');
    return staff;
  }

  private async assertRoleExists(roleId: number) {
    if (!(await this.prisma.role.findUnique({ where: { id: roleId } }))) {
      throw new BadRequestException('Choose a valid role.');
    }
  }
}
