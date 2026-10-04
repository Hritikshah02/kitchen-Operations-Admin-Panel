import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderStatus, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';

type Drop = { id: string; status: string; timing: string; driver: { id: number; name: string; isDefault: boolean } | null; blockedReason: string | null; canDispatchReady: boolean; orders: { id: number; stage: string }[]; delivery: { onTime: boolean; lateMinutes: number; note: string | null } | null };
const kitchenToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

describe('Dispatch and driver (e2e)', () => {
  let app: INestApplication<App>;
  let dispatch: ReturnType<typeof request.agent>;
  let driver: ReturnType<typeof request.agent>;
  let otherDriver: ReturnType<typeof request.agent>;
  const prisma = new PrismaClient();
  const run = Date.now().toString(36);
  let companyId: number; let addressId: number; let tierId: number; let adminId: number; let defaultDriverId: number | null;
  let driverId: number; let otherDriverId: number;
  let employeeCount = 0; let dayOffset = 0;
  const futureDate = () => { const base = new Date(Date.UTC(2033, 0, 3)); base.setUTCDate(base.getUTCDate() + 7 * dayOffset++ + 7 * (Number.parseInt(run.slice(-3), 36) % 500)); return base.toISOString().slice(0, 10); };
  const key = (date: string, deliveryTime = '12:30') => ({ deliveryDate: date, companyId, addressId, deliveryTime });

  async function makeOrder(date: string, options: { ready?: boolean; time?: string } = {}) {
    const employee = await prisma.employee.create({ data: { name: `Rider ${run} ${employeeCount}`, email: `rider.${run}.${employeeCount++}@kalamtantu.com`, companyId } });
    return (await prisma.order.create({ data: {
      employeeId: employee.id, companyId, status: OrderStatus.CONFIRMED, deliveryDate: new Date(`${date}T00:00:00Z`), deliveryTime: options.time ?? '12:30', addressId, priceTierId: tierId, totalCents: 100, createdById: adminId,
      kitchenStartedAt: options.ready ? new Date() : null, kitchenReadyAt: options.ready ? new Date() : null,
    } })).id;
  }
  const dropOf = async (date: string, id: number) => {
    const board = (await dispatch.get(`/api/dispatch/board?date=${date}&pageSize=100`).expect(200)).body as { drops: { items: Drop[] } };
    return board.drops.items.find((entry) => entry.orders.some((order) => order.id === id))!;
  };
  const stageOf = async (date: string, id: number) => (await dropOf(date, id)).orders.find((order) => order.id === id)!.stage;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    const login = async (email: string) => { const agent = request.agent(app.getHttpServer()); await agent.post('/api/auth/login').send({ email, password: 'Test@1234' }).expect(200); return agent; };
    dispatch = await login('dispatch@test.com'); driver = await login('driver@test.com');
    const company = await prisma.company.findFirstOrThrow({ where: { domains: { some: { domain: 'kalamtantu.com' } } }, include: { addresses: { where: { isDefault: true } } } });
    companyId = company.id; addressId = company.addresses[0].id; defaultDriverId = company.defaultDriverId;
    tierId = (await prisma.priceTier.findFirstOrThrow()).id; adminId = (await prisma.staff.findUniqueOrThrow({ where: { email: 'admin@test.com' } })).id;
    driverId = (await prisma.staff.findUniqueOrThrow({ where: { email: 'driver@test.com' } })).id;
    const other = await prisma.staff.findFirstOrThrow({ where: { email: { endsWith: '.driver@test.com' }, id: { not: driverId } } });
    otherDriverId = other.id; otherDriver = await login(other.email);
  });

  afterEach(async () => { await prisma.company.update({ where: { id: companyId }, data: { defaultDriverId } }); });
  afterAll(async () => { await prisma.$disconnect(); await app.close(); });

  it('groups orders by company, address and exact time into drops', async () => {
    const date = futureDate();
    const a = await makeOrder(date); const b = await makeOrder(date); const c = await makeOrder(date, { time: '13:00' });
    const dropAB = await dropOf(date, a);
    expect(dropAB.orders.map((order) => order.id).sort()).toEqual([a, b].sort());
    expect((await dropOf(date, c)).id).not.toBe(dropAB.id);
  });

  it('defaults the driver to the company default and lets dispatch change it', async () => {
    const date = futureDate();
    const id = await makeOrder(date);
    expect((await dropOf(date, id)).driver).toMatchObject({ id: defaultDriverId, isDefault: true });
    await dispatch.post('/api/dispatch/drops/assign-driver').send({ ...key(date), driverId: otherDriverId }).expect(201);
    expect((await dropOf(date, id)).driver).toMatchObject({ id: otherDriverId, isDefault: false });
    await dispatch.post('/api/dispatch/drops/assign-driver').send({ ...key(date), driverId: otherDriverId }).expect(409);
    await dispatch.post('/api/dispatch/drops/assign-driver').send({ ...key(date), driverId: 999999 }).expect(400);
  });

  it('waits for an order still due, dispatches the ready ones together, and never repeats a step', async () => {
    const date = futureDate();
    const ready1 = await makeOrder(date, { ready: true }); const ready2 = await makeOrder(date, { ready: true }); const cooking = await makeOrder(date);
    const blocked = await dispatch.post('/api/dispatch/drops/dispatch-ready').send(key(date)).expect(409);
    expect(blocked.body.message).toMatch(/Waiting for 1 order/);
    expect((await dropOf(date, ready1)).canDispatchReady).toBe(false);
    await prisma.order.update({ where: { id: cooking }, data: { kitchenReadyAt: new Date() } });
    await dispatch.post('/api/dispatch/drops/dispatch-ready').send(key(date)).expect(201);
    expect(await stageOf(date, ready2)).toBe('DISPATCH_READY');
    await dispatch.post('/api/dispatch/drops/dispatch-ready').send(key(date)).expect(409);
  });

  it('refuses out for delivery without dispatch-ready or without a driver, and only one of two clicks wins', async () => {
    const date = futureDate();
    const id = await makeOrder(date, { ready: true });
    await dispatch.post('/api/dispatch/drops/out-for-delivery').send(key(date)).expect(409); // not dispatch ready
    await dispatch.post('/api/dispatch/drops/dispatch-ready').send(key(date)).expect(201);
    await prisma.company.update({ where: { id: companyId }, data: { defaultDriverId: null } });
    const noDriver = await dispatch.post('/api/dispatch/drops/out-for-delivery').send(key(date)).expect(400);
    expect(noDriver.body.message).toMatch(/Assign a driver/);
    await dispatch.post('/api/dispatch/drops/assign-driver').send({ ...key(date), driverId }).expect(201);
    const race = await Promise.all([dispatch.post('/api/dispatch/drops/out-for-delivery').send(key(date)), dispatch.post('/api/dispatch/drops/out-for-delivery').send(key(date))]);
    expect(race.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await stageOf(date, id)).toBe('OUT_FOR_DELIVERY');
    await dispatch.post('/api/dispatch/drops/assign-driver').send({ ...key(date), driverId: otherDriverId }).expect(409); // driver locked once out
  });

  it('shows a driver only their own drops for today and lets only them deliver, with on-time recorded', async () => {
    const today = kitchenToday();
    const mine = await makeOrder(today, { ready: true, time: '23:59' });
    const theirs = await makeOrder(today, { ready: true, time: '23:58' });
    await dispatch.post('/api/dispatch/drops/dispatch-ready').send(key(today, '23:59')).expect(201);
    await dispatch.post('/api/dispatch/drops/dispatch-ready').send(key(today, '23:58')).expect(201);
    await dispatch.post('/api/dispatch/drops/assign-driver').send({ ...key(today, '23:59'), driverId }).expect(201);
    await dispatch.post('/api/dispatch/drops/assign-driver').send({ ...key(today, '23:58'), driverId: otherDriverId }).expect(201);
    await dispatch.post('/api/dispatch/drops/out-for-delivery').send(key(today, '23:59')).expect(201);
    await dispatch.post('/api/dispatch/drops/out-for-delivery').send(key(today, '23:58')).expect(201);

    const list = (await driver.get('/api/driver/drops').expect(200)).body as { drops: Drop[] };
    const ids = list.drops.flatMap((entry) => entry.orders.map((order) => order.id));
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
    const times = list.drops.map((entry) => (entry as unknown as { deliveryTime: string }).deliveryTime);
    expect(times).toEqual([...times].sort());

    await driver.post('/api/driver/drops/deliver').send({ ...key(today, '23:58') }).expect(403);
    await driver.post('/api/driver/drops/deliver').send({ ...key(today, '23:59'), photoUrl: 'https://example.com/x.jpg' }).expect(400);
    await driver.post('/api/driver/drops/deliver').send({ ...key(today, '23:59'), note: 'Left with reception' }).expect(201);
    await driver.post('/api/driver/drops/deliver').send(key(today, '23:59')).expect(409);
    const done = await prisma.order.findUniqueOrThrow({ where: { id: mine } });
    expect(done.status).toBe(OrderStatus.DELIVERED);
    expect(done.deliveredOnTime).toBe(true);
    expect(done.deliveryNote).toBe('Left with reception');
    expect(await prisma.orderEvent.count({ where: { orderId: mine, type: 'DELIVERED' } })).toBe(1);
    await otherDriver.post('/api/driver/drops/deliver').send(key(today, '23:58')).expect(201);
    await dispatch.post('/api/driver/drops/deliver').send(key(today, '23:58')).expect(403); // dispatch has no driver-drops capability
    void theirs;
  });

  it('records a late delivery beyond the grace period with the late minutes', async () => {
    const today = kitchenToday();
    const id = await makeOrder(today, { ready: true, time: '00:01' });
    await dispatch.post('/api/dispatch/drops/dispatch-ready').send(key(today, '00:01')).expect(201);
    await dispatch.post('/api/dispatch/drops/assign-driver').send({ ...key(today, '00:01'), driverId }).expect(201);
    await dispatch.post('/api/dispatch/drops/out-for-delivery').send(key(today, '00:01')).expect(201);
    await driver.post('/api/driver/drops/deliver').send(key(today, '00:01')).expect(201);
    const row = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(row.deliveredOnTime).toBe(false);
    expect(row.deliveryLateMinutes).toBeGreaterThan(5);
  });
});
