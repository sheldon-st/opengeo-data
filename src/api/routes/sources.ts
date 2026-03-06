import type { FastifyPluginAsync } from 'fastify';
import { db } from '../../db/index.js';
import { sources } from '../../db/schema.js';
import { eq, asc, and, gte, lte } from 'drizzle-orm';
import { harvestSource } from '../../harvester/core.js';
import type { SourceConfig } from '../../shared/types.js';

// ── Reusable schema fragments ─────────────────────────────────────────────────

const sourceRecord = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    key: { type: 'string' },
    name: { type: 'string' },
    url: { type: 'string' },
    type: { type: 'string' },
    organization: { type: 'string', nullable: true },
    enabled: { type: 'boolean' },
    lastHarvestAt: { type: 'string', format: 'date-time', nullable: true },
    lastHarvestStatus: { type: 'string', nullable: true },
    lastHarvestError: { type: 'string', nullable: true },
    servicesFound: { type: 'integer', nullable: true },
    config: { type: 'object', additionalProperties: true, nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'key', 'name', 'url', 'type', 'enabled', 'createdAt', 'updatedAt'],
} as const;

const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

// ── Routes ────────────────────────────────────────────────────────────────────

export const sourcesRoutes: FastifyPluginAsync = async (app) => {
  // GET /sources — list all sources
  app.get('/', {
    schema: {
      tags: ['sources'],
      summary: 'List all sources',
      querystring: {
        type: 'object',
        properties: {
          createdAfter:  { type: 'string', format: 'date-time' },
          createdBefore: { type: 'string', format: 'date-time' },
          updatedAfter:  { type: 'string', format: 'date-time' },
          updatedBefore: { type: 'string', format: 'date-time' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'array', items: sourceRecord },
          },
          required: ['data'],
        },
      },
    },
  }, async (request) => {
    const { createdAfter, createdBefore, updatedAfter, updatedBefore } =
      request.query as {
        createdAfter?: string;
        createdBefore?: string;
        updatedAfter?: string;
        updatedBefore?: string;
      };

    const filters = [
      createdAfter  ? gte(sources.createdAt, new Date(createdAfter))  : undefined,
      createdBefore ? lte(sources.createdAt, new Date(createdBefore)) : undefined,
      updatedAfter  ? gte(sources.updatedAt, new Date(updatedAfter))  : undefined,
      updatedBefore ? lte(sources.updatedAt, new Date(updatedBefore)) : undefined,
    ].filter(Boolean);

    const rows = await db
      .select()
      .from(sources)
      .where(filters.length ? and(...(filters as NonNullable<typeof filters[number]>[])) : undefined)
      .orderBy(asc(sources.name));

    return { data: rows };
  });

  // GET /sources/:id — single source detail
  app.get('/:id', {
    schema: {
      tags: ['sources'],
      summary: 'Get a source by ID',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      response: {
        200: sourceRecord,
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
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
  app.post('/:id/harvest', {
    schema: {
      tags: ['sources'],
      summary: 'Trigger an on-demand harvest for a source',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            sourceId: { type: 'string', format: 'uuid' },
          },
          required: ['message', 'sourceId'],
        },
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
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
