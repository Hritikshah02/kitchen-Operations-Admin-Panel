export const formatInvoiceNumber = (id: number) => `INV-${String(id).padStart(5, '0')}`;

/** What an order is owed: its total less any credit already netted off it before it was invoiced. */
export const billableAmount = (totalCents: number, nettedCreditCents: number) => Math.max(0, totalCents - nettedCreditCents);

export type OpenCredit = { id: number; amountCents: number };

/**
 * Carries a company's open credits onto a new invoice, oldest first. An invoice is never taken below zero, so a
 * credit that doesn't fit stays open for the next one. Everything is integer cents.
 */
export function applyCredits(subtotalCents: number, credits: OpenCredit[]) {
  let total = subtotalCents;
  const applied: OpenCredit[] = [];
  for (const credit of credits) {
    if (credit.amountCents <= total) {
      applied.push(credit);
      total -= credit.amountCents;
    }
  }
  return { applied, totalCents: total };
}

export type Combination = { id: number; label: string; quantity: number; unitPriceCents: number };
export type Missing = { combinationId: number; missingQuantity: number };

/** Partial credit for the missing items of a short delivery: missing quantity × that combination's unit price. */
export function shortDeliveryCredit(combinations: Combination[], missing: Missing[]) {
  const errors: string[] = [];
  const parts: string[] = [];
  let amountCents = 0;
  const seen = new Set<number>();
  for (const entry of missing) {
    const combination = combinations.find((candidate) => candidate.id === entry.combinationId);
    if (!combination) { errors.push(`Item ${entry.combinationId} is not on this order.`); continue; }
    if (seen.has(entry.combinationId)) { errors.push(`${combination.label} is listed twice.`); continue; }
    seen.add(entry.combinationId);
    if (entry.missingQuantity > combination.quantity) { errors.push(`${combination.label}: only ${combination.quantity} were ordered.`); continue; }
    amountCents += combination.unitPriceCents * entry.missingQuantity;
    parts.push(`${entry.missingQuantity} × ${combination.label}`);
  }
  if (!errors.length && amountCents === 0) errors.push('Enter at least one missing item.');
  return { amountCents, description: parts.join(', '), errors };
}

/** A credit goes straight onto an unpaid invoice; a paid invoice is never modified, so the credit is carried forward. */
export const creditPlacement = (status: 'UNPAID' | 'PAID' | 'VOID') => (status === 'UNPAID' ? 'APPLY_TO_INVOICE' : 'CARRY_FORWARD') as 'APPLY_TO_INVOICE' | 'CARRY_FORWARD';
