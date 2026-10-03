import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';

// Runs against the local database after `npm run db:seed`.
describe('Catalogue (e2e)', () => {
  let app: INestApplication<App>;
  let admin: ReturnType<typeof request.agent>;
  const run = Date.now().toString(36).toUpperCase();
  let sizes: { id: number; name: string }[];

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    admin = request.agent(app.getHttpServer());
    await admin.post('/api/auth/login').send({ email: 'admin@test.com', password: 'Test@1234' }).expect(200);
    sizes = (await admin.get('/api/reference-data/portion-sizes').expect(200)).body;
  });

  afterAll(async () => { await app.close(); });

  it('creates, updates and deactivates a dish (never deletes it)', async () => {
    const { body } = await admin.post('/api/catalogue/dishes').send({ sku: `T-${run}`, name: `Test Bowl ${run}`, temperature: 'HOT', costCents: 88, minOrderQty: 2 }).expect(201);
    expect(body).toMatchObject({ sku: `T-${run}`, costCents: 88, station: null, isActive: true });
    await admin.post('/api/catalogue/dishes').send({ sku: `T-${run}`, name: 'Dup', temperature: 'HOT', costCents: 1 }).expect(409);
    await admin.post('/api/catalogue/dishes').send({ sku: 'bad sku', name: 'X', temperature: 'WARM', costCents: -1 }).expect(400);
    const updated = await admin.patch(`/api/catalogue/dishes/${body.id}`).send({ isActive: false }).expect(200);
    expect(updated.body.isActive).toBe(false);
    await admin.get(`/api/catalogue/dishes/${body.id}`).expect(200);
  });

  it('enforces that a portioned group can sell every option in every size', async () => {
    const regular = sizes.find((size) => size.name === 'Regular')!;
    const large = sizes.find((size) => size.name === 'Large')!;
    const sized = await admin.post('/api/catalogue/options').send({ name: `Sized ${run}`, costCents: 40, surcharges: [{ portionSizeId: regular.id, surchargeCents: 0 }, { portionSizeId: large.id, surchargeCents: 30 }] }).expect(201);
    const unsized = await admin.post('/api/catalogue/options').send({ name: `Unsized ${run}`, costCents: 40 }).expect(201);

    const rejected = await admin.post('/api/catalogue/option-groups').send({ name: `Group ${run}`, usesPortions: true, portionSizeIds: [regular.id, large.id], optionIds: [sized.body.id, unsized.body.id] }).expect(400);
    expect(rejected.body.message).toContain(`Unsized ${run} (Regular)`);

    const group = await admin.post('/api/catalogue/option-groups').send({ name: `Group ${run}`, usesPortions: true, portionSizeIds: [regular.id, large.id], optionIds: [sized.body.id] }).expect(201);
    expect(group.body).toMatchObject({ required: true, options: [{ name: `Sized ${run}` }] });

    // Removing a surcharge the group depends on is refused too.
    await admin.patch(`/api/catalogue/options/${sized.body.id}`).send({ surcharges: [{ portionSizeId: regular.id, surchargeCents: 0 }] }).expect(400);
  });

  it('rejects impossible selection rules', async () => {
    const option = await admin.post('/api/catalogue/options').send({ name: `Only ${run}`, costCents: 10 }).expect(201);
    await admin.post('/api/catalogue/option-groups').send({ name: `Bad ${run}`, minSelect: 2, maxSelect: 1, optionIds: [option.body.id] }).expect(400);
    await admin.post('/api/catalogue/option-groups').send({ name: `Bad ${run}`, minSelect: 2, maxSelect: 2, optionIds: [option.body.id] }).expect(400);
  });

  it('attaches reusable groups to dishes in order', async () => {
    const groups = (await admin.get('/api/catalogue/option-groups').expect(200)).body as { id: number; name: string }[];
    const dish = await admin.post('/api/catalogue/dishes').send({ sku: `G-${run}`, name: `Grouped ${run}`, temperature: 'HOT', costCents: 100 }).expect(201);
    const [first, second] = groups;
    const { body } = await admin.put(`/api/catalogue/dishes/${dish.body.id}/option-groups`).send({ groupIds: [second.id, first.id] }).expect(200);
    expect(body.optionGroups.map((group: { id: number }) => group.id)).toEqual([second.id, first.id]);
  });

  it('is admin-only', async () => {
    const kitchen = request.agent(app.getHttpServer());
    await kitchen.post('/api/auth/login').send({ email: 'kitchen@test.com', password: 'Test@1234' }).expect(200);
    await kitchen.get('/api/catalogue/dishes').expect(403);
  });
});
