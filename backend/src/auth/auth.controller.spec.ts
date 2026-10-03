import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  it('places the signed JWT in an HTTP-only session cookie', async () => {
    const authService = { login: vi.fn().mockResolvedValue({ staff: { id: 1, name: 'Admin', email: 'admin@test.com', role: 'ADMIN' }, token: 'token' }) };
    const response = { cookie: vi.fn() };
    const controller = new AuthController(authService as never);

    await expect(controller.login({ email: 'admin@test.com', password: 'Test@1234' }, response as never)).resolves.toEqual({ id: 1, name: 'Admin', email: 'admin@test.com', role: 'ADMIN' });
    expect(response.cookie).toHaveBeenCalledWith('access_token', 'token', expect.objectContaining({ httpOnly: true, path: '/api', sameSite: 'lax' }));
  });

  it('clears the cookie when staff sign out', () => {
    const response = { clearCookie: vi.fn() };
    new AuthController({} as never).logout(response as never);
    expect(response.clearCookie).toHaveBeenCalledWith('access_token', expect.objectContaining({ httpOnly: true, path: '/api' }));
  });
});
