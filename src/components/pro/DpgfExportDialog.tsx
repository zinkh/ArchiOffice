import React, { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFileTypePdf, IconTable } from '@tabler/icons-react';
import type { DPGF } from '../../types/dpgf';
import {
  SANS_AFFECTATION_EXPORT, SELECTION_COMPLETE, compterArticles, filtrerDpgfPourExport, type ExportSelection,
} from '../../lib/dpgfExportSelection';
import { DialogShell, boutonPrincipal, boutonSecondaire } from '../projectDetail/situations/DialogShell';

export type FormatExportDpgf = 'pdf' | 'xlsx';

interface Props {
  open: boolean;
  dpgf: DPGF;
  onClose: () => void;
  /** Reçoit le document déjà filtré et un libellé du périmètre ('' = tout le document). */
  onExport: (format: FormatExportDpgf, document: DPGF, perimetre: string) => Promise<boolean>;
}

interface Choix { id: string; label: string }

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/**
 * Fenêtre d'export du DPGF : tout le document, ou une sélection de lots,
 * bâtiments et phases. L'export est toujours SANS PRIX. Le bâtiment et la phase
 * ne sont proposés que si le découpage est activé sur le document. Le parent
 * ne la monte qu'à l'ouverture : l'état repart de zéro (tout coché) à chaque fois.
 */
