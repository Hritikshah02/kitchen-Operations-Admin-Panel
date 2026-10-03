import { Module } from '@nestjs/common';
import { MenuModule } from '../menu/menu.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { CutoffService } from './cutoff.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [MenuModule, SettingsModule],
  controllers: [OrdersController],
  providers: [OrdersService, CutoffService],
  exports: [OrdersService, CutoffService],
})
export class OrdersModule {}
