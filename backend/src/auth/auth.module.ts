import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppThrottlerGuard } from './app-throttler.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CapabilitiesGuard } from './capabilities.guard.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtStrategy, jwtSecret } from './jwt.strategy.js';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: jwtSecret(),
      signOptions: { expiresIn: '8h' },
    }),
    // Everyone reaches the API through the frontend's proxy, so one IP carries many users (and the boards poll): keep this generous.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    CapabilitiesGuard,
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
  exports: [JwtAuthGuard, CapabilitiesGuard],
})
export class AuthModule {}
