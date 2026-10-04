// Composition d'un extrait de carte pour l'étude de faisabilité : fond IGN
// (plan ou photo aérienne), parcellaire facultatif, contour de la parcelle,
// flèche du nord, barre d'échelle et source. Les tuiles passent par le relais
// du serveur (/api/feasibility/map-tile) pour que le canvas reste exportable ;
// l'image validée est déposée comme document de la proposition.
// Les calculs (zoom, tuiles, projection, échelle) sont dans src/lib/feasibilityMap.ts.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX, IconMap2, IconLoader2 } from '@tabler/icons-react';
import { getAccessToken } from '../../lib/authToken';
import {
  FEASIBILITY_MAP_EXTENTS, FEASIBILITY_MAP_LAYERS, FEASIBILITY_MAP_PRESETS, approximateScale, defaultMapCaption,
  geometryRings, niceScaleBar, planMapExtract, pointInGeometry, type MapExtractPlan,
} from '../../lib/feasibilityMap';
import type { FeasibilityIllustration } from '../../lib/feasibilityBlocks';

const OUT_W = 1200;
const OUT_H = 800;

interface Props {
  proposalId: string;
  lat: number;
  lon: number;
  /** Parcelles sélectionnées sur la carte cadastrale de la proposition, s'il y en a. */
  parcelGeometry?: GeoJSON.Geometry | null;
  onInsert: (illustration: FeasibilityIllustration) => void;
  onClose: () => void;
}

async function loadTile(layer: string, z: number, x: number, y: number): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(`/api/feasibility/map-tile?layer=${layer}&z=${z}&x=${x}&y=${y}`);
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

async function drawLayer(ctx: CanvasRenderingContext2D, layer: string, plan: MapExtractPlan): Promise<number> {
  const bitmaps = await Promise.all(plan.tiles.map(t => loadTile(layer, plan.z, t.x, t.y)));
  let drawn = 0;
  bitmaps.forEach((bmp, i) => {
    if (!bmp) return;
    const t = plan.tiles[i];
    // +0,5 px : évite le liseré entre deux tuiles mises à l'échelle.
    ctx.drawImage(bmp, t.dx, t.dy, t.size + 0.5, t.size + 0.5);
    bmp.close();
    drawn++;
  });
  return drawn;
}

async function parcelAtPoint(lat: number, lon: number): Promise<GeoJSON.Geometry | null> {
  try {
    const res = await fetch(`/api/cadastre/parcel?lat=${lat}&lon=${lon}`);
    if (!res.ok) return null;
    const fc = await res.json();
    const hit = (fc?.features || []).find((f: any) => pointInGeometry(lon, lat, f.geometry));
    return hit?.geometry ?? null;
  } catch {
    return null;
  }
}

