import type { HarvestProvider } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';

const TIMEOUT = Number(process.env.HARVEST_REQUEST_TIMEOUT ?? 30000);
const USER_AGENT = process.env.HARVEST_USER_AGENT ?? 'opengeo-harvester/1.0';

export const xyzProvider: HarvestProvider = {
  type: 'xyz',
  async *harvest(sourceUrl, config) {
    // XYZ tiles have minimal discoverable metadata.
    // Validate by trying to fetch tile 0/0/0.
    const testUrl = sourceUrl
      .replace('{z}', '0')
      .replace('{x}', '0')
      .replace('{y}', '0');

    try {
      const res = await fetch(testUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) {
        logger.warn({ url: testUrl, status: res.status }, 'XYZ tile validation failed');
      }
    } catch (err) {
      logger.warn({ url: testUrl, err }, 'XYZ tile validation request failed');
    }

    yield {
      url: sourceUrl,
      serviceType: 'xyz',
      title: (config?.title as string) ?? sourceUrl,
      description: config?.description as string | undefined,
      bbox: config?.bbox as [number, number, number, number] | undefined,
      extraMeta: {
        tileUrlTemplate: sourceUrl,
        minzoom: config?.minzoom,
        maxzoom: config?.maxzoom,
      },
    };
  },
};
