import { XMLParser } from 'fast-xml-parser';
import type { HarvestProvider, HarvestResult, LayerInfo } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';

const TIMEOUT = Number(process.env.HARVEST_REQUEST_TIMEOUT ?? 30000);
const USER_AGENT = process.env.HARVEST_USER_AGENT ?? 'opengeo-harvester/1.0';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['FeatureType', 'Keyword', 'Format', 'DefaultCRS', 'OtherCRS'].includes(name),
});

function toArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

export const ogcWfsProvider: HarvestProvider = {
  type: 'ogc-wfs',
  async *harvest(sourceUrl) {
    const capUrl = `${sourceUrl}${sourceUrl.includes('?') ? '&' : '?'}service=WFS&request=GetCapabilities`;

    let xml: string;
    try {
      const res = await fetch(capUrl, {
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
    } catch (err) {
      logger.error({ url: capUrl, err }, 'Failed to fetch WFS capabilities');
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = parser.parse(xml);
    } catch (err) {
      logger.error({ url: capUrl, err }, 'Failed to parse WFS capabilities XML');
      return;
    }

    const cap = (parsed['wfs:WFS_Capabilities'] ?? parsed['WFS_Capabilities']) as Record<string, unknown> | undefined;
    if (!cap) {
      logger.warn({ url: capUrl }, 'No WFS capabilities root element found');
      return;
    }

    const serviceId = cap['ows:ServiceIdentification'] ?? cap['ServiceIdentification'] ?? cap['Service'];
    const si = serviceId as Record<string, unknown> | undefined;

    const title = (si?.['ows:Title'] ?? si?.['Title']) as string | undefined;
    const description = (si?.['ows:Abstract'] ?? si?.['Abstract']) as string | undefined;

    const keywordsSection = si?.['ows:Keywords'] ?? si?.['Keywords'];
    const keywords = toArray(
      (keywordsSection as Record<string, unknown>)?.['ows:Keyword'] ??
      (keywordsSection as Record<string, unknown>)?.['Keyword'],
    ).map(String);

    const featureTypeList = (cap['FeatureTypeList'] ?? cap['wfs:FeatureTypeList']) as Record<string, unknown> | undefined;
    const featureTypes = toArray(
      featureTypeList?.['FeatureType'] ?? featureTypeList?.['wfs:FeatureType'],
    ) as Record<string, unknown>[];

    const layers: LayerInfo[] = [];
    let combinedBbox: [number, number, number, number] | undefined;
    const allCrs: Set<string> = new Set();

    for (const ft of featureTypes) {
      const name = (ft['Name'] ?? ft['wfs:Name']) as string;
      const ftTitle = (ft['Title'] ?? ft['wfs:Title']) as string | undefined;
      if (name) layers.push({ name, title: ftTitle });

      // CRS
      const defaultCrs = (ft['DefaultCRS'] ?? ft['DefaultSRS'] ?? ft['wfs:DefaultCRS'] ?? ft['wfs:DefaultSRS']) as string | undefined;
      if (defaultCrs) allCrs.add(defaultCrs);

      // BBox from WGS84BoundingBox
      const wgs84 = (ft['ows:WGS84BoundingBox'] ?? ft['WGS84BoundingBox']) as Record<string, unknown> | undefined;
      if (wgs84) {
        const lower = String(wgs84['ows:LowerCorner'] ?? wgs84['LowerCorner']).split(' ').map(Number);
        const upper = String(wgs84['ows:UpperCorner'] ?? wgs84['UpperCorner']).split(' ').map(Number);
        const ftBbox: [number, number, number, number] = [lower[0], lower[1], upper[0], upper[1]];

        if (!combinedBbox) {
          combinedBbox = [...ftBbox];
        } else {
          combinedBbox[0] = Math.min(combinedBbox[0], ftBbox[0]);
          combinedBbox[1] = Math.min(combinedBbox[1], ftBbox[1]);
          combinedBbox[2] = Math.max(combinedBbox[2], ftBbox[2]);
          combinedBbox[3] = Math.max(combinedBbox[3], ftBbox[3]);
        }
      }
    }

    const result: HarvestResult = {
      url: sourceUrl,
      serviceType: 'ogc-wfs',
      title,
      description,
      bbox: combinedBbox,
      layers,
      crs: allCrs.size > 0 ? [...allCrs] : undefined,
      keywords: keywords.length > 0 ? keywords : undefined,
    };

    yield result;
  },
};
