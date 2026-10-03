import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [PrismaModule, CompaniesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

