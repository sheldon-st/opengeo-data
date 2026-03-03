import type { FastifyPluginAsync } from 'fastify';
import { db } from '../../db/index.js';
import { sql } from 'drizzle-orm';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    // Quick DB connectivity check
    await db.execute(sql`SELECT 1`);
    return { status: 'ok', timestamp: new Date().toISOString() };
  });
};
