import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  boolean,
  integer,
  doublePrecision,
  unique,
  index,
} from 'drizzle-orm/pg-core';

export const sources = pgTable('sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  type: text('type').notNull(),
  organization: text('organization'),
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
    organization: text('organization'),
    title: text('title'),
    description: text('description'),
    bboxXmin: doublePrecision('bbox_xmin'),
    bboxYmin: doublePrecision('bbox_ymin'),
    bboxXmax: doublePrecision('bbox_xmax'),
    bboxYmax: doublePrecision('bbox_ymax'),
    layers: jsonb('layers'),
    crs: jsonb('crs'),
    keywords: jsonb('keywords'),
    formats: jsonb('formats'),
    extraMeta: jsonb('extra_meta'),
    sourceCreatedAt: timestamp('source_created_at', { withTimezone: true }),
    sourceModifiedAt: timestamp('source_modified_at', { withTimezone: true }),
    healthStatus: text('health_status').default('unknown'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    responseTimeMs: integer('response_time_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    // TODO: PostGIS — re-enable when PostGIS is available
    // geom column: geometry(Polygon, 4326) — created via custom migration SQL
    // search_vector column: tsvector GENERATED — created via custom migration SQL
  },
  (table) => [
    unique('services_url_source_unique').on(table.url, table.sourceId),
    index('idx_services_service_type').on(table.serviceType),
    index('idx_services_source_id').on(table.sourceId),
    index('idx_services_health_status').on(table.healthStatus),
    index('idx_services_updated_at').on(table.updatedAt),
  ],
);
