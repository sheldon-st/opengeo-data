import type { HarvestProvider } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';

const TIMEOUT = Number(process.env.HARVEST_REQUEST_TIMEOUT ?? 30000);
const USER_AGENT = process.env.HARVEST_USER_AGENT ?? 'opengeo-harvester/1.0';

interface TileJSON {
  name?: string;
  description?: string;
  bounds?: [number, number, number, number];
  center?: [number, number, number];
  minzoom?: number;
  maxzoom?: number;
  format?: string;
  tiles?: string[];
  attribution?: string;
}

export const tilejsonProvider: HarvestProvider = {
  type: 'tilejson',
  async *harvest(sourceUrl) {
    let data: TileJSON;
    try {
      const res = await fetch(sourceUrl, {
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = (await res.json()) as TileJSON;
    } catch (err) {
      logger.error({ url: sourceUrl, err }, 'Failed to fetch TileJSON');
      return;
    }

    yield {
      url: sourceUrl,
      serviceType: 'tilejson',
      title: data.name,
      description: data.description,
      bbox: data.bounds,
      formats: data.format ? [data.format] : undefined,
      extraMeta: {
        minzoom: data.minzoom,
        maxzoom: data.maxzoom,
        center: data.center,
        tiles: data.tiles,
        attribution: data.attribution,
      },
    };
  },
};
