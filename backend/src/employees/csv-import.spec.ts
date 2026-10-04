import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_ROWS, parseCsv, validateImport, type ImportContext } from './csv-import.js';

const ctx: ImportContext = {
  domains: ['acme.in'], existingEmails: new Set(['taken@acme.in']),
  allergens: new Map([['peanuts', 1], ['milk', 2]]), dietaryTags: new Map([['jain', 7]]),
};

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, commas and newlines inside cells, CRLF and a BOM', () => {
    const rows = parseCsv('﻿name,email\r\n"Rao, Meera","m@acme.in"\r\n"Say ""hi""","a\nb"\r\n');
    expect(rows.map((row) => row.cells)).toEqual([['name', 'email'], ['Rao, Meera', 'm@acme.in'], ['Say "hi"', 'a\nb']]);
  });
  it('skips blank lines but keeps real line numbers', () => {
    const rows = parseCsv('name,email\n\nA,a@acme.in\n');
    expect(rows.map((row) => row.line)).toEqual([1, 3]);
  });
});

describe('validateImport', () => {
  const run = (text: string) => validateImport(parseCsv(text), ctx);

  it('accepts a good row, with flags, allergies and preferences', () => {
    const result = run('Name,Email,Allergies,Dietary preferences,Can choose address\nMeera Rao,Meera@Acme.in,Peanuts; Milk,Jain,yes');
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[0].data).toMatchObject({ email: 'meera@acme.in', allergenIds: [1, 2], dietaryTagIds: [7], canChooseAddress: true, canChangePackaging: false });
  });

  it('reports every problem per row without rejecting the file', () => {
    const result = run('name,email,allergies,can_change_packaging\nGood Person,good@acme.in,,\nX,not-an-email,,\nBad Domain,b@other.com,,\nTaken,taken@acme.in,,\nDup,good@acme.in,,\nAllergic,al@acme.in,Pollen,maybe');
    const [good, bad, domain, taken, dup, allergic] = result.rows;
    expect(good.data).not.toBeNull();
    expect(bad.errors.join(' ')).toMatch(/2 to 80/);
    expect(bad.errors.join(' ')).toMatch(/not a valid email/);
    expect(domain.errors[0]).toMatch(/@acme\.in/);
    expect(taken.errors[0]).toMatch(/already exists/);
    expect(dup.errors[0]).toMatch(/Same email as line 2/);
    expect(allergic.errors.join(' ')).toMatch(/Unknown allergy "Pollen"/);
    expect(allergic.errors.join(' ')).toMatch(/use yes or no/);
    expect(result.rows.filter((row) => row.data).length).toBe(1);
  });

  it('needs name and email columns, and lists columns it ignores', () => {
    expect(run('name,phone\nA,1').fileErrors[0]).toMatch(/header/);
    expect(run('name,email,favourite colour\nAnn Lee,ann@acme.in,blue').ignoredColumns).toEqual(['favourite colour']);
  });

  it('refuses an empty file or too many rows', () => {
    expect(run('').fileErrors[0]).toMatch(/empty/);
    const big = `name,email\n${Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => `Person ${index},p${index}@acme.in`).join('\n')}`;
    expect(run(big).fileErrors[0]).toMatch(/at most/);
  });
});
