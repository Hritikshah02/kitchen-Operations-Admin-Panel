import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderStatus, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';

describe('Hardening (e2e)', () => {
  let app: INestApplication<App>;
  let admin: ReturnType<typeof request.agent>;
  const prisma = new PrismaClient();
  const run = Date.now().toString(36);
  let companyId: number; let adminId: number; let tierId: number; let addressId: number;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    admin = request.agent(app.getHttpServer());
    await admin.post('/api/auth/login').send({ email: 'admin@test.com', password: 'Test@1234' }).expect(200);
    const company = await prisma.company.findFirstOrThrow({ where: { domains: { some: { domain: 'kalamtantu.com' } } }, include: { addresses: { where: { isDefault: true } } } });
    companyId = company.id; addressId = company.addresses[0].id;
    adminId = (await prisma.staff.findUniqueOrThrow({ where: { email: 'admin@test.com' } })).id;
    tierId = (await prisma.priceTier.findFirstOrThrow()).id;
  });
  afterAll(async () => { await prisma.$disconnect(); await app.close(); });

  it('answers impossible dates with a 400, never a 500', async () => {
    for (const path of ['/api/orders?from=2026-13-45', '/api/kitchen/board?date=2026-13-45', '/api/dispatch/board?date=2026-02-30', '/api/settings/cutoff-preview?from=2026-13-45', '/api/billing/companies/1/uninvoiced?from=2026-00-10']) {
      const response = await admin.get(path);
      expect(response.status, path).toBe(400);
      expect(JSON.stringify(response.body.message)).toMatch(/real date/);
    }
    await admin.post('/api/orders/cutoff/run').send({ deliveryDate: '2026-13-45' }).expect(400);
  });

  it('answers ids and numbers beyond the database range with a 4xx, never a 500', async () => {
    const big = '99999999999';
    for (const path of [`/api/orders/${big}`, `/api/employees/${big}`, `/api/companies/${big}`, `/api/catalogue/dishes/${big}`, `/api/billing/invoices/${big}`, `/api/employees/abc`]) {
      const response = await admin.get(path);
      expect(response.status, path).toBeGreaterThanOrEqual(400);
      expect(response.status, path).toBeLessThan(500);
    }
    for (const path of [`/api/orders?companyId=${big}`, `/api/menu/preview?employeeId=${big}`, '/api/employees?search=%00']) {
      expect((await admin.get(path)).status, path).toBeLessThan(500);
    }
    expect((await admin.post('/api/kitchen/units/99999999999/start')).status).toBeLessThan(500);
    expect((await admin.post('/api/orders/quote').send({ employeeId: 99999999999, deliveryDate: '2031-01-06', lines: [] })).status).toBeLessThan(500);
    expect((await admin.post('/api/billing/invoices').send({ companyId, orderIds: [99999999999] })).status).toBeLessThan(500);
  });

  it('says what is duplicated in plain words', async () => {
    const date = '2031-02-03';
    await admin.post(`/api/companies/${companyId}/holidays`).send({ date, name: 'Test holiday' }).expect(201).catch(() => undefined);
    const again = await admin.post(`/api/companies/${companyId}/holidays`).send({ date, name: 'Test holiday' });
    expect(again.status).toBe(409);
    expect(again.body.message).not.toMatch(/companyId|\bdate\b.*already exists/);
    await prisma.companyHoliday.deleteMany({ where: { companyId, name: 'Test holiday' } });
  });

  it('records cancellations caused by moving or deactivating an employee on the order timeline', async () => {
    const other = await prisma.company.findFirstOrThrow({ where: { id: { not: companyId }, isActive: true }, include: { domains: true } });
    const make = async (suffix: string) => {
      const employee = await prisma.employee.create({ data: { name: `Mover ${run} ${suffix}`, email: `mover.${run}.${suffix}@kalamtantu.com`, companyId } });
      const order = await prisma.order.create({ data: { employeeId: employee.id, companyId, status: OrderStatus.PLACED, deliveryDate: new Date('2034-05-01T00:00:00Z'), deliveryTime: '12:30', addressId, priceTierId: tierId, totalCents: 100, createdById: adminId } });
      return { employee, order };
    };
    const moved = await make('a');
    await admin.post(`/api/employees/${moved.employee.id}/move`).send({ companyId: other.id, email: `mover.${run}.a@${other.domains[0].domain}` }).expect(201);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: moved.order.id }, include: { events: true } });
    expect(after.status).toBe('CANCELLED');
    expect(after.cancelledAt).not.toBeNull();
    expect(after.cancellationReason).toMatch(/moved to/);
    expect(after.version).toBe(2);
    expect(after.events.map((event) => event.type)).toContain('CANCELLED');

    const gone = await make('b');
    const response = await admin.patch(`/api/employees/${gone.employee.id}`).send({ isActive: false }).expect(200);
    expect(response.body.cancelledOrders).toBe(1);
    const cancelled = await prisma.order.findUniqueOrThrow({ where: { id: gone.order.id }, include: { events: true } });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.events.some((event) => event.message.includes('deactivated'))).toBe(true);
  });

  it('refuses an order for a date in the past', async () => {
    const employee = await prisma.employee.create({ data: { name: `Past ${run}`, email: `past.${run}@kalamtantu.com`, companyId } });
    const menu = (await admin.get(`/api/menu/preview?employeeId=${employee.id}`).expect(200)).body as { categories: { items: { id: number; groups: unknown[] }[] }[] };
    const dish = menu.categories.flatMap((category) => category.items).find((entry) => entry.groups.length === 0)!;
    const response = await admin.post('/api/orders/quote').send({ employeeId: employee.id, deliveryDate: '2026-01-05', lines: [{ dishId: dish.id, quantity: 1, combinations: [{ quantity: 1, choices: [] }] }] }).expect(201);
    expect((response.body as { errors: string[] }).errors.join(' ')).toMatch(/in the past/);
    });

  it('limits sign-in per account, so forging X-Forwarded-For does not help', async () => {
    const email = `nobody.${run}@test.com`;
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const response = await request(app.getHttpServer()).post('/api/auth/login').set('X-Forwarded-For', `10.9.${attempt}.1`).send({ email, password: 'wrong-password' });
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
    expect(statuses.slice(0, 5).every((status) => status === 401)).toBe(true);
  });

  it('imports employees from CSV, reporting bad rows without rejecting the file', async () => {
    const csv = [
      'name,email,allergies,dietary preferences,can choose address',
      `Asha Nair,asha.${run}@kalamtantu.com,Peanuts,,yes`,
      `X,broken,,,`,
      `Wrong Domain,w.${run}@gmail.com,,,`,
      `Vimal Shah,vimal.${run}@kalamtantu.com,Pollen,,`,
      `"Shah, Riya",riya.${run}@kalamtantu.com,,,no`,
    ].join('\n');
    const preview = (await admin.post('/api/employees/import').send({ companyId, csv, dryRun: true }).expect(201)).body as { total: number; valid: number; imported: number; failures: { line: number; errors: string[] }[] };
    expect(preview).toMatchObject({ total: 5, valid: 2, imported: 0 });
    expect(await prisma.employee.count({ where: { email: `asha.${run}@kalamtantu.com` } })).toBe(0);
    expect(preview.failures.map((failure) => failure.line)).toEqual([3, 4, 5]);

    const result = (await admin.post('/api/employees/import').send({ companyId, csv }).expect(201)).body as { imported: number; failed: number };
    expect(result).toMatchObject({ imported: 2, failed: 3 });
    const asha = await prisma.employee.findUniqueOrThrow({ where: { email: `asha.${run}@kalamtantu.com` }, include: { allergens: true } });
    expect(asha.canChooseAddress).toBe(true);
    expect(asha.allergens.map((allergen) => allergen.name)).toEqual(['Peanuts']);
    // Importing the same file again creates nothing and says why.
    const again = (await admin.post('/api/employees/import').send({ companyId, csv }).expect(201)).body as { imported: number; failures: { errors: string[] }[] };
    expect(again.imported).toBe(0);
    expect(again.failures.some((failure) => failure.errors.join(' ').includes('already exists'))).toBe(true);
    await admin.post('/api/employees/import').send({ companyId, csv: 'name,phone\nA,1' }).expect(201).then((response) => expect(response.body.fileErrors[0]).toMatch(/header/));
  });
});
