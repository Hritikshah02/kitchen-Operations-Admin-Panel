import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('Authentication and authorization (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();
  });

  it('logs in, restores the session, and logs out through an HTTP-only cookie', async () => {
    const agent = request.agent(app.getHttpServer());
    const login = await agent.post('/api/auth/login').send({ email: 'admin@test.com', password: 'Test@1234' }).expect(200);
    expect(login.body).toMatchObject({ email: 'admin@test.com', role: 'ADMIN' });
    expect(login.headers['set-cookie'][0]).toContain('HttpOnly');

    await agent.get('/api/auth/me').expect(200).expect(({ body }) => expect(body.role).toBe('ADMIN'));
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
  });

  it('requires a session and permits company access only to admins', async () => {
    await request(app.getHttpServer()).get('/api/companies').expect(401);

    const kitchen = request.agent(app.getHttpServer());
    await kitchen.post('/api/auth/login').send({ email: 'kitchen@test.com', password: 'Test@1234' }).expect(200);
    await kitchen.get('/api/companies').expect(403);

    const admin = request.agent(app.getHttpServer());
    await admin.post('/api/auth/login').send({ email: 'admin@test.com', password: 'Test@1234' }).expect(200);
    await admin.get('/api/companies').expect(200);
  });

  afterAll(async () => { await app.close(); });
});
