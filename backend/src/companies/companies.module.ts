import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';

@Module({
  imports: [SettingsModule],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
