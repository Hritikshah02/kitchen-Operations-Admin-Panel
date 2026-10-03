import { describe, expect, it } from 'vitest';
import { Capability, hasCapabilities } from './capabilities';

describe('capability policy', () => {
  it('grants company management only to admins', () => {
    expect(hasCapabilities('ADMIN', [Capability.COMPANIES_MANAGE])).toBe(true);
    expect(hasCapabilities('KITCHEN', [Capability.COMPANIES_MANAGE])).toBe(false);
    expect(hasCapabilities('DISPATCH', [Capability.COMPANIES_MANAGE])).toBe(false);
    expect(hasCapabilities('DRIVER', [Capability.COMPANIES_MANAGE])).toBe(false);
  });
});
