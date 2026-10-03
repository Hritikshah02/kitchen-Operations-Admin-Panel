import { Module } from '@nestjs/common';
import { MenuModule } from '../menu/menu.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { DemoOrdersService } from './demo-orders.service.js';

@Module({
  imports: [MenuModule, SettingsModule],
  providers: [DemoOrdersService],
  exports: [DemoOrdersService],
})
export class DemoModule {}
