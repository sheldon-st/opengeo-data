import type { FastifyPluginAsync } from 'fastify';
import { db } from '../../db/index.js';
import { sources } from '../../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import { harvestSource } from '../../harvester/core.js';
import type { SourceConfig } from '../../shared/types.js';

export const sourcesRoutes: FastifyPluginAsync = async (app) => {
  // GET /sources — list all sources
  app.get('/', async () => {
    const rows = await db
      .select()
      .from(sources)
      .orderBy(asc(sources.name));

    return { data: rows };
  });

  // GET /sources/:id — single source detail
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const [row] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, id))
      .limit(1);

    if (!row) {
      return reply.code(404).send({ error: 'Source not found' });
    }

    return row;
  });

  // POST /sources/:id/harvest — trigger on-demand harvest
  app.post('/:id/harvest', async (request, reply) => {
    const { id } = request.params as { id: string };

    const [row] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, id))
      .limit(1);

    if (!row) {
      return reply.code(404).send({ error: 'Source not found' });
    }

    const config: SourceConfig = {
      id: row.id,
      key: row.key,
      name: row.name,
      type: row.type,
      url: row.url,
      config: row.config as Record<string, unknown> | undefined,
    };

    // Run harvest in background — don't block the response
    harvestSource(config).catch(() => {
      // errors are logged inside harvestSource
    });

    return { message: 'Harvest started', sourceId: id };
  });
};
