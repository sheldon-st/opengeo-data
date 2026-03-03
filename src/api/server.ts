import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { servicesRoutes } from './routes/services.js';
import { sourcesRoutes } from './routes/sources.js';
import { healthRoutes } from './routes/health.js';
import { logger } from '../shared/logger.js';

export async function buildServer() {
  const app = Fastify({
    logger: logger as unknown as boolean,
  });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? '*',
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'OpenGeo Data API',
        description: 'Geospatial service catalog and discovery API',
        version: '0.1.0',
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/documentation',
  });

  await app.register(healthRoutes);
  await app.register(servicesRoutes, { prefix: '/services' });
  await app.register(sourcesRoutes, { prefix: '/sources' });

  return app;
}
