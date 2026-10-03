import { UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  const prisma = { staff: { findUnique: vi.fn() } };
  const jwtService = { signAsync: vi.fn() };
  let service: AuthService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new AuthService(prisma as never, jwtService as never);
  });

  it('returns a safe staff record and signs the expected JWT payload', async () => {
    const passwordHash = await argon2.hash('Test@1234');
    prisma.staff.findUnique.mockResolvedValue({
      id: 7, name: 'Admin', email: 'admin@test.com', passwordHash, isActive: true, role: { name: 'ADMIN', label: 'Admin', capabilities: ['dashboard:view', 'not-a-capability'] },
    });
    jwtService.signAsync.mockResolvedValue('signed-token');

    await expect(service.login('ADMIN@Test.com', 'Test@1234')).resolves.toEqual({
      staff: { id: 7, name: 'Admin', email: 'admin@test.com', role: 'ADMIN', roleLabel: 'Admin', capabilities: ['dashboard:view'] },
      token: 'signed-token',
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith({ sub: 7, email: 'admin@test.com' });
  });

  it('rejects inactive staff with the same response as bad credentials', async () => {
    prisma.staff.findUnique.mockResolvedValue({ isActive: false });
    await expect(service.login('admin@test.com', 'Test@1234')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
