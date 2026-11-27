import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  Crosshair,
  Layers,
  LocateFixed,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AppSettings,
  IncidentRecord,
  MultiAreaDraftItem,
  MultiAreaParseResult,
  ParsedCoordinate,
  WatchAlertLevel,
  WatchAlertRecord,
  WatchAreaTarget,
  WatchAuditResult,
} from '../types/incident';
import type { NewsToIncidentDraft } from '../types/news';
import { buildParsedCoordinate, parseCoordinateInput } from '../utils/coordinates';
import type { GasPullResult } from '../utils/gasSync';
import {
  getCenterOfArea,
  getDistrictsByProvince,
  getSubdistrictsByDistrict,
  getTargetProvinces,
  lookupAreaByLatLng,
  matchAreaByThaiNames,
} from '../utils/geoLookup';
import {
  auditWatchAlerts,
  extractMultiAreaPaper,
  extractPaperMetadata,
  extractWatchAdvisory,
  formatThaiDateTime,
  formatWatchAreasSummary,
  getCurrentLocalDateTimeInput,
  isWatchAdvisoryCategory,
  isWatchAlertActive,
  reparseWatchAlert,
} from '../utils/thaiDate';
import { formatIncidentForLine, formatIncidentForPaper } from '../utils/exportUtils';
import { LeafletMap, type PreviewPin } from './LeafletMap';

interface IncidentFormPageProps {
  settings: AppSettings;
  incidents?: IncidentRecord[];
  editingIncident: IncidentRecord | null;
  onCancelEdit: () => void;
  newsDraft?: NewsToIncidentDraft | null;
  onClearNewsDraft?: () => void;
  onSaveIncident: (record: IncidentRecord) => Promise<IncidentRecord>;
  onSaveIncidentBatch?: (records: IncidentRecord[]) => Promise<IncidentRecord[]>;
  lastSavedRecord: IncidentRecord | null;
  watchAlerts?: WatchAlertRecord[];
  onSaveWatchAlert?: (alert: WatchAlertRecord) => Promise<WatchAlertRecord>;
  onSaveWatchAlertsBatch?: (alerts: WatchAlertRecord[]) => Promise<WatchAlertRecord[]>;
  onQuickUpdateIncidentBatch?: (records: IncidentRecord[]) => Promise<IncidentRecord[]>;
  onPullFromGas?: () => Promise<GasPullResult>;
  onDeleteWatchAlert?: (id: string) => Promise<void>;
}

const FORMAT_LABELS: Record<ParsedCoordinate['format'], string> = {
  latlng: 'ละติจูด / ลองจิจูด (Decimal)',
  'google-maps-url': 'ลิงก์ Google Maps',
  dms: 'องศา-ลิปดา-ฟิลิปดา (DMS)',
  mgrs: 'พิกัดทางทหาร (MGRS)',
  utm: 'พิกัด UTM',
  'map-pick': 'เลือก/ลากหมุดบนแผนที่',
};

