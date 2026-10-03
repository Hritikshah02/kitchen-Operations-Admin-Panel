import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { PrismaExceptionFilter } from './common/prisma-exception.filter.js';

/** Request pipeline shared by the real server and the e2e tests, so tests exercise the same validation. */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
}
