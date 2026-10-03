import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';

type Row = { id: number; sku: string | null; costCents: number; typedCents: number | null; derivedCents: number | null; priceCents: number | null; source: string; isUnavailable: boolean };

// Runs against the local database after `npm run db:seed`.
describe('Pricing (e2e)', () => {
  let app: INestApplication<App>;
  let admin: ReturnType<typeof request.agent>;
  const run = Date.now().toString(36);
  let standardId: number;
  let dishId: number;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    admin = request.agent(app.getHttpServer());
    await admin.post('/api/auth/login').send({ email: 'admin@test.com', password: 'Test@1234' }).expect(200);
    const tiers = (await admin.get('/api/pricing/tiers').expect(200)).body as { id: number; name: string; isDefault: boolean }[];
    standardId = tiers.find((tier) => tier.isDefault)!.id;
    dishId = (await admin.post('/api/catalogue/dishes').send({ sku: `P-${run}`.toUpperCase().slice(0, 20), name: `Priced ${run}`, temperature: 'HOT', costCents: 88 }).expect(201)).body.id;
  });

  afterAll(async () => { await app.close(); });

  const row = async (tierId: number) => {
    const { body } = await admin.get(`/api/pricing/tiers/${tierId}/grid?kind=dishes&search=P-${run}`).expect(200);
    return (body.rows as Row[])[0];
  };

  it('shows a new dish as missing on the manual default tier, then priced once typed', async () => {
    expect(await row(standardId)).toMatchObject({ priceCents: null, source: 'missing' });
    const missing = (await admin.get(`/api/pricing/tiers/${standardId}/grid?kind=dishes&missingOnly=true`).expect(200)).body.rows as Row[];
    expect(missing.some((entry) => entry.id === dishId)).toBe(true);
    await admin.put(`/api/pricing/tiers/${standardId}/prices`).send({ dishes: [{ id: dishId, priceCents: 200 }] }).expect(200);
    expect(await row(standardId)).toMatchObject({ priceCents: 200, source: 'manual' });
  });

  it('derives "cost × 2.4" with round-up to 5 cents and lets staff override', async () => {
    const tier = (await admin.post('/api/pricing/tiers').send({ name: `Cost ${run}`, rule: 'COST_MULTIPLIER', ruleValueBps: 24000 }).expect(201)).body;
    expect(await row(tier.id)).toMatchObject({ derivedCents: 215, priceCents: 215, source: 'derived' }); // 88 × 2.4 = 211.2
    await admin.put(`/api/pricing/tiers/${tier.id}/prices`).send({ dishes: [{ id: dishId, priceCents: 199 }] }).expect(200);
    expect(await row(tier.id)).toMatchObject({ derivedCents: 215, priceCents: 199, source: 'override' });
    await admin.put(`/api/pricing/tiers/${tier.id}/prices`).send({ dishes: [{ id: dishId, priceCents: null }] }).expect(200);
    expect(await row(tier.id)).toMatchObject({ priceCents: 215, source: 'derived' });
  });

  it('derives "Standard + 15%" and supports "not sold on this tier"', async () => {
    const tier = (await admin.post('/api/pricing/tiers').send({ name: `Plus ${run}`, rule: 'TIER_PERCENT', ruleValueBps: 1500, baseTierId: standardId }).expect(201)).body;
    expect(await row(tier.id)).toMatchObject({ priceCents: 230, source: 'derived' }); // 200 × 1.15
    await admin.put(`/api/pricing/tiers/${tier.id}/prices`).send({ dishes: [{ id: dishId, isUnavailable: true }] }).expect(200);
    expect(await row(tier.id)).toMatchObject({ priceCents: null, source: 'unavailable', isUnavailable: true });
  });

  it('rejects invalid rules and derivation loops', async () => {
    await admin.post('/api/pricing/tiers').send({ name: `Bad ${run}`, rule: 'TIER_PERCENT', ruleValueBps: 500 }).expect(400); // no base
    await admin.post('/api/pricing/tiers').send({ name: `Bad ${run}`, rule: 'COST_MULTIPLIER', ruleValueBps: 0 }).expect(400);
    const a = (await admin.post('/api/pricing/tiers').send({ name: `A ${run}`, rule: 'TIER_PERCENT', ruleValueBps: 100, baseTierId: standardId }).expect(201)).body;
    const b = (await admin.post('/api/pricing/tiers').send({ name: `B ${run}`, rule: 'TIER_PERCENT', ruleValueBps: 100, baseTierId: a.id }).expect(201)).body;
    await admin.patch(`/api/pricing/tiers/${a.id}`).send({ baseTierId: b.id }).expect(400);
  });

  it('keeps exactly one default tier', async () => {
    const tier = (await admin.post('/api/pricing/tiers').send({ name: `Default ${run}` }).expect(201)).body;
    const tiers = (await admin.post(`/api/pricing/tiers/${tier.id}/make-default`).expect(201)).body as { id: number; isDefault: boolean }[];
    expect(tiers.filter((entry) => entry.isDefault).map((entry) => entry.id)).toEqual([tier.id]);
    await admin.post(`/api/pricing/tiers/${standardId}/make-default`).expect(201);
  });

  it('assigns a tier to a company', async () => {
    const companies = (await admin.get('/api/companies?pageSize=1').expect(200)).body.items as { id: number }[];
    const tiers = (await admin.get('/api/pricing/tiers').expect(200)).body as { id: number; name: string }[];
    const enterprise = tiers.find((tier) => tier.name === 'Enterprise')!;
    const { body } = await admin.patch(`/api/companies/${companies[0].id}`).send({ priceTierId: enterprise.id }).expect(200);
    expect(body.priceTier).toEqual({ id: enterprise.id, name: 'Enterprise' });
    await admin.patch(`/api/companies/${companies[0].id}`).send({ priceTierId: 999999 }).expect(400);
  });
});
