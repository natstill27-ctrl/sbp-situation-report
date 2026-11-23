import L from 'leaflet';
import { PMTiles, leafletRasterLayer } from 'pmtiles';

/**
 * Creates a Leaflet raster tile layer backed by a local or Intranet .pmtiles archive.
 */
export function createPmtilesRasterLayer(
  pmtilesUrl: string,
  options: L.GridLayerOptions = {}
): L.GridLayer {
  const archive = new PMTiles(pmtilesUrl.trim());
  const layer = leafletRasterLayer(archive, {
    maxZoom: 18,
    attribution: 'Offline PMTiles',
    ...options,
  });
  return layer as L.GridLayer;
}
