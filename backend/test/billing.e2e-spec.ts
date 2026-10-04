import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderStatus, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';

type Invoice = { id: number; number: string; status: string; totalCents: number; linesTotalCents: number; lines: { type: string; orderId: number | null; amountCents: number }[] };

describe('Billing (e2e)', () => {
  let app: INestApplication<App>;
  let admin: ReturnType<typeof request.agent>;
  let dispatch: ReturnType<typeof request.agent>;
  const prisma = new PrismaClient();
  const run = Date.now().toString(36);
  let companyId: number; let addressId: number; let tierId: number; let adminId: number; let count = 0;
  let companyIds: number[] = [];

  // Each test bills its own company so open credits and uninvoiced orders never leak between tests.
  async function freshCompany() {
    const template = await prisma.company.findFirstOrThrow({ where: { domains: { some: { domain: 'kalamtantu.com' } } }, include: { addresses: { where: { isDefault: true } } } });
    const company = await prisma.company.create({ data: { name: `Bill Co ${run} ${count++}`, billingContactName: 'Accounts', billingContactEmail: `acc.${run}.${count}@example.com`, addresses: { create: { label: 'HQ', line1: '1 Road', city: 'Ahmedabad', pincode: '380001', isDefault: true } } }, include: { addresses: true } });
    companyIds.push(company.id); addressId = company.addresses[0].id; companyId = company.id; tierId = template.priceTierId ?? tierId;
    return company.id;
  }
  async function makeOrder(total: number, status: OrderStatus = OrderStatus.CONFIRMED, items?: { quantity: number; unit: number }[]) {
    const employee = await prisma.employee.create({ data: { name: `Biller ${run} ${count}`, email: `biller.${run}.${count++}@x${companyId}.example.com`, companyId } });
    const dish = await prisma.dish.findFirstOrThrow();
    return prisma.order.create({ data: {
      employeeId: employee.id, companyId, status, deliveryDate: new Date('2033-03-01T00:00:00Z'), deliveryTime: '12:30', addressId, priceTierId: tierId, totalCents: total, createdById: adminId,
      lines: { create: [{ dishId: dish.id, dishName: 'Test Thali', dishSku: 'T-1', quantity: items?.reduce((s, i) => s + i.quantity, 0) ?? 1, unitPriceCents: total, totalCents: total, sortOrder: 10,
        combinations: { create: (items ?? [{ quantity: 1, unit: total }]).map((item, index) => ({ signature: `sig${index}`, quantity: item.quantity, unitPriceCents: item.unit, totalCents: item.quantity * item.unit })) } }] },
    }, include: { lines: { include: { combinations: true } } } });
  }
  const invoice = async (orderIds: number[]) => (await admin.post('/api/billing/invoices').send({ companyId, orderIds }).expect(201)).body as Invoice;
  const fetchInvoice = async (id: number) => (await admin.get(`/api/billing/invoices/${id}`).expect(200)).body as Invoice;
  const version = async (id: number) => (await prisma.order.findUniqueOrThrow({ where: { id } })).version;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    const login = async (email: string) => { const agent = request.agent(app.getHttpServer()); await agent.post('/api/auth/login').send({ email, password: 'Test@1234' }).expect(200); return agent; };
    admin = await login('admin@test.com'); dispatch = await login('dispatch@test.com');
    adminId = (await prisma.staff.findUniqueOrThrow({ where: { email: 'admin@test.com' } })).id;
    tierId = (await prisma.priceTier.findFirstOrThrow()).id;
  });
  afterAll(async () => { await prisma.$disconnect(); await app.close(); });

  it('lists a company’s confirmed, uninvoiced orders only, and needs the billing capability', async () => {
    await freshCompany();
    const a = await makeOrder(1000); await makeOrder(900, OrderStatus.PLACED); await makeOrder(800, OrderStatus.CANCELLED); await makeOrder(700, OrderStatus.REJECTED); const d = await makeOrder(600, OrderStatus.DELIVERED);
    const list = (await admin.get(`/api/billing/companies/${companyId}/uninvoiced`).expect(200)).body as { items: { id: number }[]; total: number };
    expect(list.items.map((item) => item.id).sort()).toEqual([a.id, d.id].sort());
    await dispatch.get(`/api/billing/companies/${companyId}/uninvoiced`).expect(403);
  });

  it('invoices orders, reconciles to the cent, and puts an order on at most one invoice', async () => {
    await freshCompany();
    const a = await makeOrder(1250); const b = await makeOrder(3335);
    const created = await invoice([a.id, b.id]);
    expect(created.number).toMatch(/^INV-\d{5}$/);
    expect(created.totalCents).toBe(4585);
    expect(created.linesTotalCents).toBe(created.totalCents);
    const again = await admin.post('/api/billing/invoices').send({ companyId, orderIds: [a.id] }).expect(409);
    expect(again.body.message).toMatch(/already on an invoice/);
    const list = (await admin.get(`/api/orders?invoiced=true&companyId=${companyId}&pageSize=100`).expect(200)).body as { items: { id: number }[] };
    expect(list.items.map((item) => item.id).sort()).toEqual([a.id, b.id].sort());
    expect(((await admin.get(`/api/orders?invoiced=false&companyId=${companyId}`).expect(200)).body as { total: number }).total).toBe(0);
    await admin.post('/api/billing/invoices').send({ companyId: companyId + 99999, orderIds: [a.id] }).expect(404);
  });

  it('two staff invoicing the same orders at once: exactly one wins', async () => {
    await freshCompany();
    const a = await makeOrder(500);
    const race = await Promise.all([admin.post('/api/billing/invoices').send({ companyId, orderIds: [a.id] }), admin.post('/api/billing/invoices').send({ companyId, orderIds: [a.id] })]);
    expect(race.map((response) => response.status).sort()).toEqual([201, 409]);
  });

  it('marks paid once, and a paid invoice can’t be voided', async () => {
    await freshCompany();
    const created = await invoice([(await makeOrder(1000)).id]);
    await admin.post(`/api/billing/invoices/${created.id}/pay`).expect(201);
    await admin.post(`/api/billing/invoices/${created.id}/pay`).expect(409);
    const refused = await admin.post(`/api/billing/invoices/${created.id}/void`).send({ reason: 'oops' }).expect(409);
    expect(refused.body.message).toMatch(/final/);
  });

  it('voids an unpaid invoice, releases its orders and lets them be invoiced again', async () => {
    await freshCompany();
    const a = await makeOrder(1000); const b = await makeOrder(2000);
    const created = await invoice([a.id, b.id]);
    await admin.post(`/api/billing/invoices/${created.id}/void`).send({ reason: 'Wrong period' }).expect(201);
    expect((await fetchInvoice(created.id)).status).toBe('VOID');
    const second = await invoice([a.id, b.id]);
    expect(second.totalCents).toBe(3000);
    await admin.post(`/api/billing/invoices/${created.id}/void`).send({ reason: 'again' }).expect(409);
  });

  it('cancelling or rejecting before invoicing simply excludes the order', async () => {
    await freshCompany();
    const a = await makeOrder(1000); const b = await makeOrder(2000);
    await admin.post(`/api/orders/${a.id}/cancel`).send({ version: await version(a.id), reason: 'Employee left' }).expect(201);
    await admin.post(`/api/orders/${b.id}/reject`).send({ version: await version(b.id), reason: 'Out of paneer' }).expect(201);
    const list = (await admin.get(`/api/billing/companies/${companyId}/uninvoiced`).expect(200)).body as { total: number };
    expect(list.total).toBe(0);
    expect(await prisma.orderCredit.count({ where: { companyId } })).toBe(0);
  });

  it('cancelling after invoicing credits the order on an unpaid invoice and leaves its lines untouched', async () => {
    await freshCompany();
    const a = await makeOrder(1000); const b = await makeOrder(2000);
    const created = await invoice([a.id, b.id]);
    await admin.post(`/api/orders/${a.id}/cancel`).send({ version: await version(a.id), reason: 'Customer cancelled' }).expect(201);
    const after = await fetchInvoice(created.id);
    expect(after.totalCents).toBe(2000);
    expect(after.linesTotalCents).toBe(after.totalCents);
    expect(after.lines.find((line) => line.type === 'ORDER' && line.orderId === a.id)?.amountCents).toBe(1000);
    expect(after.lines.filter((line) => line.type === 'CREDIT').map((line) => line.amountCents)).toEqual([-1000]);
  });

  it('after invoicing a paid invoice, a rejection is carried forward to the company’s next invoice', async () => {
    await freshCompany();
    const a = await makeOrder(1000);
    const paid = await invoice([a.id]);
    await admin.post(`/api/billing/invoices/${paid.id}/pay`).expect(201);
    await admin.post(`/api/orders/${a.id}/reject`).send({ version: await version(a.id), reason: 'Kitchen could not fulfil' }).expect(201);
    const untouched = await fetchInvoice(paid.id);
    expect(untouched.totalCents).toBe(1000);
    expect(untouched.lines).toHaveLength(1);
    const credit = await prisma.orderCredit.findFirstOrThrow({ where: { companyId } });
    expect(credit.status).toBe('OPEN');
    expect(credit.amountCents).toBe(1000);

    const b = await makeOrder(2500);
    const next = await invoice([b.id]);
    expect(next.totalCents).toBe(1500);
    expect(next.linesTotalCents).toBe(1500);
    expect((await prisma.orderCredit.findUniqueOrThrow({ where: { id: credit.id } })).status).toBe('APPLIED');
  });

  it('a credit bigger than the next invoice stays open and never makes a total negative', async () => {
    await freshCompany();
    const a = await makeOrder(3000);
    const paid = await invoice([a.id]);
    await admin.post(`/api/billing/invoices/${paid.id}/pay`).expect(201);
    await admin.post(`/api/orders/${a.id}/cancel`).send({ version: await version(a.id), reason: 'Cancelled' }).expect(201);
    const small = await makeOrder(1000);
    const next = await invoice([small.id]);
    expect(next.totalCents).toBe(1000);
    expect((await prisma.orderCredit.findFirstOrThrow({ where: { companyId } })).status).toBe('OPEN');
  });

  it('a short delivery issues a partial credit for the missing items, and can’t exceed what was ordered', async () => {
    await freshCompany();
    const order = await makeOrder(1425, OrderStatus.DELIVERED, [{ quantity: 3, unit: 475 }]);
    const combinationId = order.lines[0].combinations[0].id;
    const created = await invoice([order.id]);
    await admin.post(`/api/billing/orders/${order.id}/short-delivery`).send({ items: [{ combinationId, missingQuantity: 4 }], reason: 'Box missing' }).expect(400);
    await admin.post(`/api/billing/orders/${order.id}/short-delivery`).send({ items: [{ combinationId, missingQuantity: 1 }], reason: 'One box missing' }).expect(201);
    const after = await fetchInvoice(created.id);
    expect(after.totalCents).toBe(950);
    expect(after.linesTotalCents).toBe(950);
    await admin.post(`/api/billing/orders/${order.id}/short-delivery`).send({ items: [{ combinationId, missingQuantity: 3 }], reason: 'More missing' }).expect(400); // only 2 can still be credited
  });

  it('the same missing item can’t be credited twice, even when the order total would allow it', async () => {
    await freshCompany();
    const order = await makeOrder(2000, OrderStatus.DELIVERED, [{ quantity: 1, unit: 1000 }, { quantity: 1, unit: 1000 }]);
    const [first] = order.lines[0].combinations;
    await invoice([order.id]);
    await admin.post(`/api/billing/orders/${order.id}/short-delivery`).send({ items: [{ combinationId: first.id, missingQuantity: 1 }], reason: 'Missing' }).expect(201);
    const again = await admin.post(`/api/billing/orders/${order.id}/short-delivery`).send({ items: [{ combinationId: first.id, missingQuantity: 1 }], reason: 'Missing again' }).expect(400);
    expect(again.body.message).toMatch(/can still be credited/);
  });

  it('a short delivery before invoicing is netted off what will be invoiced', async () => {
    await freshCompany();
    const order = await makeOrder(1425, OrderStatus.DELIVERED, [{ quantity: 3, unit: 475 }]);
    await admin.post(`/api/billing/orders/${order.id}/short-delivery`).send({ items: [{ combinationId: order.lines[0].combinations[0].id, missingQuantity: 2 }], reason: 'Two missing' }).expect(201);
    const list = (await admin.get(`/api/billing/companies/${companyId}/uninvoiced`).expect(200)).body as { items: { amountCents: number }[] };
    expect(list.items[0].amountCents).toBe(475);
    expect((await invoice([order.id])).totalCents).toBe(475);
  });

  it('voiding an unpaid invoice returns carried-forward credits to the company', async () => {
    await freshCompany();
    const a = await makeOrder(1000);
    const paid = await invoice([a.id]);
    await admin.post(`/api/billing/invoices/${paid.id}/pay`).expect(201);
    await admin.post(`/api/orders/${a.id}/cancel`).send({ version: await version(a.id), reason: 'Cancelled' }).expect(201);
    const b = await makeOrder(4000);
    const next = await invoice([b.id]);
    expect(next.totalCents).toBe(3000);
    await admin.post(`/api/billing/invoices/${next.id}/void`).send({ reason: 'Wrong amount' }).expect(201);
    expect((await prisma.orderCredit.findFirstOrThrow({ where: { companyId } })).status).toBe('OPEN');
    expect((await invoice([b.id])).totalCents).toBe(3000);
  });
});
