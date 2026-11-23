import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { IncidentRecord } from '../types/incident';
import { getCategoryColor } from '../utils/categoryColors';
import { getMilSymbolIconOptions } from '../utils/milSymbols';
import { createPmtilesRasterLayer } from '../utils/pmtilesLayer';
import { formatThaiDateTime } from '../utils/thaiDate';
import { getDistrictBoundariesGeoJson } from '../utils/geoLookup';

export type BasemapType = 'osm' | 'satellite' | 'topo';

const DEFAULT_CENTER: [number, number] = [6.48, 101.42];
const DEFAULT_ZOOM = 9;

function createPinIcon(color: string, large = false): L.DivIcon {
  const size = large ? 32 : 24;
  return L.divIcon({
    className: 'custom-map-pin',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size + 4],
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="${color}" stroke="#ffffff" stroke-width="1.8"/>
      <circle cx="12" cy="9" r="2.8" fill="#ffffff"/>
    </svg>`,
  });
}

function createBaseTileLayer(offlinePmtilesUrl?: string, basemap: BasemapType = 'osm'): L.GridLayer {
  const pmtilesUrl = (offlinePmtilesUrl || '').trim();
  if (pmtilesUrl) {
    return createPmtilesRasterLayer(pmtilesUrl);
  }
  if (basemap === 'satellite') {
    return L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 18,
      }
    );
  }
  if (basemap === 'topo') {
    return L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenTopoMap',
      maxZoom: 17,
    });
  }
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface PickerMapProps {
  mode: 'picker';
  lat: number | null;
  lng: number | null;
  onPickCoordinate: (lat: number, lng: number) => void;
  showBoundaries?: boolean;
  offlinePmtilesUrl?: string;
  height?: string;
}

interface OverviewMapProps {
  mode: 'overview';
  incidents: IncidentRecord[];
  categories: string[];
  selectedId?: string | null;
  onSelectIncident?: (id: string) => void;
  showBoundaries?: boolean;
  markerStyle?: 'pin' | 'milsymbol';
  offlinePmtilesUrl?: string;
  height?: string;
}

type LeafletMapProps = PickerMapProps | OverviewMapProps;

export function LeafletMap(props: LeafletMapProps) {
  const [basemap, setBasemap] = useState<BasemapType>('osm');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.GridLayer | null>(null);
  const baseKeyRef = useRef<string>('');
  const boundaryLayerRef = useRef<L.GeoJSON | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const pickerMarkerRef = useRef<L.Marker | null>(null);
  const onPickRef = useRef<((lat: number, lng: number) => void) | undefined>(
    props.mode === 'picker' ? props.onPickCoordinate : undefined
  );
  const onSelectRef = useRef<((id: string) => void) | undefined>(
    props.mode === 'overview' ? props.onSelectIncident : undefined
  );

  onPickRef.current = props.mode === 'picker' ? props.onPickCoordinate : undefined;
  onSelectRef.current = props.mode === 'overview' ? props.onSelectIncident : undefined;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
    });

    const initialBaseLayer = createBaseTileLayer(props.offlinePmtilesUrl, basemap);
    initialBaseLayer.addTo(map);
    baseLayerRef.current = initialBaseLayer;
    baseKeyRef.current = `${(props.offlinePmtilesUrl || '').trim()}|${basemap}`;

    const boundaryLayer = L.geoJSON(getDistrictBoundariesGeoJson() as GeoJSON.GeoJsonObject, {
      style: {
        color: '#1e3a8a',
        weight: 0.8,
        opacity: 0.35,
        fillColor: '#1d4ed8',
        fillOpacity: 0.03,
      },
      interactive: false,
    });
    if (props.showBoundaries !== false) {
      boundaryLayer.addTo(map);
    }

    const markerLayer = L.layerGroup().addTo(map);

    if (props.mode === 'picker') {
      map.on('click', (ev: L.LeafletMouseEvent) => {
        onPickRef.current?.(Number(ev.latlng.lat.toFixed(6)), Number(ev.latlng.lng.toFixed(6)));
      });
    }

    mapRef.current = map;
    boundaryLayerRef.current = boundaryLayer;
    markerLayerRef.current = markerLayer;

    // Ensure Leaflet measures container properly after render
    const timer = window.setTimeout(() => map.invalidateSize(), 150);

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      boundaryLayerRef.current = null;
      markerLayerRef.current = null;
      pickerMarkerRef.current = null;
    };
  }, []);

  // Switch between online OSM / Satellite / Topo and offline PMTiles basemap
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const nextKey = `${(props.offlinePmtilesUrl || '').trim()}|${basemap}`;
    if (baseKeyRef.current === nextKey) return;
    baseKeyRef.current = nextKey;

    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }
    const nextLayer = createBaseTileLayer(props.offlinePmtilesUrl, basemap);
    nextLayer.addTo(map);
    baseLayerRef.current = nextLayer;
  }, [props.offlinePmtilesUrl, basemap]);

  // Toggle operational boundaries
  useEffect(() => {
    const map = mapRef.current;
    const layer = boundaryLayerRef.current;
    if (!map || !layer) return;
    if (props.showBoundaries !== false) {
      if (!map.hasLayer(layer)) layer.addTo(map);
    } else if (map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  }, [props.showBoundaries]);

  // Picker marker sync
  useEffect(() => {
    if (props.mode !== 'picker') return;
    const map = mapRef.current;
    const layer = markerLayerRef.current;
    if (!map || !layer) return;

    if (props.lat !== null && props.lng !== null) {
      const pos: [number, number] = [props.lat, props.lng];
      if (!pickerMarkerRef.current) {
        const marker = L.marker(pos, {
          draggable: true,
          icon: createPinIcon('#b91c1c', true),
        });
        marker.on('dragend', () => {
          const ll = marker.getLatLng();
          onPickRef.current?.(Number(ll.lat.toFixed(6)), Number(ll.lng.toFixed(6)));
        });
        marker.addTo(layer);
        pickerMarkerRef.current = marker;
      } else {
        pickerMarkerRef.current.setLatLng(pos);
      }
      map.setView(pos, Math.max(map.getZoom(), 12), { animate: true });
    } else if (pickerMarkerRef.current) {
      layer.removeLayer(pickerMarkerRef.current);
      pickerMarkerRef.current = null;
    }
  }, [props.mode, props.mode === 'picker' ? props.lat : null, props.mode === 'picker' ? props.lng : null]);

  // Overview markers sync
  useEffect(() => {
    if (props.mode !== 'overview') return;
    const map = mapRef.current;
    const layer = markerLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const valid = props.incidents.filter((i) => i.lat !== null && i.lng !== null);
    const bounds: [number, number][] = [];

    for (const item of valid) {
      const lat = item.lat as number;
      const lng = item.lng as number;
      bounds.push([lat, lng]);
      const catIndex = props.categories.indexOf(item.category);
      const color = getCategoryColor(item.category, catIndex >= 0 ? catIndex : 0);
      const isSelected = props.selectedId === item.id;
      const icon =
        props.markerStyle === 'milsymbol'
          ? L.divIcon({
              className: 'custom-milsymbol-icon',
              ...getMilSymbolIconOptions(item.category, isSelected),
            })
          : createPinIcon(color, isSelected);
      const marker = L.marker([lat, lng], { icon });

      const area = [
        item.subdistrict ? `ต.${item.subdistrict}` : '',
        item.district ? `อ.${item.district}` : '',
        item.province ? `จว.${item.province}` : '',
      ]
        .filter(Boolean)
        .join(' ');

      const popupHtml = `
        <div style="font-family:'Sarabun','Noto Sans Thai',sans-serif;min-width:220px;max-width:290px;line-height:1.45;">
          <div style="font-weight:700;color:${color};margin-bottom:4px;">${escapeHtml(item.category)}</div>
          <div style="font-size:12px;color:#334155;"><strong>วัน-เวลา:</strong> ${escapeHtml(formatThaiDateTime(item.occurredAt))}</div>
          <div style="font-size:12px;color:#334155;"><strong>พื้นที่:</strong> ${escapeHtml(area || 'ไม่ระบุ')}</div>
          <div style="font-size:12px;color:#334155;"><strong>พิกัด:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
          <div style="font-size:11px;color:#475569;margin-bottom:6px;"><strong>MGRS:</strong> ${escapeHtml(item.mgrs || '-')}</div>
          <div style="font-size:12px;color:#0f172a;background:#f8fafc;padding:6px;border-radius:4px;border:1px solid #e2e8f0;max-height:95px;overflow:auto;">
            ${escapeHtml(item.details)}
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">ผู้บันทึก: ${escapeHtml(item.reporter || '-')}</div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      marker.on('click', () => {
        onSelectRef.current?.(item.id);
      });
      marker.addTo(layer);
      if (isSelected) {
        marker.openPopup();
        map.setView([lat, lng], Math.max(map.getZoom(), 12), { animate: true });
      }
    }

    if (bounds.length > 0 && !props.selectedId) {
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 12 });
    } else if (bounds.length === 0) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }
  }, [
    props.mode,
    props.mode === 'overview' ? props.incidents : null,
    props.mode === 'overview' ? props.categories : null,
    props.mode === 'overview' ? props.selectedId : null,
    props.mode === 'overview' ? props.markerStyle : null,
  ]);

  const isOfflineBasemap = Boolean((props.offlinePmtilesUrl || '').trim());

  return (
    <div className="leaflet-wrapper">
      {!isOfflineBasemap && (
        <div className="basemap-switcher" role="group" aria-label="เลือกชั้นแผนที่พื้นหลัง">
          {(
            [
              ['osm', 'ถนน (OSM)'],
              ['satellite', 'ดาวเทียม'],
              ['topo', 'ภูมิประเทศ'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`basemap-btn ${basemap === key ? 'active' : ''}`}
              aria-pressed={basemap === key}
              onClick={() => setBasemap(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div
        ref={containerRef}
        className="leaflet-map-box"
        style={{ height: props.height || '380px', width: '100%' }}
        aria-label="แผนที่แสดงพิกัดและพื้นที่ปฏิบัติการ 3 จังหวัดชายแดนภาคใต้"
      />
    </div>
  );
}
