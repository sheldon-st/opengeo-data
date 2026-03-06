import type { FastifyPluginAsync } from 'fastify';
import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', {
    schema: {
      tags: ['health'],
      summary: 'Health check',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
          required: ['status', 'timestamp'],
        },
      },
    },
  }, async () => {
    // Quick DB connectivity check
    await db.execute(sql`SELECT 1`);
    return { status: 'ok', timestamp: new Date().toISOString() };
  });
};
