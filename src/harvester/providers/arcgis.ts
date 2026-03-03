import type { HarvestProvider, HarvestResult, ServiceType } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';

const TIMEOUT = Number(process.env.HARVEST_REQUEST_TIMEOUT ?? 30000);
const USER_AGENT = process.env.HARVEST_USER_AGENT ?? 'opengeo-harvester/1.0';

const ARCGIS_TYPE_MAP: Record<string, ServiceType> = {
  MapServer: 'arcgis-mapserver',
  FeatureServer: 'arcgis-featureserver',
  ImageServer: 'arcgis-imageserver',
  VectorTileServer: 'arcgis-vectortileserver',
};

async function fetchJson(url: string): Promise<unknown> {
  const separator = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${separator}f=json`, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

interface ArcGISDirectory {
  folders?: string[];
  services?: Array<{ name: string; type: string }>;
}

interface ArcGISServiceInfo {
  serviceDescription?: string;
  description?: string;
  mapName?: string;
  name?: string;
  fullExtent?: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
    spatialReference?: { wkid?: number; latestWkid?: number };
  };
  initialExtent?: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
    spatialReference?: { wkid?: number; latestWkid?: number };
  };
  layers?: Array<{ id: number; name: string; title?: string }>;
  spatialReference?: { wkid?: number; latestWkid?: number };
  supportedExtensions?: string;
}

function extractBbox(
  info: ArcGISServiceInfo,
): [number, number, number, number] | undefined {
  const extent = info.fullExtent ?? info.initialExtent;
  if (!extent) return undefined;

  const wkid = extent.spatialReference?.latestWkid ?? extent.spatialReference?.wkid;

  // If already WGS84 or Web Mercator-ish with reasonable values
  if (wkid === 4326 || !wkid) {
    if (
      extent.xmin >= -180 && extent.xmax <= 180 &&
      extent.ymin >= -90 && extent.ymax <= 90
    ) {
      return [extent.xmin, extent.ymin, extent.xmax, extent.ymax];
    }
  }

  // For Web Mercator (3857/102100), do rough conversion
  if (wkid === 3857 || wkid === 102100) {
    const xmin = Math.max(-180, (extent.xmin / 20037508.34) * 180);
    const xmax = Math.min(180, (extent.xmax / 20037508.34) * 180);
    const yminRad = Math.atan(Math.exp((extent.ymin / 20037508.34) * Math.PI));
    const ymaxRad = Math.atan(Math.exp((extent.ymax / 20037508.34) * Math.PI));
    const ymin = Math.max(-90, (2 * yminRad * 180) / Math.PI - 90);
    const ymax = Math.min(90, (2 * ymaxRad * 180) / Math.PI - 90);
    return [xmin, ymin, xmax, ymax];
  }

  // Unknown projection — skip bbox rather than return garbage
  return undefined;
}

async function* crawlDirectory(
  baseUrl: string,
  path: string,
  depth: number,
  maxDepth: number,
  serviceTypeFilter?: string[],
): AsyncGenerator<HarvestResult> {
  if (depth > maxDepth) return;

  const url = path ? `${baseUrl}/${path}` : baseUrl;
  let dir: ArcGISDirectory;

  try {
    dir = (await fetchJson(url)) as ArcGISDirectory;
  } catch (err) {
    logger.warn({ url, err }, 'Failed to fetch ArcGIS directory');
    return;
  }

  // Recurse into folders
  if (dir.folders) {
    for (const folder of dir.folders) {
      const folderPath = path ? `${path}/${folder}` : folder;
      yield* crawlDirectory(baseUrl, folderPath, depth + 1, maxDepth, serviceTypeFilter);
    }
  }

  // Process services
  if (dir.services) {
    for (const svc of dir.services) {
      const serviceType = ARCGIS_TYPE_MAP[svc.type];
      if (!serviceType) continue;
      if (serviceTypeFilter && !serviceTypeFilter.includes(svc.type)) continue;

      const serviceUrl = `${baseUrl}/${svc.name}/${svc.type}`;

      try {
        const info = (await fetchJson(serviceUrl)) as ArcGISServiceInfo;

        yield {
          url: serviceUrl,
          serviceType,
          title: info.mapName ?? info.name ?? svc.name.split('/').pop() ?? svc.name,
          description: info.serviceDescription || info.description || undefined,
          bbox: extractBbox(info),
          layers: info.layers?.map((l) => ({
            id: l.id,
            name: l.name,
            title: l.title,
          })),
          crs: info.spatialReference?.wkid
            ? [`EPSG:${info.spatialReference.latestWkid ?? info.spatialReference.wkid}`]
            : undefined,
          extraMeta: {
            supportedExtensions: info.supportedExtensions,
          },
        };
      } catch (err) {
        logger.warn({ serviceUrl, err }, 'Failed to fetch ArcGIS service info');
      }
    }
  }
}

export const arcgisProvider: HarvestProvider = {
  type: 'arcgis-directory',
  async *harvest(sourceUrl, config) {
    const maxDepth = (config?.maxDepth as number) ?? 3;
    const serviceTypes = config?.serviceTypes as string[] | undefined;
    yield* crawlDirectory(sourceUrl, '', 0, maxDepth, serviceTypes);
  },
};
