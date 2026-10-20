// Génération du panneau de chantier d'une affaire : intervenants, lots, entreprises
// et logos viennent de l'affaire et des fiches contact (rien à ressaisir). La
// fenêtre sert à choisir le format, à masquer des lignes et à vérifier les logos.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconDownload, IconLoader2, IconAlertTriangle } from '@tabler/icons-react';
import { ModalShell } from './ui/ModalShell';
import { apiFetch } from '../lib/api';
import {
  CHANTIER_FORMATS, downloadBlob, requestPanelPdf,
  type PanneauFormat, type PanneauOrientation,
} from '../lib/panneaux';

interface PanelRow { key: string; role?: string; name?: string; number?: string; title?: string; company?: string | null; hasLogo: boolean }
interface ImageCandidate { id: string; label: string }
interface PanelPreview {
  projectName: string;
  maitriseOuvrage: PanelRow[];
  maitriseOeuvre: PanelRow[];
  lots: PanelRow[];
  candidates: ImageCandidate[];
  settings: Record<string, any> | null;
  settingsAvailable: boolean;
  warnings: string[];
}

const fieldClass = 'bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] rounded-lg p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export function PanneauChantierDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<PanelPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [format, setFormat] = useState<PanneauFormat>('A0');
  const [orientation, setOrientation] = useState<PanneauOrientation>('portrait');
  const [logos, setLogos] = useState(true);
  const [colorLogos, setColorLogos] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hiddenLogos, setHiddenLogos] = useState<Set<string>>(new Set());
  const [imageId, setImageId] = useState('');
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [durationText, setDurationText] = useState('');

  useEffect(() => {
    let alive = true;
    apiFetch<PanelPreview>(`/api/projects/${encodeURIComponent(projectId)}/panneau-chantier`)
      .then(p => {
        if (!alive) return;
        setPreview(p);
        const s = p.settings;
        if (s) {
          if (CHANTIER_FORMATS.includes(s.format)) setFormat(s.format);
          if (s.orientation === 'paysage') setOrientation('paysage');
          setLogos(s.logos !== false);
          setColorLogos(s.colorLogos === true);
          setHidden(new Set(s.hidden || []));
          setHiddenLogos(new Set(s.hiddenLogos || []));
          setImageId(s.imageId || '');
          setTitle(s.title || '');
          setStartDate(s.startDate || '');
          setDurationText(s.durationText || '');
        }
      })
      .catch((e: any) => alive && setError(e?.message || t('panneau_load_failed')));
    return () => { alive = false; };
  }, [projectId, t]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  const withCompany = useMemo(() => (preview?.lots ?? []).filter(l => l.company), [preview]);
  const withLogo = withCompany.filter(l => l.hasLogo).length;
  const missingLogos = withCompany.filter(l => !l.hasLogo);

  const settingsBody = () => ({
    format, orientation, logos, colorLogos, hidden: [...hidden], hiddenLogos: [...hiddenLogos],
    imageId: imageId || null, title: title || null, startDate: startDate || null, durationText: durationText || null,
  });

  async function generate() {
    setBusy(true); setError(null); setWarnings([]);
    try {
      const body = settingsBody();
      // Les réglages sont mémorisés pour la prochaine fois ; un échec ne bloque pas la génération.
      apiFetch(`/api/projects/${encodeURIComponent(projectId)}/panneau-chantier`, { method: 'PUT', body: JSON.stringify(body) }).catch(() => undefined);
      const result = await requestPanelPdf(`/api/projects/${encodeURIComponent(projectId)}/panneau-chantier/pdf`, body, 'panneau-chantier.pdf');
      downloadBlob(result.blob, result.filename);
      setWarnings(result.warnings);
    } catch (e: any) {
      setError(e?.message || t('panneau_generate_failed'));
    } finally {
      setBusy(false);
    }
  }

  const rowLabel = (r: PanelRow) => r.number !== undefined ? `${r.number} · ${r.title ?? ''}` : `${r.role ?? ''}`;
  const rowName = (r: PanelRow) => r.number !== undefined ? (r.company || t('panneau_company_tbd')) : (r.name ?? '');

  const renderRows = (rows: PanelRow[]) => (
    <ul className="divide-y divide-[var(--tblr-border)] border border-[var(--tblr-border)] rounded-lg overflow-hidden">
      {rows.map(r => (
        <li key={r.key} className="flex items-center gap-3 px-3 py-2 text-sm">
          <input type="checkbox" aria-label={t('panneau_show_row', { name: rowName(r) })} checked={!hidden.has(r.key)} onChange={() => toggle(hidden, setHidden, r.key)} />
          <div className="min-w-0 flex-1">
            <div className="text-[0.6875rem] uppercase tracking-wider text-[var(--tblr-muted)] truncate">{rowLabel(r)}</div>
            <div className="font-medium truncate">{rowName(r)}</div>
          </div>
          {(r.number === undefined || r.company) && (
            <label className="flex items-center gap-1.5 text-xs shrink-0" style={{ color: r.hasLogo ? 'var(--tblr-text)' : 'var(--tblr-muted)' }}>
              <input type="checkbox" disabled={!r.hasLogo || !logos} checked={r.hasLogo && !hiddenLogos.has(r.key)} onChange={() => toggle(hiddenLogos, setHiddenLogos, r.key)} aria-label={t('panneau_show_logo_of', { name: rowName(r) })} />
              {r.hasLogo ? t('panneau_logo') : t('panneau_no_logo')}
            </label>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <ModalShell
      title={t('panneau_chantier_title')}
      subtitle={preview?.projectName}
      size="xl"
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{t('btn_cancel')}</button>
          <button type="button" className="btn btn-primary disabled:opacity-60" onClick={generate} disabled={busy || !preview}>
            {busy ? <IconLoader2 size={18} className="animate-spin" aria-hidden="true" /> : <IconDownload size={18} aria-hidden="true" />}
            {t('panneau_generate')}
          </button>
        </>
      )}
    >
      {!preview && !error && <p className="p-6 text-sm text-[var(--tblr-muted)]">{t('panneau_loading')}</p>}
      {error && <p role="alert" className="m-4 p-3 rounded-lg text-sm bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
      {preview && (
        <div className="p-4 space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="text-xs font-medium flex flex-col gap-1">{t('panneau_format')}
              <select className={fieldClass} value={format} onChange={e => setFormat(e.target.value as PanneauFormat)}>
                {CHANTIER_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium flex flex-col gap-1">{t('panneau_orientation')}
              <select className={fieldClass} value={orientation} onChange={e => setOrientation(e.target.value as PanneauOrientation)}>
                <option value="portrait">{t('panneau_portrait')}</option>
                <option value="paysage">{t('panneau_landscape')}</option>
              </select>
            </label>
            <label className="text-xs font-medium flex flex-col gap-1 col-span-2">{t('panneau_image')}
              <select className={fieldClass} value={imageId} onChange={e => setImageId(e.target.value)}>
                <option value="">{t('panneau_image_default')}</option>
                {preview.candidates.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium flex flex-col gap-1 col-span-2">{t('panneau_title_override')}
              <input className={fieldClass} value={title} maxLength={200} placeholder={preview.projectName} onChange={e => setTitle(e.target.value)} />
            </label>
            <label className="text-xs font-medium flex flex-col gap-1">{t('panneau_start_date')}
              <input type="date" className={fieldClass} value={startDate} onChange={e => setStartDate(e.target.value)} />
            </label>
            <label className="text-xs font-medium flex flex-col gap-1">{t('panneau_duration')}
              <input className={fieldClass} value={durationText} maxLength={80} placeholder={t('panneau_duration_placeholder')} onChange={e => setDurationText(e.target.value)} />
            </label>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={logos} onChange={e => setLogos(e.target.checked)} />{t('panneau_logos_all')}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={colorLogos} disabled={!logos} onChange={e => setColorLogos(e.target.checked)} />{t('panneau_logos_color')}</label>
          </div>

          {withCompany.length > 0 && (
            <p className="text-sm" role="status">
              {t('panneau_logo_summary', { with: withLogo, total: withCompany.length })}
              {missingLogos.length > 0 && <span className="text-[var(--tblr-muted)]"> {t('panneau_logo_missing', { list: missingLogos.map(l => l.company).join(', ') })}</span>}
            </p>
          )}

          {!preview.settingsAvailable && <p className="text-xs text-[var(--tblr-muted)]">{t('panneau_settings_unavailable')}</p>}

          {preview.maitriseOuvrage.length > 0 && (<section><h3 className="text-xs font-bold uppercase tracking-wider mb-2">{t('panneau_section_moa')}</h3>{renderRows(preview.maitriseOuvrage)}</section>)}
          {preview.maitriseOeuvre.length > 0 && (<section><h3 className="text-xs font-bold uppercase tracking-wider mb-2">{t('panneau_section_moe')}</h3>{renderRows(preview.maitriseOeuvre)}</section>)}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider mb-2">{t('panneau_section_lots')}</h3>
            {preview.lots.length === 0 ? <p className="text-sm text-[var(--tblr-muted)] italic">{t('panneau_no_lots')}</p> : renderRows(preview.lots)}
          </section>

          {[...preview.warnings, ...warnings].length > 0 && (
            <ul className="space-y-1" role="status">
              {[...preview.warnings, ...warnings].map((w, i) => (
                <li key={i} className="flex gap-2 text-xs text-amber-700 dark:text-amber-300"><IconAlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </ModalShell>
  );
}
