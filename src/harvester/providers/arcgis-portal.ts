import type { HarvestProvider, HarvestResult, ServiceType } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';

const TIMEOUT = Number(process.env.HARVEST_REQUEST_TIMEOUT ?? 30000);
const USER_AGENT = process.env.HARVEST_USER_AGENT ?? 'opengeo-harvester/1.0';
const DEFAULT_NUM = 100;

const PORTAL_TYPE_MAP: Record<string, ServiceType> = {
  'Feature Service': 'arcgis-featureserver',
  'Map Service': 'arcgis-mapserver',
  'Image Service': 'arcgis-imageserver',
  'Vector Tile Service': 'arcgis-vectortileserver',
};

interface PortalItem {
  id: string;
  title?: string;
  type?: string;
  description?: string;
  snippet?: string;
  tags?: string[];
  typeKeywords?: string[];
  extent?: [[number, number], [number, number]]; // [[xmin,ymin],[xmax,ymax]]
  spatialReference?: string;
  url?: string;
  owner?: string;
  orgId?: string;
  accessInformation?: string;
  licenseInfo?: string;
  created?: number;
  modified?: number;
  numViews?: number;
  scoreCompleteness?: number;
}

interface PortalSearchResponse {
  total: number;
  start: number;
  num: number;
  nextStart: number;
  results: PortalItem[];
}

async function fetchPage(url: string, num: number, start: number): Promise<PortalSearchResponse> {
  const body = new URLSearchParams({ f: 'json', num: String(num), start: String(start) });
  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT),
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json() as Promise<PortalSearchResponse>;
}

function itemToResult(item: PortalItem): HarvestResult | null {
  const serviceType = PORTAL_TYPE_MAP[item.type ?? ''];
  if (!serviceType) return null;
  if (!item.url) return null;

  let bbox: [number, number, number, number] | undefined;
  if (item.extent && item.extent.length === 2) {
    const [[xmin, ymin], [xmax, ymax]] = item.extent;
    if (isFinite(xmin) && isFinite(ymin) && isFinite(xmax) && isFinite(ymax)) {
      bbox = [xmin, ymin, xmax, ymax];
    }
  }

  return {
    url: item.url,
    serviceType,
    title: item.title,
    description: item.description || item.snippet,
    bbox,
    keywords: item.tags,
    crs: item.spatialReference ? [`EPSG:${item.spatialReference}`] : undefined,
    sourceCreatedAt: item.created ? new Date(item.created) : undefined,
    sourceModifiedAt: item.modified ? new Date(item.modified) : undefined,
    extraMeta: {
      portalItemId: item.id,
      owner: item.owner,
      orgId: item.orgId,
      typeKeywords: item.typeKeywords,
      accessInformation: item.accessInformation,
      licenseInfo: item.licenseInfo,
      numViews: item.numViews,
      scoreCompleteness: item.scoreCompleteness,
    },
  };
}

export const arcgisPortalProvider: HarvestProvider = {
  type: 'arcgis-portal-group',
  async *harvest(sourceUrl, config) {
    const num = (config?.num as number) ?? DEFAULT_NUM;
    let start = 1;

    while (start !== -1) {
      let page: PortalSearchResponse;
      try {
        page = await fetchPage(sourceUrl, num, start);
      } catch (err) {
        logger.warn({ url: sourceUrl, start, err }, 'Failed to fetch Portal group search page');
        break;
      }

      for (const item of page.results ?? []) {
        const result = itemToResult(item);
        if (result) yield result;
      }

      start = page.nextStart; // -1 when there are no more pages
    }
  },
};
