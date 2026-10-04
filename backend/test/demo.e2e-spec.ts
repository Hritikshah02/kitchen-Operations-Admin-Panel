import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderStatus, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

describe('Demo data and closed-day defaults (e2e)', () => {
  let app: INestApplication<App>;
  let admin: ReturnType<typeof request.agent>;
  const prisma = new PrismaClient();
  const run = Date.now().toString(36);

  beforeAll(async () => {
    process.env.DEMO_REFRESH_TOKEN = 'test-demo-token';
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    admin = request.agent(app.getHttpServer());
    await admin.post('/api/auth/login').send({ email: 'admin@test.com', password: 'Test@1234' }).expect(200);
  });
  afterAll(async () => { delete process.env.DEMO_REFRESH_TOKEN; await prisma.$disconnect(); await app.close(); });

  it('never touches a company or an order that staff created', async () => {
    const staff = await prisma.staff.findUniqueOrThrow({ where: { email: 'admin@test.com' } });
    const tier = await prisma.priceTier.findFirstOrThrow();
    const company = await prisma.company.create({
      data: { name: `Real Co ${run}`, billingContactName: 'Accounts', billingContactEmail: `acc.${run}@example.com`, addresses: { create: { label: 'HQ', line1: '1 Road', city: 'Ahmedabad', pincode: '380001', isDefault: true } } },
      include: { addresses: true },
    });
    const employee = await prisma.employee.create({ data: { name: `Real Person ${run}`, email: `real.${run}@realco${run}.example.com`, companyId: company.id } });
    const order = await prisma.order.create({
      data: { employeeId: employee.id, companyId: company.id, status: OrderStatus.CONFIRMED, deliveryDate: new Date(`${today()}T00:00:00Z`), deliveryTime: '00:05', addressId: company.addresses[0].id, priceTierId: tier.id, totalCents: 500, createdById: staff.id },
    });
    expect(company.isDemo).toBe(false);
    expect(order.isDemo).toBe(false);

    await request(app.getHttpServer()).post('/api/demo/refresh').set('x-demo-token', 'test-demo-token').expect(201);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { events: true } });
    expect(after.status).toBe(OrderStatus.CONFIRMED); // a delivery time of 00:05 would have been "delivered" long ago by the simulator
    expect(after.kitchenStartedAt).toBeNull();
    expect(after.driverId).toBeNull();
    expect(after.events).toHaveLength(0);
    expect(await prisma.order.count({ where: { companyId: company.id } })).toBe(1);
    expect(await prisma.invoice.count({ where: { companyId: company.id } })).toBe(0);
  });

  it('opens the boards on the next working day when the kitchen is closed today', async () => {
    const dashboard = (await admin.get('/api/dashboard').expect(200)).body as { operatingDate: string; today: string };
    const kitchen = (await admin.get('/api/kitchen/board').expect(200)).body as { date: string; today: string; closedToday: boolean };
    const dispatch = (await admin.get('/api/dispatch/board').expect(200)).body as { date: string; closedToday: boolean };
    expect(kitchen.date).toBe(dashboard.operatingDate);
    expect(dispatch.date).toBe(dashboard.operatingDate);
    expect(kitchen.closedToday).toBe(kitchen.date !== kitchen.today);
    expect(kitchen.date >= kitchen.today).toBe(true);
    // An explicit date still wins.
    expect(((await admin.get('/api/kitchen/board?date=2026-09-30').expect(200)).body as { date: string }).date).toBe('2026-09-30');
  });

  it('shows a driver the next working day’s drops when today is closed', async () => {
    const driver = request.agent(app.getHttpServer());
    await driver.post('/api/auth/login').send({ email: 'driver@test.com', password: 'Test@1234' }).expect(200);
    const body = (await driver.get('/api/driver/drops').expect(200)).body as { closedToday: boolean; nextDay: { date: string } | null };
    expect(body.closedToday).toBe(body.nextDay !== null);
  });

  it('keeps sample history believable: nothing in the future, a full timeline in time order', async () => {
    const future = await prisma.order.count({ where: { isDemo: true, OR: [{ placedAt: { gt: new Date() } }, { cancelledAt: { gt: new Date() } }, { rejectedAt: { gt: new Date() } }, { confirmedAt: { gt: new Date() } }] } });
    expect(future).toBe(0);
    const delivered = await prisma.order.findFirstOrThrow({ where: { isDemo: true, status: OrderStatus.DELIVERED, deliveryDate: { lt: new Date(`${today()}T00:00:00Z`) } }, include: { events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } });
    expect(delivered.events.map((event) => event.type)).toEqual(['CREATED', 'PLACED', 'CONFIRMED', 'KITCHEN_STARTED', 'KITCHEN_READY', 'DISPATCH_READY', 'OUT_FOR_DELIVERY', 'DELIVERED']);
    expect(new Set(delivered.events.map((event) => event.createdAt.getTime())).size).toBe(delivered.events.length);
    const cancelled = await prisma.order.findMany({ where: { isDemo: true, status: OrderStatus.CANCELLED, placedAt: { not: null }, cancelledAt: { not: null } }, select: { placedAt: true, cancelledAt: true } });
    expect(cancelled.every((order) => order.cancelledAt! >= order.placedAt!)).toBe(true);
  });
});
