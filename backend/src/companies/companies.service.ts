import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { Capability } from '../auth/capabilities.js';
import { pageArgs, type Page } from '../common/pagination.js';
import { definedOnly, emailDomainOf, minutesOf } from '../common/validation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { fromDbDate, toDbDate } from '../settings/kitchen-calendar.js';
import { SettingsService } from '../settings/settings.service.js';
import type {
  AddressDto,
  CompanyHolidayDto,
  CreateCompanyDto,
  ListCompaniesQueryDto,
  UpdateAddressDto,
  UpdateCompanyDto,
} from './dto/company.dto.js';

/** Orders that have not reached cut-off yet; these are the ones a company or employee change can disrupt. */
export const OPEN_ORDER_STATUSES: OrderStatus[] = [OrderStatus.DRAFT, OrderStatus.PLACED];

type Tx = Prisma.TransactionClient;

const listSelect = {
  id: true,
  name: true,
  isActive: true,
  defaultDeliveryTime: true,
  domains: { select: { domain: true }, orderBy: { domain: 'asc' } },
  owner: { select: { id: true, name: true } },
  addresses: { where: { isDefault: true }, select: { label: true, area: true } },
  _count: { select: { employees: { where: { isActive: true } } } },
} satisfies Prisma.CompanySelect;

