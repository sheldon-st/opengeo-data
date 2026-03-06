import type { HarvestProvider } from '../../shared/types.js';
import { arcgisProvider } from './arcgis.js';
import { arcgisHubProvider } from './arcgis-hub.js';
import { arcgisPortalProvider } from './arcgis-portal.js';
import { ogcWmsProvider } from './ogc-wms.js';
import { ogcWfsProvider } from './ogc-wfs.js';
import { ogcWcsProvider } from './ogc-wcs.js';
import { ogcWmtsProvider } from './ogc-wmts.js';
import { ogcApiProvider } from './ogc-api.js';
import { stacProvider } from './stac.js';
import { tilejsonProvider } from './tilejson.js';
import { xyzProvider } from './xyz.js';
import { geojsonProvider } from './geojson.js';

const providers: Record<string, HarvestProvider> = {
  'arcgis-directory': arcgisProvider,
  'arcgis-hub': arcgisHubProvider,
  'arcgis-portal-group': arcgisPortalProvider,
  'ogc-wms': ogcWmsProvider,
  'ogc-wfs': ogcWfsProvider,
  'ogc-wcs': ogcWcsProvider,
  'ogc-wmts': ogcWmtsProvider,
  'ogc-api': ogcApiProvider,
  stac: stacProvider,
  tilejson: tilejsonProvider,
  xyz: xyzProvider,
  geojson: geojsonProvider,
};

export function getProvider(type: string): HarvestProvider | undefined {
  return providers[type];
}

export function listProviderTypes(): string[] {
  return Object.keys(providers);
}
