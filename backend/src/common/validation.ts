import { Transform } from 'class-transformer';
import { registerDecorator, type ValidationOptions } from 'class-validator';
import { DateTime } from 'luxon';

export const TIME_HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const TIME_MESSAGE = 'must be a 24-hour time such as 12:30';
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Postgres text can't hold NUL bytes, so they are stripped from every string input. */
// eslint-disable-next-line no-control-regex
const clean = (value: string) => value.replace(/\u0000/g, '').trim();
export const Trim = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? clean(value) : value));
export const TrimToNull = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? clean(value) || null : value));

/** A real calendar date written YYYY-MM-DD (2026-13-45 and 2026-02-30 are rejected, not just the format). */
export const isRealDate = (value: unknown) => typeof value === 'string' && ISO_DATE.test(value) && DateTime.fromISO(value, { zone: 'utc' }).isValid;
export function IsRealDate(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({ name: 'isRealDate', target: target.constructor, propertyName, options: { message: `${propertyName} must be a real date in YYYY-MM-DD format.`, ...options }, validator: { validate: isRealDate } });
}
const lower = (value: unknown) => (typeof value === 'string' ? clean(value).toLowerCase() : value);
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
