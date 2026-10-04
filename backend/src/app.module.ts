import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { DemoModule } from './demo/demo.module.js';
import { EmployeesModule } from './employees/employees.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { MenuModule } from './menu/menu.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { KitchenModule } from './kitchen/kitchen.module.js';
import { DispatchModule } from './dispatch/dispatch.module.js';
import { BillingModule } from './billing/billing.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { PricingModule } from './pricing/pricing.module.js';
import { ReferenceDataModule } from './reference-data/reference-data.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { StaffModule } from './staff/staff.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [PrismaModule, AuthModule, SettingsModule, ReferenceDataModule, StaffModule, CompaniesModule, EmployeesModule, CatalogueModule, PricingModule, MenuModule, OrdersModule, KitchenModule, DispatchModule, BillingModule, DashboardModule, DemoModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
