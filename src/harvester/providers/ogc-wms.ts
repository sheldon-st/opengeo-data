import { XMLParser } from 'fast-xml-parser';
import type { HarvestProvider, HarvestResult, LayerInfo } from '../../shared/types.js';
import { logger } from '../../shared/logger.js';

const TIMEOUT = Number(process.env.HARVEST_REQUEST_TIMEOUT ?? 30000);
const USER_AGENT = process.env.HARVEST_USER_AGENT ?? 'opengeo-harvester/1.0';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['Layer', 'Keyword', 'Format', 'CRS', 'SRS'].includes(name),
});

function toArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function extractBbox(layer: Record<string, unknown>): [number, number, number, number] | undefined {
  // WMS 1.3.0 uses EX_GeographicBoundingBox
  const geo = layer['EX_GeographicBoundingBox'] as Record<string, number> | undefined;
  if (geo) {
    return [
      geo['westBoundLongitude'],
      geo['southBoundLatitude'],
      geo['eastBoundLongitude'],
      geo['northBoundLatitude'],
    ];
  }

  // WMS 1.1.x uses LatLonBoundingBox
  const ll = layer['LatLonBoundingBox'] as Record<string, string> | undefined;
  if (ll) {
    return [
      parseFloat(ll['@_minx']),
      parseFloat(ll['@_miny']),
      parseFloat(ll['@_maxx']),
      parseFloat(ll['@_maxy']),
    ];
  }

  return undefined;
}

function collectLayers(layer: Record<string, unknown>): LayerInfo[] {
  const layers: LayerInfo[] = [];
  const name = layer['Name'] as string | undefined;
  if (name) {
    layers.push({ name, title: layer['Title'] as string | undefined });
  }
  for (const child of toArray(layer['Layer'] as Record<string, unknown>[])) {
    layers.push(...collectLayers(child));
  }
  return layers;
}

export const ogcWmsProvider: HarvestProvider = {
  type: 'ogc-wms',
  async *harvest(sourceUrl) {
    const capUrl = `${sourceUrl}${sourceUrl.includes('?') ? '&' : '?'}service=WMS&request=GetCapabilities`;

    let xml: string;
    try {
      const res = await fetch(capUrl, {
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
    } catch (err) {
      logger.error({ url: capUrl, err }, 'Failed to fetch WMS capabilities');
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = parser.parse(xml);
    } catch (err) {
      logger.error({ url: capUrl, err }, 'Failed to parse WMS capabilities XML');
      return;
    }

    // Handle both WMS_Capabilities (1.3.0) and WMT_MS_Capabilities (1.1.x)
    const cap = (parsed['WMS_Capabilities'] ?? parsed['WMT_MS_Capabilities']) as Record<string, unknown> | undefined;
    if (!cap) {
      logger.warn({ url: capUrl }, 'No WMS capabilities root element found');
      return;
    }

    const service = cap['Service'] as Record<string, unknown> | undefined;
    const capability = cap['Capability'] as Record<string, unknown> | undefined;
    const rootLayer = capability?.['Layer'] as Record<string, unknown> | undefined;

    const title = (service?.['Title'] as string) ?? undefined;
    const description = (service?.['Abstract'] as string) ?? undefined;
    const keywordsRaw = service?.['KeywordList'] as Record<string, unknown> | undefined;
    const keywords = toArray(keywordsRaw?.['Keyword'] as string[]).map(String);

    const layers = rootLayer ? collectLayers(rootLayer) : [];
    const bbox = rootLayer ? extractBbox(rootLayer) : undefined;
    const crs = toArray(rootLayer?.['CRS'] as string[] ?? rootLayer?.['SRS'] as string[]).map(String);

    const getMap = (capability?.['Request'] as Record<string, unknown> | undefined)?.['GetMap'] as Record<string, unknown> | undefined;
    const formats = getMap ? toArray(getMap['Format'] as string[]).map(String) : [];

    const result: HarvestResult = {
      url: sourceUrl,
      serviceType: 'ogc-wms',
      title,
      description,
      bbox,
      layers,
      crs: crs.length > 0 ? crs : undefined,
      keywords: keywords.length > 0 ? keywords : undefined,
      formats: formats.length > 0 ? formats : undefined,
    };

    yield result;
  },
};
