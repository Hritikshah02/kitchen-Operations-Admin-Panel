import { describe, expect, it } from 'vitest';
import { Capability, hasCapabilities, parseCapabilities } from './capabilities.js';

describe('capability policy', () => {
  const admin = [Capability.DASHBOARD_VIEW, Capability.COMPANIES_MANAGE, Capability.STAFF_MANAGE];
  const kitchen = [Capability.DASHBOARD_VIEW, Capability.KITCHEN_BOARD_VIEW, Capability.KITCHEN_BOARD_UPDATE];

  it('grants a request only when every required capability is held', () => {
    expect(hasCapabilities(admin, [Capability.COMPANIES_MANAGE])).toBe(true);
    expect(hasCapabilities(kitchen, [Capability.COMPANIES_MANAGE])).toBe(false);
    expect(hasCapabilities(kitchen, [Capability.KITCHEN_BOARD_VIEW, Capability.KITCHEN_BOARD_UPDATE])).toBe(true);
    expect(hasCapabilities(kitchen, [Capability.KITCHEN_BOARD_VIEW, Capability.STAFF_MANAGE])).toBe(false);
  });

  it('allows any signed-in staff when nothing is required', () => {
    expect(hasCapabilities([], [])).toBe(true);
  });

  it('ignores capability strings the code does not know', () => {
    expect(parseCapabilities(['kitchen-board:view', 'launch:missiles'])).toEqual([Capability.KITCHEN_BOARD_VIEW]);
  });
});
