import type { FastifyPluginAsync } from 'fastify';
import { db } from '../../db/index.js';
import { services, sources } from '../../db/schema.js';
import { eq, sql, gte, lte, inArray, and, desc, asc, count, isNotNull } from 'drizzle-orm';
import { SERVICE_TYPES } from '../../shared/types.js';

// ── Reusable schema fragments ─────────────────────────────────────────────────

const sourceRef = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', nullable: true },
    key: { type: 'string', nullable: true },
  },
  required: ['id'],
} as const;

const serviceListItem = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    url: { type: 'string' },
    serviceType: { type: 'string' },
    organization: { type: 'string', nullable: true },
    title: { type: 'string', nullable: true },
    description: { type: 'string', nullable: true },
    bbox: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, nullable: true },
    layers: { type: 'array', items: { type: 'object', additionalProperties: true }, nullable: true },
    crs: { type: 'array', items: { type: 'string' }, nullable: true },
    keywords: { type: 'array', items: { type: 'string' }, nullable: true },
    formats: { type: 'array', items: { type: 'string' }, nullable: true },
    extraMeta: { type: 'object', additionalProperties: true, nullable: true },
    sourceCreatedAt: { type: 'string', format: 'date-time', nullable: true },
    sourceModifiedAt: { type: 'string', format: 'date-time', nullable: true },
    healthStatus: { type: 'string', nullable: true },
    lastCheckedAt: { type: 'string', format: 'date-time', nullable: true },
    responseTimeMs: { type: 'integer', nullable: true },
    source: sourceRef,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'url', 'serviceType', 'source', 'createdAt', 'updatedAt'],
} as const;

const serviceDetail = {
  type: 'object',
  properties: {
    ...serviceListItem.properties,
    lastSuccessAt: { type: 'string', format: 'date-time', nullable: true },
  },
  required: serviceListItem.required,
} as const;

// Raw DB row returned by INSERT/UPDATE .returning()
const serviceDbRecord = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    sourceId: { type: 'string', format: 'uuid' },
    url: { type: 'string' },
    serviceType: { type: 'string' },
    organization: { type: 'string', nullable: true },
    title: { type: 'string', nullable: true },
    description: { type: 'string', nullable: true },
    bboxXmin: { type: 'number', nullable: true },
    bboxYmin: { type: 'number', nullable: true },
    bboxXmax: { type: 'number', nullable: true },
    bboxYmax: { type: 'number', nullable: true },
    layers: { type: 'array', items: { type: 'object', additionalProperties: true }, nullable: true },
    crs: { type: 'array', items: { type: 'string' }, nullable: true },
    keywords: { type: 'array', items: { type: 'string' }, nullable: true },
    formats: { type: 'array', items: { type: 'string' }, nullable: true },
    extraMeta: { type: 'object', additionalProperties: true, nullable: true },
    sourceCreatedAt: { type: 'string', format: 'date-time', nullable: true },
    sourceModifiedAt: { type: 'string', format: 'date-time', nullable: true },
    healthStatus: { type: 'string', nullable: true },
    lastCheckedAt: { type: 'string', format: 'date-time', nullable: true },
    lastSuccessAt: { type: 'string', format: 'date-time', nullable: true },
    responseTimeMs: { type: 'integer', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'sourceId', 'url', 'serviceType', 'createdAt', 'updatedAt'],
} as const;

const errorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

// ── Routes ────────────────────────────────────────────────────────────────────