const detailInclude = {
  domains: { orderBy: { domain: 'asc' } },
  addresses: { orderBy: [{ isActive: 'desc' }, { isDefault: 'desc' }, { label: 'asc' }] },
  holidays: { orderBy: { date: 'asc' } },
  owner: { select: { id: true, name: true, email: true } },
  defaultDriver: { select: { id: true, name: true, isActive: true } },
  defaultPackagingType: { select: { id: true, name: true, isActive: true } },
  _count: { select: { employees: { where: { isActive: true } } } },
} satisfies Prisma.CompanyInclude;

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: ListCompaniesQueryDto): Promise<Page<unknown>> {
    const where: Prisma.CompanyWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { domains: { some: { domain: { contains: query.search.toLowerCase() } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({ where, select: listSelect, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], ...pageArgs(query) }),
      this.prisma.company.count({ where }),
    ]);
    const items = rows.map(({ _count, addresses, domains, ...company }) => ({
      ...company,
      domains: domains.map((entry) => entry.domain),
      defaultAddress: addresses[0] ?? null,
      activeEmployees: _count.employees,
    }));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(id: number) {
    const company = await this.prisma.company.findUnique({ where: { id }, include: detailInclude });
    if (!company) throw new NotFoundException('Company not found.');
    const { _count, holidays, ...rest } = company;
    return {
      ...rest,
      workingDays: [...company.workingDays].sort((a, b) => a - b),
      holidays: holidays.map((holiday) => ({ id: holiday.id, name: holiday.name, date: fromDbDate(holiday.date) })),
      activeEmployees: _count.employees,
    };
  }

  /** Company, its domains, first (default) address and owner employee are created atomically. */
  async create(data: CreateCompanyDto) {
    const { domains, address, owner, ...fields } = data;
    if (!domains.includes(emailDomainOf(owner.email))) {
      throw new BadRequestException(`The owner's email must use one of the company's domains (${domains.join(', ')}).`);
    }
    await this.assertDomainsFree(domains);
    if (await this.prisma.employee.findUnique({ where: { email: owner.email } })) {
      throw new ConflictException(`An employee with email ${owner.email} already exists.`);
    }
    const settings = await this.prisma.kitchenSettings.findUniqueOrThrow({ where: { id: 1 } });
    const merged = { ...fields, dispatchLeadMinutes: fields.dispatchLeadMinutes ?? settings.defaultDispatchLeadMinutes };
    this.assertDeliveryTimes(merged);
    await this.assertDefaults(this.prisma, merged);

    const id = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          ...merged,
          domains: { create: domains.map((domain) => ({ domain })) },
          addresses: { create: { ...address, isDefault: true } },
        },
      });
      const ownerRow = await tx.employee.create({ data: { ...owner, companyId: company.id } });
      await tx.company.update({ where: { id: company.id }, data: { ownerId: ownerRow.id } });
      return company.id;
    });
    return this.get(id);
  }

  async update(id: number, data: UpdateCompanyDto) {
    const current = await this.prisma.company.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Company not found.');
    this.assertDeliveryTimes({ ...current, ...definedOnly(data) });
    await this.assertDefaults(this.prisma, data);
    if (data.ownerId !== undefined) {
      const owner = await this.prisma.employee.findUnique({ where: { id: data.ownerId } });
      if (!owner || owner.companyId !== id || !owner.isActive) {
        throw new BadRequestException('The owner must be an active employee of this company.');
      }
    }
    await this.prisma.company.update({ where: { id }, data });
    return this.get(id);
  }

  /**
   * Deactivation blocks new orders and cancels the company's draft/placed orders that are still before
   * cut-off. Placed orders already past cut-off are locked: they are kept, confirmed by cut-off processing
   * and billed to the company (4.6). Confirmed and later orders are untouched.
   */
  async setActive(id: number, isActive: boolean) {
    await this.findOrThrow(id);
    const openOrders = isActive
      ? []
      : await this.prisma.order.findMany({ where: { companyId: id, status: { in: OPEN_ORDER_STATUSES } }, select: { id: true, deliveryDate: true } });
    const toCancel = await this.settings.idsBeforeCutoff(openOrders);

    const cancelledOrders = await this.prisma.$transaction(async (tx) => {
      await tx.company.update({ where: { id }, data: { isActive } });
      // Status guard: an order confirmed by cut-off processing in the meantime is left alone.
      const { count } = await tx.order.updateMany({
        where: { id: { in: toCancel }, status: { in: OPEN_ORDER_STATUSES } },
        data: { status: OrderStatus.CANCELLED },
      });
      return count;
    });
    return { ...(await this.get(id)), cancelledOrders, lockedOrdersKept: openOrders.length - toCancel.length };
  }

  async addDomain(id: number, domain: string) {
    await this.findOrThrow(id);
    await this.assertDomainsFree([domain]);
    await this.prisma.companyDomain.create({ data: { companyId: id, domain } });
    return this.get(id);
  }

  async removeDomain(id: number, domainId: number) {
    const domain = await this.prisma.companyDomain.findFirst({ where: { id: domainId, companyId: id } });
    if (!domain) throw new NotFoundException('Domain not found for this company.');
    const [domainCount, employeesUsing] = await Promise.all([
      this.prisma.companyDomain.count({ where: { companyId: id } }),
      this.prisma.employee.count({ where: { companyId: id, isActive: true, email: { endsWith: `@${domain.domain}` } } }),
    ]);
    if (domainCount <= 1) throw new BadRequestException('A company needs at least one email domain.');
    if (employeesUsing > 0) {
      throw new BadRequestException(`${employeesUsing} active employee(s) still use @${domain.domain}. Change their emails first.`);
    }
    await this.prisma.companyDomain.delete({ where: { id: domainId } });
    return this.get(id);
  }

  async addAddress(id: number, address: AddressDto) {
    await this.findOrThrow(id);
    const hasDefault = await this.prisma.companyAddress.count({ where: { companyId: id, isDefault: true } });
    await this.prisma.companyAddress.create({ data: { ...address, companyId: id, isDefault: hasDefault === 0 } });
    return this.get(id);
  }

  async updateAddress(id: number, addressId: number, data: UpdateAddressDto) {
    const address = await this.prisma.companyAddress.findFirst({ where: { id: addressId, companyId: id } });
    if (!address) throw new NotFoundException('Address not found for this company.');
    if (data.isDefault === false && address.isDefault) {
      throw new BadRequestException('Make another address the default instead.');
    }
    const willBeDefault = data.isDefault ?? address.isDefault;
    const willBeActive = data.isActive ?? address.isActive;
    if (willBeDefault && !willBeActive) throw new BadRequestException('The default address cannot be deactivated.');

    await this.prisma.$transaction(async (tx) => {
      if (data.isDefault && !address.isDefault) {
        await tx.companyAddress.updateMany({ where: { companyId: id, isDefault: true }, data: { isDefault: false } });
      }
      await tx.companyAddress.update({ where: { id: addressId }, data });
    });
    return this.get(id);
  }

  async addHoliday(id: number, { date, name }: CompanyHolidayDto) {
    await this.findOrThrow(id);
    if (!DateTime.fromISO(date).isValid) throw new BadRequestException(`${date} is not a real calendar date.`);
    await this.prisma.companyHoliday.create({ data: { companyId: id, date: toDbDate(date), name } });
    return this.get(id);
  }

  async removeHoliday(id: number, holidayId: number) {
    const { count } = await this.prisma.companyHoliday.deleteMany({ where: { id: holidayId, companyId: id } });
    if (!count) throw new NotFoundException('Holiday not found for this company.');
    return this.get(id);
  }

  /** Staff who can take deliveries: chosen by capability, never by role name. */
  driverOptions() {
    return this.prisma.staff.findMany({
      where: { isActive: true, role: { capabilities: { has: Capability.DRIVER_DROPS_UPDATE } } },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }

  private async findOrThrow(id: number) {
    const company = await this.prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!company) throw new NotFoundException('Company not found.');
  }

  private async assertDomainsFree(domains: string[]) {
    const taken = await this.prisma.companyDomain.findMany({
      where: { domain: { in: domains } },
      include: { company: { select: { name: true } } },
    });
    if (taken.length) {
      throw new ConflictException(taken.map((entry) => `${entry.domain} already belongs to ${entry.company.name}.`).join(' '));
    }
  }

  private assertDeliveryTimes(values: { defaultDeliveryTime?: string; deliveryWindowStart?: string; deliveryWindowEnd?: string }) {
    const start = values.deliveryWindowStart ?? '12:00';
    const end = values.deliveryWindowEnd ?? '14:00';
    const time = values.defaultDeliveryTime ?? '12:30';
    if (minutesOf(start) >= minutesOf(end)) throw new BadRequestException('The delivery window must start before it ends.');
    if (minutesOf(time) < minutesOf(start) || minutesOf(time) > minutesOf(end)) {
      throw new BadRequestException(`The default delivery time ${time} must be inside the delivery window ${start}–${end}.`);
    }
  }

  private async assertDefaults(db: Tx | PrismaService, values: { defaultDriverId?: number | null; defaultPackagingTypeId?: number | null }) {
    if (values.defaultDriverId) {
      const driver = await db.staff.findFirst({
        where: { id: values.defaultDriverId, isActive: true, role: { capabilities: { has: Capability.DRIVER_DROPS_UPDATE } } },
      });
      if (!driver) throw new BadRequestException('The default driver must be an active staff member who can make deliveries.');
    }
    if (values.defaultPackagingTypeId) {
      const packaging = await db.packagingType.findFirst({ where: { id: values.defaultPackagingTypeId, isActive: true } });
      if (!packaging) throw new BadRequestException('Choose an active packaging type.');
    }
  }
}
