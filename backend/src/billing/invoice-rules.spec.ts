import { describe, expect, it } from 'vitest';
import { applyCredits, billableAmount, creditPlacement, formatInvoiceNumber, shortDeliveryCredit } from './invoice-rules.js';

describe('invoice numbers and billable amounts', () => {
  it('pads the number', () => expect(formatInvoiceNumber(42)).toBe('INV-00042'));
  it('nets credits off an order and never goes negative', () => {
    expect(billableAmount(1250, 250)).toBe(1000);
    expect(billableAmount(1250, 5000)).toBe(0);
  });
});

describe('applyCredits', () => {
  it('applies credits oldest first and reduces the total exactly', () => {
    const result = applyCredits(10_000, [{ id: 1, amountCents: 1_250 }, { id: 2, amountCents: 300 }]);
    expect(result.applied.map((credit) => credit.id)).toEqual([1, 2]);
    expect(result.totalCents).toBe(8_450);
  });
  it('never takes an invoice below zero: a credit that does not fit stays open', () => {
    const result = applyCredits(1_000, [{ id: 1, amountCents: 1_500 }, { id: 2, amountCents: 400 }]);
    expect(result.applied.map((credit) => credit.id)).toEqual([2]);
    expect(result.totalCents).toBe(600);
  });
  it('can bring an invoice to exactly zero', () => expect(applyCredits(500, [{ id: 1, amountCents: 500 }]).totalCents).toBe(0));
});

describe('shortDeliveryCredit', () => {
  const items = [{ id: 1, label: 'Mini Thali', quantity: 3, unitPriceCents: 475 }, { id: 2, label: 'Chaas', quantity: 2, unitPriceCents: 125 }];
  it('credits missing quantity × unit price', () => {
    const credit = shortDeliveryCredit(items, [{ combinationId: 1, missingQuantity: 2 }, { combinationId: 2, missingQuantity: 1 }]);
    expect(credit.amountCents).toBe(2 * 475 + 125);
    expect(credit.description).toBe('2 × Mini Thali, 1 × Chaas');
    expect(credit.errors).toEqual([]);
  });
  it('rejects more than ordered, unknown and duplicate items, and empty credits', () => {
    expect(shortDeliveryCredit(items, [{ combinationId: 1, missingQuantity: 4 }]).errors[0]).toMatch(/only 3 were ordered/);
    expect(shortDeliveryCredit(items, [{ combinationId: 9, missingQuantity: 1 }]).errors[0]).toMatch(/not on this order/);
    expect(shortDeliveryCredit(items, [{ combinationId: 1, missingQuantity: 1 }, { combinationId: 1, missingQuantity: 1 }]).errors[0]).toMatch(/twice/);
    expect(shortDeliveryCredit(items, [{ combinationId: 1, missingQuantity: 0 }]).errors[0]).toMatch(/at least one/);
  });
});

describe('creditPlacement', () => {
  it('applies to unpaid invoices and carries forward from paid ones', () => {
    expect(creditPlacement('UNPAID')).toBe('APPLY_TO_INVOICE');
    expect(creditPlacement('PAID')).toBe('CARRY_FORWARD');
  });
});
