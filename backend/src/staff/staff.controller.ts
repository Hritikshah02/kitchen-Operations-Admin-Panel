import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IdPipe } from '../common/id.pipe.js';
import { Authorize } from '../auth/authorize.decorator.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { Capability } from '../auth/capabilities.js';
import { CreateStaffDto, ListStaffQueryDto, ResetPasswordDto, UpdateStaffDto } from './staff.dto.js';
import { StaffService } from './staff.service.js';

@Controller()
@Authorize(Capability.STAFF_MANAGE)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('roles')
  listRoles() {
    return this.staff.listRoles();
  }

  @Get('staff')
  list(@Query() query: ListStaffQueryDto) {
    return this.staff.list(query);
  }

  @Post('staff')
  create(@Body() body: CreateStaffDto) {
    return this.staff.create(body);
  }

  @Patch('staff/:id')
  update(@Req() request: AuthenticatedRequest, @Param('id', IdPipe) id: number, @Body() body: UpdateStaffDto) {
    return this.staff.update(request.user.id, id, body);
  }

  @Post('staff/:id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Param('id', IdPipe) id: number, @Body() body: ResetPasswordDto) {
    return this.staff.resetPassword(id, body.password);
  }
}
