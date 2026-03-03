import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  boolean,
  integer,
  unique,
  index,
} from 'drizzle-orm/pg-core';

export const sources = pgTable('sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  type: text('type').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  lastHarvestAt: timestamp('last_harvest_at', { withTimezone: true }),
  lastHarvestStatus: text('last_harvest_status'),
  lastHarvestError: text('last_harvest_error'),
  servicesFound: integer('services_found').default(0),
  config: jsonb('config'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const services = pgTable(
  'services',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceId: uuid('source_id')
      .references(() => sources.id, { onDelete: 'cascade' })
      .notNull(),
    url: text('url').notNull(),
    serviceType: text('service_type').notNull(),
    title: text('title'),
    description: text('description'),
    bbox: text('bbox'),
    // geom column created via custom migration SQL (PostGIS geometry)
    layers: jsonb('layers'),
    crs: jsonb('crs'),
    keywords: jsonb('keywords'),
    formats: jsonb('formats'),
    extraMeta: jsonb('extra_meta'),
    healthStatus: text('health_status').default('unknown'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    responseTimeMs: integer('response_time_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // search_vector column created via custom migration SQL (generated tsvector)
  },
  (table) => [
    unique('services_url_source_unique').on(table.url, table.sourceId),
    index('idx_services_service_type').on(table.serviceType),
    index('idx_services_source_id').on(table.sourceId),
    index('idx_services_health_status').on(table.healthStatus),
    index('idx_services_updated_at').on(table.updatedAt),
  ],
);
