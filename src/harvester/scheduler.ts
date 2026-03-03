import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { Cron } from 'croner';
import { db } from '../db/index.js';
import { sources } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { harvestSource } from './core.js';
import { logger } from '../shared/logger.js';
import type { SourcesYaml, SourceConfig } from '../shared/types.js';

async function ensureSource(entry: SourcesYaml['sources'][number]): Promise<string> {
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
        config: entry.config ?? null,
        updatedAt: new Date(),
      })
      .where(eq(sources.key, entry.key));
    return existing.id;
  }

  const [inserted] = await db
    .insert(sources)
    .values({
      key: entry.key,
      name: entry.name,
      url: entry.url,
      type: entry.type,
      config: entry.config ?? null,
    })
    .returning({ id: sources.id });

  return inserted.id;
}

async function main() {
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

  const jobs: Cron[] = [];

  for (const entry of yamlData.sources) {
    const schedule = entry.schedule ?? '0 3 * * *'; // default: 3 AM daily
    const id = await ensureSource(entry);

    const config: SourceConfig = { ...entry, id };

    const job = new Cron(schedule, async () => {
      logger.info({ source: entry.key, schedule }, 'Scheduled harvest starting');
      await harvestSource(config);
    });

    jobs.push(job);
    logger.info({ source: entry.key, schedule, nextRun: job.nextRun() }, 'Scheduled harvest job');
  }

  logger.info({ jobCount: jobs.length }, 'Scheduler running. Press Ctrl+C to stop.');

  // Keep process alive
  process.on('SIGINT', () => {
    logger.info('Shutting down scheduler...');
    for (const job of jobs) job.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error(err, 'Scheduler failed');
  process.exit(1);
});
