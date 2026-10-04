import { Module } from '@nestjs/common';
import { MenuModule } from '../menu/menu.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { DemoScheduler } from './demo-scheduler.js';
import { DemoController } from './demo.controller.js';
import { DemoOrdersService } from './demo-orders.service.js';

@Module({
  imports: [MenuModule, SettingsModule],
  controllers: [DemoController],
  providers: [DemoOrdersService, DemoScheduler],
  exports: [DemoOrdersService],
})
export class DemoModule {}
