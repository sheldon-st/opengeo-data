# OpenGeo Data

A geospatial service catalog that automatically discovers and indexes geospatial web services from diverse providers. It harvests metadata from ArcGIS, OGC (WMS, WFS, WCS, WMTS), STAC catalogs, and more, then exposes everything through a searchable REST API.

## Features

- **Multi-protocol harvesting** -- ArcGIS REST directories, ArcGIS Hub, ArcGIS Portal groups, OGC WMS/WFS/WCS/WMTS, OGC API, STAC catalogs, TileJSON, XYZ, GeoJSON
- **Full-text search** -- PostgreSQL tsvector-based search across service titles and descriptions
- **Spatial filtering** -- Bounding box queries against harvested service extents
- **Scheduled harvesting** -- Cron-based scheduling per source via `sources.yaml`
- **REST API with Swagger UI** -- Auto-generated OpenAPI docs at `/documentation`
- **Health tracking** -- Monitors service availability and response times

## Prerequisites

- **Node.js** >= 22
- **pnpm**
- **PostgreSQL** >= 15

## Quick Start

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL

# Create database and run migrations
createdb opengeo
pnpm db:migrate

# Start dev server
pnpm dev
```

The API will be available at `http://localhost:3000` with Swagger UI at `http://localhost:3000/documentation`.

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://localhost:5432/opengeo` | PostgreSQL connection string |
| `PORT` | `3000` | API server port |
| `HOST` | `0.0.0.0` | API server bind address |
| `LOG_LEVEL` | `info` | Pino log level |
| `CORS_ORIGIN` | `*` | CORS allowed origins |
| `HARVEST_CONCURRENCY` | `3` | Max concurrent harvest jobs |
| `HARVEST_REQUEST_TIMEOUT` | `30000` | HTTP timeout for harvest requests (ms) |
| `HARVEST_USER_AGENT` | `opengeo-harvester/1.0` | User-Agent header for harvest requests |

### Data Sources

Sources are defined in [`sources.yaml`](sources.yaml). Each entry specifies a provider type, URL, and optional schedule/config:

```yaml
sources:
  - key: usacoe-sample
    name: "US Army Corps of Engineers"
    type: arcgis-directory
    url: "https://services7.arcgis.com/n1YM8pTrFmm7L4hs/ArcGIS/rest/services"
    organization: "USACOE"
    schedule: "0 2 * * *"
    config:
      maxDepth: 2
```

**Supported source types:**

| Type | Description |
|---|---|
| `arcgis-directory` | ArcGIS REST Services directory (recursive crawl) |
| `arcgis-hub` | ArcGIS Hub group datasets |
| `arcgis-portal-group` | ArcGIS Portal/Online group search |
| `ogc-wms` | OGC Web Map Service (GetCapabilities) |
| `ogc-wfs` | OGC Web Feature Service |
| `ogc-wcs` | OGC Web Coverage Service |
| `ogc-wmts` | OGC Web Map Tile Service |
| `ogc-api` | OGC API (Features, Tiles, Maps) |
| `stac` | SpatioTemporal Asset Catalog |
| `tilejson` | TileJSON endpoint |
| `xyz` | XYZ tile service |
| `geojson` | GeoJSON file/endpoint |

## Scripts

```bash
pnpm dev              # Start dev server (tsx watch)
pnpm build            # Compile TypeScript to dist/
pnpm start            # Run production build
pnpm typecheck        # Type check without emitting

pnpm harvest          # Harvest all sources
pnpm harvest:source --source=<key>  # Harvest a single source
pnpm harvest:schedule # Run scheduler (cron-based)

pnpm db:generate      # Generate Drizzle migration files
pnpm db:migrate       # Run migrations
pnpm db:push          # Push schema directly (dev)
pnpm db:studio        # Open Drizzle Studio

pnpm test             # Run tests (vitest)
```

## API Endpoints

### Services

| Method | Path | Description |
|---|---|---|
| `GET` | `/services` | List/search services (supports `q`, `type`, `bbox`, `keywords`, `organization`, pagination) |
| `GET` | `/services/:id` | Get service detail |
| `POST` | `/services` | Create a service manually |
| `PATCH` | `/services/:id` | Update a service |
| `DELETE` | `/services/:id` | Delete a service |
| `GET` | `/services/types` | List distinct service types |
| `GET` | `/services/organizations` | List distinct organizations |
| `GET` | `/services/keywords` | List distinct keywords |

### Sources

| Method | Path | Description |
|---|---|---|
| `GET` | `/sources` | List all sources |
| `GET` | `/sources/:id` | Get source detail |
| `POST` | `/sources/:id/harvest` | Trigger on-demand harvest |

### Other

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (includes DB connectivity) |
| `GET` | `/types` | Alias for `/services/types` |

## Architecture

```
src/
  index.ts              # Entrypoint -- starts Fastify server
  env.ts                # Environment config with defaults
  api/
    server.ts           # Fastify app setup (CORS, Swagger, routes)
    routes/             # Route handlers (services, sources, health)
  db/
    schema.ts           # Drizzle ORM schema (sources, services tables)
    index.ts            # Database connection
    migrate.ts          # Migration runner (Drizzle + custom SQL)
    migrations/         # Generated SQL migrations
  harvester/
    core.ts             # Main harvest loop (upserts results into DB)
    run.ts              # CLI entry for one-off harvests
    scheduler.ts        # Cron-based scheduled harvesting
    providers/          # Provider implementations (one per source type)
  shared/
    types.ts            # Shared types (ServiceType, HarvestResult, HarvestProvider)
    logger.ts           # Pino logger setup
```

Each harvest provider implements the `HarvestProvider` interface, yielding `HarvestResult` objects via an async generator. The core harvester upserts these into the `services` table with conflict resolution on `(url, source_id)`.

## Deployment

The project includes a Dockerfile and Helm chart for Kubernetes deployment. CI/CD is handled via GitHub Actions:

1. Push to `main` builds a Docker image and pushes to GHCR
2. Helm chart is synced and deployed to a k3s cluster via SSH

## License

MIT
