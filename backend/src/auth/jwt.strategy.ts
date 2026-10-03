import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from './auth.service.js';
import type { JwtPayload } from './auth.types.js';

export function jwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be configured in production.');
  }
  return 'development-only-secret-change-before-deployment';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([(request) => request?.cookies?.access_token ?? null]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(),
    });
  }

  validate(payload: JwtPayload) {
    return this.authService.validateJwt(payload);
  }
}
