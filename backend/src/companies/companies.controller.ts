import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IdPipe } from '../common/id.pipe.js';
import { Authorize } from '../auth/authorize.decorator.js';
import { Capability } from '../auth/capabilities.js';
import { CompaniesService } from './companies.service.js';
import {
  AddressDto,
  CompanyHolidayDto,
  CreateCompanyDto,
  DomainDto,
  ListCompaniesQueryDto,
  UpdateAddressDto,
  UpdateCompanyDto,
} from './dto/company.dto.js';

@Controller('companies')
@Authorize(Capability.COMPANIES_MANAGE)
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  list(@Query() query: ListCompaniesQueryDto) {
    return this.companies.list(query);
  }

  @Get('driver-options')
  driverOptions() {
    return this.companies.driverOptions();
  }

  @Post()
  create(@Body() body: CreateCompanyDto) {
    return this.companies.create(body);
  }

  @Get(':id')
  get(@Param('id', IdPipe) id: number) {
    return this.companies.get(id);
  }

  @Patch(':id')
  update(@Param('id', IdPipe) id: number, @Body() body: UpdateCompanyDto) {
    return this.companies.update(id, body);
  }

  @Post(':id/deactivate')
  deactivate(@Param('id', IdPipe) id: number) {
    return this.companies.setActive(id, false);
  }

  @Post(':id/reactivate')
  reactivate(@Param('id', IdPipe) id: number) {
    return this.companies.setActive(id, true);
  }

  @Post(':id/domains')
  addDomain(@Param('id', IdPipe) id: number, @Body() body: DomainDto) {
    return this.companies.addDomain(id, body.domain);
  }

  @Delete(':id/domains/:domainId')
  removeDomain(@Param('id', IdPipe) id: number, @Param('domainId', IdPipe) domainId: number) {
    return this.companies.removeDomain(id, domainId);
  }

  @Post(':id/addresses')
  addAddress(@Param('id', IdPipe) id: number, @Body() body: AddressDto) {
    return this.companies.addAddress(id, body);
  }

  @Patch(':id/addresses/:addressId')
  updateAddress(
    @Param('id', IdPipe) id: number,
    @Param('addressId', IdPipe) addressId: number,
    @Body() body: UpdateAddressDto,
  ) {
    return this.companies.updateAddress(id, addressId, body);
  }

  @Post(':id/holidays')
  addHoliday(@Param('id', IdPipe) id: number, @Body() body: CompanyHolidayDto) {
    return this.companies.addHoliday(id, body);
  }

  @Delete(':id/holidays/:holidayId')
  removeHoliday(@Param('id', IdPipe) id: number, @Param('holidayId', IdPipe) holidayId: number) {
    return this.companies.removeHoliday(id, holidayId);
  }
}
