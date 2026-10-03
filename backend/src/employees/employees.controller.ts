import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Authorize } from '../auth/authorize.decorator.js';
import { Capability } from '../auth/capabilities.js';
import { CreateEmployeeDto, ListEmployeesQueryDto, MoveEmployeeDto, UpdateEmployeeDto } from './employee.dto.js';
import { EmployeesService } from './employees.service.js';

@Controller('employees')
@Authorize(Capability.COMPANIES_MANAGE)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  list(@Query() query: ListEmployeesQueryDto) {
    return this.employees.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.employees.get(id);
  }

  @Post()
  create(@Body() body: CreateEmployeeDto) {
    return this.employees.create(body);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateEmployeeDto) {
    return this.employees.update(id, body);
  }

  @Post(':id/move')
  move(@Param('id', ParseIntPipe) id: number, @Body() body: MoveEmployeeDto) {
    return this.employees.move(id, body);
  }
}
