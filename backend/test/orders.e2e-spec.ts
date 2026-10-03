import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderStatus, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';

type Group = { id: number; name: string; minSelect: number; usesPortions: boolean; sizes: { id: number }[]; options: { id: number; name: string; priceCents: number }[] };
type MenuDish = { id: number; sku: string; priceCents: number; groups: Group[] };

// Runs against the local database after `npm run db:seed`. Uses far-future dates (before cut-off) and fixed past dates.
describe('Orders (e2e)', () => {
  let app: INestApplication<App>;
  let admin: ReturnType<typeof request.agent>;
  let desk: ReturnType<typeof request.agent>; // a custom role with orders:manage but not orders:override
  const prisma = new PrismaClient();
  const run = Date.now().toString(36);
  let employeeId: number;
  let allergicId: number;
  let thali: MenuDish;
  let usedDates = 0;
  // Each test gets its own future working day so the one-order-per-day rule doesn't interfere between runs.
  const futureDate = () => {
    const base = new Date(Date.UTC(2031, 0, 6)); // Monday 6 Jan 2031: far beyond any cut-off
    base.setUTCDate(base.getUTCDate() + 7 * usedDates++);
    return base.toISOString().slice(0, 10);
  };

  /** Every required group gets its first option (Regular size where portioned). */
  const defaultChoices = (dish: MenuDish, pick = 0) =>
    dish.groups.filter((group) => group.minSelect > 0).map((group) => ({ groupId: group.id, optionId: group.options[pick % group.options.length].id, portionSizeId: group.usesPortions ? group.sizes[0].id : undefined }));
  const line = (dish: MenuDish, quantity: number, splits: number[] = [quantity]) => ({
    dishId: dish.id, quantity, combinations: splits.map((part, index) => ({ quantity: part, choices: defaultChoices(dish, index) })),
  });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    admin = request.agent(app.getHttpServer());
    await admin.post('/api/auth/login').send({ email: 'admin@test.com', password: 'Test@1234' }).expect(200);

    const kalamtantu = await prisma.company.findFirstOrThrow({ where: { domains: { some: { domain: 'kalamtantu.com' } } } });
    // Fresh employees per run, so earlier runs' orders can't collide with the one-order-per-day rule.
    employeeId = (await prisma.employee.create({ data: { name: `Orderer ${run}`, email: `orderer.${run}@kalamtantu.com`, companyId: kalamtantu.id } })).id;
    const peanuts = await prisma.allergen.findFirstOrThrow({ where: { name: 'Peanuts' } });
    allergicId = (await prisma.employee.create({ data: { name: `Allergic ${run}`, email: `allergic.${run}@kalamtantu.com`, companyId: kalamtantu.id, allergens: { connect: { id: peanuts.id } } } })).id;
    const menu = (await admin.get(`/api/menu/preview?employeeId=${employeeId}`).expect(200)).body as { categories: { items: MenuDish[] }[] };
    thali = menu.categories.flatMap((category) => category.items).find((dish) => dish.sku === 'GUJ-002')!;

    // A role that is pure data: can manage orders but not override. No code knows its name.
    const role = await prisma.role.upsert({ where: { name: 'ORDER_DESK' }, update: {}, create: { name: 'ORDER_DESK', label: 'Order desk', capabilities: ['dashboard:view', 'orders:manage'] } });
    await admin.post('/api/staff').send({ name: 'Order Desk', email: `desk.${run}@test.com`, password: 'Test@1234', roleId: role.id }).expect(201);
    desk = request.agent(app.getHttpServer());
    await desk.post('/api/auth/login').send({ email: `desk.${run}@test.com`, password: 'Test@1234' }).expect(200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('quotes a price breakdown and reports every problem at once', async () => {
    const date = futureDate();
    const ok = await admin.post('/api/orders/quote').send({ employeeId, deliveryDate: date, lines: [line(thali, 10, [6, 4])] }).expect(201);
    expect(ok.body.errors).toEqual([]);
    const [combinationA, combinationB] = ok.body.lines[0].combinations;
    expect(combinationA.totalCents).toBe(combinationA.unitPriceCents * 6);
    expect(ok.body.totalCents).toBe(combinationA.totalCents + combinationB.totalCents);

    const bad = await admin.post('/api/orders/quote').send({ employeeId, deliveryDate: date, lines: [{ ...line(thali, 10, [6, 3]) }], addressId: 999999 }).expect(201);
    expect(bad.body.errors.join(' ')).toMatch(/add up to 9/);
    expect(bad.body.errors.join(' ')).toMatch(/not allowed to choose a delivery address/);
  });

  it('creates a draft, enforces one order per employee per day, places it, and locks prices', async () => {
    const date = futureDate();
    const draft = (await admin.post('/api/orders').send({ employeeId, deliveryDate: date, lines: [line(thali, 2)] }).expect(201)).body;
    expect(draft).toMatchObject({ status: OrderStatus.DRAFT, version: 1 });
    expect((await admin.post('/api/orders').send({ employeeId, deliveryDate: date, lines: [line(thali, 1)] }).expect(409)).body.message).toMatch(`#${draft.id}`);

    const placed = (await admin.post(`/api/orders/${draft.id}/place`).send({ version: draft.version }).expect(201)).body;
    expect(placed).toMatchObject({ status: OrderStatus.PLACED, version: 2 });
    expect(placed.events.map((event: { type: string }) => event.type)).toEqual(['CREATED', 'PLACED']);

    // Stale version: someone else changed it.
    await admin.post(`/api/orders/${draft.id}/cancel`).send({ version: 1 }).expect(409);

    // A price change after placement doesn't touch the placed order's existing items.
    const standard = await prisma.priceTier.findFirstOrThrow({ where: { name: 'Standard' } });
    const before = placed.lines[0].combinations[0].unitPriceCents;
    await admin.put(`/api/pricing/tiers/${standard.id}/prices`).send({ dishes: [{ id: thali.id, priceCents: thali.priceCents + 100 }] }).expect(200);
    try {
      const edited = (await admin.put(`/api/orders/${draft.id}`).send({ version: placed.version, deliveryDate: date, lines: [line(thali, 3)] }).expect(200)).body;
      expect(edited.lines[0].combinations[0].unitPriceCents).toBe(before);
      expect(edited.totalCents).toBe(before * 3);
    } finally {
      await admin.put(`/api/pricing/tiers/${standard.id}/prices`).send({ dishes: [{ id: thali.id, priceCents: thali.priceCents }] }).expect(200);
    }
  });

  it("refuses dates the kitchen or the company can't deliver on", async () => {
    const sunday = '2031-01-12';
    const holiday = '2026-12-25';
    for (const deliveryDate of [sunday, holiday]) {
      const { body } = await admin.post('/api/orders/quote').send({ employeeId, deliveryDate, lines: [line(thali, 1)] }).expect(201);
      expect(body.errors.join(' ')).toMatch(/closed|does not receive|holiday/);
    }
  });

  it('requires an explicit allergy acknowledgement to place, and records it', async () => {
    const date = futureDate();
    const payload = { employeeId: allergicId, deliveryDate: date, lines: [line(thali, 1)], place: true };
    expect((await admin.post('/api/orders').send(payload).expect(400)).body.message).toMatch(/allergic to Peanuts/);
    const order = (await admin.post('/api/orders').send({ ...payload, allergyAcknowledged: true }).expect(201)).body;
    expect(order.allergyAcknowledged).toBe(true);
    expect(order.events.some((event: { type: string }) => event.type === 'ALLERGY_ACKNOWLEDGED')).toBe(true);
  });

  it('locks orders after cut-off for staff without the override capability', async () => {
    const past = '2026-09-28'; // a Monday whose cut-off has passed
    await desk.post('/api/orders').send({ employeeId, deliveryDate: past, lines: [line(thali, 1)], place: true }).expect(403);
    const late = await admin.post('/api/orders').send({ employeeId: allergicId, deliveryDate: past, lines: [line(thali, 1)], place: true, allergyAcknowledged: true });
    if (late.status === 201) {
      expect(late.body.status).toBe(OrderStatus.CONFIRMED); // admin late order is confirmed immediately
      await desk.post(`/api/orders/${late.body.id}/cancel`).send({ version: late.body.version }).expect(403);
      const cancelled = (await admin.post(`/api/orders/${late.body.id}/cancel`).send({ version: late.body.version, reason: 'e2e cleanup' }).expect(201)).body;
      expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    } else {
      expect(late.status).toBe(409); // already has an order that day from an earlier run
    }
  });

  it('processes a cut-off: drafts cancelled, placed confirmed, safe to run twice, refused before the cut-off', async () => {
    const date = `2025-${String(1 + (Number.parseInt(run, 36) % 11)).padStart(2, '0')}-${String(10 + (Number.parseInt(run, 36) % 15)).padStart(2, '0')}`;
    const employees = await prisma.employee.findMany({ where: { isActive: true, company: { domains: { some: { domain: 'kesarloop.in' } } } }, take: 2, orderBy: { id: 'desc' } });
    const tier = await prisma.priceTier.findFirstOrThrow({ where: { isDefault: true } });
    const staff = await prisma.staff.findUniqueOrThrow({ where: { email: 'admin@test.com' } });
    await prisma.order.deleteMany({ where: { deliveryDate: new Date(`${date}T00:00:00Z`) } });
    const make = async (index: number, status: OrderStatus) => {
      const address = await prisma.companyAddress.findFirstOrThrow({ where: { companyId: employees[index].companyId, isDefault: true } });
      return prisma.order.create({ data: { employeeId: employees[index].id, companyId: employees[index].companyId, deliveryDate: new Date(`${date}T00:00:00Z`), deliveryTime: '12:30', addressId: address.id, priceTierId: tier.id, createdById: staff.id, status } });
    };
    const draft = await make(0, OrderStatus.DRAFT);
    const placed = await make(1, OrderStatus.PLACED);

    expect((await admin.post('/api/orders/cutoff/run').send({ deliveryDate: date }).expect(201)).body).toEqual({ deliveryDate: date, confirmed: 1, cancelled: 1 });
    expect((await admin.post('/api/orders/cutoff/run').send({ deliveryDate: date }).expect(201)).body).toEqual({ deliveryDate: date, confirmed: 0, cancelled: 0 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(OrderStatus.CANCELLED);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: placed.id } })).status).toBe(OrderStatus.CONFIRMED);
    await admin.post('/api/orders/cutoff/run').send({ deliveryDate: futureDate() }).expect(400);
    await desk.post('/api/orders/cutoff/run').send({ deliveryDate: date }).expect(403);
  });

  it('lets an admin reject with a reason and override delivery details after confirmation', async () => {
    const date = futureDate();
    const order = (await admin.post('/api/orders').send({ employeeId, deliveryDate: date, lines: [line(thali, 1)], place: true }).expect(201)).body;
    await prisma.order.update({ where: { id: order.id }, data: { status: OrderStatus.CONFIRMED } }); // as if cut-off had passed
    const packaging = await prisma.packagingType.findFirstOrThrow({ where: { name: 'Steel tiffin (reusable)' } });
    const overridden = (await admin.patch(`/api/orders/${order.id}/delivery`).send({ version: order.version, deliveryTime: '13:40', packagingTypeId: packaging.id }).expect(200)).body;
    expect(overridden).toMatchObject({ deliveryTime: '13:40', packagingTypeId: packaging.id });
    expect(overridden.events.at(-1)).toMatchObject({ type: 'DELIVERY_CHANGED' });
    await desk.patch(`/api/orders/${order.id}/delivery`).send({ version: overridden.version, deliveryTime: '13:50' }).expect(403);

    await admin.post(`/api/orders/${order.id}/reject`).send({ version: overridden.version }).expect(400); // reason required
    const rejected = (await admin.post(`/api/orders/${order.id}/reject`).send({ version: overridden.version, reason: 'Paneer delivery failed' }).expect(201)).body;
    expect(rejected).toMatchObject({ status: OrderStatus.REJECTED, rejectionReason: 'Paneer delivery failed' });
  });

  it('lists with filters and pagination', async () => {
    const { body } = await admin.get(`/api/orders?status=PLACED,CONFIRMED&employeeId=${employeeId}&pageSize=5`).expect(200);
    expect(body.pageSize).toBe(5);
    expect(body.items.every((order: { status: string }) => ['PLACED', 'CONFIRMED'].includes(order.status))).toBe(true);
    await admin.get('/api/orders?status=SHIPPED').expect(400);
  });
});
