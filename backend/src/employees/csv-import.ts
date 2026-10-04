/** Bulk import of a company's employees (4.5 [Should]): parsing and row-level validation, no database access. */

export const MAX_IMPORT_ROWS = 500;
const PHONE = /^\+?[0-9 ()-]{7,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CsvRow = { line: number; cells: string[] };

/** RFC 4180 style: quoted cells, "" for a quote, commas and newlines inside quotes, CRLF or LF, optional BOM. */
export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const input = text.replace(/^﻿/, '');
  const endRow = () => {
    cells.push(cell);
    if (cells.some((entry) => entry.trim() !== '')) rows.push({ line: rowLine, cells });
    cells = []; cell = '';
  };
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else { if (char === '\n') line++; cell += char; }
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ',') { cells.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index++;
      endRow(); line++; rowLine = line;
    } else cell += char;
  }
  if (cell !== '' || cells.length) endRow();
  return rows;
}

const HEADERS: Record<string, string> = {
  name: 'name', fullname: 'name', employeename: 'name',
  email: 'email', emailaddress: 'email',
  phone: 'phone', mobile: 'phone', phonenumber: 'phone',
  allergies: 'allergies', allergens: 'allergies', allergy: 'allergies',
  dietary: 'dietary', dietarypreferences: 'dietary', dietarytags: 'dietary', diet: 'dietary',
  canchooseaddress: 'canChooseAddress', canchoosedeliveryaddress: 'canChooseAddress',
  canchangedeliverytime: 'canChangeDeliveryTime', canchangetime: 'canChangeDeliveryTime',
  canchangepackaging: 'canChangePackaging',
};
const normalise = (header: string) => header.toLowerCase().replace(/[^a-z]/g, '');

export type ImportContext = {
  domains: string[];
  existingEmails: ReadonlySet<string>; // lowercase, already in the system (any company)
  allergens: ReadonlyMap<string, number>; // lowercase name → id (active only)
  dietaryTags: ReadonlyMap<string, number>;
};

export type ImportEmployee = {
  name: string; email: string; phone: string | null; allergenIds: number[]; dietaryTagIds: number[];
  canChooseAddress: boolean; canChangeDeliveryTime: boolean; canChangePackaging: boolean;
};
export type ImportRow = { line: number; email: string; name: string; errors: string[]; data: ImportEmployee | null };

const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0', '']);

export function validateImport(rows: CsvRow[], ctx: ImportContext): { rows: ImportRow[]; fileErrors: string[]; ignoredColumns: string[] } {
  if (!rows.length) return { rows: [], fileErrors: ['The file is empty.'], ignoredColumns: [] };
  const [header, ...body] = rows;
  const columns = new Map<string, number>();
  const ignoredColumns: string[] = [];
  header.cells.forEach((raw, index) => {
    const key = HEADERS[normalise(raw)];
    if (key && !columns.has(key)) columns.set(key, index);
    else if (raw.trim()) ignoredColumns.push(raw.trim());
  });
  const fileErrors: string[] = [];
  if (!columns.has('name') || !columns.has('email')) fileErrors.push('The first row must be a header with at least "name" and "email" columns.');
  if (body.length > MAX_IMPORT_ROWS) fileErrors.push(`Import at most ${MAX_IMPORT_ROWS} employees at a time (this file has ${body.length}).`);
  if (fileErrors.length) return { rows: [], fileErrors, ignoredColumns };

  const cell = (row: CsvRow, key: string) => (columns.has(key) ? (row.cells[columns.get(key)!] ?? '').trim() : '');
  const seen = new Map<string, number>();
  const result = body.map((row): ImportRow => {
    const errors: string[] = [];
    const name = cell(row, 'name');
    const email = cell(row, 'email').toLowerCase();
    if (name.length < 2 || name.length > 80) errors.push('Name must be 2 to 80 characters.');
    if (!email) errors.push('Email is missing.');
    else if (!EMAIL.test(email) || email.length > 254) errors.push(`"${email}" is not a valid email address.`);
    else {
      const domain = email.slice(email.lastIndexOf('@') + 1);
      if (!ctx.domains.includes(domain)) errors.push(`Email must be at ${ctx.domains.map((entry) => `@${entry}`).join(' or ')}.`);
      if (ctx.existingEmails.has(email)) errors.push('An employee with this email already exists.');
      if (seen.has(email)) errors.push(`Same email as line ${seen.get(email)}.`);
      else seen.set(email, row.line);
    }
    const phone = cell(row, 'phone');
    if (phone && !PHONE.test(phone)) errors.push('Phone must look like +91 90000 01101.');

    const list = (key: string, known: ReadonlyMap<string, number>, label: string) => {
      const ids: number[] = [];
      for (const part of cell(row, key).split(/[;|]/).map((entry) => entry.trim()).filter(Boolean)) {
        const id = known.get(part.toLowerCase());
        if (id === undefined) errors.push(`Unknown ${label} "${part}".`);
        else if (!ids.includes(id)) ids.push(id);
      }
      return ids;
    };
    const allergenIds = list('allergies', ctx.allergens, 'allergy');
    const dietaryTagIds = list('dietary', ctx.dietaryTags, 'dietary preference');
    const flag = (key: string) => {
      const value = cell(row, key).toLowerCase();
      if (YES.has(value)) return true;
      if (!NO.has(value)) errors.push(`${key}: use yes or no (got "${cell(row, key)}").`);
      return false;
    };
    const flags = { canChooseAddress: flag('canChooseAddress'), canChangeDeliveryTime: flag('canChangeDeliveryTime'), canChangePackaging: flag('canChangePackaging') };
    return { line: row.line, email, name, errors, data: errors.length ? null : { name, email, phone: phone || null, allergenIds, dietaryTagIds, ...flags } };
  });
  return { rows: result, fileErrors: [], ignoredColumns };
}
