import '../env.js';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { db } from '../db/index.js';
import { sources } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { harvestSource } from './core.js';
import { logger } from '../shared/logger.js';
import type { SourcesYaml, SourceConfig } from '../shared/types.js';

async function syncSources(yamlSources: SourcesYaml['sources']): Promise<SourceConfig[]> {
  const configs: SourceConfig[] = [];

  for (const entry of yamlSources) {
    // Upsert source record
    const existing = await db.query.sources.findFirst({
      where: eq(sources.key, entry.key),
    });

    if (existing) {
      await db
        .update(sources)
        .set({
          name: entry.name,
          url: entry.url,
          type: entry.type,
          organization: entry.organization ?? null,
          config: entry.config ?? null,
          updatedAt: new Date(),
        })
        .where(eq(sources.key, entry.key));

      configs.push({ ...entry, id: existing.id });
    } else {
      const [inserted] = await db
        .insert(sources)
        .values({
          key: entry.key,
          name: entry.name,
          url: entry.url,
          type: entry.type,
          organization: entry.organization ?? null,
          config: entry.config ?? null,
        })
        .returning({ id: sources.id });

      configs.push({ ...entry, id: inserted.id });
    }
  }

  return configs;
}

async function main() {
  const args = process.argv.slice(2);
  const sourceFlag = args.find((a) => a.startsWith('--source='));
  const sourceKey = sourceFlag?.split('=')[1];
  const runAll = args.includes('--all');

  if (!runAll && !sourceKey) {
    console.log('Usage:');
    console.log('  tsx src/harvester/run.ts --all              Harvest all sources');
    console.log('  tsx src/harvester/run.ts --source=<key>     Harvest a specific source');
    process.exit(1);
  }

  // Read sources.yaml
  let yamlContent: string;
  try {
    yamlContent = readFileSync('sources.yaml', 'utf-8');
  } catch {
    logger.error('Could not read sources.yaml');
    process.exit(1);
  }

  const yamlData = parse(yamlContent) as SourcesYaml;
  if (!yamlData.sources?.length) {
    logger.warn('No sources defined in sources.yaml');
    process.exit(0);
  }

  // Sync sources to DB
  const configs = await syncSources(yamlData.sources);

  // Filter to requested source(s)
  const toHarvest = sourceKey
    ? configs.filter((c) => c.key === sourceKey)
    : configs;

  if (toHarvest.length === 0) {
    logger.warn({ sourceKey }, 'No matching sources found');
    process.exit(1);
  }

  const concurrency = Number(process.env.HARVEST_CONCURRENCY ?? 3);
  logger.info({ count: toHarvest.length, concurrency }, 'Starting harvest');

  // Run harvests with concurrency limit
  const queue = [...toHarvest];
  const active: Promise<void>[] = [];

  while (queue.length > 0 || active.length > 0) {
    while (active.length < concurrency && queue.length > 0) {
      const source = queue.shift()!;
      const promise = harvestSource(source).then(() => {
        active.splice(active.indexOf(promise), 1);
      });
      active.push(promise);
    }
    if (active.length > 0) {
      await Promise.race(active);
    }
  }

  logger.info('All harvests complete');
  process.exit(0);
}

main().catch((err) => {
  logger.error(err, 'Harvester failed');
  process.exit(1);
});
