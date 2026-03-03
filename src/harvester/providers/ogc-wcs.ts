import { XMLParser } from 'fast-xml-parser';
import type { HarvestProvider, HarvestResult, LayerInfo } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';

const TIMEOUT = Number(process.env.HARVEST_REQUEST_TIMEOUT ?? 30000);
const USER_AGENT = process.env.HARVEST_USER_AGENT ?? 'opengeo-harvester/1.0';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['CoverageSummary', 'Keyword', 'Format'].includes(name),
});

function toArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

export const ogcWcsProvider: HarvestProvider = {
  type: 'ogc-wcs',
  async *harvest(sourceUrl) {
    const capUrl = `${sourceUrl}${sourceUrl.includes('?') ? '&' : '?'}service=WCS&request=GetCapabilities`;

    let xml: string;
    try {
      const res = await fetch(capUrl, {
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
    } catch (err) {
      logger.error({ url: capUrl, err }, 'Failed to fetch WCS capabilities');
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = parser.parse(xml);
    } catch (err) {
      logger.error({ url: capUrl, err }, 'Failed to parse WCS capabilities XML');
      return;
    }

    const cap = (parsed['wcs:Capabilities'] ?? parsed['Capabilities']) as Record<string, unknown> | undefined;
    if (!cap) {
      logger.warn({ url: capUrl }, 'No WCS capabilities root element found');
      return;
    }

    const si = (cap['ows:ServiceIdentification'] ?? cap['ServiceIdentification']) as Record<string, unknown> | undefined;
    const title = (si?.['ows:Title'] ?? si?.['Title']) as string | undefined;
    const description = (si?.['ows:Abstract'] ?? si?.['Abstract']) as string | undefined;

    const keywordsSection = si?.['ows:Keywords'] ?? si?.['Keywords'];
    const keywords = toArray(
      (keywordsSection as Record<string, unknown>)?.['ows:Keyword'] ??
      (keywordsSection as Record<string, unknown>)?.['Keyword'],
    ).map(String);

    const contents = (cap['Contents'] ?? cap['wcs:Contents']) as Record<string, unknown> | undefined;
    const coverages = toArray(
      contents?.['CoverageSummary'] ?? contents?.['wcs:CoverageSummary'],
    ) as Record<string, unknown>[];

    const layers: LayerInfo[] = [];
    let combinedBbox: [number, number, number, number] | undefined;

    for (const cov of coverages) {
      const id = (cov['CoverageId'] ?? cov['wcs:CoverageId'] ?? cov['Identifier'] ?? cov['wcs:Identifier']) as string;
      if (id) layers.push({ name: id });

      const wgs84 = (cov['ows:WGS84BoundingBox'] ?? cov['WGS84BoundingBox']) as Record<string, unknown> | undefined;
      if (wgs84) {
        const lower = String(wgs84['ows:LowerCorner'] ?? wgs84['LowerCorner']).split(' ').map(Number);
        const upper = String(wgs84['ows:UpperCorner'] ?? wgs84['UpperCorner']).split(' ').map(Number);
        const covBbox: [number, number, number, number] = [lower[0], lower[1], upper[0], upper[1]];

        if (!combinedBbox) {
          combinedBbox = [...covBbox];
        } else {
          combinedBbox[0] = Math.min(combinedBbox[0], covBbox[0]);
          combinedBbox[1] = Math.min(combinedBbox[1], covBbox[1]);
          combinedBbox[2] = Math.max(combinedBbox[2], covBbox[2]);
          combinedBbox[3] = Math.max(combinedBbox[3], covBbox[3]);
        }
      }
    }

    yield {
      url: sourceUrl,
      serviceType: 'ogc-wcs',
      title,
      description,
      bbox: combinedBbox,
      layers,
      keywords: keywords.length > 0 ? keywords : undefined,
    };
  },
};
