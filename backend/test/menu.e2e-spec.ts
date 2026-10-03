import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';

type Preview = {
  tier: { name: string };
  categories: { name: string; items: { sku: string; priceCents: number }[] }[];
  searchResults: { sku: string }[];
  excluded: { name: string; reason: string }[];
};

// Runs against the local database after `npm run db:seed` (uses the seeded Ahmedabad companies and menu).
describe('Menu (e2e)', () => {
  let app: INestApplication<App>;
  let admin: ReturnType<typeof request.agent>;
  const prisma = new PrismaClient();
  const employeeOf = async (domain: string) =>
    (await prisma.employee.findFirstOrThrow({ where: { isActive: true, company: { domains: { some: { domain } } } }, orderBy: { id: 'asc' } })).id;
  const preview = async (employeeId: number, search = '') =>
    (await admin.get(`/api/menu/preview?employeeId=${employeeId}${search ? `&search=${search}` : ''}`).expect(200)).body as Preview;
  const skus = (menu: Preview) => menu.categories.flatMap((category) => category.items.map((item) => item.sku));

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    admin = request.agent(app.getHttpServer());
    await admin.post('/api/auth/login').send({ email: 'admin@test.com', password: 'Test@1234' }).expect(200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('never lists a dish without a price on the employee tier', async () => {
    const menu = await preview(await employeeOf('kalamtantu.com'));
    expect(skus(menu)).not.toContain('BEV-005');
    expect(menu.excluded.find((entry) => entry.name.startsWith('Packaged Mineral Water'))?.reason).toMatch(/No price/);
    expect(menu.categories.flatMap((category) => category.items).every((item) => item.priceCents > 0)).toBe(true);
  });

  it('applies the company tier: Enterprise is Standard − 8% and its "not sold" dish disappears', async () => {
    const menu = await preview(await employeeOf('kesarloop.in')); // seeded on the Enterprise tier
    expect(menu.tier.name).toBe('Enterprise');
    expect(skus(menu)).not.toContain('GUJ-005');
    const standardMenu = await preview(await employeeOf('kalamtantu.com'));
    const price = (m: Preview, sku: string) => m.categories.flatMap((category) => category.items).find((item) => item.sku === sku)!.priceCents;
    const standard = price(standardMenu, 'GUJ-001');
    expect(price(menu, 'GUJ-001')).toBe(Math.ceil((standard * 0.92) / 5) * 5);
  });

  it('hides a category or a dish for specific companies', async () => {
    const fintech = await preview(await employeeOf('ledgerkite.in'));
    expect(fintech.categories.map((category) => category.name)).not.toContain('Breakfast & Farsan');
    const gems = await preview(await employeeOf('hiranyaprabha.com'));
    expect(skus(gems)).not.toContain('GUJ-003');
    expect(skus(await preview(await employeeOf('kalamtantu.com')))).toContain('GUJ-003');
  });

  it('keeps the secret category out of the listing but finds it by search', async () => {
    const employeeId = await employeeOf('kalamtantu.com');
    const menu = await preview(employeeId);
    expect(menu.categories.map((category) => category.name)).not.toContain('Meeting & bulk trays');
    // Search covers the whole menu; the secret trays are reachable through it.
    expect((await preview(employeeId, 'tray')).searchResults.map((item) => item.sku)).toEqual(expect.arrayContaining(['MTG-001', 'MTG-002']));
    expect((await preview(employeeId, 'MTG')).searchResults.map((item) => item.sku).sort()).toEqual(['MTG-001', 'MTG-002']);
  });

  it('reorders categories and toggles items', async () => {
    const categories = (await admin.get('/api/menu/categories').expect(200)).body as { id: number; name: string; items: { id: number; dish: { sku: string } }[] }[];
    const reversed = [...categories].reverse().map((category) => category.id);
    const reordered = (await admin.put('/api/menu/categories/order').send({ ids: reversed }).expect(200)).body as { id: number }[];
    expect(reordered.map((category) => category.id)).toEqual(reversed);
    await admin.put('/api/menu/categories/order').send({ ids: categories.map((category) => category.id) }).expect(200);

    const drinks = categories.find((category) => category.name === 'Beverages')!;
    const item = drinks.items.find((entry) => entry.dish.sku === 'BEV-001')!;
    const employeeId = await employeeOf('kalamtantu.com');
    await admin.patch(`/api/menu/items/${item.id}`).send({ isActive: false }).expect(200);
    expect(skus(await preview(employeeId))).not.toContain('BEV-001');
    await admin.patch(`/api/menu/items/${item.id}`).send({ isActive: true }).expect(200);
    expect(skus(await preview(employeeId))).toContain('BEV-001');
  });
});
