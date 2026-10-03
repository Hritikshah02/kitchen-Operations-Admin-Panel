import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CapabilitiesGuard } from '../auth/capabilities.guard.js';
import { Capability } from '../auth/capabilities.js';
import { RequireCapabilities } from '../auth/require-capabilities.decorator.js';
import { CompaniesService } from './companies.service.js';

@Controller('companies')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
@RequireCapabilities(Capability.COMPANIES_MANAGE)
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  create(@Body() body: { name: string; emailDomain: string }) {
    return this.companiesService.create(body);
  }

  @Get()
  findAll() {
    return this.companiesService.findAll();
  }
}
