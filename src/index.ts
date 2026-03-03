import { buildServer } from './api/server.js';
import { logger } from './shared/logger.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

async function main() {
  const app = await buildServer();

  await app.listen({ port, host });
  logger.info({ port, host }, 'OpenGeo Data API running');
}

main().catch((err) => {
  logger.error(err, 'Failed to start server');
  process.exit(1);
});
