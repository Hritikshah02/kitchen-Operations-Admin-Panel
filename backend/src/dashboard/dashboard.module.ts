import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module.js';
import { KitchenModule } from '../kitchen/kitchen.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({ imports: [SettingsModule, KitchenModule, DispatchModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
