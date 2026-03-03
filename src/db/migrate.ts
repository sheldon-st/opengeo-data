import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { logger } from '../shared/logger.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/opengeo';

async function runMigrations() {
  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  logger.info('Running Drizzle migrations...');
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  logger.info('Drizzle migrations complete.');

  // Custom PostGIS setup
  logger.info('Applying PostGIS extensions and custom columns...');
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;

  // Add geom column if it doesn't exist
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'services' AND column_name = 'geom'
      ) THEN
        ALTER TABLE services ADD COLUMN geom geometry(Polygon, 4326);
      END IF;
    END $$
  `;

  // GiST index on geom
  await sql`
    CREATE INDEX IF NOT EXISTS idx_services_geom ON services USING GIST (geom)
  `;

  // Full-text search vector column
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'services' AND column_name = 'search_vector'
      ) THEN
        ALTER TABLE services ADD COLUMN search_vector tsvector
          GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(description, '')), 'B')
          ) STORED;
      END IF;
    END $$
  `;

  // GIN index on search_vector
  await sql`
    CREATE INDEX IF NOT EXISTS idx_services_search ON services USING GIN (search_vector)
  `;

  logger.info('PostGIS setup complete.');
  await sql.end();
}

runMigrations().catch((err) => {
  logger.error(err, 'Migration failed');
  process.exit(1);
});
