import type { HarvestProvider, HarvestResult, ServiceType } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';

const TIMEOUT = Number(process.env.HARVEST_REQUEST_TIMEOUT ?? 30000);
const USER_AGENT = process.env.HARVEST_USER_AGENT ?? 'opengeo-harvester/1.0';

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

interface OgcApiCollection {
  id: string;
  title?: string;
  description?: string;
  extent?: {
    spatial?: {
      bbox?: number[][];
      crs?: string;
    };
  };
  crs?: string[];
  links?: Array<{ rel: string; type?: string; href: string }>;
  keywords?: string[];
}

export const ogcApiProvider: HarvestProvider = {
  type: 'ogc-api',
  async *harvest(sourceUrl, config) {
    const conformsTo = (config?.conformsTo as string[]) ?? ['features'];

    // Fetch landing page
    let landing: Record<string, unknown>;
    try {
      landing = (await fetchJson(sourceUrl)) as Record<string, unknown>;
    } catch (err) {
      logger.error({ url: sourceUrl, err }, 'Failed to fetch OGC API landing page');
      return;
    }

    const landingTitle = landing['title'] as string | undefined;
    const landingDesc = landing['description'] as string | undefined;

    // Fetch collections
    let collections: OgcApiCollection[];
    try {
      const collectionsUrl = `${sourceUrl.replace(/\/$/, '')}/collections`;
      const data = (await fetchJson(collectionsUrl)) as { collections: OgcApiCollection[] };
      collections = data.collections ?? [];
    } catch (err) {
      logger.error({ url: sourceUrl, err }, 'Failed to fetch OGC API collections');
      return;
    }

    // Determine the service type based on conformance
    let serviceType: ServiceType = 'ogc-api-features';
    if (conformsTo.includes('tiles')) serviceType = 'ogc-api-tiles';
    if (conformsTo.includes('maps')) serviceType = 'ogc-api-maps';

    for (const col of collections) {
      const bbox = col.extent?.spatial?.bbox?.[0] as
        | [number, number, number, number]
        | undefined;

      yield {
        url: `${sourceUrl.replace(/\/$/, '')}/collections/${col.id}`,
        serviceType,
        title: col.title ?? col.id,
        description: col.description,
        bbox,
        crs: col.crs,
        keywords: col.keywords,
        extraMeta: {
          parentTitle: landingTitle,
          parentDescription: landingDesc,
        },
      };
    }
  },
};
