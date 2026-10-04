import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderStatus, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';

type Group = { id: number; minSelect: number; usesPortions: boolean; sizes: { id: number }[]; options: { id: number }[] };
type MenuDish = { id: number; sku: string; groups: Group[] };
type Unit = { id: number; dish: string; state: string; station: string };
type Card = { orderId: number; timing: string; units: Unit[]; kitchenStartedAt: string | null; kitchenReadyAt: string | null };

describe('Kitchen board (e2e)', () => {
  let app: INestApplication<App>;
  let admin: ReturnType<typeof request.agent>;
  let kitchen: ReturnType<typeof request.agent>;
  const prisma = new PrismaClient();
  const run = Date.now().toString(36);
  let employeeId: number;
  let menu: MenuDish[];
  let used = 0;
  // A far-future Monday per test so the one-order-per-day rule never collides between runs.
  const futureDate = () => { const base = new Date(Date.UTC(2032, 0, 5)); base.setUTCDate(base.getUTCDate() + 7 * used++ + 7 * (Number.parseInt(run.slice(-3), 36) % 500)); return base.toISOString().slice(0, 10); };
  const choices = (dish: MenuDish, pick = 0) => dish.groups.filter((group) => group.minSelect > 0).map((group) => ({ groupId: group.id, optionId: group.options[pick % group.options.length].id, portionSizeId: group.usesPortions ? group.sizes[0].id : undefined }));
  const dish = (sku: string) => menu.find((entry) => entry.sku === sku)!;

  /** A confirmed order of a split thali (2 units) and a drink (1 unit, different station). */
  async function confirmedOrder(date: string, status: OrderStatus = OrderStatus.CONFIRMED) {
    const thali = dish('GUJ-002'); const drink = dish('BEV-001');
    const created = (await admin.post('/api/orders').send({
      employeeId, deliveryDate: date,
      lines: [
        { dishId: thali.id, quantity: 2, combinations: [{ quantity: 1, choices: choices(thali, 0) }, { quantity: 1, choices: choices(thali, 1) }] },
        { dishId: drink.id, quantity: 1, combinations: [{ quantity: 1, choices: choices(drink) }] },
      ],
    }).expect(201)).body;
    await prisma.order.update({ where: { id: created.id }, data: { status, confirmedAt: new Date() } });
    return created.id as number;
  }
  const board = async (date: string, extra = '') => (await admin.get(`/api/kitchen/board?date=${date}${extra}`).expect(200)).body as { orders: { items: Card[]; total: number }; stations: { id: number | null; name: string; pending: number }[]; totals: { orders: number } };
  const card = async (date: string, orderId: number) => (await board(date, '&pageSize=100')).orders.items.find((entry) => entry.orderId === orderId)!;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    admin = request.agent(app.getHttpServer());
    await admin.post('/api/auth/login').send({ email: 'admin@test.com', password: 'Test@1234' }).expect(200);
    kitchen = request.agent(app.getHttpServer());
    await kitchen.post('/api/auth/login').send({ email: 'kitchen@test.com', password: 'Test@1234' }).expect(200);
    const company = await prisma.company.findFirstOrThrow({ where: { domains: { some: { domain: 'kalamtantu.com' } } } });
    employeeId = (await prisma.employee.create({ data: { name: `Cook ${run}`, email: `cook.${run}@kalamtantu.com`, companyId: company.id } })).id;
    menu = ((await admin.get(`/api/menu/preview?employeeId=${employeeId}`).expect(200)).body as { categories: { items: MenuDish[] }[] }).categories.flatMap((category) => category.items);
  });

  afterAll(async () => { await prisma.$disconnect(); await app.close(); });

  it('shows confirmed orders only, as one unit per combination routed to stations', async () => {
    const date = futureDate();
    const id = await confirmedOrder(date);
    await confirmedOrder(futureDate(), OrderStatus.PLACED);
    const mine = await card(date, id);
    expect(mine.units).toHaveLength(3);
    expect(mine.units.every((unit) => unit.state === 'PENDING')).toBe(true);
    expect(new Set(mine.units.map((unit) => unit.station)).size).toBeGreaterThan(1);
    const placed = await prisma.order.findFirstOrThrow({ where: { status: OrderStatus.PLACED, employeeId }, select: { deliveryDate: true } });
    expect((await board(placed.deliveryDate.toISOString().slice(0, 10))).orders.total).toBe(0);
    const stationId = (await board(date)).stations.find((station) => station.name === mine.units[0].station)!.id;
    const filtered = await board(date, `&station=${stationId}`);
    expect(filtered.orders.items[0].units.every((unit) => unit.station === mine.units[0].station)).toBe(true);
  });

  it('cannot start or finish a unit twice, and finishing an unstarted unit records the start', async () => {
    const date = futureDate();
    const id = await confirmedOrder(date);
    const [a, b] = (await card(date, id)).units;
    await kitchen.post(`/api/kitchen/units/${a.id}/start`).expect(201);
    await kitchen.post(`/api/kitchen/units/${a.id}/start`).expect(409);
    await kitchen.post(`/api/kitchen/units/${a.id}/finish`).expect(201);
    await kitchen.post(`/api/kitchen/units/${a.id}/finish`).expect(409);
    await kitchen.post(`/api/kitchen/units/${b.id}/finish`).expect(201);
    const row = await prisma.orderCombination.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.startedAt).not.toBeNull();
    expect(row.doneAt).not.toBeNull();
  });

  it('sets kitchen started on the first start and kitchen ready only when every unit is done', async () => {
    const date = futureDate();
    const id = await confirmedOrder(date);
    const units = (await card(date, id)).units;
    expect((await card(date, id)).kitchenStartedAt).toBeNull();
    await kitchen.post(`/api/kitchen/units/${units[0].id}/start`).expect(201);
    expect((await card(date, id)).kitchenStartedAt).not.toBeNull();
    await kitchen.post(`/api/kitchen/units/${units[0].id}/finish`).expect(201);
    await kitchen.post(`/api/kitchen/units/${units[1].id}/finish`).expect(201);
    expect((await card(date, id)).kitchenReadyAt).toBeNull();
    await kitchen.post(`/api/kitchen/units/${units[2].id}/finish`).expect(201);
    const done = await card(date, id);
    expect(done.kitchenReadyAt).not.toBeNull();
    expect(done.timing).toBe('DONE');
    const events = (await admin.get(`/api/orders/${id}`).expect(200)).body.events.map((event: { type: string }) => event.type);
    expect(events).toEqual(expect.arrayContaining(['KITCHEN_STARTED', 'KITCHEN_READY']));
  });

  it('lets only one of two simultaneous clicks win, and still marks the order ready once', async () => {
    const date = futureDate();
    const id = await confirmedOrder(date);
    const units = (await card(date, id)).units;
    const race = await Promise.all([kitchen.post(`/api/kitchen/units/${units[0].id}/finish`), admin.post(`/api/kitchen/units/${units[0].id}/finish`)]);
    expect(race.map((response) => response.status).sort()).toEqual([201, 409]);
    // The last two units finished at the same instant by different people: readiness must not be missed.
    await Promise.all([kitchen.post(`/api/kitchen/units/${units[1].id}/finish`).expect(201), admin.post(`/api/kitchen/units/${units[2].id}/finish`).expect(201)]);
    expect((await card(date, id)).kitchenReadyAt).not.toBeNull();
    expect(await prisma.orderEvent.count({ where: { orderId: id, type: 'KITCHEN_READY' } })).toBe(1);
  });

  it('refuses work on orders that are not confirmed', async () => {
    const date = futureDate();
    const id = await confirmedOrder(date, OrderStatus.PLACED);
    const unit = await prisma.orderCombination.findFirstOrThrow({ where: { line: { orderId: id } } });
    const response = await kitchen.post(`/api/kitchen/units/${unit.id}/start`).expect(409);
    expect(response.body.message).toMatch(/Only confirmed orders/);
  });

  it('lets only an admin force-complete a whole order', async () => {
    const date = futureDate();
    const id = await confirmedOrder(date);
    const units = (await card(date, id)).units;
    await kitchen.post(`/api/kitchen/units/${units[0].id}/start`).expect(201);
    await kitchen.post(`/api/kitchen/orders/${id}/force-complete`).expect(403);
    await admin.post(`/api/kitchen/orders/${id}/force-complete`).expect(201);
    const done = await prisma.orderCombination.findMany({ where: { line: { orderId: id } } });
    expect(done.every((unit) => unit.startedAt && unit.doneAt)).toBe(true);
    expect((await card(date, id)).kitchenReadyAt).not.toBeNull();
    await admin.post(`/api/kitchen/orders/${id}/force-complete`).expect(409);
  });

  it('plans the times from the delivery time and moves them when it changes', async () => {
    const date = futureDate();
    const id = await confirmedOrder(date);
    const before = (await admin.get(`/api/orders/${id}`).expect(200)).body;
    const detail = await admin.patch(`/api/orders/${id}/delivery`).send({ version: before.version, deliveryTime: '14:00' }).expect(200);
    const gap = new Date(detail.body.kitchen.plannedKitchenReadyAt).getTime() - new Date(before.kitchen.plannedKitchenReadyAt).getTime();
    expect(gap).toBe(((14 * 60) - (Number(before.deliveryTime.slice(0, 2)) * 60 + Number(before.deliveryTime.slice(3)))) * 60_000);
  });

  it('keeps the board for 400 orders responsive', async () => {
    const date = futureDate();
    const company = await prisma.company.findFirstOrThrow({ where: { domains: { some: { domain: 'kalamtantu.com' } } }, include: { addresses: true } });
    const source = await prisma.order.findFirstOrThrow({ where: { id: await confirmedOrder(date) }, include: { lines: { include: { combinations: true } } } });
    const stamp = Date.now();
    for (let batch = 0; batch < 40; batch++) {
      await Promise.all(Array.from({ length: 10 }, async (_, index) => {
        const employee = await prisma.employee.create({ data: { name: `Load ${run} ${batch}-${index}`, email: `load.${run}.${batch}.${index}.${stamp}@kalamtantu.com`, companyId: company.id } });
        await prisma.order.create({ data: {
          employeeId: employee.id, companyId: company.id, status: OrderStatus.CONFIRMED, deliveryDate: source.deliveryDate, deliveryTime: source.deliveryTime, addressId: source.addressId, priceTierId: source.priceTierId, totalCents: source.totalCents, createdById: source.createdById,
          lines: { create: source.lines.map((entry) => ({ dishId: entry.dishId, dishName: entry.dishName, dishSku: entry.dishSku, quantity: entry.quantity, unitPriceCents: entry.unitPriceCents, totalCents: entry.totalCents, sortOrder: entry.sortOrder, combinations: { create: entry.combinations.map((combo) => ({ signature: combo.signature, quantity: combo.quantity, unitPriceCents: combo.unitPriceCents, totalCents: combo.totalCents })) } })) },
        } });
      }));
    }
    const started = Date.now();
    const result = await board(date, '&pageSize=100');
    expect(result.totals.orders).toBeGreaterThanOrEqual(401);
    expect(result.orders.items).toHaveLength(100);
    expect(Date.now() - started).toBeLessThan(3000);
    await prisma.order.deleteMany({ where: { employee: { name: { startsWith: `Load ${run}` } } } });
  });
});
