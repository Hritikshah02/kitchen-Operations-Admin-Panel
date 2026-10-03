import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedStaff, JwtPayload, RoleName } from './auth.types.js';

const invalidCredentials = () => new UnauthorizedException('Invalid email or password.');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string): Promise<{ staff: AuthenticatedStaff; token: string }> {
    const staff = await this.prisma.staff.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { role: true },
    });

    if (!staff || !staff.isActive || !(await argon2.verify(staff.passwordHash, password))) {
      throw invalidCredentials();
    }

    const safeStaff = this.toAuthenticatedStaff(staff);
    const payload: JwtPayload = { sub: safeStaff.id, email: safeStaff.email, role: safeStaff.role };
    return { staff: safeStaff, token: await this.jwtService.signAsync(payload) };
  }

  async validateJwt(payload: JwtPayload): Promise<AuthenticatedStaff> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });

    if (!staff || !staff.isActive) throw invalidCredentials();
    return this.toAuthenticatedStaff(staff);
  }

  private toAuthenticatedStaff(staff: {
    id: number;
    name: string;
    email: string;
    role: { name: string };
  }): AuthenticatedStaff {
    return { id: staff.id, name: staff.name, email: staff.email, role: staff.role.name as RoleName };
  }
}
