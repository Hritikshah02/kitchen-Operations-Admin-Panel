import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OPEN_ORDER_STATUSES } from '../companies/companies.service.js';
import { pageArgs, type Page } from '../common/pagination.js';
import { emailDomainOf } from '../common/validation.js';
import { cancelOpenOrders } from '../orders/system-cancel.js';
import { parseCsv, validateImport } from './csv-import.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { CreateEmployeeDto, ImportEmployeesDto, ListEmployeesQueryDto, MoveEmployeeDto, UpdateEmployeeDto } from './employee.dto.js';

const employeeSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  isActive: true,
  updatedAt: true,
  canChooseAddress: true,
  canChangeDeliveryTime: true,
  canChangePackaging: true,
  company: { select: { id: true, name: true, isActive: true, ownerId: true } },
  allergens: { select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } },
  dietaryTags: { select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.EmployeeSelect;

type EmployeeRow = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>;
const present = ({ company, ...employee }: EmployeeRow) => ({
  ...employee,
  company: { id: company.id, name: company.name, isActive: company.isActive },
  isOwner: company.ownerId === employee.id,
});

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: ListEmployeesQueryDto): Promise<Page<ReturnType<typeof present>>> {
    const where: Prisma.EmployeeWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({ where, select: employeeSelect, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], ...pageArgs(query) }),
      this.prisma.employee.count({ where }),
    ]);
    return { items: rows.map(present), total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: number) {
    const employee = await this.prisma.employee.findUnique({ where: { id }, select: employeeSelect });
    if (!employee) throw new NotFoundException('Employee not found.');
    return present(employee);
  }

  async create(data: CreateEmployeeDto) {
    const { allergenIds, dietaryTagIds, ...fields } = data;
    const company = await this.prisma.company.findUnique({ where: { id: data.companyId }, include: { domains: true } });
    if (!company) throw new BadRequestException('Choose a valid company.');
    if (!company.isActive) throw new BadRequestException(`${company.name} is deactivated; reactivate it before adding employees.`);
    this.assertEmailMatchesDomains(data.email, company.name, company.domains.map((entry) => entry.domain));
    await this.assertEmailFree(data.email);
    await this.assertReferences(allergenIds, dietaryTagIds);

    const employee = await this.prisma.employee.create({
      data: { ...fields, ...this.connect(allergenIds, dietaryTagIds, 'connect') },
      select: { id: true },
    });
    return this.get(employee.id);
  }

  /**
   * Bulk import (4.5): every row is checked on its own and the file is never rejected as a whole. Valid rows are
   * created, bad rows are reported with their line number and reason. `dryRun` only reports.
   */
  async importCsv({ companyId, csv, dryRun }: ImportEmployeesDto) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, include: { domains: true } });
    if (!company) throw new BadRequestException('Choose a valid company.');
    if (!company.isActive) throw new BadRequestException(`${company.name} is deactivated; reactivate it before adding employees.`);
    const rows = parseCsv(csv);
    const emails = rows.slice(1).map((row) => row.cells.find((cell) => cell.includes('@'))?.trim().toLowerCase()).filter((email): email is string => Boolean(email));
    const [existing, allergens, tags] = await Promise.all([
      this.prisma.employee.findMany({ where: { email: { in: emails } }, select: { email: true } }),
      this.prisma.allergen.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
      this.prisma.dietaryTag.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    ]);
    const byName = (list: { id: number; name: string }[]) => new Map(list.map((entry) => [entry.name.toLowerCase(), entry.id]));
    const checked = validateImport(rows, { domains: company.domains.map((entry) => entry.domain), existingEmails: new Set(existing.map((entry) => entry.email)), allergens: byName(allergens), dietaryTags: byName(tags) });

    const failures = checked.rows.filter((row) => row.errors.length).map((row) => ({ line: row.line, email: row.email, name: row.name, errors: row.errors }));
    let imported = 0;
    for (const row of checked.rows) {
      if (!row.data || dryRun) continue;
      const { allergenIds, dietaryTagIds, ...fields } = row.data;
      try {
        await this.prisma.employee.create({ data: { ...fields, companyId, ...this.connect(allergenIds, dietaryTagIds, 'connect') } });
        imported++;
      } catch (error) {
        // Lost a race (the same email was added in the meantime): report the row like any other bad row.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') failures.push({ line: row.line, email: row.email, name: row.name, errors: ['An employee with this email already exists.'] });
        else throw error;
      }
    }
    failures.sort((a, b) => a.line - b.line);
    return {
      company: company.name, dryRun: Boolean(dryRun), total: checked.rows.length, valid: checked.rows.filter((row) => row.data).length, imported,
      failed: failures.length, failures, fileErrors: checked.fileErrors, ignoredColumns: checked.ignoredColumns,
    };
  }

  async update(id: number, data: UpdateEmployeeDto) {
    const { allergenIds, dietaryTagIds, ...fields } = data;
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: { company: { include: { domains: true } }, ownerOf: { select: { id: true } } },
    });
    if (!employee) throw new NotFoundException('Employee not found.');

    if (data.email && data.email !== employee.email) {
      this.assertEmailMatchesDomains(data.email, employee.company.name, employee.company.domains.map((entry) => entry.domain));
      await this.assertEmailFree(data.email);
    }
    if (data.isActive === true && !employee.isActive) {
      // Reactivating must not resurrect an email whose domain the company no longer owns.
      this.assertEmailMatchesDomains(data.email ?? employee.email, employee.company.name, employee.company.domains.map((entry) => entry.domain));
    }
    if (data.isActive === false && employee.ownerOf) {
      throw new BadRequestException(`${employee.name} is the owner of ${employee.company.name}. Choose another owner first.`);
    }
    await this.assertReferences(allergenIds, dietaryTagIds);

    // Deactivating cancels the employee's draft/placed orders that are still before cut-off; locked ones are kept
    // (and billed to the company, 4.6), like when an employee moves.
    const deactivating = data.isActive === false && employee.isActive;
    const openOrders = deactivating ? await this.prisma.order.findMany({ where: { employeeId: id, status: { in: OPEN_ORDER_STATUSES } }, select: { id: true, deliveryDate: true } }) : [];
    const toCancel = await this.settings.idsBeforeCutoff(openOrders);
    const cancelledOrders = await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id }, data: { ...fields, ...this.connect(allergenIds, dietaryTagIds, 'set') } });
      return cancelOpenOrders(tx, toCancel, `${employee.name} was deactivated`);
    });
    return { ...(await this.get(id)), cancelledOrders, lockedOrdersKept: openOrders.length - toCancel.length };
  }

  /**
   * Moving changes which company's rules (domains, calendar, prices, menu, permissions) apply.
   * - Draft/placed orders still before their cut-off were made under the old company's rules: cancelled.
   * - Placed orders already past cut-off are locked and about to become billable: kept on the old company,
   *   cut-off processing confirms them as usual.
   * - Confirmed and later orders keep their company and stay billed to it.
   * - Permission flags are reset to the new company's choice (none unless given).
   */
  async move(id: number, { companyId, email, ...flags }: MoveEmployeeDto) {
    const employee = await this.prisma.employee.findUnique({ where: { id }, include: { ownerOf: { select: { id: true } }, company: true } });
    if (!employee) throw new NotFoundException('Employee not found.');
    if (employee.companyId === companyId) throw new BadRequestException('The employee already belongs to this company.');
    if (employee.ownerOf) {
      throw new BadRequestException(`${employee.name} is the owner of ${employee.company.name}. Choose another owner first.`);
    }
    const target = await this.prisma.company.findUnique({ where: { id: companyId }, include: { domains: true } });
    if (!target || !target.isActive) throw new BadRequestException('Choose an active company to move to.');
    this.assertEmailMatchesDomains(email, target.name, target.domains.map((entry) => entry.domain));
    if (email !== employee.email) await this.assertEmailFree(email);

    const openOrders = await this.prisma.order.findMany({
      where: { employeeId: id, status: { in: OPEN_ORDER_STATUSES } },
      select: { id: true, deliveryDate: true },
    });
    const toCancel = await this.settings.idsBeforeCutoff(openOrders);

    const cancelledOrders = await this.prisma.$transaction(async (tx) => {
      // Status guard: an order confirmed by cut-off processing in the meantime is left alone.
      const count = await cancelOpenOrders(tx, toCancel, `${employee.name} moved to ${target.name}`);
      await tx.employee.update({
        where: { id },
        data: {
          companyId,
          email,
          canChooseAddress: flags.canChooseAddress ?? false,
          canChangeDeliveryTime: flags.canChangeDeliveryTime ?? false,
          canChangePackaging: flags.canChangePackaging ?? false,
        },
      });
      return count;
    });
    return { ...(await this.get(id)), cancelledOrders, lockedOrdersKept: openOrders.length - toCancel.length };
  }

  private connect(allergenIds: number[] | undefined, dietaryTagIds: number[] | undefined, mode: 'connect' | 'set') {
    const ids = (values: number[]) => values.map((value) => ({ id: value }));
    return {
      ...(allergenIds ? { allergens: { [mode]: ids(allergenIds) } } : {}),
      ...(dietaryTagIds ? { dietaryTags: { [mode]: ids(dietaryTagIds) } } : {}),
    };
  }

  private assertEmailMatchesDomains(email: string, companyName: string, domains: string[]) {
    if (!domains.includes(emailDomainOf(email))) {
      throw new BadRequestException(`Employees of ${companyName} must use an email at ${domains.map((domain) => `@${domain}`).join(' or ')}.`);
    }
  }

  private async assertEmailFree(email: string) {
    if (await this.prisma.employee.findUnique({ where: { email } })) {
      throw new ConflictException(`An employee with email ${email} already exists.`);
    }
  }

  private async assertReferences(allergenIds?: number[], dietaryTagIds?: number[]) {
    if (allergenIds?.length) {
      const found = await this.prisma.allergen.count({ where: { id: { in: allergenIds }, isActive: true } });
      if (found !== allergenIds.length) throw new BadRequestException('One or more allergies are unknown or inactive.');
    }
    if (dietaryTagIds?.length) {
      const found = await this.prisma.dietaryTag.count({ where: { id: { in: dietaryTagIds }, isActive: true } });
      if (found !== dietaryTagIds.length) throw new BadRequestException('One or more dietary preferences are unknown or inactive.');
    }
  }
}
