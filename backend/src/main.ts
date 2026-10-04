import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Behind Render's load balancer. Only that many proxy hops are trusted, so a client can't pick its own IP by
  // sending its own X-Forwarded-For (sign-in is limited per account anyway, see AppThrottlerGuard).
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.use(helmet());
  configureApp(app);
  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`Backend running on port ${port} (${process.env.APP_ENV ?? 'local'})`);
}

void bootstrap();