export const servicesRoutes: FastifyPluginAsync = async (app) => {
  // GET /services — search and list
  app.get('/', {
    schema: {
      tags: ['services'],
      summary: 'List and search services',
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Full-text search query' },
          type: { type: 'string', description: 'Comma-separated service types' },
          bbox: { type: 'string', description: 'Bounding box filter: xmin,ymin,xmax,ymax' },
          keywords: { type: 'string', description: 'Comma-separated keywords (must match all)' },
          health: { type: 'string', description: 'Health status filter' },
          source_id: { type: 'string', description: 'Filter by source UUID' },
          organization: { type: 'string', description: 'Filter by organization' },
          page: { type: 'string', description: 'Page number (default: 1)' },
          limit: { type: 'string', description: 'Results per page, max 500 (default: 50)' },
          sort: { type: 'string', description: 'Sort field: relevance | title | source_created_at | source_modified_at | updated_at' },
          order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction (default: desc)' },
          sourceCreatedAfter:   { type: 'string', format: 'date-time', description: 'Filter by source item creation date (after)' },
          sourceCreatedBefore:  { type: 'string', format: 'date-time', description: 'Filter by source item creation date (before)' },
          sourceModifiedAfter:  { type: 'string', format: 'date-time', description: 'Filter by source item modification date (after)' },
          sourceModifiedBefore: { type: 'string', format: 'date-time', description: 'Filter by source item modification date (before)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'array', items: serviceListItem },
            meta: {
              type: 'object',
              properties: {
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total: { type: 'integer' },
                totalPages: { type: 'integer' },
              },
              required: ['page', 'limit', 'total', 'totalPages'],
            },
          },
          required: ['data', 'meta'],
        },
      },
    },
  }, async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const q = query.q;
    const type = query.type;
    const bbox = query.bbox;
    const keywords = query.keywords;
    const health = query.health;
    const sourceId = query.source_id;
    const organization = query.organization;
    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const limit = Math.min(500, Math.max(1, parseInt(query.limit ?? '50', 10)));
    const sortField = query.sort ?? (q ? 'relevance' : 'updated_at');
    const order = query.order ?? 'desc';
    const offset = (page - 1) * limit;
    const sourceCreatedAfter   = query.sourceCreatedAfter;
    const sourceCreatedBefore  = query.sourceCreatedBefore;
    const sourceModifiedAfter  = query.sourceModifiedAfter;
    const sourceModifiedBefore = query.sourceModifiedBefore;

    const conditions: ReturnType<typeof eq>[] = [];

    // Full-text search
    if (q) {
      conditions.push(
        sql`search_vector @@ plainto_tsquery('english', ${q})`,
      );
    }

    // Type filter
    if (type) {
      const types = type.split(',').filter((t) => SERVICE_TYPES.includes(t as never));
      if (types.length > 0) {
        conditions.push(inArray(services.serviceType, types));
      }
    }

    // Spatial filter (bbox intersection using numeric columns)
    if (bbox) {
      const parts = bbox.split(',').map(Number);
      if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
        const [xmin, ymin, xmax, ymax] = parts;
        // Service bbox overlaps query bbox when:
        // service.xmin <= query.xmax AND service.xmax >= query.xmin
        // AND service.ymin <= query.ymax AND service.ymax >= query.ymin
        conditions.push(lte(services.bboxXmin, xmax));
        conditions.push(gte(services.bboxXmax, xmin));
        conditions.push(lte(services.bboxYmin, ymax));
        conditions.push(gte(services.bboxYmax, ymin));
      }
    }

    // TODO: PostGIS — replace above with ST_MakeEnvelope when PostGIS is available
    // conditions.push(sql`geom && ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}, 4326)`);

    // Keyword filter (must match ALL)
    if (keywords) {
      for (const kw of keywords.split(',')) {
        conditions.push(
          sql`${services.keywords} @> ${JSON.stringify([kw.trim()])}::jsonb`,
        );
      }
    }

    // Health filter
    if (health) {
      conditions.push(eq(services.healthStatus, health));
    }

    // Source filter
    if (sourceId) {
      conditions.push(eq(services.sourceId, sourceId));
    }

    // Organization filter
    if (organization) {
      conditions.push(eq(services.organization, organization));
    }

    // Timestamp filters (source item dates)
    if (sourceCreatedAfter)   conditions.push(gte(services.sourceCreatedAt, new Date(sourceCreatedAfter)));
    if (sourceCreatedBefore)  conditions.push(lte(services.sourceCreatedAt, new Date(sourceCreatedBefore)));
    if (sourceModifiedAfter)  conditions.push(gte(services.sourceModifiedAt, new Date(sourceModifiedAfter)));
    if (sourceModifiedBefore) conditions.push(lte(services.sourceModifiedAt, new Date(sourceModifiedBefore)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Count total
    const [{ total }] = await db
      .select({ total: count() })
      .from(services)
      .where(whereClause);

    // Build sort
    let orderBy;
    if (sortField === 'relevance' && q) {
      const direction = order === 'asc' ? asc : desc;
      orderBy = direction(
        sql`ts_rank(search_vector, plainto_tsquery('english', ${q}))`,
      );
    } else if (sortField === 'title') {
      orderBy = order === 'asc' ? asc(services.title) : desc(services.title);
    } else if (sortField === 'source_created_at') {
      orderBy = order === 'asc' ? asc(services.sourceCreatedAt) : desc(services.sourceCreatedAt);
    } else if (sortField === 'source_modified_at') {
      orderBy = order === 'asc' ? asc(services.sourceModifiedAt) : desc(services.sourceModifiedAt);
    } else {
      orderBy = order === 'asc' ? asc(services.updatedAt) : desc(services.updatedAt);
    }

    const rows = await db
      .select({
        id: services.id,
        url: services.url,
        serviceType: services.serviceType,
        organization: services.organization,
        title: services.title,
        description: services.description,
        bboxXmin: services.bboxXmin,
        bboxYmin: services.bboxYmin,
        bboxXmax: services.bboxXmax,
        bboxYmax: services.bboxYmax,
        layers: services.layers,
        crs: services.crs,
        keywords: services.keywords,
        formats: services.formats,
        extraMeta: services.extraMeta,
        sourceCreatedAt: services.sourceCreatedAt,
        sourceModifiedAt: services.sourceModifiedAt,
        healthStatus: services.healthStatus,
        lastCheckedAt: services.lastCheckedAt,
        responseTimeMs: services.responseTimeMs,
        createdAt: services.createdAt,
        updatedAt: services.updatedAt,
        sourceId: services.sourceId,
        sourceName: sources.name,
        sourceKey: sources.key,
      })
      .from(services)
      .leftJoin(sources, eq(services.sourceId, sources.id))
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    const data = rows.map((r) => ({
      id: r.id,
      url: r.url,
      serviceType: r.serviceType,
      organization: r.organization,
      title: r.title,
      description: r.description,
      bbox: r.bboxXmin != null && isFinite(r.bboxXmin) && isFinite(r.bboxYmin!) && isFinite(r.bboxXmax!) && isFinite(r.bboxYmax!)
        ? [r.bboxXmin, r.bboxYmin!, r.bboxXmax!, r.bboxYmax!]
        : null,
      layers: r.layers,
      crs: r.crs,
      keywords: r.keywords,
      formats: r.formats,
      extraMeta: r.extraMeta,
      sourceCreatedAt: r.sourceCreatedAt,
      sourceModifiedAt: r.sourceModifiedAt,
      healthStatus: r.healthStatus,
      lastCheckedAt: r.lastCheckedAt,
      responseTimeMs: r.responseTimeMs,
      source: {
        id: r.sourceId,
        name: r.sourceName,
        key: r.sourceKey,
      },
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    const totalCount = Number(total);
    return {
      data,
      meta: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  });

  // GET /services/types — list distinct service types
  app.get('/types', {
    schema: {
      tags: ['services'],
      summary: 'List distinct service types',
      response: {
        200: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  }, async () => {
    const rows = await db
      .selectDistinct({ serviceType: services.serviceType })
      .from(services)
      .orderBy(asc(services.serviceType));

    return rows.map((r) => r.serviceType);
  });

  // GET /services/organizations — list distinct organizations
  app.get('/organizations', {
    schema: {
      tags: ['services'],
      summary: 'List distinct service organizations',
      response: {
        200: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  }, async () => {
    const rows = await db
      .selectDistinct({ organization: services.organization })
      .from(services)
      .where(isNotNull(services.organization))
      .orderBy(asc(services.organization));

    return rows.map((r) => r.organization!);
  });

  // GET /services/keywords — list distinct keywords (unnested from JSONB arrays)
  app.get('/keywords', {
    schema: {
      tags: ['services'],
      summary: 'List distinct service keywords',
      response: {
        200: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  }, async () => {
    const result = await db.execute<{ keyword: string }>(sql`
      SELECT DISTINCT jsonb_array_elements_text(keywords) AS keyword
      FROM services
      WHERE keywords IS NOT NULL AND keywords != 'null'::jsonb
      ORDER BY keyword
    `);

    return [...result].map((r) => r.keyword);
  });

  // GET /services/:id
  app.get('/:id', {
    schema: {
      tags: ['services'],
      summary: 'Get a service by ID',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      response: {
        200: serviceDetail,
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [row] = await db
      .select({
        id: services.id,
        url: services.url,
        serviceType: services.serviceType,
        organization: services.organization,
        title: services.title,
        description: services.description,
        bboxXmin: services.bboxXmin,
        bboxYmin: services.bboxYmin,
        bboxXmax: services.bboxXmax,
        bboxYmax: services.bboxYmax,
        layers: services.layers,
        crs: services.crs,
        keywords: services.keywords,
        formats: services.formats,
        extraMeta: services.extraMeta,
        sourceCreatedAt: services.sourceCreatedAt,
        sourceModifiedAt: services.sourceModifiedAt,
        healthStatus: services.healthStatus,
        lastCheckedAt: services.lastCheckedAt,
        lastSuccessAt: services.lastSuccessAt,
        responseTimeMs: services.responseTimeMs,
        createdAt: services.createdAt,
        updatedAt: services.updatedAt,
        sourceId: services.sourceId,
        sourceName: sources.name,
        sourceKey: sources.key,
      })
      .from(services)
      .leftJoin(sources, eq(services.sourceId, sources.id))
      .where(eq(services.id, id))
      .limit(1);

    if (!row) {
      return reply.code(404).send({ error: 'Service not found' });
    }

    return {
      id: row.id,
      url: row.url,
      serviceType: row.serviceType,
      organization: row.organization,
      title: row.title,
      description: row.description,
      bbox: row.bboxXmin != null && isFinite(row.bboxXmin) && isFinite(row.bboxYmin!) && isFinite(row.bboxXmax!) && isFinite(row.bboxYmax!)
        ? [row.bboxXmin, row.bboxYmin!, row.bboxXmax!, row.bboxYmax!]
        : null,
      layers: row.layers,
      crs: row.crs,
      keywords: row.keywords,
      formats: row.formats,
      extraMeta: row.extraMeta,
      sourceCreatedAt: row.sourceCreatedAt,
      sourceModifiedAt: row.sourceModifiedAt,
      healthStatus: row.healthStatus,
      lastCheckedAt: row.lastCheckedAt,
      lastSuccessAt: row.lastSuccessAt,
      responseTimeMs: row.responseTimeMs,
      source: {
        id: row.sourceId,
        name: row.sourceName,
        key: row.sourceKey,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  // POST /services — manually add a service
  app.post('/', {
    schema: {
      tags: ['services'],
      summary: 'Create a service',
      body: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          serviceType: { type: 'string' },
          sourceId: { type: 'string', format: 'uuid' },
          organization: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          bbox: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
          layers: { type: 'array', items: { type: 'object', additionalProperties: true } },
          crs: { type: 'array', items: { type: 'string' } },
          keywords: { type: 'array', items: { type: 'string' } },
          formats: { type: 'array', items: { type: 'string' } },
          extraMeta: { type: 'object', additionalProperties: true },
        },
        required: ['url', 'serviceType', 'sourceId'],
      },
      response: {
        201: serviceDbRecord,
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      url: string;
      serviceType: string;
      sourceId: string;
      organization?: string;
      title?: string;
      description?: string;
      bbox?: [number, number, number, number];
      layers?: Array<{ name: string; title?: string; id?: string | number }>;
      crs?: string[];
      keywords?: string[];
      formats?: string[];
      extraMeta?: Record<string, unknown>;
    };

    const [inserted] = await db
      .insert(services)
      .values({
        url: body.url,
        serviceType: body.serviceType,
        sourceId: body.sourceId,
        organization: body.organization,
        title: body.title,
        description: body.description,
        bboxXmin: body.bbox?.[0],
        bboxYmin: body.bbox?.[1],
        bboxXmax: body.bbox?.[2],
        bboxYmax: body.bbox?.[3],
        layers: body.layers,
        crs: body.crs,
        keywords: body.keywords,
        formats: body.formats,
        extraMeta: body.extraMeta,
      })
      .returning();

    return reply.code(201).send(inserted);
  });

  // PATCH /services/:id
  app.patch('/:id', {
    schema: {
      tags: ['services'],
      summary: 'Update a service',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          serviceType: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          organization: { type: 'string' },
          healthStatus: { type: 'string' },
          bbox: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
          layers: { type: 'array', items: { type: 'object', additionalProperties: true } },
          crs: { type: 'array', items: { type: 'string' } },
          keywords: { type: 'array', items: { type: 'string' } },
          formats: { type: 'array', items: { type: 'string' } },
          extraMeta: { type: 'object', additionalProperties: true },
        },
      },
      response: {
        200: serviceDbRecord,
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    for (const field of ['title', 'description', 'serviceType', 'url', 'healthStatus', 'organization'] as const) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }
    for (const field of ['layers', 'crs', 'keywords', 'formats', 'extraMeta'] as const) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }
    if (body.bbox) {
      const bbox = body.bbox as [number, number, number, number];
      updateData.bboxXmin = bbox[0];
      updateData.bboxYmin = bbox[1];
      updateData.bboxXmax = bbox[2];
      updateData.bboxYmax = bbox[3];
    }

    const [updated] = await db
      .update(services)
      .set(updateData)
      .where(eq(services.id, id))
      .returning();

    if (!updated) {
      return reply.code(404).send({ error: 'Service not found' });
    }

    return updated;
  });

  // DELETE /services/:id
  app.delete('/:id', {
    schema: {
      tags: ['services'],
      summary: 'Delete a service',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: { deleted: { type: 'boolean' } },
          required: ['deleted'],
        },
        404: errorResponse,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [deleted] = await db
      .delete(services)
      .where(eq(services.id, id))
      .returning({ id: services.id });

    if (!deleted) {
      return reply.code(404).send({ error: 'Service not found' });
    }

    return { deleted: true };
  });
};
