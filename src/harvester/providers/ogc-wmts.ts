import { XMLParser } from 'fast-xml-parser';
import type { HarvestProvider, HarvestResult, LayerInfo } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';

const TIMEOUT = Number(process.env.HARVEST_REQUEST_TIMEOUT ?? 30000);
const USER_AGENT = process.env.HARVEST_USER_AGENT ?? 'opengeo-harvester/1.0';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['Layer', 'Keyword', 'Format', 'Style'].includes(name),
});

function toArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

export const ogcWmtsProvider: HarvestProvider = {
  type: 'ogc-wmts',
  async *harvest(sourceUrl) {
    const capUrl = `${sourceUrl}${sourceUrl.includes('?') ? '&' : '?'}service=WMTS&request=GetCapabilities`;

    let xml: string;
    try {
      const res = await fetch(capUrl, {
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
    } catch (err) {
      logger.error({ url: capUrl, err }, 'Failed to fetch WMTS capabilities');
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = parser.parse(xml);
    } catch (err) {
      logger.error({ url: capUrl, err }, 'Failed to parse WMTS capabilities XML');
      return;
    }

    const cap = parsed['Capabilities'] as Record<string, unknown> | undefined;
    if (!cap) {
      logger.warn({ url: capUrl }, 'No WMTS capabilities root element found');
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

    const contents = cap['Contents'] as Record<string, unknown> | undefined;
    const layerNodes = toArray(contents?.['Layer']) as Record<string, unknown>[];

    const layers: LayerInfo[] = [];
    let combinedBbox: [number, number, number, number] | undefined;
    const allFormats: Set<string> = new Set();

    for (const layer of layerNodes) {
      const id = (layer['ows:Identifier'] ?? layer['Identifier']) as string;
      const layerTitle = (layer['ows:Title'] ?? layer['Title']) as string | undefined;
      if (id) layers.push({ name: id, title: layerTitle });

      for (const fmt of toArray(layer['Format'] as string[])) {
        allFormats.add(String(fmt));
      }

      const wgs84 = (layer['ows:WGS84BoundingBox'] ?? layer['WGS84BoundingBox']) as Record<string, unknown> | undefined;
      if (wgs84) {
        const lower = String(wgs84['ows:LowerCorner'] ?? wgs84['LowerCorner']).split(' ').map(Number);
        const upper = String(wgs84['ows:UpperCorner'] ?? wgs84['UpperCorner']).split(' ').map(Number);
        const layerBbox: [number, number, number, number] = [lower[0], lower[1], upper[0], upper[1]];

        if (!combinedBbox) {
          combinedBbox = [...layerBbox];
        } else {
          combinedBbox[0] = Math.min(combinedBbox[0], layerBbox[0]);
          combinedBbox[1] = Math.min(combinedBbox[1], layerBbox[1]);
          combinedBbox[2] = Math.max(combinedBbox[2], layerBbox[2]);
          combinedBbox[3] = Math.max(combinedBbox[3], layerBbox[3]);
        }
      }
    }

    yield {
      url: sourceUrl,
      serviceType: 'ogc-wmts',
      title,
      description,
      bbox: combinedBbox,
      layers,
      keywords: keywords.length > 0 ? keywords : undefined,
      formats: allFormats.size > 0 ? [...allFormats] : undefined,
    };
  },
};