export function IncidentFormPage({
  settings,
  incidents = [],
  editingIncident,
  onCancelEdit,
  newsDraft,
  onClearNewsDraft,
  onSaveIncident,
  onSaveIncidentBatch,
  lastSavedRecord,
  watchAlerts = [],
  onSaveWatchAlert,
  onSaveWatchAlertsBatch,
  onQuickUpdateIncidentBatch,
  onPullFromGas,
  onDeleteWatchAlert,
}: IncidentFormPageProps) {
  const [entryMode, setEntryMode] = useState<'single' | 'batch' | 'watch'>('single');

  const [coordinateRaw, setCoordinateRaw] = useState('');
  const [parsedCoord, setParsedCoord] = useState<ParsedCoordinate | null>(null);
  const [coordError, setCoordError] = useState('');

  const [province, setProvince] = useState('');
  const [district, setDistrict] = useState('');
  const [subdistrict, setSubdistrict] = useState('');
  const [inTargetArea, setInTargetArea] = useState(true);
  const [areaAutoNote, setAreaAutoNote] = useState('');

  const [occurredAt, setOccurredAt] = useState(getCurrentLocalDateTimeInput);
  const [category, setCategory] = useState(settings.categories[0] || 'อื่นๆ');
  const [eventCount, setEventCount] = useState(1);
  const [details, setDetails] = useState('');
  const [reporter, setReporter] = useState(settings.defaultReporter || '');

  const [showBoundaries, setShowBoundaries] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [paperNotice, setPaperNotice] = useState('');
  const [multiOffer, setMultiOffer] = useState<MultiAreaParseResult | null>(null);
  const [copiedType, setCopiedType] = useState<'line' | 'paper' | null>(null);

  // Multi-area batch state
  const [batchRawText, setBatchRawText] = useState('');
  const [batchItems, setBatchItems] = useState<MultiAreaDraftItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [batchHints, setBatchHints] = useState<string[]>([]);
  const [batchWarnings, setBatchWarnings] = useState<string[]>([]);
  const [batchReportedTotal, setBatchReportedTotal] = useState<number | undefined>(undefined);
  const [expandByEventCount, setExpandByEventCount] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [batchResultBanner, setBatchResultBanner] = useState<{
    savedCount: number;
    syncedCount: number;
    failedCount: number;
    totalEvents: number;
  } | null>(null);

  // Watch Advisory / Threat Zone state
  const todayDateDefault = useMemo(() => getCurrentLocalDateTimeInput().slice(0, 10), []);
  const [watchRawText, setWatchRawText] = useState('');
  const [watchReportedAt, setWatchReportedAt] = useState(todayDateDefault);
  const [watchStart, setWatchStart] = useState(todayDateDefault);
  const [watchEnd, setWatchEnd] = useState(todayDateDefault);
  const [watchThreatType, setWatchThreatType] = useState('ความเคลื่อนไหวกลุ่มผู้ก่อเหตุรุนแรง');
  const [watchAlertLevel, setWatchAlertLevel] = useState<WatchAlertLevel>('high');
  const [watchAreas, setWatchAreas] = useState<WatchAreaTarget[]>([]);
  const [watchAddProv, setWatchAddProv] = useState('นราธิวาส');
  const [watchAddDist, setWatchAddDist] = useState('');
  const [watchHints, setWatchHints] = useState<string[]>([]);
  const [watchError, setWatchError] = useState('');
  const [watchSuccessBanner, setWatchSuccessBanner] = useState('');
  const [editingWatchId, setEditingWatchId] = useState<string | null>(null);
  const [regeocodingWatch, setRegeocodingWatch] = useState(false);
  const [watchAuditReport, setWatchAuditReport] = useState<{
    checkedCount: number;
    updatedWatchCount: number;
    promotedLegacyCount: number;
    updatedIncidentCount: number;
    activeAlerts: WatchAlertRecord[];
    flagged: Array<{ alert: WatchAlertRecord; result: WatchAuditResult }>;
  } | null>(null);

  const provinces = useMemo(() => getTargetProvinces(), []);
  const districts = useMemo(() => (province ? getDistrictsByProvince(province) : []), [province]);
  const subdistricts = useMemo(
    () => (province && district ? getSubdistrictsByDistrict(province, district) : []),
    [province, district]
  );

  // Sync form when entering/exiting edit mode
  useEffect(() => {
    if (editingIncident) {
      setEntryMode('single');
      setMultiOffer(null);
      setCoordinateRaw(editingIncident.coordinateRaw);
      if (editingIncident.lat !== null && editingIncident.lng !== null) {
        setParsedCoord(
          buildParsedCoordinate(
            editingIncident.lat,
            editingIncident.lng,
            'latlng',
            editingIncident.coordinateRaw
          )
        );
      } else {
        setParsedCoord(null);
      }
      setProvince(editingIncident.province);
      setDistrict(editingIncident.district);
      setSubdistrict(editingIncident.subdistrict);
      setInTargetArea(editingIncident.inTargetArea);
      setOccurredAt(
        editingIncident.occurredAt.length === 10
          ? `${editingIncident.occurredAt}T08:00`
          : editingIncident.occurredAt
      );
      setCategory(editingIncident.category);
      setEventCount(
        editingIncident.eventCount && editingIncident.eventCount > 0
          ? editingIncident.eventCount
          : 1
      );
      setDetails(editingIncident.details);
      setReporter(editingIncident.reporter);
      setAreaAutoNote('');
      setCoordError('');
      setFormError('');
    }
  }, [editingIncident]);

  // Prefill from News HUB 1-click import when not editing an existing incident
  useEffect(() => {
    if (!newsDraft || editingIncident) return;
    setEntryMode('single');
    setMultiOffer(null);
    setCoordinateRaw('');
    setParsedCoord(null);
    setCoordError('');
    setFormError('');

    const bkkDate = new Date(new Date(newsDraft.publishedAt).getTime() + 7 * 60 * 60 * 1000);
    if (!Number.isNaN(bkkDate.getTime())) {
      setOccurredAt(bkkDate.toISOString().slice(0, 16));
    }
    setCategory(newsDraft.mappedIncidentCategory || settings.categories[0] || 'อื่นๆ');

    const provMatch = newsDraft.province
      ? matchAreaByThaiNames(newsDraft.province, newsDraft.district || undefined)
      : null;
    if (provMatch) {
      setProvince(provMatch.province);
      setDistrict(provMatch.district);
      setSubdistrict('');
      setInTargetArea(provMatch.inTargetArea);
      setAreaAutoNote(
        provMatch.district
          ? `ดึงพื้นที่จากข่าว: อ.${provMatch.district} จว.${provMatch.province} (สามารถเลือกตำบลหรือปักหมุดเพิ่มเติมได้)`
          : `ดึงพื้นที่จากข่าว: จว.${provMatch.province} (สามารถเลือกอำเภอ/ตำบลหรือปักหมุดเพิ่มเติมได้)`
      );
    } else {
      setProvince('');
      setDistrict('');
      setSubdistrict('');
      setInTargetArea(true);
      setAreaAutoNote('');
    }

    const summaryPart =
      newsDraft.summary && newsDraft.summary !== newsDraft.title ? ` — ${newsDraft.summary}` : '';
    const linkPart = newsDraft.link ? ` (${newsDraft.link})` : '';
    setDetails(
      `[${newsDraft.sourceName}] ${newsDraft.title}${summaryPart}${linkPart}`
    );
  }, [newsDraft, editingIncident, settings.categories]);

  const applyCoordinateResult = (coord: ParsedCoordinate) => {
    setParsedCoord(coord);
    setCoordError('');

    const area = lookupAreaByLatLng(coord.lat, coord.lng);
    if (area.inTargetArea) {
      setProvince(area.province);
      setDistrict(area.district);
      setSubdistrict(area.subdistrict);
      setInTargetArea(true);
      setAreaAutoNote(
        `ระบุพื้นที่อัตโนมัติ: ต.${area.subdistrict} อ.${area.district} จว.${area.province}`
      );
    } else {
      setInTargetArea(false);
      setAreaAutoNote(
        'พิกัดอยู่นอกเขตพื้นที่รับผิดชอบ 7 จังหวัดภาคใต้ตอนล่าง (ยังสามารถระบุพื้นที่และบันทึกได้)'
      );
    }
  };

  const handleCoordinateChange = (value: string) => {
    setCoordinateRaw(value);
    setFormError('');
    if (!value.trim()) {
      setParsedCoord(null);
      setCoordError('');
      setAreaAutoNote('');
      return;
    }
    const result = parseCoordinateInput(value);
    if (result) {
      applyCoordinateResult(result);
    } else {
      setParsedCoord(null);
      setCoordError(
        'ยังไม่พบรูปแบบพิกัดที่รู้จัก — รองรับ เช่น 6.0462, 101.2015 | 47N QH 43764 68514 | 47N 743764 668514 | ลิงก์ Google Maps'
      );
    }
  };

  const activeBatchItem = useMemo(
    () => batchItems.find((item) => item.id === activeItemId) || batchItems[0] || null,
    [batchItems, activeItemId]
  );

  const batchPreviewMarkers = useMemo<PreviewPin[]>(
    () =>
      batchItems
        .filter((item) => item.lat !== null && item.lng !== null)
        .map((item, idx) => {
          const areaLabel =
            [
              item.subdistrict ? `ต.${item.subdistrict}` : '',
              item.district ? `อ.${item.district}` : '',
              item.province ? `จว.${item.province}` : '',
            ]
              .filter(Boolean)
              .join(' ') || 'จุดย่อย';
          return {
            id: item.id,
            lat: item.lat as number,
            lng: item.lng as number,
            label: `#${idx + 1} ${areaLabel} • ${item.category} (${item.eventCount} เหตุการณ์)`,
            eventCount: item.eventCount,
            active: item.id === activeBatchItem?.id,
          };
        }),
    [batchItems, activeBatchItem]
  );

  const batchTotalEvents = useMemo(
    () => batchItems.reduce((sum, item) => sum + (item.eventCount > 0 ? item.eventCount : 1), 0),
    [batchItems]
  );

  const batchProvinceBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of batchItems) {
      if (!item.province) continue;
      counts.set(
        item.province,
        (counts.get(item.province) || 0) + (item.eventCount > 0 ? item.eventCount : 1)
      );
    }
    return counts.size >= 2 ? Array.from(counts.entries()) : [];
  }, [batchItems]);

  const handlePickOnMap = (lat: number, lng: number) => {
    if (entryMode === 'batch' && activeBatchItem) {
      const area = lookupAreaByLatLng(lat, lng);
      const targetId = activeBatchItem.id;
      setBatchItems((prev) =>
        prev.map((item) => {
          if (item.id !== targetId) return item;
          const nextProv = item.province || (area.inTargetArea ? area.province : '');
          const nextDist = item.district || (area.inTargetArea ? area.district : '');
          const canFillSub =
            area.inTargetArea &&
            (!item.subdistrict ||
              (area.province === nextProv && area.district === nextDist));
          return {
            ...item,
            lat,
            lng,
            coordMatched: true,
            province: nextProv,
            district: nextDist,
            subdistrict: canFillSub ? area.subdistrict : item.subdistrict,
            areaMatched: item.areaMatched || area.inTargetArea,
          };
        })
      );
      setBatchError('');
      return;
    }

    const coord = buildParsedCoordinate(lat, lng, 'map-pick', `${lat}, ${lng}`);
    setCoordinateRaw(`${lat}, ${lng}`);
    applyCoordinateResult(coord);
  };

  const handleUseCurrentGps = () => {
    if (!navigator.geolocation) {
      setCoordError('เบราว์เซอร์นี้ไม่รองรับการดึงพิกัด GPS');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const coord = buildParsedCoordinate(lat, lng, 'latlng', `${lat}, ${lng}`);
        setCoordinateRaw(`${lat}, ${lng}`);
        applyCoordinateResult(coord);
      },
      (err) => {
        setCoordError(`ไม่สามารถดึงพิกัด GPS ได้ (${err.message})`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleJumpToSelectedArea = () => {
    if (!province) return;
    const center =
      getCenterOfArea(province, district || undefined, subdistrict || undefined) ||
      getCenterOfArea(province);
    if (center) {
      const coord = buildParsedCoordinate(center.lat, center.lng, 'map-pick', `${center.lat}, ${center.lng}`);
      setCoordinateRaw(`${center.lat}, ${center.lng}`);
      setParsedCoord(coord);
      setCoordError('');
      setInTargetArea(true);
      setAreaAutoNote('ปักหมุดที่จุดกึ่งกลางพื้นที่ที่เลือกแล้ว สามารถลากหมุดบนแผนที่เพื่อปรับตำแหน่งจริงได้');
    }
  };

  const handleExtractFromPaper = () => {
    if (!details.trim()) {
      setPaperNotice('กรุณาวางข้อความรายงานในช่องรายละเอียดเหตุการณ์ก่อนครับ');
      setMultiOffer(null);
      return;
    }
    const multi = extractMultiAreaPaper(details, settings.categories);
    setMultiOffer(multi.items.length >= 2 ? multi : null);

    const hints: string[] = [];
    const coordInText = parseCoordinateInput(details);
    if (coordInText) {
      setCoordinateRaw(coordInText.rawMatched);
      applyCoordinateResult(coordInText);
      hints.push(`พิกัด (${coordInText.lat}, ${coordInText.lng})`);
    }

    const parsed = extractPaperMetadata(details, settings.categories);
    if (parsed.occurredAt) {
      setOccurredAt(parsed.occurredAt);
      hints.push(`วันที่ (${formatThaiDateTime(parsed.occurredAt, { includeTime: false })})`);
    }
    if (parsed.category) {
      setCategory(parsed.category);
      hints.push(`ประเภท (${parsed.category})`);
    }
    if (parsed.province || parsed.district || parsed.subdistrict) {
      const areaMatch = matchAreaByThaiNames(parsed.province, parsed.district, parsed.subdistrict);
      if (areaMatch) {
        setProvince(areaMatch.province);
        setDistrict(areaMatch.district);
        setSubdistrict(areaMatch.subdistrict);
        setInTargetArea(true);
        const areaLabel = [
          areaMatch.subdistrict ? `ต.${areaMatch.subdistrict}` : '',
          areaMatch.district ? `อ.${areaMatch.district}` : '',
          `จว.${areaMatch.province}`,
        ]
          .filter(Boolean)
          .join(' ');
        hints.push(`พื้นที่ (${areaLabel})`);
        if (!coordInText) {
          const center = getCenterOfArea(
            areaMatch.province,
            areaMatch.district || undefined,
            areaMatch.subdistrict || undefined
          );
          if (center) {
            const c = buildParsedCoordinate(center.lat, center.lng, 'map-pick', `${center.lat}, ${center.lng}`);
            setParsedCoord(c);
            setCoordinateRaw(`${center.lat}, ${center.lng}`);
            setAreaAutoNote('ปักหมุดอ้างอิงกึ่งกลางพื้นที่จากข้อความ Paper (สามารถกรอกพิกัดจริงหรือลากหมุดทับได้)');
          }
        }
      } else {
        if (parsed.province) setProvince(parsed.province);
        if (parsed.district) setDistrict(parsed.district);
        if (parsed.subdistrict) setSubdistrict(parsed.subdistrict);
      }
    }

    setPaperNotice(
      hints.length > 0
        ? `สกัดข้อมูลอัตโนมัติสำเร็จ: ${hints.join(' • ')}`
        : 'ไม่พบรูปแบบวันที่ พื้นที่ หรือพิกัดที่สกัดได้จากข้อความนี้'
    );
  };

  const applyBatchParseResult = (parsed: MultiAreaParseResult, rawSource: string) => {
    const defaultDt = getCurrentLocalDateTimeInput();
    if (parsed.items.length > 0) {
      const normalizedItems = parsed.items.map((item) => ({
        ...item,
        occurredAt: item.occurredAt || defaultDt,
      }));
      setBatchItems(normalizedItems);
      setActiveItemId(normalizedItems[0].id);
      setBatchHints(parsed.matchedHints);
      setBatchWarnings(parsed.warnings);
      setBatchReportedTotal(parsed.reportedTotalCount);
      return;
    }

    // Fallback: create 1 editable row from single-incident extractor
    const single = extractPaperMetadata(rawSource, settings.categories);
    const areaMatch = matchAreaByThaiNames(single.province, single.district, single.subdistrict);
    const coord = parseCoordinateInput(rawSource);
    const center = !coord && areaMatch
      ? getCenterOfArea(
          areaMatch.province,
          areaMatch.district || undefined,
          areaMatch.subdistrict || undefined
        )
      : null;
    const item: MultiAreaDraftItem = {
      id: `draft-${Date.now()}`,
      occurredAt: single.occurredAt || defaultDt,
      category: (single.category || settings.categories[0] || 'อื่นๆ'),
      province: areaMatch?.province || single.province || '',
      district: areaMatch?.district || single.district || '',
      subdistrict: areaMatch?.subdistrict || single.subdistrict || '',
      lat: coord?.lat ?? center?.lat ?? null,
      lng: coord?.lng ?? center?.lng ?? null,
      eventCount: 1,
      details: rawSource.trim(),
      damageSummary: '',
      casualtiesSummary: '',
      coordMatched: Boolean(coord),
      areaMatched: Boolean(areaMatch),
    };
    setBatchItems([item]);
    setActiveItemId(item.id);
    setBatchHints(single.matchedHints);
    setBatchWarnings([
      'ตรวจพบหัวข้อย่อยไม่ถึง 2 พื้นที่ จึงสร้างเป็น 1 รายการตั้งต้น (สามารถกด "+ เพิ่มพื้นที่/จุดย่อย" ได้)',
    ]);
    setBatchReportedTotal(undefined);
  };

  const handleSwitchToBatchFromSingle = () => {
    const parsed = multiOffer || extractMultiAreaPaper(details, settings.categories);
    setBatchRawText(details);
    setBatchError('');
    setBatchResultBanner(null);
    applyBatchParseResult(parsed, details);
    setMultiOffer(null);
    setEntryMode('batch');
  };

  const handleExtractBatch = () => {
    setBatchError('');
    setBatchResultBanner(null);
    if (!batchRawText.trim()) {
      setBatchError('กรุณาวางข้อความรายงานหลายพื้นที่ก่อนกดสกัดข้อมูล');
      return;
    }
    const parsed = extractMultiAreaPaper(batchRawText, settings.categories);
    applyBatchParseResult(parsed, batchRawText);
  };

  const handleUpdateBatchItem = (id: string, patch: Partial<MultiAreaDraftItem>) => {
    setBatchItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setBatchError('');
  };

  const handleJumpBatchItemCenter = (item: MultiAreaDraftItem) => {
    if (!item.province) return;
    const validDistricts = getDistrictsByProvince(item.province);
    const validDist = item.district && validDistricts.includes(item.district) ? item.district : '';
    const validSub =
      validDist &&
      item.subdistrict &&
      getSubdistrictsByDistrict(item.province, validDist).includes(item.subdistrict)
        ? item.subdistrict
        : '';
    const center =
      getCenterOfArea(item.province, validDist || undefined, validSub || undefined) ||
      getCenterOfArea(item.province);
    if (center) {
      handleUpdateBatchItem(item.id, {
        lat: center.lat,
        lng: center.lng,
        coordMatched: false,
        ...(item.district && !validDist ? { district: '', subdistrict: '' } : {}),
        ...(validDist && item.subdistrict && !validSub ? { subdistrict: '' } : {}),
      });
      setActiveItemId(item.id);
    }
  };

  const handlePasteBatchItemCoord = (id: string, rawCoord: string) => {
    const parsed = parseCoordinateInput(rawCoord);
    setActiveItemId(id);
    if (!parsed) return;
    const area = lookupAreaByLatLng(parsed.lat, parsed.lng);
    setBatchItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              lat: parsed.lat,
              lng: parsed.lng,
              coordMatched: true,
              province: item.province || (area.inTargetArea ? area.province : ''),
              district: item.district || (area.inTargetArea ? area.district : ''),
              subdistrict:
                area.inTargetArea &&
                (!item.subdistrict ||
                  (area.province === (item.province || area.province) &&
                    area.district === (item.district || area.district)))
                  ? area.subdistrict
                  : item.subdistrict,
            }
          : item
      )
    );
    setBatchError('');
  };

  const handleAddBatchItem = () => {
    const seed = batchItems[0];
    const prov = seed?.province || '';
    const center = prov ? getCenterOfArea(prov) : null;
    const newId = `draft-${Date.now()}-${batchItems.length + 1}`;
    const newItem: MultiAreaDraftItem = {
      id: newId,
      occurredAt: seed?.occurredAt || getCurrentLocalDateTimeInput(),
      category: (settings.categories[0] || 'อื่นๆ'),
      province: prov,
      district: '',
      subdistrict: '',
      lat: center?.lat ?? null,
      lng: center?.lng ?? null,
      eventCount: 1,
      details: '',
      damageSummary: '',
      casualtiesSummary: '',
      coordMatched: false,
      areaMatched: Boolean(prov),
    };
    setBatchItems((prev) => [...prev, newItem]);
    setActiveItemId(newId);
    setBatchError('');
  };

  const handleRemoveBatchItem = (id: string) => {
    setBatchItems((prev) => {
      const next = prev.filter((item) => item.id !== id);
      if (activeItemId === id) {
        setActiveItemId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const handleResetBatch = () => {
    setBatchRawText('');
    setBatchItems([]);
    setActiveItemId(null);
    setBatchHints([]);
    setBatchWarnings([]);
    setBatchReportedTotal(undefined);
    setBatchError('');
    setBatchResultBanner(null);
  };

  const handleSubmitBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setBatchError('');
    setBatchResultBanner(null);

    if (batchItems.length === 0) {
      setBatchError('กรุณากด "สกัดจุดเกิดเหตุทั้งหมดอัตโนมัติ" หรือเพิ่มพื้นที่อย่างน้อย 1 รายการ');
      return;
    }
    if (!reporter.trim()) {
      setBatchError('กรุณาระบุชื่อผู้บันทึกเหตุการณ์');
      return;
    }

    const todayYmd = getCurrentLocalDateTimeInput().slice(0, 10);
    for (let i = 0; i < batchItems.length; i++) {
      const item = batchItems[i];
      const label = `#${i + 1}${item.district ? ` (อ.${item.district})` : ''}`;
      if (!item.occurredAt) {
        setBatchError(`รายการ ${label} ยังไม่ระบุวัน-เวลาเกิดเหตุ`);
        setActiveItemId(item.id);
        return;
      }
      if (item.occurredAt.slice(0, 10) > todayYmd) {
        setBatchError(`รายการ ${label} เลือกวันที่ในอนาคตไม่ได้ (ตามเงื่อนไขของระบบเดิม)`);
        setActiveItemId(item.id);
        return;
      }
      if (item.lat === null || item.lng === null) {
        setBatchError(`รายการ ${label} ยังไม่มีพิกัด กรุณาเลือกอำเภอหรือคลิกบนแผนที่`);
        setActiveItemId(item.id);
        return;
      }
      if (!item.details.trim()) {
        setBatchError(`รายการ ${label} กรุณาระบุรายละเอียดเหตุการณ์`);
        setActiveItemId(item.id);
        return;
      }
    }

    const nowIso = new Date().toISOString();
    const beYear = new Date().getFullYear() + 543;
    const baseSuffix = String(Date.now()).slice(-6);
    const batchId = `BATCH-${beYear}-${baseSuffix}`;
    const recordsToSave: IncidentRecord[] = [];

    for (const item of batchItems) {
      const lat = item.lat as number;
      const lng = item.lng as number;
      const coordObj = buildParsedCoordinate(
        lat,
        lng,
        item.coordMatched ? 'latlng' : 'map-pick',
        `${lat}, ${lng}`
      );
      const areaCheck = lookupAreaByLatLng(lat, lng);
      const itemInTargetArea = areaCheck.inTargetArea || Boolean(item.province.trim());
      const count = item.eventCount > 0 ? Math.round(item.eventCount) : 1;

      if (expandByEventCount && count > 1) {
        for (let k = 1; k <= count; k++) {
          const seq = String(recordsToSave.length + 1).padStart(2, '0');
          recordsToSave.push({
            id: `INC-${beYear}-${baseSuffix}-${seq}`,
            occurredAt: item.occurredAt,
            coordinateRaw: `${lat}, ${lng}`,
            lat,
            lng,
            mgrs: coordObj.mgrs,
            utm: coordObj.utm,
            province: item.province.trim(),
            district: item.district.trim(),
            subdistrict: item.subdistrict.trim(),
            inTargetArea: itemInTargetArea,
            category: item.category,
            details: `[จุดที่ ${k}/${count}] ${item.details.trim()}`,
            reporter: reporter.trim(),
            createdAt: nowIso,
            updatedAt: nowIso,
            syncStatus: 'pending',
            sourceSheet: 'local',
            eventCount: 1,
            batchId,
          });
        }
      } else {
        const seq = String(recordsToSave.length + 1).padStart(2, '0');
        recordsToSave.push({
          id: `INC-${beYear}-${baseSuffix}-${seq}`,
          occurredAt: item.occurredAt,
          coordinateRaw: `${lat}, ${lng}`,
          lat,
          lng,
          mgrs: coordObj.mgrs,
          utm: coordObj.utm,
          province: item.province.trim(),
          district: item.district.trim(),
          subdistrict: item.subdistrict.trim(),
          inTargetArea: itemInTargetArea,
          category: item.category,
          details: item.details.trim(),
          reporter: reporter.trim(),
          createdAt: nowIso,
          updatedAt: nowIso,
          syncStatus: 'pending',
          sourceSheet: 'local',
          ...(count > 1 ? { eventCount: count } : {}),
          batchId,
        });
      }
    }

    setSaving(true);
    try {
      let savedRecords: IncidentRecord[];
      if (onSaveIncidentBatch) {
        savedRecords = await onSaveIncidentBatch(recordsToSave);
      } else {
        savedRecords = [];
        for (const rec of recordsToSave) {
          savedRecords.push(await onSaveIncident(rec));
        }
      }
      const syncedCount = savedRecords.filter((r) => r.syncStatus === 'synced').length;
      const failedCount = savedRecords.filter((r) => r.syncStatus === 'failed').length;
      const totalEvents = savedRecords.reduce(
        (sum, r) => sum + (r.eventCount && r.eventCount > 0 ? r.eventCount : 1),
        0
      );
      setBatchResultBanner({
        savedCount: savedRecords.length,
        syncedCount,
        failedCount,
        totalEvents,
      });
      setBatchRawText('');
      setBatchItems([]);
      setActiveItemId(null);
      setBatchHints([]);
      setBatchWarnings([]);
      setBatchReportedTotal(undefined);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setCoordinateRaw('');
    setParsedCoord(null);
    setCoordError('');
    setProvince('');
    setDistrict('');
    setSubdistrict('');
    setInTargetArea(true);
    setAreaAutoNote('');
    setOccurredAt(getCurrentLocalDateTimeInput());
    setCategory(settings.categories[0] || 'อื่นๆ');
    setEventCount(1);
    setDetails('');
    setFormError('');
    setPaperNotice('');
    setMultiOffer(null);
    if (editingIncident) onCancelEdit();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!parsedCoord && !coordinateRaw.trim()) {
      setFormError('กรุณากรอกพิกัด หรือคลิกเลือกตำแหน่งบนแผนที่');
      return;
    }
    if (!occurredAt) {
      setFormError('กรุณาระบุวันที่และเวลาเกิดเหตุ');
      return;
    }
    const todayYmd = getCurrentLocalDateTimeInput().slice(0, 10);
    if (occurredAt.slice(0, 10) > todayYmd) {
      setFormError('ไม่สามารถเลือกวันที่เกิดเหตุในอนาคตได้ (ตามเงื่อนไขของระบบเดิม)');
      return;
    }
    if (!details.trim()) {
      setFormError('กรุณากรอกรายละเอียดเหตุการณ์');
      return;
    }
    if (!reporter.trim()) {
      setFormError('กรุณาระบุชื่อผู้บันทึกเหตุการณ์');
      return;
    }

    const nowIso = new Date().toISOString();
    const recordId =
      editingIncident?.id ||
      `INC-${new Date().getFullYear() + 543}-${String(Date.now()).slice(-6)}`;

    const normalizedCount = eventCount > 0 ? Math.round(eventCount) : 1;
    const record: IncidentRecord = {
      id: recordId,
      occurredAt,
      coordinateRaw: coordinateRaw.trim(),
      lat: parsedCoord?.lat ?? null,
      lng: parsedCoord?.lng ?? null,
      mgrs: parsedCoord?.mgrs ?? '-',
      utm: parsedCoord?.utm ?? '-',
      province: province.trim(),
      district: district.trim(),
      subdistrict: subdistrict.trim(),
      inTargetArea,
      category,
      details: details.trim(),
      reporter: reporter.trim(),
      createdAt: editingIncident?.createdAt || nowIso,
      updatedAt: nowIso,
      syncStatus: 'pending',
      sourceSheet: editingIncident?.sourceSheet || 'local',
      legacyRowNumber: editingIncident?.legacyRowNumber,
      ...(normalizedCount > 1 ? { eventCount: normalizedCount } : {}),
      ...(editingIncident?.batchId ? { batchId: editingIncident.batchId } : {}),
    };

    setSaving(true);
    try {
      await onSaveIncident(record);
      if (!editingIncident) {
        // Keep reporter name for rapid successive entries
        setCoordinateRaw('');
        setParsedCoord(null);
        setCoordError('');
        setProvince('');
        setDistrict('');
        setSubdistrict('');
        setAreaAutoNote('');
        setEventCount(1);
        setDetails('');
        setPaperNotice('');
        setMultiOffer(null);
        setOccurredAt(getCurrentLocalDateTimeInput());
      } else {
        onCancelEdit();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleExtractWatch = () => {
    setWatchError('');
    setWatchSuccessBanner('');
    if (!watchRawText.trim()) {
      setWatchError('กรุณาวางข้อความข่าวกรอง / พื้นที่เฝ้าระวังก่อนกดสกัดข้อมูล');
      return;
    }
    const parsed = extractWatchAdvisory(watchRawText);
    if (parsed.reportedAt) setWatchReportedAt(parsed.reportedAt);
    if (parsed.watchStart) setWatchStart(parsed.watchStart);
    if (parsed.watchEnd) setWatchEnd(parsed.watchEnd);
    setWatchThreatType(parsed.threatType);
    setWatchAlertLevel(parsed.alertLevel);
    setWatchAreas(parsed.areas);
    setWatchHints(parsed.matchedHints);
    if (parsed.areas.length === 0) {
      setWatchError('ยังไม่พบชื่ออำเภอเฝ้าระวังในข้อความ กรุณาเลือกเพิ่มอำเภอด้วยตนเองด้านล่าง');
    }
  };

  const watchAddDistrictOptions = useMemo(
    () => (watchAddProv ? getDistrictsByProvince(watchAddProv) : []),
    [watchAddProv]
  );

  const handleAddWatchArea = () => {
    if (!watchAddProv || !watchAddDist) return;
    const exists = watchAreas.some(
      (a) => a.province === watchAddProv && a.district === watchAddDist
    );
    if (exists) return;
    setWatchAreas((prev) => [...prev, { province: watchAddProv, district: watchAddDist }]);
    setWatchError('');
  };

  const handleRemoveWatchArea = (prov: string, dist: string, sub?: string) => {
    setWatchAreas((prev) =>
      prev.filter(
        (a) =>
          !(
            a.province === prov &&
            a.district === dist &&
            (a.subdistrict || '') === (sub || '')
          )
      )
    );
  };

  const handleResetWatch = () => {
    setEditingWatchId(null);
    setWatchRawText('');
    setWatchReportedAt(todayDateDefault);
    setWatchStart(todayDateDefault);
    setWatchEnd(todayDateDefault);
    setWatchThreatType('ความเคลื่อนไหวกลุ่มผู้ก่อเหตุรุนแรง');
    setWatchAlertLevel('high');
    setWatchAreas([]);
    setWatchHints([]);
    setWatchError('');
    setWatchSuccessBanner('');
  };

  const handleEditWatchAlert = (w: WatchAlertRecord) => {
    setEditingWatchId(w.id);
    setWatchRawText(w.details);
    setWatchReportedAt(w.reportedAt || todayDateDefault);
    setWatchStart(w.watchStart || w.reportedAt || todayDateDefault);
    setWatchEnd(w.watchEnd || w.watchStart || w.reportedAt || todayDateDefault);
    setWatchThreatType(w.threatType);
    setWatchAlertLevel(w.alertLevel);
    setWatchAreas(w.areas);
    setWatchHints([`กำลังแก้ไขข่าวเฝ้าระวัง ${w.id}`]);
    setWatchError('');
    setWatchSuccessBanner('');
    document.getElementById('watch-raw-input')?.focus();
  };

  const handleRegeocodeAndAuditWatch = async () => {
    setWatchError('');
    setWatchSuccessBanner('');
    setRegeocodingWatch(true);
    try {
      let sourceIncidents = incidents;
      let sourceWatches = watchAlerts;

      const hasGasUrl = Boolean((settings.gasFetchUrl || settings.gasWebhookUrl).trim());
      if (onPullFromGas && hasGasUrl) {
        const pullRes = await onPullFromGas();
        if (!pullRes.ok) {
          setWatchError(
            `ดึงข้อมูลจากระบบเดิมไม่สำเร็จ: ${pullRes.message} (ดำเนินการตรวจสอบจากข้อมูลในเครื่องแทน)`
          );
        } else {
          const incMap = new Map(sourceIncidents.map((i) => [i.id, i]));
          for (const r of pullRes.records) incMap.set(r.id, r);
          sourceIncidents = Array.from(incMap.values());

          const watchMap = new Map(sourceWatches.map((w) => [w.id, w]));
          for (const w of pullRes.watchAlerts || []) watchMap.set(w.id, w);
          sourceWatches = Array.from(watchMap.values());
        }
      }

      const watchToSaveMap = new Map<string, WatchAlertRecord>();
      let updatedWatchCount = 0;

      const workingWatches = sourceWatches.map((w) => {
        const reparsed = reparseWatchAlert(w);
        if (reparsed.updated !== w) {
          updatedWatchCount++;
          watchToSaveMap.set(reparsed.updated.id, reparsed.updated);
        }
        return reparsed.updated;
      });

      const existingIds = new Set(workingWatches.map((w) => w.id));
      const existingPrefixes = workingWatches
        .map((w) => (w.details || '').trim().slice(0, 40))
        .filter((p) => p.length >= 12);

      const incidentsToUpdate: IncidentRecord[] = [];
      let promotedLegacyCount = 0;
      const nowIso = new Date().toISOString();

      for (const item of sourceIncidents) {
        if (!isWatchAdvisoryCategory(item.category)) continue;
        const parsed = extractWatchAdvisory(item.details);
        const targetArea = parsed.areas[0];

        if (targetArea) {
          const areaMatches =
            item.province === targetArea.province &&
            (!targetArea.district || item.district === targetArea.district) &&
            (!targetArea.subdistrict || item.subdistrict === targetArea.subdistrict);
          if (item.lat === null || item.lng === null || !areaMatches) {
            const center = getCenterOfArea(
              targetArea.province,
              targetArea.district || undefined,
              targetArea.subdistrict || undefined
            );
            if (center) {
              const coord = buildParsedCoordinate(
                center.lat,
                center.lng,
                'map-pick',
                `${center.lat}, ${center.lng}`
              );
              incidentsToUpdate.push({
                ...item,
                province: targetArea.province,
                district: targetArea.district,
                subdistrict: targetArea.subdistrict || '',
                inTargetArea: true,
                lat: coord.lat,
                lng: coord.lng,
                mgrs: coord.mgrs,
                utm: coord.utm,
                coordinateRaw: `${coord.lat}, ${coord.lng}`,
              });
            }
          }
        }

        const histId = `WATCH-HIST-${item.id}`;
        const prefix = (item.details || '').trim().slice(0, 40);
        const alreadyCovered =
          existingIds.has(histId) ||
          existingIds.has(item.id) ||
          (prefix.length >= 12 && existingPrefixes.includes(prefix));

        const watchAreasList =
          parsed.areas.length > 0
            ? parsed.areas
            : item.province
              ? [{ province: item.province, district: item.district || '' }]
              : [];

        if (!alreadyCovered && watchAreasList.length > 0) {
          const dateStr = (item.occurredAt || '').slice(0, 10);
          const repDate = parsed.reportedAt || dateStr;
          const wStart = parsed.watchStart || repDate;
          const wEnd = parsed.watchEnd || wStart;
          const promoted: WatchAlertRecord = {
            id: histId,
            reportedAt: repDate,
            watchStart: wStart,
            watchEnd: wEnd,
            areas: watchAreasList,
            threatType: parsed.threatType,
            alertLevel: parsed.alertLevel,
            details: item.details,
            reporter: item.reporter || '-',
            createdAt: item.createdAt || nowIso,
            updatedAt: nowIso,
            syncStatus: 'pending',
          };
          watchToSaveMap.set(promoted.id, promoted);
          workingWatches.push(promoted);
          existingIds.add(promoted.id);
          if (prefix.length >= 12) existingPrefixes.push(prefix);
          promotedLegacyCount++;
        }
      }

      const watchToSave = Array.from(watchToSaveMap.values());
      if (watchToSave.length > 0) {
        if (onSaveWatchAlertsBatch) {
          const savedList = await onSaveWatchAlertsBatch(watchToSave);
          for (const s of savedList) {
            const idx = workingWatches.findIndex((w) => w.id === s.id);
            if (idx >= 0) workingWatches[idx] = s;
          }
        } else if (onSaveWatchAlert) {
          for (const w of watchToSave) {
            const s = await onSaveWatchAlert(w);
            const idx = workingWatches.findIndex((item) => item.id === s.id);
            if (idx >= 0) workingWatches[idx] = s;
          }
        }
      }

      if (incidentsToUpdate.length > 0 && onQuickUpdateIncidentBatch) {
        await onQuickUpdateIncidentBatch(incidentsToUpdate);
      }

      const auditResults = auditWatchAlerts(workingWatches);
      const auditMap = new Map(auditResults.map((r) => [r.id, r]));
      const activeAlerts = workingWatches.filter(
        (w) => auditMap.get(w.id)?.status === 'active'
      );
      const flagged = workingWatches
        .map((alert) => ({ alert, result: auditMap.get(alert.id)! }))
        .filter(({ result }) =>
          result.issues.some((iss) => iss.severity === 'error' || iss.severity === 'warn')
        );

      setWatchAuditReport({
        checkedCount: workingWatches.length,
        updatedWatchCount,
        promotedLegacyCount,
        updatedIncidentCount: incidentsToUpdate.length,
        activeAlerts,
        flagged,
      });
    } finally {
      setRegeocodingWatch(false);
    }
  };

  const handleSubmitWatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setWatchError('');
    setWatchSuccessBanner('');
    if (!onSaveWatchAlert) return;

    if (watchAreas.length === 0) {
      setWatchError('กรุณาระบุพื้นที่อำเภอเฝ้าระวังอย่างน้อย 1 อำเภอ');
      return;
    }
    if (!watchRawText.trim()) {
      setWatchError('กรุณากรอกรายละเอียดข่าวแจ้งเตือน / พื้นที่เฝ้าระวัง');
      return;
    }
    if (!reporter.trim()) {
      setWatchError('กรุณาระบุชื่อผู้บันทึกข่าวกรอง');
      return;
    }

    const nowIso = new Date().toISOString();
    const existingWatch = editingWatchId
      ? watchAlerts.find((w) => w.id === editingWatchId)
      : undefined;
    const record: WatchAlertRecord = {
      id:
        editingWatchId ||
        `WATCH-${new Date().getFullYear() + 543}-${String(Date.now()).slice(-6)}`,
      reportedAt: watchReportedAt || todayDateDefault,
      watchStart: watchStart || watchReportedAt || todayDateDefault,
      watchEnd: watchEnd || watchStart || watchReportedAt || todayDateDefault,
      areas: watchAreas,
      threatType: watchThreatType.trim() || 'ความเคลื่อนไหวกลุ่มผู้ก่อเหตุรุนแรง',
      alertLevel: watchAlertLevel,
      details: watchRawText.trim(),
      reporter: reporter.trim(),
      createdAt: existingWatch?.createdAt || nowIso,
      updatedAt: nowIso,
      syncStatus: 'pending',
    };

    setSaving(true);
    try {
      const saved = await onSaveWatchAlert(record);
      setWatchSuccessBanner(
        saved.syncStatus === 'synced'
          ? `${editingWatchId ? 'อัปเดต' : 'บันทึก'}พื้นที่เฝ้าระวัง ${saved.id} (${saved.areas.length} พื้นที่) และซิงก์เข้าแท็บแยกแล้ว`
          : `${editingWatchId ? 'อัปเดต' : 'บันทึก'}พื้นที่เฝ้าระวัง ${saved.id} (${saved.areas.length} พื้นที่) ลงเครื่องเรียบร้อย (ไม่นับปนกับสถิติเหตุจริง)`
      );
      setEditingWatchId(null);
      setWatchRawText('');
      setWatchAreas([]);
      setWatchHints([]);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyText = async (mode: 'line' | 'paper') => {
    if (!lastSavedRecord) return;
    const text =
      mode === 'line'
        ? formatIncidentForLine(lastSavedRecord)
        : formatIncidentForPaper(lastSavedRecord, true);
    await navigator.clipboard.writeText(text);
    setCopiedType(mode);
    window.setTimeout(() => setCopiedType(null), 2000);
  };

  return (
    <section aria-labelledby="entry-heading" className="page-section">
      <div className="section-header-row">
        <div>
          <h2 id="entry-heading" className="section-title">
            {editingIncident
              ? `แก้ไขเหตุการณ์ (${editingIncident.id})`
              : 'บันทึกเหตุการณ์และจับพิกัดอัตโนมัติ'}
          </h2>
          <p className="section-subtitle">
            {entryMode === 'batch'
              ? 'โหมดหลายพื้นที่: วางรายงานสรุปเหตุการณ์หลายอำเภอ/หลายจุด สกัดอัตโนมัติ แก้ไขรายจุด และบันทึกเป็นชุดพร้อมกัน'
              : entryMode === 'watch'
                ? 'โหมดแจ้งเตือน & พื้นที่เฝ้าระวัง: บันทึกข่าวกรองเตรียมก่อเหตุ แสดงเขตระบายสีบนแผนที่โดยไม่นำไปบวกปนกับสถิติเหตุจริง'
                : 'ฟอร์มกระชับเน้นกรอกเร็ว: กรอกหรือวางพิกัดได้ทุกรูปแบบ ระบบจะปักหมุดและระบุ จว./อ./ต. ให้อัตโนมัติ'}
          </p>
        </div>
        {editingIncident && (
          <button type="button" className="btn btn-outline" onClick={resetForm}>
            ยกเลิกการแก้ไข
          </button>
        )}
      </div>

      {newsDraft && !editingIncident && (
        <div className="inline-alert info" style={{ justifyContent: 'space-between', marginBottom: '0.85rem' }} role="status">
          <span>
            นำเข้าข้อมูลข่าวจาก <strong>{newsDraft.sourceName}</strong> เรียบร้อย — ตรวจสอบพื้นที่/ปักหมุดเพิ่มเติมแล้วกดบันทึกได้ทันที
          </span>
          {onClearNewsDraft && (
            <button type="button" className="btn-xs btn-outline" onClick={onClearNewsDraft}>
              ปิดแถบ
            </button>
          )}
        </div>
      )}

      {!editingIncident && (
        <div className="entry-mode-tabs" role="tablist" aria-label="รูปแบบการบันทึกเหตุการณ์">
          <button
            type="button"
            role="tab"
            aria-selected={entryMode === 'single'}
            className={`entry-mode-tab ${entryMode === 'single' ? 'active' : ''}`}
            onClick={() => setEntryMode('single')}
          >
            <MapPin size={16} aria-hidden="true" />
            <span>บันทึกเหตุการณ์เดี่ยว</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={entryMode === 'batch'}
            className={`entry-mode-tab ${entryMode === 'batch' ? 'active' : ''}`}
            onClick={() => setEntryMode('batch')}
          >
            <Layers size={16} aria-hidden="true" />
            <span>
              บันทึกหลายพื้นที่ / รายงานรวม
              {batchItems.length > 0 ? ` (${batchItems.length} จุด • ${batchTotalEvents} เหตุการณ์)` : ''}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={entryMode === 'watch'}
            className={`entry-mode-tab ${entryMode === 'watch' ? 'active' : ''}`}
            onClick={() => setEntryMode('watch')}
          >
            <ShieldAlert size={16} aria-hidden="true" />
            <span>
              ข่าวแจ้งเตือน / พื้นที่เฝ้าระวัง
              {watchAlerts.length > 0 ? ` (${watchAlerts.length})` : ''}
            </span>
          </button>
        </div>
      )}

      <div className="entry-grid">
        {/* Left: Single Form OR Multi-Area Batch Form */}
        {entryMode === 'single' ? (
          <form onSubmit={handleSubmit} className="gov-card form-card" noValidate>
            {/* Field 1: Coordinate Auto-Parser */}
            <div className="form-group">
              <div className="label-row">
                <label htmlFor="coord-input" className="form-label required">
                  1. พิกัดเกิดเหตุ (จับพิกัดอัตโนมัติ)
                </label>
                <button
                  type="button"
                  className="btn-link-inline"
                  onClick={handleUseCurrentGps}
                  title="ใช้พิกัด GPS ปัจจุบันของอุปกรณ์"
                >
                  <LocateFixed size={14} aria-hidden="true" />
                  <span>ใช้ GPS ปัจจุบัน</span>
                </button>
              </div>
              <input
                id="coord-input"
                type="text"
                className="form-input"
                value={coordinateRaw}
                onChange={(e) => handleCoordinateChange(e.target.value)}
                placeholder="วาง Lat/Lng, MGRS (47N QH ...), UTM (47N ...), DMS หรือลิงก์ Google Maps"
                autoComplete="off"
              />
              <p className="field-hint">
                ตัวอย่าง: <code>6.0462, 101.2015</code> หรือ <code>47N QH 43764 68514</code> หรือลิงก์ Google Maps
              </p>

              {coordError && (
                <div className="inline-alert warn" role="alert">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>{coordError}</span>
                </div>
              )}

              {parsedCoord && (
                <div className="coord-readout" aria-live="polite">
                  <div className="coord-badge-row">
                    <span className="badge badge-info">ตรวจพบ: {FORMAT_LABELS[parsedCoord.format]}</span>
                    <span className={`badge ${inTargetArea ? 'badge-success' : 'badge-warn'}`}>
                      {inTargetArea ? 'อยู่ในพื้นที่ 3 จว. + 4 อ.สงขลา' : 'อยู่นอกเขตพื้นที่หลัก'}
                    </span>
                  </div>
                  <div className="coord-grid-values">
                    <div>
                      <span className="meta-label">Lat / Lng:</span>{' '}
                      <strong>
                        {parsedCoord.lat}, {parsedCoord.lng}
                      </strong>
                    </div>
                    <div>
                      <span className="meta-label">MGRS:</span> <strong>{parsedCoord.mgrs}</strong>
                    </div>
                    <div>
                      <span className="meta-label">UTM:</span> <strong>{parsedCoord.utm}</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Field 2: Area (Auto-detected Province / District / Subdistrict) */}
            <div className="form-group">
              <div className="label-row">
                <span className="form-label">2. พื้นที่เกิดเหตุ (ระบุอัตโนมัติจากพิกัด / แก้ไขได้)</span>
                {province && (
                  <button
                    type="button"
                    className="btn-link-inline"
                    onClick={handleJumpToSelectedArea}
                    title="ปักหมุดกึ่งกลางพื้นที่ที่เลือกบนแผนที่"
                  >
                    <Crosshair size={14} aria-hidden="true" />
                    <span>เลื่อนหมุดมาที่พื้นที่นี้</span>
                  </button>
                )}
              </div>
              <div className="area-select-grid">
                <div>
                  <label htmlFor="province-select" className="sub-label">
                    จังหวัด
                  </label>
                  <select
                    id="province-select"
                    className="form-select"
                    value={provinces.includes(province) ? province : province ? '__other__' : ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '__other__') return;
                      setProvince(val);
                      setDistrict('');
                      setSubdistrict('');
                      setInTargetArea(Boolean(val));
                    }}
                  >
                    <option value="">-- เลือกจังหวัด --</option>
                    {provinces.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                    {province && !provinces.includes(province) && (
                      <option value="__other__">{province} (นอกเขต)</option>
                    )}
                  </select>
                </div>
                <div>
                  <label htmlFor="district-select" className="sub-label">
                    อำเภอ
                  </label>
                  {districts.length > 0 ? (
                    <select
                      id="district-select"
                      className="form-select"
                      value={district}
                      onChange={(e) => {
                        setDistrict(e.target.value);
                        setSubdistrict('');
                      }}
                    >
                      <option value="">-- เลือกอำเภอ --</option>
                      {districts.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="district-select"
                      type="text"
                      className="form-input"
                      value={district}
                      onChange={(e) => setDistrict(e.target.value)}
                      placeholder="ระบุอำเภอ"
                    />
                  )}
                </div>
                <div>
                  <label htmlFor="subdistrict-select" className="sub-label">
                    ตำบล
                  </label>
                  {subdistricts.length > 0 ? (
                    <select
                      id="subdistrict-select"
                      className="form-select"
                      value={subdistrict}
                      onChange={(e) => setSubdistrict(e.target.value)}
                    >
                      <option value="">-- เลือกตำบล --</option>
                      {subdistricts.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="subdistrict-select"
                      type="text"
                      className="form-input"
                      value={subdistrict}
                      onChange={(e) => setSubdistrict(e.target.value)}
                      placeholder="ระบุตำบล"
                    />
                  )}
                </div>
              </div>
              {areaAutoNote && (
                <div className={`inline-alert ${inTargetArea ? 'info' : 'warn'}`} aria-live="polite">
                  <MapPin size={15} aria-hidden="true" />
                  <span>{areaAutoNote}</span>
                </div>
              )}
            </div>

            {/* Field 3 & 4: Date-Time (พ.ศ. preview) & Event Category */}
            <div className="two-col-row">
              <div className="form-group">
                <label htmlFor="occurred-at" className="form-label required">
                  3. วันที่และเวลาเกิดเหตุ
                </label>
                <input
                  id="occurred-at"
                  type="datetime-local"
                  className="form-input"
                  value={occurredAt}
                  max={`${getCurrentLocalDateTimeInput().slice(0, 10)}T23:59`}
                  onChange={(e) => setOccurredAt(e.target.value)}
                  required
                />
                <p className="field-hint">
                  แสดงผล พ.ศ.: <strong>{formatThaiDateTime(occurredAt, { shortMonth: false })}</strong>
                </p>
              </div>

              <div className="form-group">
                <label htmlFor="category-select" className="form-label required">
                  4. ประเภทเหตุการณ์
                </label>
                <select
                  id="category-select"
                  className="form-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {settings.categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.45rem' }}>
                  <label htmlFor="event-count-input" className="sub-label" style={{ margin: 0 }}>
                    จำนวนเหตุการณ์:
                  </label>
                  <input
                    id="event-count-input"
                    type="number"
                    min={1}
                    max={99}
                    className="form-input"
                    style={{ width: 76, padding: '0.25rem 0.5rem' }}
                    value={eventCount}
                    onChange={(e) => setEventCount(Math.max(1, Number(e.target.value) || 1))}
                  />
                  <span className="sub-label" style={{ margin: 0 }}>
                    ครั้ง/จุด
                  </span>
                </div>
              </div>
            </div>

            {/* Field 5: Incident Details + Smart Paper Extractor */}
            <div className="form-group">
              <div className="label-row">
                <label htmlFor="details-input" className="form-label required">
                  5. รายละเอียดเหตุการณ์
                </label>
                <button
                  type="button"
                  className="btn-link-inline"
                  onClick={handleExtractFromPaper}
                  title="สกัดวันที่ พื้นที่ ประเภทเหตุการณ์ และพิกัด จากข้อความรายงานสไตล์ Paper ที่วางไว้"
                >
                  <Sparkles size={14} aria-hidden="true" />
                  <span>สกัดข้อมูลจากข้อความ Paper</span>
                </button>
              </div>
              <textarea
                id="details-input"
                className="form-textarea"
                rows={5}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="กรอกรายละเอียดเหตุการณ์ หรือวางข้อความรายงาน Paper (เช่น เมื่อ ๙ พ.ย.๖๙ ... ต.แม่หวาด อ.ธารโต จว.ยะลา ...)"
                required
              />
              {paperNotice && (
                <div className="inline-alert info" aria-live="polite">
                  <Sparkles size={15} aria-hidden="true" />
                  <span>{paperNotice}</span>
                </div>
              )}
              {multiOffer && !editingIncident && (
                <div className="inline-alert info batch-smart-banner" role="region" aria-live="polite">
                  <span>
                    ตรวจพบข้อความรายงานหลายพื้นที่/หลายเหตุการณ์ ({multiOffer.items.length} รายการย่อย รวม{' '}
                    {multiOffer.items.reduce((sum, i) => sum + i.eventCount, 0)} เหตุการณ์)
                  </span>
                  <button
                    type="button"
                    className="btn-xs btn-primary"
                    onClick={handleSwitchToBatchFromSingle}
                  >
                    <Layers size={13} aria-hidden="true" />
                    <span>เปิดในโหมดหลายพื้นที่</span>
                  </button>
                </div>
              )}
            </div>

            {/* Field 6: Reporter */}
            <div className="form-group">
              <label htmlFor="reporter-input" className="form-label required">
                6. ผู้บันทึกเหตุการณ์
              </label>
              <input
                id="reporter-input"
                type="text"
                className="form-input"
                value={reporter}
                onChange={(e) => setReporter(e.target.value)}
                placeholder="ระบุชื่อ-นามสกุล / ตำแหน่ง หรือหน่วยงานผู้บันทึก"
                required
              />
            </div>

            {formError && (
              <div className="inline-alert danger" role="alert">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <Send size={17} aria-hidden="true" />
                <span>
                  {saving
                    ? 'กำลังบันทึกและส่งข้อมูล...'
                    : editingIncident
                      ? 'บันทึกการแก้ไขและซิงก์ระบบเดิม'
                      : settings.gasWebhookUrl && settings.autoSyncOnSave
                        ? 'บันทึกและส่งเข้าระบบเดิม'
                        : 'บันทึกเหตุการณ์ลงเครื่อง'}
                </span>
              </button>
              <button type="button" className="btn btn-outline" onClick={resetForm}>
                <RotateCcw size={16} aria-hidden="true" />
                <span>ล้างฟอร์ม</span>
              </button>
            </div>
          </form>
        ) : entryMode === 'batch' ? (
          <form onSubmit={handleSubmitBatch} className="gov-card form-card" noValidate>
            <div className="form-group">
              <div className="label-row">
                <label htmlFor="batch-raw-input" className="form-label required">
                  1. วางข้อความรายงานรวมหลายพื้นที่ / หลายอำเภอ (สไตล์ Paper)
                </label>
              </div>
              <textarea
                id="batch-raw-input"
                className="form-textarea"
                rows={6}
                value={batchRawText}
                onChange={(e) => setBatchRawText(e.target.value)}
                placeholder="วางข้อความรายงานที่มีหลายข้อย่อย เช่น ๑.๑ เมื่อ ๑๕ มี.ค.๖๘, ๐๔๐๐ - ๐๕๓๐ เกิดเหตุในพื้นที่ จว.ปัตตานี จำนวน ๕ จุด ดังนี้ ๑.๑.๑ อ.ยะรัง ... ๑.๑.๒ อ.สายบุรี ..."
              />
              <div className="form-actions" style={{ marginTop: '0.6rem' }}>
                <button type="button" className="btn btn-primary" onClick={handleExtractBatch}>
                  <Sparkles size={16} aria-hidden="true" />
                  <span>สกัดจุดเกิดเหตุทั้งหมดอัตโนมัติ</span>
                </button>
                <button type="button" className="btn btn-outline" onClick={handleAddBatchItem}>
                  <Plus size={16} aria-hidden="true" />
                  <span>เพิ่มพื้นที่/จุดย่อย</span>
                </button>
              </div>
            </div>

            {batchHints.length > 0 && (
              <div className="inline-alert info" aria-live="polite">
                <Sparkles size={15} aria-hidden="true" />
                <span>{batchHints.join(' • ')}</span>
              </div>
            )}

            {batchWarnings.map((w, idx) => (
              <div key={idx} className="inline-alert warn" role="status">
                <AlertTriangle size={15} aria-hidden="true" />
                <span>{w}</span>
              </div>
            ))}

            {batchItems.length > 0 && (
              <>
                <div className="batch-summary-bar">
                  <div>
                    <strong>
                      แยกได้ {batchItems.length} รายการย่อย • รวม {batchTotalEvents} เหตุการณ์
                    </strong>
                    {batchReportedTotal !== undefined && (
                      <span
                        className={`badge ${
                          batchTotalEvents === batchReportedTotal ? 'badge-success' : 'badge-warn'
                        }`}
                        style={{ marginLeft: 8 }}
                      >
                        {batchTotalEvents === batchReportedTotal
                          ? `ครบตามหัวข้อ (${batchReportedTotal})`
                          : `หัวข้อระบุ ${batchReportedTotal}`}
                      </span>
                    )}
                    {batchProvinceBreakdown.length > 0 && (
                      <span style={{ display: 'inline-flex', gap: '0.35rem', flexWrap: 'wrap', marginLeft: 8 }}>
                        {batchProvinceBreakdown.map(([prov, count]) => (
                          <span key={prov} className="badge badge-info">
                            จว.{prov} {count}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                  <label className="checkbox-inline" style={{ fontSize: '0.84rem' }}>
                    <input
                      type="checkbox"
                      checked={expandByEventCount}
                      onChange={(e) => setExpandByEventCount(e.target.checked)}
                    />
                    <span>แตกแถวตามจำนวนเหตุการณ์ย่อย (สำหรับปักพิกัดทีละจุด)</span>
                  </label>
                </div>

                <div className="batch-items-list">
                  {batchItems.map((item, idx) => {
                    const isActive = item.id === activeBatchItem?.id;
                    const itemDistricts = item.province ? getDistrictsByProvince(item.province) : [];
                    const itemSubdistricts =
                      item.province && item.district
                        ? getSubdistrictsByDistrict(item.province, item.district)
                        : [];

                    return (
                      <div
                        key={item.id}
                        className={`batch-item-card ${isActive ? 'active' : ''}`}
                        onClick={() => setActiveItemId(item.id)}
                      >
                        <div className="batch-item-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                            <strong>#{idx + 1}</strong>
                            <span className="badge badge-info">
                              {[
                                item.subdistrict ? `ต.${item.subdistrict}` : '',
                                item.district ? `อ.${item.district}` : '',
                                item.province ? `จว.${item.province}` : '',
                              ]
                                .filter(Boolean)
                                .join(' ') || 'ยังไม่ระบุพื้นที่'}
                            </span>
                            <span
                              className={`badge ${
                                item.coordMatched
                                  ? 'badge-success'
                                  : item.lat !== null
                                    ? 'badge-warn'
                                    : 'badge-danger'
                              }`}
                            >
                              {item.coordMatched
                                ? 'พิกัดเฉพาะจุด'
                                : item.lat !== null
                                  ? item.subdistrict
                                    ? 'กึ่งกลางตำบล'
                                    : item.district
                                      ? 'กึ่งกลางอำเภอ'
                                      : 'กึ่งกลางจังหวัด'
                                  : 'รอพิกัด'}
                            </span>
                          </div>

                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <label htmlFor={`count-${item.id}`} className="sub-label" style={{ margin: 0 }}>
                              จำนวน
                            </label>
                            <input
                              id={`count-${item.id}`}
                              type="number"
                              min={1}
                              max={99}
                              className="form-input"
                              style={{ width: 64, padding: '0.2rem 0.45rem' }}
                              value={item.eventCount}
                              onChange={(e) =>
                                handleUpdateBatchItem(item.id, {
                                  eventCount: Math.max(1, Number(e.target.value) || 1),
                                })
                              }
                            />
                            {item.province && (
                              <button
                                type="button"
                                className="btn-xs btn-outline"
                                onClick={() => handleJumpBatchItemCenter(item)}
                                title="ปักหมุดกึ่งกลางพื้นที่นี้"
                              >
                                <Crosshair size={13} aria-hidden="true" />
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn-xs btn-outline btn-danger-outline"
                              onClick={() => handleRemoveBatchItem(item.id)}
                              aria-label={`ลบรายการ #${idx + 1}`}
                              title="ลบรายการย่อยนี้"
                            >
                              <Trash2 size={13} aria-hidden="true" />
                            </button>
                          </div>
                        </div>

                        <div className="batch-item-grid" onClick={(e) => e.stopPropagation()}>
                          <div>
                            <label htmlFor={`dt-${item.id}`} className="sub-label">
                              วัน-เวลาเกิดเหตุ
                            </label>
                            <input
                              id={`dt-${item.id}`}
                              type="datetime-local"
                              className="form-input"
                              value={item.occurredAt}
                              onChange={(e) =>
                                handleUpdateBatchItem(item.id, { occurredAt: e.target.value })
                              }
                            />
                          </div>
                          <div>
                            <label htmlFor={`cat-${item.id}`} className="sub-label">
                              ประเภทเหตุการณ์
                            </label>
                            <select
                              id={`cat-${item.id}`}
                              className="form-select"
                              value={item.category}
                              onChange={(e) =>
                                handleUpdateBatchItem(item.id, { category: e.target.value })
                              }
                            >
                              {settings.categories.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`prov-${item.id}`} className="sub-label">
                              จังหวัด
                            </label>
                            <select
                              id={`prov-${item.id}`}
                              className="form-select"
                              value={provinces.includes(item.province) ? item.province : ''}
                              onChange={(e) => {
                                const nextProv = e.target.value;
                                const center = nextProv ? getCenterOfArea(nextProv) : null;
                                handleUpdateBatchItem(item.id, {
                                  province: nextProv,
                                  district: '',
                                  subdistrict: '',
                                  ...(center && !item.coordMatched
                                    ? { lat: center.lat, lng: center.lng }
                                    : {}),
                                });
                              }}
                            >
                              <option value="">-- จังหวัด --</option>
                              {provinces.map((p) => (
                                <option key={p} value={p}>
                                  {p === 'สงขลา' ? 'สงขลา (4 อ.)' : p}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`dist-${item.id}`} className="sub-label">
                              อำเภอ
                            </label>
                            {itemDistricts.length > 0 ? (
                              <select
                                id={`dist-${item.id}`}
                                className="form-select"
                                value={itemDistricts.includes(item.district) ? item.district : ''}
                                onChange={(e) => {
                                  const nextDist = e.target.value;
                                  const center = item.province
                                    ? getCenterOfArea(item.province, nextDist || undefined)
                                    : null;
                                  handleUpdateBatchItem(item.id, {
                                    district: nextDist,
                                    subdistrict: '',
                                    ...(center && !item.coordMatched
                                      ? { lat: center.lat, lng: center.lng }
                                      : {}),
                                  });
                                }}
                              >
                                <option value="">-- อำเภอ --</option>
                                {itemDistricts.map((d) => (
                                  <option key={d} value={d}>
                                    {d}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                id={`dist-${item.id}`}
                                type="text"
                                className="form-input"
                                value={item.district}
                                onChange={(e) =>
                                  handleUpdateBatchItem(item.id, { district: e.target.value })
                                }
                                placeholder="อำเภอ"
                              />
                            )}
                          </div>
                          <div>
                            <label htmlFor={`sub-${item.id}`} className="sub-label">
                              ตำบล
                            </label>
                            {itemSubdistricts.length > 0 ? (
                              <select
                                id={`sub-${item.id}`}
                                className="form-select"
                                value={item.subdistrict}
                                onChange={(e) => {
                                  const nextSub = e.target.value;
                                  const center =
                                    item.province && item.district
                                      ? getCenterOfArea(
                                          item.province,
                                          item.district,
                                          nextSub || undefined
                                        )
                                      : null;
                                  handleUpdateBatchItem(item.id, {
                                    subdistrict: nextSub,
                                    ...(center && !item.coordMatched
                                      ? { lat: center.lat, lng: center.lng }
                                      : {}),
                                  });
                                }}
                              >
                                <option value="">-- ตำบล (ถ้ามี) --</option>
                                {itemSubdistricts.map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                id={`sub-${item.id}`}
                                type="text"
                                className="form-input"
                                value={item.subdistrict}
                                onChange={(e) =>
                                  handleUpdateBatchItem(item.id, { subdistrict: e.target.value })
                                }
                                placeholder="ตำบล (ถ้ามี)"
                              />
                            )}
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            flexWrap: 'wrap',
                            marginBottom: '0.5rem',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="cell-sub">
                            พิกัดปัจจุบัน:{' '}
                            <strong>
                              {item.lat !== null && item.lng !== null
                                ? `${item.lat.toFixed(5)}, ${item.lng.toFixed(5)}`
                                : 'ยังไม่ระบุ (คลิกแผนที่)'}
                            </strong>
                          </span>
                          <input
                            type="text"
                            className="form-input"
                            style={{ flex: '1 1 200px', padding: '0.28rem 0.55rem', fontSize: '0.84rem' }}
                            placeholder="วางพิกัดเฉพาะจุด (Lat,Lng / MGRS / Google Maps)"
                            onChange={(e) => handlePasteBatchItemCoord(item.id, e.target.value)}
                          />
                        </div>

                        <div onClick={(e) => e.stopPropagation()}>
                          <label htmlFor={`det-${item.id}`} className="sub-label">
                            รายละเอียดเหตุการณ์จุดที่ #{idx + 1}
                          </label>
                          <textarea
                            id={`det-${item.id}`}
                            className="form-textarea"
                            rows={2}
                            value={item.details}
                            onChange={(e) =>
                              handleUpdateBatchItem(item.id, { details: e.target.value })
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div className="form-group">
              <label htmlFor="batch-reporter-input" className="form-label required">
                ผู้บันทึกเหตุการณ์ (ใช้ร่วมกันทั้งชุด)
              </label>
              <input
                id="batch-reporter-input"
                type="text"
                className="form-input"
                value={reporter}
                onChange={(e) => setReporter(e.target.value)}
                placeholder="ระบุชื่อ-นามสกุล / ตำแหน่ง หรือหน่วยงานผู้บันทึก"
                required
              />
            </div>

            {batchError && (
              <div className="inline-alert danger" role="alert">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{batchError}</span>
              </div>
            )}

            {batchResultBanner && (
              <div className="inline-alert info" aria-live="polite">
                <CheckCircle2 size={16} aria-hidden="true" />
                <span>
                  บันทึกข้อมูลชุดหลายพื้นที่สำเร็จ {batchResultBanner.savedCount} รายการ (รวม{' '}
                  {batchResultBanner.totalEvents} เหตุการณ์)
                  {settings.gasWebhookUrl && settings.autoSyncOnSave
                    ? ` • ซิงก์เข้าระบบเดิมแล้ว ${batchResultBanner.syncedCount} รายการ${
                        batchResultBanner.failedCount > 0
                          ? ` (ไม่สำเร็จ ${batchResultBanner.failedCount} รายการ — กดซิงก์ซ้ำได้ที่หน้าแผนที่และรายการ)`
                          : ''
                      }`
                    : ' (เก็บลงเครื่องเรียบร้อย)'}
                </span>
              </div>
            )}

            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || batchItems.length === 0}
              >
                <Send size={17} aria-hidden="true" />
                <span>
                  {saving
                    ? 'กำลังบันทึกและทยอยส่งเข้าระบบ...'
                    : `บันทึกทั้งหมด (${
                        expandByEventCount ? batchTotalEvents : batchItems.length
                      } แถว / ${batchTotalEvents} เหตุการณ์)`}
                </span>
              </button>
              <button type="button" className="btn btn-outline" onClick={handleResetBatch}>
                <RotateCcw size={16} aria-hidden="true" />
                <span>ล้างชุดข้อมูล</span>
              </button>
            </div>
          </form>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <form onSubmit={handleSubmitWatch} className="gov-card form-card" noValidate>
              <div className="form-group">
                <div className="label-row">
                  <label htmlFor="watch-raw-input" className="form-label required">
                    1. วางข้อความข่าวกรองแจ้งเตือน / พื้นที่เฝ้าระวัง
                  </label>
                </div>
                <textarea
                  id="watch-raw-input"
                  className="form-textarea"
                  rows={5}
                  value={watchRawText}
                  onChange={(e) => setWatchRawText(e.target.value)}
                  placeholder="วางข้อความข่าวกรองแจ้งเตือน เช่น เมื่อ ๕ มี.ค.๖๘ ปรากฏข่าวสารเตรียมก่อเหตุ ... พื้นที่เฝ้าระวัง อ.ยะรัง อ.สายบุรี จว.ปัตตานี ห้วงเฝ้าระวัง ๕ - ๑๖ มี.ค.๖๘"
                />
                <div className="form-actions" style={{ marginTop: '0.6rem' }}>
                  <button type="button" className="btn btn-primary" onClick={handleExtractWatch}>
                    <Sparkles size={16} aria-hidden="true" />
                    <span>สกัดพื้นที่เฝ้าระวังและห้วงเวลาอัตโนมัติ</span>
                  </button>
                </div>
              </div>

              {watchHints.length > 0 && (
                <div className="inline-alert info" aria-live="polite">
                  <Sparkles size={15} aria-hidden="true" />
                  <span>{watchHints.join(' • ')}</span>
                </div>
              )}

              <div className="two-col-row">
                <div className="form-group">
                  <label htmlFor="watch-threat-input" className="form-label required">
                    2. รูปแบบภัยคุกคาม
                  </label>
                  <input
                    id="watch-threat-input"
                    type="text"
                    className="form-input"
                    value={watchThreatType}
                    onChange={(e) => setWatchThreatType(e.target.value)}
                    placeholder="เช่น คาร์บอมบ์ / จยย.บอมบ์ / ลอบยิง"
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="watch-level-select" className="form-label required">
                    3. ระดับการแจ้งเตือน
                  </label>
                  <select
                    id="watch-level-select"
                    className="form-select"
                    value={watchAlertLevel}
                    onChange={(e) => setWatchAlertLevel(e.target.value as WatchAlertLevel)}
                  >
                    <option value="critical">เฝ้าระวังสูงสุด (สีแดง)</option>
                    <option value="high">เฝ้าระวังสูง (สีส้ม)</option>
                    <option value="medium">เฝ้าระวัง (สีเหลือง)</option>
                  </select>
                </div>
              </div>

              <div className="area-select-grid">
                <div className="form-group">
                  <label htmlFor="watch-reported-at" className="sub-label">
                    วันที่ข่าวกรอง
                  </label>
                  <input
                    id="watch-reported-at"
                    type="date"
                    className="form-input"
                    value={watchReportedAt}
                    onChange={(e) => setWatchReportedAt(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="watch-start" className="sub-label">
                    เริ่มเฝ้าระวัง
                  </label>
                  <input
                    id="watch-start"
                    type="date"
                    className="form-input"
                    value={watchStart}
                    onChange={(e) => setWatchStart(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="watch-end" className="sub-label">
                    สิ้นสุดเฝ้าระวัง
                  </label>
                  <input
                    id="watch-end"
                    type="date"
                    className="form-input"
                    value={watchEnd}
                    onChange={(e) => setWatchEnd(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <span className="form-label required">
                  4. เขตอำเภอเฝ้าระวัง ({watchAreas.length} อำเภอ)
                </span>
                {watchAreas.length > 0 ? (
                  <div className="watch-chip-list">
                    {watchAreas.map((a) => {
                      const chipText = [
                        a.subdistrict ? `ต.${a.subdistrict}` : '',
                        a.district ? `อ.${a.district}` : '',
                        a.province ? `จว.${a.province}` : '',
                      ]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <span
                          key={`${a.province}|${a.district}|${a.subdistrict || ''}`}
                          className="watch-chip"
                        >
                          <span>{chipText}</span>
                          <button
                            type="button"
                            className="watch-chip-remove"
                            aria-label={`ลบ ${chipText}`}
                            onClick={() =>
                              handleRemoveWatchArea(a.province, a.district, a.subdistrict)
                            }
                          >
                            <X size={13} aria-hidden="true" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <p className="field-hint">ยังไม่ได้เลือกอำเภอเฝ้าระวัง (กดสกัดจากข้อความหรือเลือกเพิ่มด้านล่าง)</p>
                )}

                <div className="area-select-grid" style={{ marginTop: '0.55rem' }}>
                  <select
                    aria-label="เลือกจังหวัดที่จะเพิ่ม"
                    className="form-select"
                    value={watchAddProv}
                    onChange={(e) => {
                      setWatchAddProv(e.target.value);
                      setWatchAddDist('');
                    }}
                  >
                    {provinces.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="เลือกอำเภอที่จะเพิ่ม"
                    className="form-select"
                    value={watchAddDist}
                    onChange={(e) => setWatchAddDist(e.target.value)}
                  >
                    <option value="">-- เลือกอำเภอเพิ่ม --</option>
                    {watchAddDistrictOptions.map((d) => (
                      <option key={d} value={d}>
                        อ.{d}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={handleAddWatchArea}
                    disabled={!watchAddProv || !watchAddDist}
                  >
                    <Plus size={15} aria-hidden="true" />
                    <span>เพิ่มอำเภอ</span>
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="watch-reporter-input" className="form-label required">
                  5. ผู้บันทึกข่าวแจ้งเตือน
                </label>
                <input
                  id="watch-reporter-input"
                  type="text"
                  className="form-input"
                  value={reporter}
                  onChange={(e) => setReporter(e.target.value)}
                  placeholder="ระบุชื่อ-นามสกุล / ตำแหน่ง หรือหน่วยงานผู้บันทึก"
                  required
                />
              </div>

              {watchError && (
                <div className="inline-alert danger" role="alert">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>{watchError}</span>
                </div>
              )}

              {watchSuccessBanner && (
                <div className="inline-alert info" aria-live="polite">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{watchSuccessBanner}</span>
                </div>
              )}

              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving || watchAreas.length === 0 || !onSaveWatchAlert}
                >
                  <ShieldAlert size={17} aria-hidden="true" />
                  <span>
                    {saving
                      ? 'กำลังบันทึก...'
                      : editingWatchId
                        ? `บันทึกการแก้ไขพื้นที่เฝ้าระวัง (${watchAreas.length} พื้นที่)`
                        : `บันทึกพื้นที่เฝ้าระวัง (${watchAreas.length} พื้นที่ • แยกจากสถิติเหตุจริง)`}
                  </span>
                </button>
                <button type="button" className="btn btn-outline" onClick={handleResetWatch}>
                  <RotateCcw size={16} aria-hidden="true" />
                  <span>{editingWatchId ? 'ยกเลิกการแก้ไข' : 'ล้างข้อมูล'}</span>
                </button>
              </div>
            </form>

            <div className="gov-card">
              <div className="batch-item-header" style={{ marginBottom: '0.5rem' }}>
                <div>
                  <h3 className="card-title" style={{ marginBottom: 2 }}>
                    ตรวจสอบข่าวเฝ้าระวังเก่า &amp; จับพิกัด/ห้วงเวลาใหม่
                  </h3>
                  <p className="cell-sub" style={{ margin: 0 }}>
                    ดึงข่าวเก่าจาก GAS + ข่าวความเคลื่อนไหวในระบบ มาสกัดอำเภอ/จังหวัดและตรวจห้วงเฝ้าระวังให้ตรง
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={regeocodingWatch}
                  onClick={() => void handleRegeocodeAndAuditWatch()}
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  <span>
                    {regeocodingWatch
                      ? 'กำลังดึงและตรวจข้อมูล...'
                      : 'ดึงข่าวเก่ามาจับพิกัดใหม่ & ตรวจห้วงเฝ้าระวัง'}
                  </span>
                </button>
              </div>

              {watchAuditReport && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.5rem' }}>
                  <div className="inline-alert info">
                    <CheckCircle2 size={16} aria-hidden="true" />
                    <span>
                      ตรวจข่าวเฝ้าระวังแล้ว {watchAuditReport.checkedCount} รายการ • ปรับปรุงพื้นที่/ห้วง{' '}
                      {watchAuditReport.updatedWatchCount} รายการ • นำเข้าจากข่าวเก่า{' '}
                      {watchAuditReport.promotedLegacyCount} รายการ • อัปเดตพิกัดหมุด{' '}
                      {watchAuditReport.updatedIncidentCount} จุด
                    </span>
                  </div>

                  <div className="inline-alert info" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.35rem' }}>
                    <strong>
                      ห้วงเฝ้าระวังที่กำลัง Active วันนี้ ({watchAuditReport.activeAlerts.length} ข่าว):
                    </strong>
                    {watchAuditReport.activeAlerts.length === 0 ? (
                      <span className="cell-sub">ไม่มีข่าวเฝ้าระวังที่อยู่ในห้วงเวลาวันนี้</span>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: '1.15rem', fontSize: '0.86rem' }}>
                        {watchAuditReport.activeAlerts.map((w) => (
                          <li key={w.id}>
                            <strong>{w.threatType}</strong> •{' '}
                            {formatWatchAreasSummary(w.areas) || 'ยังไม่ระบุพื้นที่'} (
                            {formatThaiDateTime(w.watchStart, { includeTime: false })} –{' '}
                            {formatThaiDateTime(w.watchEnd, { includeTime: false })})
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {watchAuditReport.flagged.length > 0 ? (
                    <div className="inline-alert warn" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.45rem' }}>
                      <strong>
                        พบจุดที่ควรตรวจสอบห้วงเวลา/พื้นที่ ({watchAuditReport.flagged.length} รายการ):
                      </strong>
                      {watchAuditReport.flagged.map(({ alert, result }) => (
                        <div
                          key={alert.id}
                          style={{
                            width: '100%',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: '0.5rem',
                            paddingTop: '0.35rem',
                            borderTop: '1px solid rgba(180, 83, 9, 0.2)',
                          }}
                        >
                          <div style={{ fontSize: '0.84rem' }}>
                            <div>
                              <strong>{alert.threatType}</strong> ({alert.id}) •{' '}
                              {formatWatchAreasSummary(alert.areas) || 'ไม่มีพื้นที่'}
                            </div>
                            <div className="cell-sub">
                              {result.issues
                                .filter((i) => i.severity !== 'info')
                                .map((i) => i.message)
                                .join(' | ')}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn-xs btn-outline"
                            onClick={() => handleEditWatchAlert(alert)}
                          >
                            <Pencil size={12} aria-hidden="true" />
                            <span>แก้ไข</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="inline-alert info">
                      <CheckCircle2 size={15} aria-hidden="true" />
                      <span>ไม่พบความผิดปกติของห้วงเวลาหรือพื้นที่เฝ้าระวัง</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {watchAlerts.length > 0 && (
              <div className="gov-card">
                <h3 className="card-title">
                  รายการข่าวแจ้งเตือน / พื้นที่เฝ้าระวังที่บันทึกไว้ ({watchAlerts.length})
                </h3>
                <div className="watch-saved-list">
                  {watchAlerts.map((w) => {
                    const status = isWatchAlertActive(w);
                    return (
                      <div key={w.id} className={`watch-alert-card ${w.alertLevel}`}>
                        <div className="batch-item-header">
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <strong>{w.threatType}</strong>
                            <span
                              className={`badge ${
                                status === 'active'
                                  ? 'badge-danger'
                                  : status === 'upcoming'
                                    ? 'badge-warn'
                                    : 'badge-info'
                              }`}
                            >
                              {status === 'active'
                                ? 'กำลังเฝ้าระวัง'
                                : status === 'upcoming'
                                  ? 'รอเริ่มห้วง'
                                  : 'พ้นห้วงแล้ว'}
                            </span>
                            <span className="cell-sub">
                              {formatThaiDateTime(w.watchStart, { includeTime: false })} –{' '}
                              {formatThaiDateTime(w.watchEnd, { includeTime: false })}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                            <button
                              type="button"
                              className="btn-xs btn-outline"
                              onClick={() => handleEditWatchAlert(w)}
                              aria-label={`แก้ไข ${w.id}`}
                              title="แก้ไขข่าวเฝ้าระวังนี้"
                            >
                              <Pencil size={13} aria-hidden="true" />
                            </button>
                            {onDeleteWatchAlert && (
                              <button
                                type="button"
                                className="btn-xs btn-outline btn-danger-outline"
                                onClick={() => {
                                  if (window.confirm(`ต้องการลบข่าวเฝ้าระวัง ${w.id} ใช่หรือไม่?`)) {
                                    void onDeleteWatchAlert(w.id);
                                  }
                                }}
                                aria-label={`ลบ ${w.id}`}
                              >
                                <Trash2 size={13} aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="cell-area" style={{ marginBottom: 4 }}>
                          พื้นที่ ({w.areas.length} อำเภอ):{' '}
                          {formatWatchAreasSummary(w.areas)}
                        </div>
                        <div className="details-clamp" title={w.details}>
                          {w.details}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Right: Live Auto-Pin Map + Last Saved Briefing Card */}
        <div className="entry-side-col">
          <div className="gov-card map-card">
            <div className="card-header-row">
              <div>
                <h3 className="card-title">
                  {entryMode === 'watch' ? 'แผนที่เขตอำเภอเฝ้าระวัง' : 'แผนที่ตรวจสอบพิกัดอัตโนมัติ'}
                </h3>
                <p className="card-subtitle">
                  {entryMode === 'watch'
                    ? watchAreas.length > 0
                      ? `กำลังระบายสีเขตเฝ้าระวัง ${watchAreas.length} อำเภอ`
                      : 'วางข้อความข่าวกรองหรือเลือกอำเภอเพื่อดูพื้นที่ระบายสีบนแผนที่'
                    : entryMode === 'batch'
                      ? activeBatchItem
                        ? `กำลังปรับหมุดรายการ #${batchItems.findIndex((i) => i.id === activeBatchItem.id) + 1} (${
                            activeBatchItem.district
                              ? `อ.${activeBatchItem.district}`
                              : activeBatchItem.province || 'รอระบุพื้นที่'
                          }) • คลิกหมุดสีน้ำเงินเพื่อสลับรายการ`
                        : 'กดสกัดจุดเกิดเหตุเพื่อแสดงหมุดทั้งหมดบนแผนที่'
                      : 'คลิกบนแผนที่หรือลากหมุดสีแดงเพื่อปรับตำแหน่งจริง'}
                </p>
              </div>
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={showBoundaries}
                  onChange={(e) => setShowBoundaries(e.target.checked)}
                />
                <span>แสดงเส้นเขตตำบล</span>
              </label>
            </div>
            <LeafletMap
              mode="picker"
              lat={
                entryMode === 'watch'
                  ? null
                  : entryMode === 'batch'
                    ? (activeBatchItem?.lat ?? null)
                    : (parsedCoord?.lat ?? null)
              }
              lng={
                entryMode === 'watch'
                  ? null
                  : entryMode === 'batch'
                    ? (activeBatchItem?.lng ?? null)
                    : (parsedCoord?.lng ?? null)
              }
              onPickCoordinate={handlePickOnMap}
              previewMarkers={entryMode === 'batch' ? batchPreviewMarkers : undefined}
              onSelectPreviewMarker={
                entryMode === 'batch' ? (id) => setActiveItemId(id) : undefined
              }
              watchPreviewAreas={entryMode === 'watch' ? watchAreas : undefined}
              showBoundaries={showBoundaries}
              offlinePmtilesUrl={settings.offlinePmtilesUrl}
              height="410px"
            />
          </div>

          {lastSavedRecord && (
            <div className="gov-card saved-card" aria-live="polite">
              <div className="saved-header">
                <div className="saved-title-row">
                  <CheckCircle2 size={20} className="text-success" aria-hidden="true" />
                  <h3>บันทึกล่าสุด: {lastSavedRecord.id}</h3>
                </div>
                <span
                  className={`badge ${
                    lastSavedRecord.syncStatus === 'synced'
                      ? 'badge-success'
                      : lastSavedRecord.syncStatus === 'failed'
                        ? 'badge-danger'
                        : 'badge-warn'
                  }`}
                >
                  {lastSavedRecord.syncStatus === 'synced'
                    ? 'ส่งเข้าระบบเดิมแล้ว'
                    : lastSavedRecord.syncStatus === 'failed'
                      ? 'ส่งไม่สำเร็จ (เก็บในเครื่องแล้ว)'
                      : 'เก็บในเครื่องแล้ว (รอซิงก์)'}
                </span>
              </div>
              <p className="saved-meta">
                {lastSavedRecord.category}
                {lastSavedRecord.eventCount && lastSavedRecord.eventCount > 1
                  ? ` (×${lastSavedRecord.eventCount} เหตุการณ์)`
                  : ''}{' '}
                •{' '}
                {[
                  lastSavedRecord.subdistrict && `ต.${lastSavedRecord.subdistrict}`,
                  lastSavedRecord.district && `อ.${lastSavedRecord.district}`,
                  lastSavedRecord.province && `จว.${lastSavedRecord.province}`,
                ]
                  .filter(Boolean)
                  .join(' ')}
              </p>
              {lastSavedRecord.syncError && (
                <p className="saved-error-note">หมายเหตุการส่ง: {lastSavedRecord.syncError}</p>
              )}
              <div className="copy-actions-row">
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => handleCopyText('line')}
                >
                  <ClipboardCopy size={14} aria-hidden="true" />
                  <span>{copiedType === 'line' ? 'คัดลอกแล้ว!' : 'คัดลอกส่ง LINE'}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => handleCopyText('paper')}
                >
                  <ClipboardCopy size={14} aria-hidden="true" />
                  <span>{copiedType === 'paper' ? 'คัดลอกแล้ว!' : 'คัดลอกสไตล์ Paper (เลขไทย)'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
