import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderStatus, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';

// Runs against the local database (docker compose) after `npm run db:seed`.
describe('Companies and employees (e2e)', () => {
  let app: INestApplication<App>;
  let admin: ReturnType<typeof request.agent>;
  const prisma = new PrismaClient();
  const run = Date.now().toString(36);
  const domain = `e2e-${run}.test`;
  const otherDomain = `e2e-other-${run}.test`;
  let companyId: number;
  let otherCompanyId: number;
  let ownerId: number;

  const newCompany = (name: string, domains: string[], ownerEmail: string) => ({
    name,
    domains,
    billingContactName: 'Test Billing',
    billingContactEmail: `billing@${domains[0]}`,
    address: { label: 'HQ', line1: '1st Floor, Test Tower', city: 'Ahmedabad', pincode: '380054' },
    owner: { name: 'Test Owner', email: ownerEmail },
  });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    admin = request.agent(app.getHttpServer());
    await admin.post('/api/auth/login').send({ email: 'admin@test.com', password: 'Test@1234' }).expect(200);
  });

  /** Inserts an order directly (bypassing order validation) to set up company/employee rules. */
  const rawOrder = async (employeeId: number, orderCompanyId: number, date: string, status: OrderStatus) => {
    const address = await prisma.companyAddress.findFirstOrThrow({ where: { companyId: orderCompanyId, isDefault: true } });
    const tier = await prisma.priceTier.findFirstOrThrow({ where: { isDefault: true } });
    const staff = await prisma.staff.findUniqueOrThrow({ where: { email: 'admin@test.com' } });
    return prisma.order.create({
      data: { employeeId, companyId: orderCompanyId, deliveryDate: new Date(`${date}T00:00:00Z`), deliveryTime: '12:30', addressId: address.id, priceTierId: tier.id, createdById: staff.id, status },
    });
  };

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('creates a company together with its owner and default address', async () => {
    const { body } = await admin.post('/api/companies').send(newCompany('E2E Foods', [domain], `owner@${domain}`)).expect(201);
    companyId = body.id;
    ownerId = body.owner.id;
    expect(body.owner.email).toBe(`owner@${domain}`);
    expect(body.addresses).toEqual([expect.objectContaining({ isDefault: true, label: 'HQ' })]);
    expect(body.dispatchLeadMinutes).toBe(60);

    const other = await admin.post('/api/companies').send(newCompany('E2E Other', [otherDomain], `boss@${otherDomain}`)).expect(201);
    otherCompanyId = other.body.id;
  });

  it('rejects public, duplicate and mismatched domains', async () => {
    await admin.post('/api/companies').send(newCompany('Bad', ['gmail.com'], 'x@gmail.com')).expect(400);
    const duplicate = await admin.post('/api/companies').send(newCompany('Dup', [domain], `y@${domain}`)).expect(409);
    expect(duplicate.body.message).toContain('E2E Foods');
    const mismatch = await admin.post('/api/companies').send(newCompany('Mismatch', [`m-${run}.test`], 'owner@elsewhere.test')).expect(400);
    expect(mismatch.body.message).toMatch(/owner's email/);
  });

  it('keeps the default delivery time inside the delivery window', async () => {
    await admin.patch(`/api/companies/${companyId}`).send({ deliveryWindowStart: '13:00', deliveryWindowEnd: '12:00' }).expect(400);
    await admin.patch(`/api/companies/${companyId}`).send({ defaultDeliveryTime: '15:00' }).expect(400);
    await admin.patch(`/api/companies/${companyId}`).send({ deliveryWindowStart: '12:00', deliveryWindowEnd: '13:30', defaultDeliveryTime: '13:00' }).expect(200);
    // A partial update is checked against the company's saved window, not the defaults.
    await admin.patch(`/api/companies/${companyId}`).send({ deliveryWindowStart: '14:00', deliveryWindowEnd: '15:00', defaultDeliveryTime: '14:30' }).expect(200);
    await admin.patch(`/api/companies/${companyId}`).send({ defaultDeliveryTime: '14:45' }).expect(200);
    await admin.patch(`/api/companies/${companyId}`).send({ deliveryWindowStart: '12:00', deliveryWindowEnd: '13:30', defaultDeliveryTime: '13:00' }).expect(200);
  });

  it('requires employee emails to use a company domain', async () => {
    await admin.post('/api/employees').send({ companyId, name: 'Wrong Domain', email: `a@${otherDomain}` }).expect(400);
    const { body } = await admin.post('/api/employees').send({ companyId, name: 'Asha Patel', email: `asha@${domain}`, canChooseAddress: true }).expect(201);
    expect(body).toMatchObject({ canChooseAddress: true, isOwner: false, company: { id: companyId } });
  });

  it('blocks removing the last domain or a domain still in use', async () => {
    const company = await admin.get(`/api/companies/${companyId}`).expect(200);
    await admin.delete(`/api/companies/${companyId}/domains/${company.body.domains[0].id}`).expect(400);
    const added = await admin.post(`/api/companies/${companyId}/domains`).send({ domain: `alt.${domain}` }).expect(201);
    const primary = added.body.domains.find((entry: { domain: string }) => entry.domain === domain);
    const removal = await admin.delete(`/api/companies/${companyId}/domains/${primary.id}`).expect(400);
    expect(removal.body.message).toMatch(/still use/);
  });

  it('protects the owner: cannot be deactivated or moved until replaced', async () => {
    await admin.patch(`/api/employees/${ownerId}`).send({ isActive: false }).expect(400);
    await admin.post(`/api/employees/${ownerId}/move`).send({ companyId: otherCompanyId, email: `owner@${otherDomain}` }).expect(400);
  });

  it('moving cancels orders before cut-off, keeps locked ones on the old company, and resets permissions', async () => {
    const employee = await admin
      .post('/api/employees')
      .send({ companyId, name: 'Mover', email: `mover@${domain}`, canChooseAddress: true, canChangeDeliveryTime: true, canChangePackaging: true })
      .expect(201);
    const id = employee.body.id;
    await admin.post(`/api/employees/${id}/move`).send({ companyId: otherCompanyId, email: `mover@${domain}` }).expect(400); // wrong domain

    const make = (status: OrderStatus, date: string) => rawOrder(id, companyId, date, status);
    const futureDraft = await make(OrderStatus.DRAFT, '2030-01-07');
    const futurePlaced = await make(OrderStatus.PLACED, '2030-01-08');
    const lockedPlaced = await make(OrderStatus.PLACED, '2026-01-06'); // cut-off long past, awaiting cut-off processing
    const confirmed = await make(OrderStatus.CONFIRMED, '2030-01-09');

    const moved = await admin
      .post(`/api/employees/${id}/move`)
      .send({ companyId: otherCompanyId, email: `mover@${otherDomain}`, canChangePackaging: true })
      .expect(201);
    expect(moved.body).toMatchObject({
      company: { id: otherCompanyId },
      email: `mover@${otherDomain}`,
      cancelledOrders: 2,
      lockedOrdersKept: 1,
      canChooseAddress: false,
      canChangeDeliveryTime: false,
      canChangePackaging: true,
    });

    const order = (orderId: number) => prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect((await order(futureDraft.id)).status).toBe(OrderStatus.CANCELLED);
    expect((await order(futurePlaced.id)).status).toBe(OrderStatus.CANCELLED);
    expect(await order(lockedPlaced.id)).toMatchObject({ status: OrderStatus.PLACED, companyId });
    expect(await order(confirmed.id)).toMatchObject({ status: OrderStatus.CONFIRMED, companyId });
  });

  it('deactivating a company cancels open orders before cut-off and keeps locked ones billable', async () => {
    const employee = await prisma.employee.findFirstOrThrow({ where: { companyId: otherCompanyId } });
    const make = (status: OrderStatus, date: string) => rawOrder(employee.id, otherCompanyId, date, status);
    const draft = await make(OrderStatus.DRAFT, '2030-01-14');
    const placed = await make(OrderStatus.PLACED, '2030-01-15');
    const lockedPlaced = await make(OrderStatus.PLACED, '2026-01-06'); // past cut-off, awaiting processing
    const confirmed = await make(OrderStatus.CONFIRMED, '2030-01-16');

    const { body } = await admin.post(`/api/companies/${otherCompanyId}/deactivate`).expect(201);
    expect(body).toMatchObject({ isActive: false, cancelledOrders: 2, lockedOrdersKept: 1 });
    const statusOf = async (id: number) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;
    expect(await statusOf(draft.id)).toBe(OrderStatus.CANCELLED);
    expect(await statusOf(placed.id)).toBe(OrderStatus.CANCELLED);
    expect(await statusOf(lockedPlaced.id)).toBe(OrderStatus.PLACED);
    expect(await statusOf(confirmed.id)).toBe(OrderStatus.CONFIRMED);
    await admin.post('/api/employees').send({ companyId: otherCompanyId, name: 'Late Joiner', email: `late@${otherDomain}` }).expect(400);
  });

  it('allows exactly one default address that cannot be deactivated', async () => {
    const { body } = await admin.post(`/api/companies/${companyId}/addresses`).send({ label: 'Annex', line1: 'Ground Floor, Annex', city: 'Ahmedabad', pincode: '380015' }).expect(201);
    const annex = body.addresses.find((address: { label: string }) => address.label === 'Annex');
    const hq = body.addresses.find((address: { label: string }) => address.label === 'HQ');
    expect(annex.isDefault).toBe(false);
    await admin.patch(`/api/companies/${companyId}/addresses/${hq.id}`).send({ isActive: false }).expect(400);
    const switched = await admin.patch(`/api/companies/${companyId}/addresses/${annex.id}`).send({ isDefault: true }).expect(200);
    expect(switched.body.addresses.filter((address: { isDefault: boolean }) => address.isDefault).map((address: { label: string }) => address.label)).toEqual(['Annex']);
  });

  it('is admin-only', async () => {
    const kitchen = request.agent(app.getHttpServer());
    await kitchen.post('/api/auth/login').send({ email: 'kitchen@test.com', password: 'Test@1234' }).expect(200);
    await kitchen.get('/api/companies').expect(403);
    await kitchen.get('/api/employees').expect(403);
  });
});
