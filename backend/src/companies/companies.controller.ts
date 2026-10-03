import { Body, Controller, Get, Post } from '@nestjs/common';
import { CompaniesService } from './companies.service.js';

@Controller('companies')
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

