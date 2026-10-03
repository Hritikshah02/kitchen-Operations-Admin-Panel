// Money travels as integer cents. Parsing is string-based so "2.15" never becomes 214.99999.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const formatCents = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : usd.format(cents / 100));

/** "2.15" | "$2.15" | "2" -> 215; null if not a valid non-negative amount with at most 2 decimals. */
export function parseDollars(input: string): number | null {
  const match = input.trim().replace(/^\$/, "").match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export const centsToInput = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2));
