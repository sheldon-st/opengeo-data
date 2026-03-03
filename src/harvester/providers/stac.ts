import type { HarvestProvider, HarvestResult } from '../../shared/types.js';
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

interface StacLink {
  rel: string;
  href: string;
  type?: string;
}

interface StacCatalog {
  type?: string;
  id: string;
  title?: string;
  description?: string;
  links: StacLink[];
}

interface StacCollection {
  type?: string;
  id: string;
  title?: string;
  description?: string;
  keywords?: string[];
  extent?: {
    spatial?: { bbox?: number[][] };
    temporal?: { interval?: (string | null)[][] };
  };
  summaries?: Record<string, unknown>;
  links: StacLink[];
}

function resolveUrl(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

async function* crawlStac(
  url: string,
  maxCollections: number,
  visited: Set<string>,
): AsyncGenerator<HarvestResult> {
  if (visited.has(url) || visited.size > maxCollections) return;
  visited.add(url);

  let data: StacCatalog | StacCollection;
  try {
    data = (await fetchJson(url)) as StacCatalog | StacCollection;
  } catch (err) {
    logger.warn({ url, err }, 'Failed to fetch STAC resource');
    return;
  }

  // If this is a collection, yield it
  if (data.type === 'Collection' || (data as StacCollection).extent) {
    const col = data as StacCollection;
    const bbox = col.extent?.spatial?.bbox?.[0] as
      | [number, number, number, number]
      | undefined;

    yield {
      url,
      serviceType: 'stac-collection',
      title: col.title ?? col.id,
      description: col.description,
      bbox,
      keywords: col.keywords,
      extraMeta: {
        summaries: col.summaries,
        temporal: col.extent?.temporal?.interval,
      },
    };
  } else {
    // It's a catalog — yield it as a catalog entry, then recurse children
    yield {
      url,
      serviceType: 'stac-catalog',
      title: data.title ?? data.id,
      description: data.description,
    };
  }

  // Follow child links
  const childLinks = data.links.filter((l) => l.rel === 'child' || l.rel === 'item');
  for (const link of childLinks) {
    // Only follow child catalogs/collections, not items
    if (link.rel === 'item') continue;
    const childUrl = resolveUrl(url, link.href);
    yield* crawlStac(childUrl, maxCollections, visited);
  }
}

export const stacProvider: HarvestProvider = {
  type: 'stac',
  async *harvest(sourceUrl, config) {
    const maxCollections = (config?.maxCollections as number) ?? 500;
    const visited = new Set<string>();
    yield* crawlStac(sourceUrl, maxCollections, visited);
  },
};
