import type { FastifyPluginAsync } from 'fastify';
import { db } from '../../db/index.js';
import { services, sources } from '../../db/schema.js';
import { eq, sql, inArray, and, desc, asc, count } from 'drizzle-orm';
import { SERVICE_TYPES } from '../../shared/types.js';

export const servicesRoutes: FastifyPluginAsync = async (app) => {
  // GET /services — search and list
  app.get('/', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const q = query.q;
    const type = query.type;
    const bbox = query.bbox;
    const keywords = query.keywords;
    const health = query.health;
    const sourceId = query.source_id;
    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const limit = Math.min(500, Math.max(1, parseInt(query.limit ?? '50', 10)));
    const sortField = query.sort ?? (q ? 'relevance' : 'updated_at');
    const order = query.order ?? 'desc';
    const offset = (page - 1) * limit;

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

    // Spatial filter
    if (bbox) {
      const parts = bbox.split(',').map(Number);
      if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
        const [xmin, ymin, xmax, ymax] = parts;
        conditions.push(
          sql`geom && ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}, 4326)`,
        );
      }
    }

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
    } else if (sortField === 'created_at') {
      orderBy = order === 'asc' ? asc(services.createdAt) : desc(services.createdAt);
    } else {
      orderBy = order === 'asc' ? asc(services.updatedAt) : desc(services.updatedAt);
    }

    const rows = await db
      .select({
        id: services.id,
        url: services.url,
        serviceType: services.serviceType,
        title: services.title,
        description: services.description,
        bbox: services.bbox,
        layers: services.layers,
        crs: services.crs,
        keywords: services.keywords,
        formats: services.formats,
        extraMeta: services.extraMeta,
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
      title: r.title,
      description: r.description,
      bbox: r.bbox?.split(',').map(Number),
      layers: r.layers,
      crs: r.crs,
      keywords: r.keywords,
      formats: r.formats,
      extraMeta: r.extraMeta,
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

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });

  // GET /services/types — list distinct service types
  app.get('/types', async () => {
    const rows = await db
      .selectDistinct({ serviceType: services.serviceType })
      .from(services)
      .orderBy(asc(services.serviceType));

    return rows.map((r) => r.serviceType);
  });

  // GET /services/:id
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const [row] = await db
      .select({
        id: services.id,
        url: services.url,
        serviceType: services.serviceType,
        title: services.title,
        description: services.description,
        bbox: services.bbox,
        layers: services.layers,
        crs: services.crs,
        keywords: services.keywords,
        formats: services.formats,
        extraMeta: services.extraMeta,
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
      ...row,
      bbox: row.bbox?.split(',').map(Number),
      source: {
        id: row.sourceId,
        name: row.sourceName,
        key: row.sourceKey,
      },
    };
  });

  // POST /services — manually add a service
  app.post('/', async (request, reply) => {
    const body = request.body as {
      url: string;
      serviceType: string;
      sourceId: string;
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
        title: body.title,
        description: body.description,
        bbox: body.bbox?.join(','),
        layers: body.layers,
        crs: body.crs,
        keywords: body.keywords,
        formats: body.formats,
        extraMeta: body.extraMeta,
      })
      .returning();

    // Set geom if bbox provided
    if (body.bbox) {
      const [xmin, ymin, xmax, ymax] = body.bbox;
      await db.execute(
        sql`UPDATE services SET geom = ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}, 4326) WHERE id = ${inserted.id}`,
      );
    }

    return reply.code(201).send(inserted);
  });

  // PATCH /services/:id
  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    for (const field of ['title', 'description', 'serviceType', 'url', 'healthStatus'] as const) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }
    for (const field of ['layers', 'crs', 'keywords', 'formats', 'extraMeta'] as const) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }
    if (body.bbox) {
      const bbox = body.bbox as [number, number, number, number];
      updateData.bbox = bbox.join(',');
    }

    const [updated] = await db
      .update(services)
      .set(updateData)
      .where(eq(services.id, id))
      .returning();

    if (!updated) {
      return reply.code(404).send({ error: 'Service not found' });
    }

    // Update geom if bbox changed
    if (body.bbox) {
      const [xmin, ymin, xmax, ymax] = body.bbox as [number, number, number, number];
      await db.execute(
        sql`UPDATE services SET geom = ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}, 4326) WHERE id = ${id}`,
      );
    }

    return updated;
  });

  // DELETE /services/:id
  app.delete('/:id', async (request, reply) => {
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
