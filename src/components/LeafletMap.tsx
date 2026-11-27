import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { IncidentRecord, WatchAlertRecord, WatchAreaTarget } from '../types/incident';
import { getCategoryColor } from '../utils/categoryColors';
import { createPmtilesRasterLayer } from '../utils/pmtilesLayer';
import { escapeHtml } from '../utils/safeHtml';
import { classifyIncidentSeverity } from '../utils/severity';
import { formatThaiDateTime, isWatchAlertActive } from '../utils/thaiDate';
import { getDistrictBoundariesGeoJson, getWatchZonePolygonsGeoJson } from '../utils/geoLookup';

type MilSymbolModule = typeof import('../utils/milSymbols');

export type BasemapType = 'osm' | 'satellite' | 'topo';

const DEFAULT_CENTER: [number, number] = [6.82, 100.62];
const DEFAULT_ZOOM = 8;

function createPinIcon(color: string, large = false, badgeCount?: number): L.DivIcon {
  const size = large ? 34 : 26;
  const badge =
    badgeCount && badgeCount > 1
      ? `<circle cx="18.2" cy="5.8" r="4.8" fill="#0f172a" stroke="#ffffff" stroke-width="1.2"/>
         <text x="18.2" y="8" text-anchor="middle" font-size="6.8" font-weight="700" fill="#ffffff" font-family="sans-serif">${badgeCount > 99 ? '99+' : badgeCount}</text>`
      : '';
  return L.divIcon({
    className: 'custom-map-pin',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size + 4],
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="${color}" stroke="#ffffff" stroke-width="1.8"/>
      <circle cx="12" cy="9" r="2.8" fill="#ffffff"/>
      ${badge}
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

export interface PreviewPin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  eventCount?: number;
  active?: boolean;
}

interface PickerMapProps {
  mode: 'picker';
  lat: number | null;
  lng: number | null;
  onPickCoordinate: (lat: number, lng: number) => void;
  previewMarkers?: PreviewPin[];
  onSelectPreviewMarker?: (id: string) => void;
  watchPreviewAreas?: WatchAreaTarget[];
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
  colorMode?: 'category' | 'severity';
  watchAlerts?: WatchAlertRecord[];
  showWatchZones?: boolean;
  offlinePmtilesUrl?: string;
  height?: string;
}

type LeafletMapProps = PickerMapProps | OverviewMapProps;

export function LeafletMap(props: LeafletMapProps) {
  const [basemap, setBasemap] = useState<BasemapType>('osm');
  const [milSymbolReady, setMilSymbolReady] = useState(false);
  const milSymbolModRef = useRef<MilSymbolModule | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.GridLayer | null>(null);
  const baseKeyRef = useRef<string>('');
  const boundaryLayerRef = useRef<L.GeoJSON | null>(null);
  const watchLayerRef = useRef<L.LayerGroup | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const previewLayerRef = useRef<L.LayerGroup | null>(null);
  const pickerMarkerRef = useRef<L.Marker | null>(null);
  const overviewMarkersRef = useRef<
    Map<string, { marker: L.Marker; item: IncidentRecord; color: string }>
  >(new Map());
  const prevSelectedIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(
    props.mode === 'overview' ? props.selectedId ?? null : null
  );
  selectedIdRef.current = props.mode === 'overview' ? props.selectedId ?? null : null;
  const onPickRef = useRef<((lat: number, lng: number) => void) | undefined>(
    props.mode === 'picker' ? props.onPickCoordinate : undefined
  );
  const onSelectPreviewRef = useRef<((id: string) => void) | undefined>(
    props.mode === 'picker' ? props.onSelectPreviewMarker : undefined
  );
  const onSelectRef = useRef<((id: string) => void) | undefined>(
    props.mode === 'overview' ? props.onSelectIncident : undefined
  );

  onPickRef.current = props.mode === 'picker' ? props.onPickCoordinate : undefined;
  onSelectPreviewRef.current = props.mode === 'picker' ? props.onSelectPreviewMarker : undefined;
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

    // Create watch polygon layer beneath clickable pins
    const watchLayer = L.layerGroup().addTo(map);
    const previewLayer = L.layerGroup().addTo(map);
    const markerLayer = L.layerGroup().addTo(map);

    if (props.mode === 'picker') {
      map.on('click', (ev: L.LeafletMouseEvent) => {
        onPickRef.current?.(Number(ev.latlng.lat.toFixed(6)), Number(ev.latlng.lng.toFixed(6)));
      });
    }

    mapRef.current = map;
    boundaryLayerRef.current = boundaryLayer;
    watchLayerRef.current = watchLayer;
    previewLayerRef.current = previewLayer;
    markerLayerRef.current = markerLayer;

    // Ensure Leaflet measures container properly after render & resizes (e.g., fullscreen / C2 layout)
    const timer = window.setTimeout(() => map.invalidateSize(), 150);
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && containerRef.current
        ? new ResizeObserver(() => {
            map.invalidateSize();
          })
        : null;
    if (resizeObserver && containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.clearTimeout(timer);
      resizeObserver?.disconnect();
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      boundaryLayerRef.current = null;
      watchLayerRef.current = null;
      previewLayerRef.current = null;
      markerLayerRef.current = null;
      pickerMarkerRef.current = null;
      overviewMarkersRef.current.clear();
      prevSelectedIdRef.current = null;
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

    const activeCount = props.previewMarkers?.find((m) => m.active)?.eventCount;
    const activeIcon = createPinIcon('#b91c1c', true, activeCount);

    if (props.lat !== null && props.lng !== null) {
      const pos: [number, number] = [props.lat, props.lng];
      if (!pickerMarkerRef.current) {
        const marker = L.marker(pos, {
          draggable: true,
          icon: activeIcon,
        });
        marker.on('dragend', () => {
          const ll = marker.getLatLng();
          onPickRef.current?.(Number(ll.lat.toFixed(6)), Number(ll.lng.toFixed(6)));
        });
        marker.addTo(layer);
        pickerMarkerRef.current = marker;
      } else {
        pickerMarkerRef.current.setLatLng(pos);
        pickerMarkerRef.current.setIcon(activeIcon);
      }
      const targetMinZoom = props.previewMarkers && props.previewMarkers.length > 1 ? 10 : 12;
      map.setView(pos, Math.max(map.getZoom(), targetMinZoom), { animate: true });
    } else if (pickerMarkerRef.current) {
      layer.removeLayer(pickerMarkerRef.current);
      pickerMarkerRef.current = null;
    }
  }, [
    props.mode,
    props.mode === 'picker' ? props.lat : null,
    props.mode === 'picker' ? props.lng : null,
    props.mode === 'picker' ? props.previewMarkers : null,
  ]);

  // Multi-area draft preview pins sync (picker mode)
  useEffect(() => {
    const previewLayer = previewLayerRef.current;
    if (!previewLayer) return;
    previewLayer.clearLayers();
    if (props.mode !== 'picker' || !props.previewMarkers || props.previewMarkers.length === 0) {
      return;
    }

    for (const pin of props.previewMarkers) {
      if (pin.active) continue;
      const marker = L.marker([pin.lat, pin.lng], {
        icon: createPinIcon('#0f4c81', false, pin.eventCount),
      });
      marker.bindTooltip(escapeHtml(pin.label), { direction: 'top', offset: [0, -24] });
      marker.on('click', () => {
        onSelectPreviewRef.current?.(pin.id);
      });
      marker.addTo(previewLayer);
    }
  }, [props.mode, props.mode === 'picker' ? props.previewMarkers : null]);

  // Watch Zone Polygon overlays (shaded targeted districts/subdistricts for threat advisories)
  useEffect(() => {
    const map = mapRef.current;
    const watchLayer = watchLayerRef.current;
    if (!map || !watchLayer) return;

    watchLayer.clearLayers();

    if (props.mode === 'picker') {
      if (!props.watchPreviewAreas || props.watchPreviewAreas.length === 0) return;
      const geo = getWatchZonePolygonsGeoJson(props.watchPreviewAreas);
      if (geo.features.length === 0) return;

      const poly = L.geoJSON(geo as GeoJSON.GeoJsonObject, {
        style: {
          color: '#dc2626',
          weight: 2,
          dashArray: '6 4',
          fillColor: '#ef4444',
          fillOpacity: 0.24,
        },
        onEachFeature: (feature, layer) => {
          const p = feature.properties as { district?: string; subdistrict?: string; province?: string };
          layer.bindTooltip(
            escapeHtml(`ต.${p.subdistrict || '-'} อ.${p.district || '-'} จว.${p.province || '-'}`)
          );
        },
      });
      poly.addTo(watchLayer);
      const bounds = poly.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 11 });
      }
      return;
    }

    if (props.showWatchZones === false || !props.watchAlerts || props.watchAlerts.length === 0) {
      return;
    }

    const WATCH_COLORS: Record<'critical' | 'high' | 'medium', string> = {
      critical: '#ef4444',
      high: '#f97316',
      medium: '#eab308',
    };

    for (const alert of props.watchAlerts) {
      const geo = getWatchZonePolygonsGeoJson(alert.areas);
      if (geo.features.length === 0) continue;
      const strokeColor = WATCH_COLORS[alert.alertLevel] || '#f97316';
      const status = isWatchAlertActive(alert);
      const isExpired = status === 'expired';
      const statusLabel =
        status === 'active'
          ? 'กำลังเฝ้าระวัง'
          : status === 'upcoming'
            ? 'รอเริ่มห้วง'
            : 'พ้นห้วงแล้ว (แสดงย้อนหลัง 30 วัน)';

      const polyLayer = L.geoJSON(geo as GeoJSON.GeoJsonObject, {
        style: isExpired
          ? {
              color: strokeColor,
              weight: 1.5,
              dashArray: '3 6',
              opacity: 0.55,
              fillColor: strokeColor,
              fillOpacity: 0.09,
            }
          : {
              color: strokeColor,
              weight: 2,
              dashArray: '6 4',
              opacity: 0.9,
              fillColor: strokeColor,
              fillOpacity: 0.2,
            },
      });
      const areaNames = alert.areas
        .map((a) => `${a.district ? `อ.${a.district}` : ''} ${a.province ? `จว.${a.province}` : ''}`.trim())
        .join(', ');
      const windowText =
        alert.watchStart && alert.watchEnd && alert.watchStart !== alert.watchEnd
          ? `${formatThaiDateTime(alert.watchStart, { includeTime: false })} – ${formatThaiDateTime(alert.watchEnd, { includeTime: false })}`
          : formatThaiDateTime(alert.watchStart || alert.reportedAt, { includeTime: false });

      const popupHtml = `
        <div style="font-family:'Sarabun','Noto Sans Thai',sans-serif;min-width:220px;max-width:295px;line-height:1.45;">
          <div style="font-weight:800;color:${strokeColor};margin-bottom:4px;">พื้นที่เฝ้าระวัง: ${escapeHtml(alert.threatType)}</div>
          <div style="font-size:12px;color:#334155;"><strong>สถานะ:</strong> ${escapeHtml(statusLabel)}</div>
          <div style="font-size:12px;color:#334155;"><strong>ห้วงเฝ้าระวัง:</strong> ${escapeHtml(windowText)}</div>
          <div style="font-size:12px;color:#334155;margin-bottom:4px;"><strong>เขตเฝ้าระวัง (${alert.areas.length} พื้นที่):</strong> ${escapeHtml(areaNames)}</div>
          <div style="font-size:12px;color:#0f172a;background:#fff7ed;padding:6px;border-radius:4px;border:1px solid #fed7aa;max-height:95px;overflow:auto;">
            ${escapeHtml(alert.details)}
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">ผู้บันทึก: ${escapeHtml(alert.reporter || '-')}</div>
        </div>
      `;
      polyLayer.bindPopup(popupHtml);
      polyLayer.addTo(watchLayer);
    }
  }, [
    props.mode,
    props.mode === 'overview' ? props.watchAlerts : null,
    props.mode === 'overview' ? props.showWatchZones : null,
    props.mode === 'picker' ? props.watchPreviewAreas : null,
  ]);

  // Lazy-load milsymbol only when MIL-STD-2525D mode is requested
  useEffect(() => {
    if (props.mode !== 'overview' || props.markerStyle !== 'milsymbol' || milSymbolModRef.current) {
      return;
    }
    let active = true;
    void import('../utils/milSymbols').then((mod) => {
      if (!active) return;
      milSymbolModRef.current = mod;
      setMilSymbolReady(true);
    });
    return () => {
      active = false;
    };
  }, [props.mode, props.mode === 'overview' ? props.markerStyle : null]);

  // Overview markers sync (rebuilds markers only when data/style changes, not on selection click)
  useEffect(() => {
    if (props.mode !== 'overview') return;
    const map = mapRef.current;
    const layer = markerLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    overviewMarkersRef.current.clear();
    prevSelectedIdRef.current = null;

    const valid = props.incidents.filter((i) => i.lat !== null && i.lng !== null);
    const bounds: [number, number][] = [];
    const milMod = props.markerStyle === 'milsymbol' ? milSymbolModRef.current : null;

    for (const item of valid) {
      const lat = item.lat as number;
      const lng = item.lng as number;
      bounds.push([lat, lng]);
      const catIndex = props.categories.indexOf(item.category);
      const severity = classifyIncidentSeverity(item.category, item.details);
      const color =
        props.colorMode === 'severity'
          ? severity.color
          : getCategoryColor(item.category, catIndex >= 0 ? catIndex : 0);
      const isSelected = selectedIdRef.current === item.id;
      const icon =
        props.markerStyle === 'milsymbol' && milMod
          ? L.divIcon({
              className: 'custom-milsymbol-icon',
              ...milMod.getMilSymbolIconOptions(item.category, isSelected),
            })
          : createPinIcon(color, isSelected, item.eventCount);
      const marker = L.marker([lat, lng], {
        icon,
        title: `${item.category}${item.district ? ` อ.${item.district}` : ''}`,
      });

      const area = [
        item.subdistrict ? `ต.${item.subdistrict}` : '',
        item.district ? `อ.${item.district}` : '',
        item.province ? `จว.${item.province}` : '',
      ]
        .filter(Boolean)
        .join(' ');

      const countLine =
        item.eventCount && item.eventCount > 1
          ? `<div style="font-size:12px;color:#b45309;font-weight:700;margin-bottom:2px;">จำนวน ${item.eventCount} เหตุการณ์</div>`
          : '';

      const popupHtml = `
        <div style="font-family:'Noto Sans Thai','Sarabun',sans-serif;min-width:220px;max-width:290px;line-height:1.45;">
          <div style="font-weight:700;color:${color};margin-bottom:4px;">${escapeHtml(item.category)}</div>
          <div style="display:inline-block;font-size:11px;font-weight:700;color:#ffffff;background:${severity.color};padding:1px 7px;border-radius:999px;margin-bottom:4px;">ความรุนแรง: ${escapeHtml(severity.label)}</div>
          ${countLine}
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
      overviewMarkersRef.current.set(item.id, { marker, item, color });
      if (isSelected) {
        prevSelectedIdRef.current = item.id;
        marker.openPopup();
      }
    }

    if (bounds.length > 0 && !selectedIdRef.current) {
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 12 });
    } else if (bounds.length === 0) {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }
  }, [
    props.mode,
    props.mode === 'overview' ? props.incidents : null,
    props.mode === 'overview' ? props.categories : null,
    props.mode === 'overview' ? props.markerStyle : null,
    props.mode === 'overview' ? props.colorMode : null,
    milSymbolReady,
  ]);

  // Update only the previously/newly selected marker icon & view without rebuilding all markers
  useEffect(() => {
    if (props.mode !== 'overview') return;
    const map = mapRef.current;
    if (!map) return;

    const buildMarkerIcon = (item: IncidentRecord, color: string, selected: boolean) => {
      const milMod = props.markerStyle === 'milsymbol' ? milSymbolModRef.current : null;
      return props.markerStyle === 'milsymbol' && milMod
        ? L.divIcon({
            className: 'custom-milsymbol-icon',
            ...milMod.getMilSymbolIconOptions(item.category, selected),
          })
        : createPinIcon(color, selected, item.eventCount);
    };

    const prevId = prevSelectedIdRef.current;
    if (prevId && prevId !== props.selectedId) {
      const prevEntry = overviewMarkersRef.current.get(prevId);
      if (prevEntry) {
        prevEntry.marker.setIcon(buildMarkerIcon(prevEntry.item, prevEntry.color, false));
      }
    }

    const nextId = props.selectedId ?? null;
    if (nextId) {
      const nextEntry = overviewMarkersRef.current.get(nextId);
      if (nextEntry) {
        nextEntry.marker.setIcon(buildMarkerIcon(nextEntry.item, nextEntry.color, true));
        nextEntry.marker.openPopup();
        const ll = nextEntry.marker.getLatLng();
        map.setView([ll.lat, ll.lng], Math.max(map.getZoom(), 12), { animate: true });
      }
    }
    prevSelectedIdRef.current = nextId;
  }, [
    props.mode,
    props.mode === 'overview' ? props.selectedId : null,
    props.mode === 'overview' ? props.markerStyle : null,
    milSymbolReady,
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
        aria-label="แผนที่แสดงพิกัดและพื้นที่ปฏิบัติการ 7 จังหวัดภาคใต้ตอนล่าง (ผขว.บก.บน.56)"
      />
    </div>
  );
}
