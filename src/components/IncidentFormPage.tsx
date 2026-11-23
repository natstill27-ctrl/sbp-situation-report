import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  Crosshair,
  LocateFixed,
  MapPin,
  RotateCcw,
  Send,
  Sparkles,
} from 'lucide-react';
import type { AppSettings, IncidentRecord, ParsedCoordinate } from '../types/incident';
import { buildParsedCoordinate, parseCoordinateInput } from '../utils/coordinates';
import {
  getCenterOfArea,
  getDistrictsByProvince,
  getSubdistrictsByDistrict,
  getTargetProvinces,
  lookupAreaByLatLng,
  matchAreaByThaiNames,
} from '../utils/geoLookup';
import { extractPaperMetadata, formatThaiDateTime, getCurrentLocalDateTimeInput } from '../utils/thaiDate';
import { formatIncidentForLine, formatIncidentForPaper } from '../utils/exportUtils';
import { LeafletMap } from './LeafletMap';

interface IncidentFormPageProps {
  settings: AppSettings;
  editingIncident: IncidentRecord | null;
  onCancelEdit: () => void;
  onSaveIncident: (record: IncidentRecord) => Promise<IncidentRecord>;
  lastSavedRecord: IncidentRecord | null;
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
  editingIncident,
  onCancelEdit,
  onSaveIncident,
  lastSavedRecord,
}: IncidentFormPageProps) {
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
  const [details, setDetails] = useState('');
  const [reporter, setReporter] = useState(settings.defaultReporter || '');

  const [showBoundaries, setShowBoundaries] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [paperNotice, setPaperNotice] = useState('');
  const [copiedType, setCopiedType] = useState<'line' | 'paper' | null>(null);

  const provinces = useMemo(() => getTargetProvinces(), []);
  const districts = useMemo(() => (province ? getDistrictsByProvince(province) : []), [province]);
  const subdistricts = useMemo(
    () => (province && district ? getSubdistrictsByDistrict(province, district) : []),
    [province, district]
  );

  // Sync form when entering/exiting edit mode
  useEffect(() => {
    if (editingIncident) {
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
      setOccurredAt(editingIncident.occurredAt);
      setCategory(editingIncident.category);
      setDetails(editingIncident.details);
      setReporter(editingIncident.reporter);
      setAreaAutoNote('');
      setCoordError('');
      setFormError('');
    }
  }, [editingIncident]);

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
        'พิกัดอยู่นอกเขต 3 จังหวัดชายแดนภาคใต้ + 4 อำเภอ จ.สงขลา (ยังสามารถระบุพื้นที่และบันทึกได้)'
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

  const handlePickOnMap = (lat: number, lng: number) => {
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
    const center = getCenterOfArea(province, district || undefined, subdistrict || undefined);
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
      return;
    }
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
        hints.push(`พื้นที่ (ต.${areaMatch.subdistrict} อ.${areaMatch.district} จว.${areaMatch.province})`);
        if (!coordInText) {
          const center = getCenterOfArea(areaMatch.province, areaMatch.district, areaMatch.subdistrict);
          if (center) {
            const c = buildParsedCoordinate(center.lat, center.lng, 'map-pick', `${center.lat}, ${center.lng}`);
            setParsedCoord(c);
            setCoordinateRaw(`${center.lat}, ${center.lng}`);
            setAreaAutoNote('ปักหมุดอ้างอิงกึ่งกลางตำบลจากข้อความ Paper (สามารถกรอกพิกัดจริงหรือลากหมุดทับได้)');
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
    setDetails('');
    setFormError('');
    setPaperNotice('');
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
        setDetails('');
        setPaperNotice('');
        setOccurredAt(getCurrentLocalDateTimeInput());
      } else {
        onCancelEdit();
      }
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
            {editingIncident ? `แก้ไขเหตุการณ์ (${editingIncident.id})` : 'บันทึกเหตุการณ์และจับพิกัดอัตโนมัติ'}
          </h2>
          <p className="section-subtitle">
            ฟอร์มกระชับเน้นกรอกเร็ว: กรอกหรือวางพิกัดได้ทุกรูปแบบ ระบบจะปักหมุดและระบุ จว./อ./ต. ให้อัตโนมัติ
          </p>
        </div>
        {editingIncident && (
          <button type="button" className="btn btn-outline" onClick={resetForm}>
            ยกเลิกการแก้ไข
          </button>
        )}
      </div>

      <div className="entry-grid">
        {/* Left: Compact Fast-Entry Form */}
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
                      {p === 'สงขลา' ? 'สงขลา (4 อำเภอ)' : p}
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

        {/* Right: Live Auto-Pin Map + Last Saved Briefing Card */}
        <div className="entry-side-col">
          <div className="gov-card map-card">
            <div className="card-header-row">
              <div>
                <h3 className="card-title">แผนที่ตรวจสอบพิกัดอัตโนมัติ</h3>
                <p className="card-subtitle">คลิกบนแผนที่หรือลากหมุดสีแดงเพื่อปรับตำแหน่งจริง</p>
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
              lat={parsedCoord?.lat ?? null}
              lng={parsedCoord?.lng ?? null}
              onPickCoordinate={handlePickOnMap}
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
                {lastSavedRecord.category} •{' '}
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
