import type { HarvestProvider, HarvestResult, ServiceType } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';

const TIMEOUT = Number(process.env.HARVEST_REQUEST_TIMEOUT ?? 30000);
const USER_AGENT = process.env.HARVEST_USER_AGENT ?? 'opengeo-harvester/1.0';
const DEFAULT_LIMIT = 100;

// Hub item type → our ServiceType
const HUB_TYPE_MAP: Record<string, ServiceType> = {
  'Feature Service': 'arcgis-featureserver',
  'Map Service': 'arcgis-mapserver',
  'Image Service': 'arcgis-imageserver',
  'Vector Tile Service': 'arcgis-vectortileserver',
};

interface HubFeatureProperties {
  title?: string;
  snippet?: string;
  description?: string;
  type?: string;
  url?: string;
  tags?: string[];
  typeKeywords?: string[];
  spatialReference?: string;
  orgId?: string;
  owner?: string;
  source?: string;
  license?: string;
  licenseInfo?: string;
  access?: string;
  modified?: number;
  created?: number;
  numViews?: number;
  scoreCompleteness?: number;
  [key: string]: unknown;
}

interface HubFeature {
  id: string;
  type: 'Feature';
  geometry?: {
    type: string;
    coordinates: number[][][];
  } | null;
  properties: HubFeatureProperties;
  links?: Array<{ rel: string; href: string }>;
}

interface HubResponse {
  type: 'FeatureCollection';
  features: HubFeature[];
  numberMatched?: number;
  numberReturned?: number;
  links?: Array<{ rel: string; href: string }>;
}

async function fetchPage(url: string): Promise<HubResponse> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json() as Promise<HubResponse>;
}

function extractBbox(feature: HubFeature): [number, number, number, number] | undefined {
  const geom = feature.geometry;
  if (!geom || geom.type !== 'Polygon' || !geom.coordinates?.[0]) return undefined;

  const ring = geom.coordinates[0];
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const [x, y] of ring) {
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  }

  if (!isFinite(xmin)) return undefined;
  return [xmin, ymin, xmax, ymax];
}

function featureToResult(feature: HubFeature): HarvestResult | null {
  const props = feature.properties;
  const serviceType = HUB_TYPE_MAP[props.type ?? ''];
  if (!serviceType) return null;

  const url = props.url;
  if (!url) return null;

  return {
    url,
    serviceType,
    title: props.title,
    description: props.description || props.snippet,
    bbox: extractBbox(feature),
    keywords: props.tags,
    crs: props.spatialReference ? [`EPSG:${props.spatialReference}`] : undefined,
    sourceCreatedAt: props.created ? new Date(props.created) : undefined,
    sourceModifiedAt: props.modified ? new Date(props.modified) : undefined,
    extraMeta: {
      hubItemId: feature.id,
      orgId: props.orgId,
      owner: props.owner,
      source: props.source,
      license: props.license,
      licenseInfo: props.licenseInfo,
      access: props.access,
      typeKeywords: props.typeKeywords,
      numViews: props.numViews,
      scoreCompleteness: props.scoreCompleteness,
    },
  };
}

function buildInitialUrl(baseUrl: string, config?: Record<string, unknown>): string {
  const base = `${baseUrl.replace(/\/$/, '')}/api/search/v1/collections/all/items`;
  const limit = (config?.limit as number) ?? DEFAULT_LIMIT;
  const params: string[] = [`limit=${limit}`];

  // Use encodeURIComponent (RFC 3986, spaces → %20) instead of URLSearchParams (spaces → +)
  if (config?.filter) {
    params.push(`filter=${encodeURIComponent(config.filter as string)}`);
  } else if (config?.groups) {
    const groups = config.groups as string[];
    const filter = `((group IN (${groups.join(', ')})))`;
    params.push(`filter=${encodeURIComponent(filter)}`);
  }

  return `${base}?${params.join('&')}`;
}

export const arcgisHubProvider: HarvestProvider = {
  type: 'arcgis-hub',
  async *harvest(sourceUrl, config) {
    let nextUrl: string | null = buildInitialUrl(sourceUrl, config);

    while (nextUrl) {
      let page: HubResponse;
      try {
        page = await fetchPage(nextUrl);
      } catch (err) {
        logger.warn({ url: nextUrl, err }, 'Failed to fetch Hub API page');
        break;
      }

      for (const feature of page.features ?? []) {
        const result = featureToResult(feature);
        if (result) yield result;
      }

      // Follow the "next" link for pagination
      const nextLink = page.links?.find((l) => l.rel === 'next');
      nextUrl = nextLink?.href ?? null;
    }
  },
};
