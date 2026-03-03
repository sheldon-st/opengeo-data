import type { HarvestProvider } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';

const TIMEOUT = Number(process.env.HARVEST_REQUEST_TIMEOUT ?? 30000);
const USER_AGENT = process.env.HARVEST_USER_AGENT ?? 'opengeo-harvester/1.0';

interface GeoJSONFeatureCollection {
  type: string;
  bbox?: number[];
  features?: Array<{
    type: string;
    geometry?: {
      type: string;
      coordinates: unknown;
    };
    properties?: Record<string, unknown>;
  }>;
}

function computeBbox(geojson: GeoJSONFeatureCollection): [number, number, number, number] | undefined {
  if (geojson.bbox && geojson.bbox.length >= 4) {
    return [geojson.bbox[0], geojson.bbox[1], geojson.bbox[2], geojson.bbox[3]];
  }

  if (!geojson.features?.length) return undefined;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  function processCoords(coords: unknown): void {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      minX = Math.min(minX, coords[0]);
      minY = Math.min(minY, coords[1]);
      maxX = Math.max(maxX, coords[0]);
      maxY = Math.max(maxY, coords[1]);
    } else {
      for (const c of coords) processCoords(c);
    }
  }

  for (const feature of geojson.features) {
    if (feature.geometry?.coordinates) {
      processCoords(feature.geometry.coordinates);
    }
  }

  if (!isFinite(minX)) return undefined;
  return [minX, minY, maxX, maxY];
}

export const geojsonProvider: HarvestProvider = {
  type: 'geojson',
  async *harvest(sourceUrl) {
    let data: GeoJSONFeatureCollection;
    try {
      const res = await fetch(sourceUrl, {
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json, application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = (await res.json()) as GeoJSONFeatureCollection;
    } catch (err) {
      logger.error({ url: sourceUrl, err }, 'Failed to fetch GeoJSON');
      return;
    }

    if (data.type !== 'FeatureCollection' && data.type !== 'Feature') {
      logger.warn({ url: sourceUrl, type: data.type }, 'Unexpected GeoJSON type');
    }

    const bbox = computeBbox(data);
    const featureCount = data.features?.length;

    yield {
      url: sourceUrl,
      serviceType: 'geojson',
      title: sourceUrl.split('/').pop() ?? sourceUrl,
      bbox,
      crs: ['EPSG:4326'], // GeoJSON is always WGS84
      extraMeta: {
        featureCount,
        geometryTypes: data.features
          ? [...new Set(data.features.map((f) => f.geometry?.type).filter(Boolean))]
          : undefined,
      },
    };
  },
};
