import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { KitchenController } from './kitchen.controller.js';
import { KitchenService } from './kitchen.service.js';

@Module({ imports: [SettingsModule], controllers: [KitchenController], providers: [KitchenService], exports: [KitchenService] })
export class KitchenModule {}
