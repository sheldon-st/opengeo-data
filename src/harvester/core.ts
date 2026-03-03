import { db } from '../db/index.js';
import { services, sources } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { getProvider } from './providers/index.js';
import type { SourceConfig } from '../shared/types.js';
import { logger } from '../shared/logger.js';

export async function harvestSource(source: SourceConfig): Promise<void> {
  const provider = getProvider(source.type);
  if (!provider) {
    logger.warn({ source: source.key, type: source.type }, 'No provider found for source type');
    return;
  }

  let count = 0;
  const startTime = Date.now();
  const log = logger.child({ source: source.key });

  try {
    for await (const result of provider.harvest(source.url, source.config)) {
      count++;

      await db
        .insert(services)
        .values({
          sourceId: source.id,
          url: result.url,
          serviceType: result.serviceType,
          title: result.title ?? null,
          description: result.description ?? null,
          bbox: result.bbox?.join(',') ?? null,
          layers: result.layers ?? null,
          crs: result.crs ?? null,
          keywords: result.keywords ?? null,
          formats: result.formats ?? null,
          extraMeta: result.extraMeta ?? null,
          healthStatus: 'healthy',
          lastCheckedAt: new Date(),
          lastSuccessAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [services.url, services.sourceId],
          set: {
            serviceType: result.serviceType,
            title: result.title ?? null,
            description: result.description ?? null,
            bbox: result.bbox?.join(',') ?? null,
            layers: result.layers ?? null,
            crs: result.crs ?? null,
            keywords: result.keywords ?? null,
            formats: result.formats ?? null,
            extraMeta: result.extraMeta ?? null,
            healthStatus: 'healthy',
            lastCheckedAt: new Date(),
            lastSuccessAt: new Date(),
            updatedAt: new Date(),
          },
        });

      // Update PostGIS geom column via raw SQL
      if (result.bbox) {
        const [xmin, ymin, xmax, ymax] = result.bbox;
        await db.execute(
          sql`UPDATE services SET geom = ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}, 4326) WHERE url = ${result.url} AND source_id = ${source.id}`,
        );
      }

      if (count % 50 === 0) {
        log.info({ count }, 'Harvesting in progress...');
      }
    }

    await db
      .update(sources)
      .set({
        lastHarvestAt: new Date(),
        lastHarvestStatus: 'success',
        lastHarvestError: null,
        servicesFound: count,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, source.id));

    log.info({ count, durationMs: Date.now() - startTime }, 'Harvest complete');
  } catch (err) {
    log.error({ err }, 'Harvest failed');
    await db
      .update(sources)
      .set({
        lastHarvestAt: new Date(),
        lastHarvestStatus: 'error',
        lastHarvestError: String(err),
        updatedAt: new Date(),
      })
      .where(eq(sources.id, source.id));
  }
}
