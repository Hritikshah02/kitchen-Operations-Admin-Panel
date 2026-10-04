import { Controller, Get, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { Authorize } from '../auth/authorize.decorator.js';
import { Capability } from '../auth/capabilities.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get() @Authorize(Capability.DASHBOARD_VIEW)
  get(@Req() request: AuthenticatedRequest) { return this.dashboard.forStaff(request.user); }
}
