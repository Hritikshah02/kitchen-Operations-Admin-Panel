import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { DemoOrdersService } from '../demo/demo-orders.service.js';

// `npm run db:seed` runs this after prisma/seed.js: fills demo orders around today for dates that have none.
async function main() {

  process.env.SKIP_CUTOFF_SCHEDULER = 'true';

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const result = await app.get(DemoOrdersService).ensure();
    console.log(`Demo orders: ${result.created} created${result.dates.length ? ` for ${result.dates.join(', ')}` : ' (every date already has orders)'}.`);
  } finally {
    await app.close();
  }
}

void main();
