// Panneau d'affichage du permis de construire (ou de la déclaration préalable) :
// mentions réglementaires saisies sur la fiche du permis, version brouillon
// (à compléter à la délivrance) ou définitive, formats réglementaires.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconDownload, IconLoader2, IconPaperclip, IconAlertTriangle, IconDeviceFloppy } from '@tabler/icons-react';
import { ModalShell } from './ui/ModalShell';
import { apiFetch } from '../lib/api';
import type { Permit } from '../types';
import {
  PERMIS_FORMATS, PanelRequestError, attachPanelToPermit, downloadBlob, isRegulatoryFormat, requestPanelPdf,
  type PanneauFormat, type PanneauOrientation,
} from '../lib/panneaux';

interface PermisPreview {
  etat: 'brouillon' | 'definitif';
  status: string;
  missingRequired: string[];
  warnings: string[];
}

const fieldClass = 'bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 w-full';
const numText = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function PanneauPermisDialog({ permit, onClose, onUpdated }: { permit: Permit; onClose: () => void; onUpdated: (p: Permit) => void }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<Permit>(permit);
  const [preview, setPreview] = useState<PermisPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<PanneauFormat>('A0');
  const [orientation, setOrientation] = useState<PanneauOrientation>('portrait');
  const [etat, setEtat] = useState<'brouillon' | 'definitif'>('brouillon');
  const [form, setForm] = useState({
    nature_projet: permit.nature_projet ?? '', superficie_terrain_m2: numText(permit.superficie_terrain_m2),
    surface_plancher_m2: numText(permit.surface_plancher_m2), nombre_logements: numText(permit.nombre_logements),
    hauteur_m: numText(permit.hauteur_m), mairie_nom: permit.mairie_nom ?? '', mairie_adresse: permit.mairie_adresse ?? '',
    numero_decision: permit.numero_decision ?? '', decision_date: permit.decision_date ?? '',
  });
  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    try {
      const p = await apiFetch<PermisPreview>(`/api/permits/${encodeURIComponent(permit.id)}/panneau`);
      setPreview(p);
      setEtat(prev => (prev === 'definitif' && p.missingRequired.length ? 'brouillon' : prev));
    } catch (e: any) { setError(e?.message || t('panneau_load_failed')); }
  }, [permit.id, t]);

  useEffect(() => {
    void load();
    // Un permis accordé et daté ouvre directement sur la version définitive.
    if (permit.status === 'accorde' && permit.decision_date) setEtat('definitif');
  }, [load, permit.status, permit.decision_date]);

  async function save() {
    setBusy(true); setError(null); setInfo(null);
    try {
      const updated = await apiFetch<Permit>(`/api/permits/${encodeURIComponent(permit.id)}`, {
        method: 'PUT', body: JSON.stringify({ ...current, ...form, decision_date: form.decision_date || null }),
      });
      setCurrent(updated); onUpdated(updated);
      setInfo(t('panneau_permit_saved'));
      await load();
    } catch (e: any) { setError(e?.message || t('panneau_permit_save_failed')); }
    finally { setBusy(false); }
  }

  async function generate(attach: boolean) {
    setBusy(true); setError(null); setInfo(null); setWarnings([]);
    try {
      const result = await requestPanelPdf(`/api/permits/${encodeURIComponent(permit.id)}/panneau/pdf`, { format, orientation, etat }, 'panneau-permis.pdf');
      setWarnings(result.warnings);
      if (attach) { await attachPanelToPermit(permit.id, result.blob, result.filename); setInfo(t('panneau_permit_attached')); }
      else downloadBlob(result.blob, result.filename);
    } catch (e: any) {
      setError(e instanceof PanelRequestError && e.missing.length ? `${e.message} ${e.missing.join(', ')}.` : (e?.message || t('panneau_generate_failed')));
    } finally { setBusy(false); }
  }

  const regulatory = isRegulatoryFormat(format);
  const refused = preview?.status === 'refuse';
  const definitifBlocked = refused || (preview?.missingRequired.length ?? 0) > 0;

  const field = (k: keyof typeof form, label: string, opts: { type?: string; step?: string; wide?: boolean } = {}) => (
    <label className={`text-xs font-medium flex flex-col gap-1 ${opts.wide ? 'md:col-span-2' : ''}`}>{label}
      <input className={fieldClass} type={opts.type ?? 'text'} step={opts.step} min={opts.type === 'number' ? 0 : undefined} value={form[k]} onChange={e => set(k, e.target.value)} />
    </label>
  );

  return (
    <ModalShell
      title={t('panneau_permit_title', { type: permit.type })}
      subtitle={permit.reference || undefined}
      size="lg"
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={() => void save()} disabled={busy}>
            <IconDeviceFloppy size={18} aria-hidden="true" />{t('panneau_permit_save')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void generate(true)} disabled={busy || (etat === 'definitif' && definitifBlocked)}>
            <IconPaperclip size={18} aria-hidden="true" />{t('panneau_permit_attach')}
          </button>
          <button type="button" className="btn btn-primary disabled:opacity-60" onClick={() => void generate(false)} disabled={busy || (etat === 'definitif' && definitifBlocked)}>
            {busy ? <IconLoader2 size={18} className="animate-spin" aria-hidden="true" /> : <IconDownload size={18} aria-hidden="true" />}
            {t('panneau_generate')}
          </button>
        </>
      )}
    >
      <div className="p-4 space-y-5">
        <p className="text-xs p-3 rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200" role="note">{t('panneau_permit_verify_notice')}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {field('numero_decision', t('panneau_permit_number'))}
          {field('decision_date', t('panneau_permit_decision_date'), { type: 'date' })}
          {field('nature_projet', t('panneau_permit_nature'), { wide: true })}
          {field('superficie_terrain_m2', t('panneau_permit_land_area'), { type: 'number', step: 'any' })}
          {field('surface_plancher_m2', t('panneau_permit_floor_area'), { type: 'number', step: 'any' })}
          {field('nombre_logements', t('panneau_permit_dwellings'), { type: 'number', step: '1' })}
          {field('hauteur_m', t('panneau_permit_height'), { type: 'number', step: 'any' })}
          {field('mairie_nom', t('panneau_permit_town_hall'))}
          {field('mairie_adresse', t('panneau_permit_town_hall_address'))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <label className="text-xs font-medium flex flex-col gap-1">{t('panneau_format')}
            <select className={fieldClass} value={format} onChange={e => setFormat(e.target.value as PanneauFormat)}>
              {PERMIS_FORMATS.map(f => <option key={f} value={f}>{f}{isRegulatoryFormat(f) ? ` (${t('panneau_permit_compliant')})` : ` (${t('panneau_permit_preview_only')})`}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium flex flex-col gap-1">{t('panneau_orientation')}
            <select className={fieldClass} value={orientation} onChange={e => setOrientation(e.target.value as PanneauOrientation)}>
              <option value="portrait">{t('panneau_portrait')}</option>
              <option value="paysage">{t('panneau_landscape')}</option>
            </select>
          </label>
          <fieldset className="text-xs font-medium flex flex-col gap-1">
            <legend className="mb-1">{t('panneau_permit_version')}</legend>
            <label className="flex items-center gap-2"><input type="radio" name="etat" checked={etat === 'brouillon'} onChange={() => setEtat('brouillon')} />{t('panneau_permit_draft')}</label>
            <label className="flex items-center gap-2" style={{ opacity: definitifBlocked ? 0.55 : 1 }}>
              <input type="radio" name="etat" checked={etat === 'definitif'} disabled={definitifBlocked} onChange={() => setEtat('definitif')} />{t('panneau_permit_final')}
            </label>
          </fieldset>
        </div>

        {!regulatory && <p className="text-xs text-amber-700 dark:text-amber-300">{t('panneau_permit_format_warning')}</p>}
        {refused && <p className="text-xs text-red-600">{t('panneau_permit_refused')}</p>}
        {preview && preview.missingRequired.length > 0 && (
          <div className="text-xs" role="status">
            <div className="font-semibold mb-1">{t('panneau_permit_missing')}</div>
            <ul className="list-disc pl-5 text-[var(--tblr-muted)]">{preview.missingRequired.map(m => <li key={m}>{m}</li>)}</ul>
          </div>
        )}
        {[...(preview?.warnings ?? []), ...warnings].length > 0 && (
          <ul className="space-y-1" role="status">
            {[...(preview?.warnings ?? []), ...warnings].map((w, i) => (
              <li key={i} className="flex gap-2 text-xs text-amber-700 dark:text-amber-300"><IconAlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />{w}</li>
            ))}
          </ul>
        )}
        {info && <p role="status" className="text-sm text-green-700 dark:text-green-300">{info}</p>}
        {error && <p role="alert" className="p-3 rounded-lg text-sm bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
      </div>
    </ModalShell>
  );
}
