import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { DispatchController, DriverController } from './dispatch.controller.js';
import { DispatchService } from './dispatch.service.js';

@Module({ imports: [SettingsModule, CatalogueModule], controllers: [DispatchController, DriverController], providers: [DispatchService] })
export class DispatchModule {}