function drawDecorations(ctx: CanvasRenderingContext2D, plan: MapExtractPlan, attribution: string) {
  ctx.save();
  // Barre d'échelle, sur un cartouche blanc pour rester lisible sur la photo aérienne.
  const bar = niceScaleBar(plan.metersPerOutPx, 220);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(16, OUT_H - 58, bar.px + 32, 42);
  ctx.fillStyle = '#111';
  ctx.fillRect(32, OUT_H - 30, bar.px, 6);
  ctx.fillStyle = '#fff';
  ctx.fillRect(32 + bar.px / 2, OUT_H - 29, bar.px / 2 - 1, 4);
  ctx.font = '600 18px Helvetica, Arial, sans-serif';
  ctx.fillStyle = '#111';
  ctx.fillText('0', 28, OUT_H - 36);
  ctx.textAlign = 'right';
  ctx.fillText(bar.label, 32 + bar.px + 8, OUT_H - 36);

  // Flèche du nord.
  const nx = OUT_W - 48, ny = 30;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.beginPath(); ctx.arc(nx, ny + 26, 30, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.moveTo(nx, ny + 4); ctx.lineTo(nx + 12, ny + 40); ctx.lineTo(nx, ny + 32); ctx.lineTo(nx - 12, ny + 40); ctx.closePath(); ctx.fill();
  ctx.textAlign = 'center';
  ctx.font = '700 16px Helvetica, Arial, sans-serif';
  ctx.fillText('N', nx, ny + 54);

  // Source.
  ctx.font = '14px Helvetica, Arial, sans-serif';
  const w = ctx.measureText(attribution).width;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillRect(OUT_W - w - 24, OUT_H - 28, w + 16, 22);
  ctx.fillStyle = '#333';
  ctx.textAlign = 'right';
  ctx.fillText(attribution, OUT_W - 16, OUT_H - 12);
  ctx.restore();
}

function drawParcel(ctx: CanvasRenderingContext2D, plan: MapExtractPlan, geometry: GeoJSON.Geometry | null, lon: number, lat: number) {
  const rings = geometryRings(geometry as any);
  ctx.save();
  if (rings.length) {
    const trace = () => {
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach(([x, y], i) => {
          const p = plan.project(x, y);
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
      }
    };
    trace();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 4;
    ctx.setLineDash([16, 8]);
    ctx.stroke();
  } else {
    // Sans parcelle connue : un repère sur l'adresse géocodée.
    const p = plan.project(lon, lat);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

export function FeasibilityMapDialog({ proposalId, lat, lon, parcelGeometry, onInsert, onClose }: Props) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [presetId, setPresetId] = useState(FEASIBILITY_MAP_PRESETS[2].id);
  const [extent, setExtent] = useState(250);
  const [showParcel, setShowParcel] = useState(true);
  const [caption, setCaption] = useState('');
  const [captionTouched, setCaptionTouched] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preset = FEASIBILITY_MAP_PRESETS.find(p => p.id === presetId) ?? FEASIBILITY_MAP_PRESETS[0];
  const scale = approximateScale(extent);
  const presetLabel = t(`feas_map_preset_${preset.id}`);

  useEffect(() => {
    if (!captionTouched) setCaption(defaultMapCaption(presetLabel, scale));
  }, [presetLabel, scale, captionTouched]);

  // Recomposition à chaque changement de réglage, la dernière demande gagnant.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRendering(true);
      setError(null);
      try {
        const canvas = canvasRef.current ?? document.createElement('canvas');
        canvasRef.current = canvas;
        canvas.width = OUT_W;
        canvas.height = OUT_H;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas');
        ctx.fillStyle = '#f3f4f6';
        ctx.fillRect(0, 0, OUT_W, OUT_H);
        const base = FEASIBILITY_MAP_LAYERS[preset.base];
        const plan = planMapExtract({ lon, lat, widthM: extent, outW: OUT_W, outH: OUT_H, maxZoom: base.maxZoom });
        const drawn = await drawLayer(ctx, preset.base, plan);
        if (cancelled) return;
        if (drawn === 0) throw new Error('tiles');
        if (preset.cadastre) await drawLayer(ctx, 'cadastre', plan);
        if (cancelled) return;
        if (showParcel) {
          // Les parcelles choisies sur la carte de la proposition priment : un
          // terrain en couvre souvent plusieurs, l'adresse n'en désigne qu'une.
          const geometry = parcelGeometry ?? await parcelAtPoint(lat, lon);
          if (cancelled) return;
          drawParcel(ctx, plan, geometry, lon, lat);
        }
        drawDecorations(ctx, plan, preset.cadastre ? '© IGN Géoplateforme, cadastre DGFiP' : '© IGN Géoplateforme');
        setPreview(canvas.toDataURL('image/jpeg', 0.9));
      } catch {
        if (!cancelled) { setPreview(null); setError(t('feas_map_error')); }
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => { cancelled = true; };
  }, [preset, extent, showParcel, lat, lon, parcelGeometry, t]);

  const insert = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !preview) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error(t('feas_map_error') as string);
      const name = `Extrait de carte - ${presetLabel} - 1-${scale}.jpg`;
      const form = new FormData();
      form.append('file', new File([blob], name, { type: 'image/jpeg' }));
      form.append('resource_type', 'proposals');
      form.append('resource_id', proposalId);
      form.append('name', name);
      form.append('category', 'Faisabilité');
      const token = await getAccessToken();
      const res = await fetch('/api/documents', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || t('feas_map_error'));
      onInsert({
        document_id: data.id, file_url: data.file_url, layer: preset.id, scale,
        caption: caption.trim(), captured_at: new Date().toISOString(),
      });
    } catch (e: any) {
      setError(e?.message || t('feas_map_error'));
    } finally {
      setSaving(false);
    }
  };

  const selectStyle = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('feas_map_title') as string}>
      <div className="rounded-lg shadow-xl w-full max-w-3xl max-h-[92dvh] flex flex-col overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
        <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}><IconMap2 size={16} /> {t('feas_map_title')}</h3>
          <button type="button" onClick={onClose} aria-label={t('feas_cancel') as string} style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-xs font-semibold space-y-1" style={{ color: 'var(--tblr-muted)' }}>
              <span>{t('feas_map_background')}</span>
              <select className="w-full px-2 py-1.5 rounded-lg text-sm" style={selectStyle} value={presetId} onChange={e => setPresetId(e.target.value)}>
                {FEASIBILITY_MAP_PRESETS.map(p => <option key={p.id} value={p.id}>{t(`feas_map_preset_${p.id}`)}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold space-y-1" style={{ color: 'var(--tblr-muted)' }}>
              <span>{t('feas_map_extent')}</span>
              <select className="w-full px-2 py-1.5 rounded-lg text-sm" style={selectStyle} value={extent} onChange={e => setExtent(Number(e.target.value))}>
                {FEASIBILITY_MAP_EXTENTS.map(m => (
                  <option key={m} value={m}>{m >= 1000 ? `${m / 1000} km` : `${m} m`} (1/{approximateScale(m).toLocaleString('fr-FR')})</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm sm:pt-5" style={{ color: 'var(--tblr-text)' }}>
              <input type="checkbox" checked={showParcel} onChange={e => setShowParcel(e.target.checked)} />
              {t('feas_map_parcel')}
            </label>
          </div>
          <div className="relative rounded-lg overflow-hidden" style={{ aspectRatio: `${OUT_W} / ${OUT_H}`, background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
            {preview && <img src={preview} alt={caption} className="w-full h-full object-cover" />}
            {rendering && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--tblr-muted)', background: preview ? 'rgba(255,255,255,0.5)' : undefined }}>
                <IconLoader2 size={18} className="animate-spin" /> {t('feas_map_rendering')}
              </div>
            )}
          </div>
          <label className="block text-xs font-semibold space-y-1" style={{ color: 'var(--tblr-muted)' }}>
            <span>{t('feas_map_caption')}</span>
            <input className="w-full px-3 py-1.5 rounded-lg text-sm" style={selectStyle} value={caption} maxLength={300}
              onChange={e => { setCaption(e.target.value); setCaptionTouched(true); }} />
          </label>
          {error && <p className="text-sm" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}
        </div>
        <div className="p-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--tblr-border)' }}>
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('feas_cancel')}</button>
          <button type="button" onClick={insert} disabled={!preview || rendering || saving}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-60" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
            {saving ? t('feas_saving') : t('feas_map_insert')}
          </button>
        </div>
      </div>
    </div>
  );
}
