import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { servicesRoutes } from './routes/services.js';
import { sourcesRoutes } from './routes/sources.js';
import { healthRoutes } from './routes/health.js';
import { env } from '../env.js';

const isDev = env.NODE_ENV !== 'production';

export async function buildServer() {
  const app = Fastify({
    logger: isDev
      ? {
          level: env.LOG_LEVEL,
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : { level: env.LOG_LEVEL },
    disableRequestLogging: !isDev,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'OpenGeo Data API',
        description: 'Geospatial service catalog and discovery API',
        version: '0.1.0',
      },
      servers: [
        { url: `http://localhost:${env.PORT}`, description: 'Local dev' },
      ],
      tags: [
        { name: 'services', description: 'Geospatial service operations' },
        { name: 'sources', description: 'Data source operations' },
        { name: 'health', description: 'Health checks' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // Routes
  await app.register(healthRoutes);
  await app.register(servicesRoutes, { prefix: '/services' });
  await app.register(sourcesRoutes, { prefix: '/sources' });

  // GET /types — convenience top-level alias
  app.get('/types', async (_request, reply) => {
    return reply.redirect('/services/types');
  });

  return app;
}