export const DpgfExportDialog: React.FC<Props> = ({ open, dpgf, onClose, onExport }) => {
  const { t } = useTranslation();
  const groupId = useId();
  const [mode, setMode] = useState<'all' | 'custom'>('all');
  const [busy, setBusy] = useState<FormatExportDpgf | null>(null);

  const lots: Choix[] = useMemo(
    () => dpgf.lots.map(l => ({ id: l.id, label: `${l.numero} ${l.titre}`.trim() })), [dpgf.lots]);
  const batiments: Choix[] = useMemo(() => dpgf.multiBatiments
    ? [...(dpgf.batiments ?? [])].sort((a, b) => a.ordre - b.ordre)
        .map(b => ({ id: b.id, label: `${b.code}${b.libelle ? ` · ${b.libelle}` : ''}` }))
        .concat([{ id: SANS_AFFECTATION_EXPORT, label: t('pro_export_dialog_no_building') }])
    : [], [dpgf.multiBatiments, dpgf.batiments, t]);
  const phases: Choix[] = useMemo(() => dpgf.multiPhases
    ? [...(dpgf.phases ?? [])].sort((a, b) => a.ordre - b.ordre)
        .map(p => ({ id: p.id, label: `${p.code}${p.libelle ? ` · ${p.libelle}` : ''}` }))
        .concat([{ id: SANS_AFFECTATION_EXPORT, label: t('pro_export_dialog_no_phase') }])
    : [], [dpgf.multiPhases, dpgf.phases, t]);

  const [lotIds, setLotIds] = useState<Set<string>>(() => new Set(lots.map(l => l.id)));
  const [batIds, setBatIds] = useState<Set<string>>(() => new Set(batiments.map(b => b.id)));
  const [phaseIds, setPhaseIds] = useState<Set<string>>(() => new Set(phases.map(p => p.id)));

  const selection: ExportSelection = useMemo(() => {
    if (mode === 'all') return SELECTION_COMPLETE;
    const ou = (set: Set<string>, all: Choix[]) => (all.length > 0 && all.every(c => set.has(c.id)) ? null : [...set]);
    return {
      lotIds: ou(lotIds, lots),
      batimentIds: batiments.length ? ou(batIds, batiments) : null,
      phaseIds: phases.length ? ou(phaseIds, phases) : null,
    };
  }, [mode, lotIds, batIds, phaseIds, lots, batiments, phases]);

  const filtre = useMemo(() => filtrerDpgfPourExport(dpgf, selection), [dpgf, selection]);
  const nbArticles = useMemo(() => compterArticles(filtre), [filtre]);
  const vide = nbArticles === 0;

  const perimetre = (): string => {
    if (mode === 'all') return '';
    const noms = (set: Set<string>, all: Choix[]) => all.filter(c => set.has(c.id)).map(c => c.label.split(' · ')[0]);
    const parties: string[] = [];
    if (selection.lotIds) parties.push(`${t('pro_export_dialog_lots')} ${noms(lotIds, lots).map(l => l.split(' ')[0]).join(', ')}`);
    if (selection.batimentIds) parties.push(`${t('pro_export_dialog_buildings')} ${noms(batIds, batiments).join(', ')}`);
    if (selection.phaseIds) parties.push(`${t('pro_export_dialog_phases')} ${noms(phaseIds, phases).join(', ')}`);
    return parties.join(' - ');
  };

  const lancer = async (format: FormatExportDpgf) => {
    setBusy(format);
    try {
      if (await onExport(format, filtre, perimetre())) onClose();
    } finally {
      setBusy(null);
    }
  };

  const groupe = (titre: string, choix: Choix[], set: Set<string>, setSet: (s: Set<string>) => void) => (
    <fieldset className="space-y-1.5" disabled={mode === 'all'}>
      <div className="flex items-center justify-between gap-2">
        <legend className="text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)]">{titre}</legend>
        <div className="flex gap-3 text-xs">
          <button type="button" className="text-[var(--tblr-primary)] hover:underline disabled:opacity-40" disabled={mode === 'all'}
            onClick={() => setSet(new Set(choix.map(c => c.id)))}>{t('pro_export_dialog_select_all')}</button>
          <button type="button" className="text-[var(--tblr-primary)] hover:underline disabled:opacity-40" disabled={mode === 'all'}
            onClick={() => setSet(new Set())}>{t('pro_export_dialog_select_none')}</button>
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto rounded-md border border-[var(--tblr-border)] divide-y divide-[var(--tblr-border)]">
        {choix.map(c => (
          <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer min-h-[2.75rem] sm:min-h-0">
            <input type="checkbox" className="w-4 h-4 accent-[var(--tblr-primary)]"
              checked={mode === 'all' || set.has(c.id)} onChange={() => setSet(toggle(set, c.id))} />
            <span className="text-[var(--tblr-text)]">{c.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <DialogShell
      open={open}
      title={t('pro_export_dialog_title')}
      subtitle={t('pro_export_dialog_subtitle')}
      onClose={onClose}
      busy={busy !== null}
      footer={(
        <>
          <span className="mr-auto text-xs text-[var(--tblr-muted)]" aria-live="polite">
            {vide ? t('pro_export_dialog_empty') : t('pro_export_dialog_count', { count: nbArticles })}
          </span>
          <button type="button" className={boutonSecondaire} onClick={onClose} disabled={busy !== null}>{t('pro_versions_close')}</button>
          <button type="button" className={boutonPrincipal} disabled={vide || busy !== null} onClick={() => lancer('xlsx')}>
            <IconTable size={16} /> {t('pro_export_excel')}
          </button>
          <button type="button" className={boutonPrincipal} disabled={vide || busy !== null} onClick={() => lancer('pdf')}>
            <IconFileTypePdf size={16} /> {t('pro_export_pdf')}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div role="radiogroup" aria-labelledby={`${groupId}-scope`} className="space-y-2">
          <p id={`${groupId}-scope`} className="sr-only">{t('pro_export_dialog_scope')}</p>
          {(['all', 'custom'] as const).map(m => (
            <label key={m} className="flex items-center gap-2.5 text-sm cursor-pointer min-h-[2.75rem] sm:min-h-0">
              <input type="radio" name={`${groupId}-scope`} className="w-4 h-4 accent-[var(--tblr-primary)]"
                checked={mode === m} onChange={() => setMode(m)} />
              <span className="font-medium text-[var(--tblr-text)]">
                {m === 'all' ? t('pro_export_dialog_all') : t('pro_export_dialog_custom')}
              </span>
            </label>
          ))}
        </div>
        {groupe(t('pro_export_dialog_lots'), lots, lotIds, setLotIds)}
        {batiments.length > 0 && groupe(t('pro_export_dialog_buildings'), batiments, batIds, setBatIds)}
        {phases.length > 0 && groupe(t('pro_export_dialog_phases'), phases, phaseIds, setPhaseIds)}
        <p className="text-xs text-[var(--tblr-muted)]">{t('pro_export_dialog_no_prices')}</p>
      </div>
    </DialogShell>
  );
};
