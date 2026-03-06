export const SERVICE_TYPES = [
  'arcgis-mapserver',
  'arcgis-featureserver',
  'arcgis-imageserver',
  'arcgis-vectortileserver',
  'ogc-wms',
  'ogc-wfs',
  'ogc-wcs',
  'ogc-wmts',
  'ogc-api-features',
  'ogc-api-tiles',
  'ogc-api-maps',
  'stac-catalog',
  'stac-collection',
  'tilejson',
  'xyz',
  'geojson',
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

export interface LayerInfo {
  name: string;
  title?: string;
  id?: string | number;
}

export interface HarvestResult {
  url: string;
  serviceType: ServiceType;
  title?: string;
  description?: string;
  bbox?: [number, number, number, number]; // [xmin, ymin, xmax, ymax]
  layers?: LayerInfo[];
  crs?: string[];
  keywords?: string[];
  formats?: string[];
  sourceCreatedAt?: Date;
  sourceModifiedAt?: Date;
  extraMeta?: Record<string, unknown>;
}

export interface HarvestProvider {
  type: string;
  harvest(
    sourceUrl: string,
    config?: Record<string, unknown>,
  ): AsyncGenerator<HarvestResult>;
}

export interface SourceConfig {
  id: string;
  key: string;
  name: string;
  type: string;
  url: string;
  organization?: string;
  schedule?: string;
  config?: Record<string, unknown>;
}

export interface SourceYamlEntry {
  key: string;
  name: string;
  type: string;
  url: string;
  organization?: string;
  schedule?: string;
  config?: Record<string, unknown>;
}

export interface SourcesYaml {
  sources: SourceYamlEntry[];
}
