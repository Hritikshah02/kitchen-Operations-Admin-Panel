import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';

describe('Dashboards (e2e)', () => {
  let app: INestApplication<App>;
  const agents = new Map<string, ReturnType<typeof request.agent>>(); // one login per account: sign-in is rate limited
  const login = async (email: string) => {
    if (!agents.has(email)) { const agent = request.agent(app.getHttpServer()); await agent.post('/api/auth/login').send({ email, password: 'Test@1234' }).expect(200); agents.set(email, agent); }
    return agents.get(email)!;
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('gives each role its own dashboard, chosen by capability', async () => {
    const kinds: Record<string, string> = { 'admin@test.com': 'ADMIN', 'kitchen@test.com': 'KITCHEN', 'dispatch@test.com': 'DISPATCH', 'driver@test.com': 'DRIVER' };
    for (const [email, kind] of Object.entries(kinds)) {
      const body = (await (await login(email)).get('/api/dashboard').expect(200)).body as { kind: string };
      expect(body.kind).toBe(kind);
    }
    await request(app.getHttpServer()).get('/api/dashboard').expect(401);
  });

  it('shows figures that match the boards they summarise', async () => {
    const admin = await login('admin@test.com');
    const dash = (await admin.get('/api/dashboard').expect(200)).body as { operatingDate: string; admin: { operating: { kitchenOrders: number; drops: number }; recent: { billableCents: number; delivered: number }[]; performance: { onTime: number; late: number; onTimeRate: number | null }; money: { uninvoicedCents: number } } };
    const board = (await admin.get(`/api/kitchen/board?date=${dash.operatingDate}`).expect(200)).body as { totals: { orders: number } };
    const drops = (await admin.get(`/api/dispatch/board?date=${dash.operatingDate}`).expect(200)).body as { totals: { drops: number } };
    expect(dash.admin.operating.kitchenOrders).toBe(board.totals.orders);
    expect(dash.admin.operating.drops).toBe(drops.totals.drops);
    const { onTime, late, onTimeRate } = dash.admin.performance;
    expect(onTimeRate).toBe(onTime + late ? onTime / (onTime + late) : null);
    expect(dash.admin.money.uninvoicedCents).toBe(((await admin.get('/api/billing/companies').expect(200)).body as { uninvoicedCents: number }[]).reduce((sum, company) => sum + company.uninvoicedCents, 0));
  });

  it('shows a kitchen lead the same prep numbers as the board, whole-day unit counts included', async () => {
    const kitchen = await login('kitchen@test.com');
    const dash = (await kitchen.get('/api/dashboard').expect(200)).body as { operatingDate: string; kitchen: { units: { pending: number; started: number; done: number }; totals: { orders: number } } };
    const board = (await kitchen.get(`/api/kitchen/board?date=${dash.operatingDate}&pageSize=100`).expect(200)).body as { stations: { pending: number; started: number; done: number }[]; totals: { orders: number } };
    expect(dash.kitchen.units.pending).toBe(board.stations.reduce((sum, station) => sum + station.pending, 0));
    expect(dash.kitchen.totals.orders).toBe(board.totals.orders);
  });

  it('shows a driver only their own figures', async () => {
    const driver = await login('driver@test.com');
    const dash = (await driver.get('/api/dashboard').expect(200)).body as { driver: { totals: { drops: number } } };
    const mine = (await driver.get('/api/driver/drops').expect(200)).body as { drops: unknown[] };
    expect(dash.driver.totals.drops).toBe(mine.drops.length);
  });
});

describe('Demo refresh (e2e)', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    process.env.DEMO_REFRESH_TOKEN = 'test-demo-token';
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => { delete process.env.DEMO_REFRESH_TOKEN; await app.close(); });

  it('needs the shared secret and is safe to call repeatedly', async () => {
    await request(app.getHttpServer()).post('/api/demo/refresh').expect(403);
    await request(app.getHttpServer()).post('/api/demo/refresh').set('x-demo-token', 'wrong').expect(403);
    await request(app.getHttpServer()).post('/api/demo/refresh').set('x-demo-token', 'test-demo-token').expect(201);
    const second = await request(app.getHttpServer()).post('/api/demo/refresh').set('x-demo-token', 'test-demo-token').expect(201);
    expect((second.body as { created: number }).created).toBe(0);
  });

  it('keeps every status on screen for every day around today', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email: 'admin@test.com', password: 'Test@1234' }).expect(200);
    const dash = (await agent.get('/api/dashboard').expect(200)).body as { admin: { recent: { date: string; delivered: number; cancelled: number; rejected: number }[]; upcoming: { date: string; cutoffPassed: boolean; draft: number; placed: number; confirmed: number; cancelled: number; rejected: number }[] } };
    for (const day of dash.admin.recent) expect(day, `past ${day.date}`).toMatchObject({ delivered: expect.any(Number), cancelled: expect.any(Number) });
    for (const day of dash.admin.recent) { expect(day.delivered, day.date).toBeGreaterThan(0); expect(day.cancelled, day.date).toBeGreaterThan(0); expect(day.rejected, day.date).toBeGreaterThan(0); }
    for (const day of dash.admin.upcoming.slice(1)) {
      expect(day.cancelled, day.date).toBeGreaterThan(0); expect(day.rejected, day.date).toBeGreaterThan(0);
      if (day.cutoffPassed) expect(day.confirmed, day.date).toBeGreaterThan(0);
      else { expect(day.draft, day.date).toBeGreaterThan(0); expect(day.placed, day.date).toBeGreaterThan(0); }
    }
  });
});
