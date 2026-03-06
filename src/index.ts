// Load .env before anything else
import './env.js';

import { buildServer } from './api/server.js';
import { logger } from './shared/logger.js';
import { env } from './env.js';

async function main() {
  const app = await buildServer();

  await app.listen({ port: env.PORT, host: env.HOST });

  logger.info('──────────────────────────────────────');
  logger.info(`  OpenGeo Data API v0.1.0`);
  logger.info(`  http://${env.HOST === '0.0.0.0' ? 'localhost' : env.HOST}:${env.PORT}`);
  logger.info(`  Swagger UI: http://localhost:${env.PORT}/documentation`);
  logger.info(`  Drizzle Studio: pnpm db:studio`);
  logger.info('──────────────────────────────────────');
}

main().catch((err) => {
  logger.error(err, 'Failed to start server');
  process.exit(1);
});
