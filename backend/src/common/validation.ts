import { Transform } from 'class-transformer';

export const TIME_HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const TIME_MESSAGE = 'must be a 24-hour time such as 12:30';
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const Trim = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
export const TrimToNull = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value));
const lower = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
/** Trims and lowercases a string, or each string in an array. */
export const Lowercase = () =>
  Transform(({ value }: { value: unknown }) => (Array.isArray(value) ? value.map(lower) : lower(value)));

export const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

export const emailDomainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

/**
 * DTO instances carry `undefined` for every omitted field, so `{ ...defaults, ...dto }` would wipe the defaults.
 * Merge `definedOnly(dto)` instead.
 */
export const definedOnly = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
