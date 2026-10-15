import React, { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFileZip } from '@tabler/icons-react';
import type { DPGF } from '../../types/dpgf';
import type { BPU } from '../../types/bpu';
import type { AgencySettings } from '../../lib/proposalExport';
import type { ContexteCctp } from '../../lib/cctpVariables';
import {
  SANS_AFFECTATION_EXPORT, SELECTION_COMPLETE, cleLot, type ExportSelection,
} from '../../lib/exportPerimetre';
import {
  DOCUMENTS_DOSSIER, compterFichiers, produireDossier, type DocumentDossier, type FormatChoisi,
} from '../../lib/exportDossier';
import { livrer, nomSur } from '../../lib/exportSortie';
import { DialogShell, boutonPrincipal, boutonSecondaire } from '../projectDetail/situations/DialogShell';

interface Props {
  dpgf: DPGF;
  /** Bordereau chargé ; `null` tant qu'il ne l'est pas. */
  bpu: BPU | null;
  bpuLoading: boolean;
  /** Document ouvert à l'écran : il est coché d'office. */
  ongletActif: string;
  projectName?: string;
  contexte?: ContexteCctp;
  settings: AgencySettings;
  /** Attribue les références du bordereau et les enregistre, avant tout export. */
  prepareBpu: () => BPU | null;
  notify?: (message: string, opts?: { type?: 'success' | 'error' }) => void;
  onClose: () => void;
}

interface Choix { id: string; label: string }

const toggle = (set: Set<string>, id: string): Set<string> => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
};

const DEPART: Record<string, DocumentDossier> = {
  CCTP: 'cctp', DPGF: 'dpgf', DQE: 'dqe', BPU: 'bpu', ESTIMATION: 'estimation',
};

const PRESETS: Array<{ id: string; documents: Partial<Record<DocumentDossier, FormatChoisi>> }> = [
  { id: 'cctp', documents: { cctp: 'pdf' } },
  { id: 'cctp_dpgf', documents: { cctp: 'pdf', dpgf: 'pdf' } },
  { id: 'dce', documents: { cctp: 'pdf', dpgf: 'both', bpu: 'both' } },
];

/** Réunit les éléments de plusieurs documents sous une même clé (numéro ou code). */
function reunir<T>(sources: T[][], cle: (x: T) => string, label: (x: T) => string): Choix[] {
  const vus = new Map<string, Choix>();
  for (const liste of sources) for (const x of liste) if (!vus.has(cle(x))) vus.set(cle(x), { id: cle(x), label: label(x) });
  return [...vus.values()];
}

/**
 * Fenêtre unique d'export du dossier PRO : quels documents (CCTP, DPGF, DQE,
 * BPU, estimation), dans quels formats, sur quel périmètre (lots, bâtiments,
 * phases), avec ou sans prix. Plusieurs fichiers partent dans un ZIP. Le parent
 * ne la monte qu'à l'ouverture : l'état repart de zéro à chaque fois.
 */
export const ProExportDialog: React.FC<Props> = ({
  dpgf, bpu, bpuLoading, ongletActif, projectName, contexte, settings, prepareBpu, notify, onClose,
}) => {
  const { t } = useTranslation();
  const groupId = useId();
  const [documents, setDocuments] = useState<Partial<Record<DocumentDossier, FormatChoisi>>>(
    () => ({ [DEPART[ongletActif] ?? 'cctp']: 'pdf' }));
  const [mode, setMode] = useState<'all' | 'custom'>('all');
  const [avecPrix, setAvecPrix] = useState(false);
  const [avecTva, setAvecTva] = useState(false);
  const [cctpParBatiment, setCctpParBatiment] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState('');

  const bpuVide = !bpu || bpu.lots.length === 0;

  const lots = useMemo(() => reunir([dpgf.lots, bpu?.lots ?? []], l => cleLot(l.numero), l => `${l.numero} ${l.titre}`.trim()), [dpgf.lots, bpu?.lots]);
  const batiments = useMemo(() => {
    const liste = reunir(
      [dpgf.multiBatiments ? dpgf.batiments ?? [] : [], bpu?.multiBatiments ? bpu.batiments ?? [] : []],
      b => b.code, b => `${b.code}${b.libelle ? ` · ${b.libelle}` : ''}`);
    return liste.length ? [...liste, { id: SANS_AFFECTATION_EXPORT, label: t('pro_export_dialog_no_building') }] : [];
  }, [dpgf, bpu, t]);
  const phases = useMemo(() => {
    const liste = reunir(
      [dpgf.multiPhases ? dpgf.phases ?? [] : [], bpu?.multiPhases ? bpu.phases ?? [] : []],
      p => p.code, p => `${p.code}${p.libelle ? ` · ${p.libelle}` : ''}`);
    return liste.length ? [...liste, { id: SANS_AFFECTATION_EXPORT, label: t('pro_export_dialog_no_phase') }] : [];
  }, [dpgf, bpu, t]);

  const [lotIds, setLotIds] = useState<Set<string>>(() => new Set(lots.map(l => l.id)));
  const [batIds, setBatIds] = useState<Set<string>>(() => new Set(batiments.map(b => b.id)));
  const [phaseIds, setPhaseIds] = useState<Set<string>>(() => new Set(phases.map(p => p.id)));

  const selection: ExportSelection = useMemo(() => {
    if (mode === 'all') return SELECTION_COMPLETE;
    const ou = (set: Set<string>, all: Choix[]) => (all.length > 0 && all.every(c => set.has(c.id)) ? null : [...set]);
    return {
      lotNumeros: ou(lotIds, lots),
      batimentCodes: batiments.length ? ou(batIds, batiments) : null,
      phaseCodes: phases.length ? ou(phaseIds, phases) : null,
    };
  }, [mode, lotIds, batIds, phaseIds, lots, batiments, phases]);

  const nbFichiers = compterFichiers({ documents, selection, cctpParBatiment, dpgf });
  const nbDocuments = Object.keys(documents).length;

  const perimetre = (): string => {
    if (mode === 'all') return '';
    const noms = (set: Set<string>, all: Choix[]) => all.filter(c => set.has(c.id)).map(c => c.label.split(' · ')[0]);
    const parties: string[] = [];
    if (selection.lotNumeros) parties.push(`${t('pro_export_dialog_lots')} ${noms(lotIds, lots).map(l => l.split(' ')[0]).join(', ')}`);
    if (selection.batimentCodes) parties.push(`${t('pro_export_dialog_buildings')} ${noms(batIds, batiments).join(', ')}`);
    if (selection.phaseCodes) parties.push(`${t('pro_export_dialog_phases')} ${noms(phaseIds, phases).join(', ')}`);
    return parties.join(' - ');
  };

  const lancer = async () => {
    setBusy(true);
    setErreur('');
    try {
      const bpuPret = documents.bpu || documents.dqe ? prepareBpu() : null;
      const res = await produireDossier({
        dpgf, bpu: bpuPret, documents, selection, avecPrix, avecTva: avecPrix && avecTva, cctpParBatiment,
        projectName, perimetre: perimetre(), settings, contexte,
      });
      for (const a of res.avertissements) {
        notify?.(
          a.code === 'vide'
            ? t('pro_export_dialog_warn_empty', { doc: t(`pro_export_doc_${a.document}`) })
            : t('pro_cctp_export_unassigned', { count: a.count }),
          { type: 'error' },
        );
      }
      if (res.fichiers.length === 0) { setErreur(t('pro_export_dialog_nothing')); return; }
      await livrer(res.fichiers, `Dossier_PRO_${nomSur(projectName ?? dpgf.titre)}.zip`);
      onClose();
    } catch (e) {
      setErreur(t('pro_export_dialog_error', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const ligneDocument = (doc: DocumentDossier) => {
    const choix = documents[doc];
    const indisponible = (doc === 'bpu' || doc === 'dqe') && (bpuLoading || bpuVide);
    const autre = doc === 'cctp' ? t('pro_export_word') : t('pro_export_excel');
    return (
      <div key={doc} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
        <label className="flex items-center gap-2.5 min-w-0 flex-1 basis-56 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-[var(--tblr-primary)] shrink-0"
            checked={!!choix} disabled={indisponible}
            onChange={e => setDocuments(prev => {
              const { [doc]: _retire, ...reste } = prev;
              return e.target.checked ? { ...reste, [doc]: 'pdf' as FormatChoisi } : reste;
            })} />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-[var(--tblr-text)]">{t(`pro_export_doc_${doc}`)}</span>
            <span className="block text-xs text-[var(--tblr-muted)]">
              {indisponible ? (bpuLoading ? t('pro_export_dialog_loading') : t('pro_export_dialog_bpu_empty')) : t(`pro_export_doc_${doc}_hint`)}
            </span>
          </span>
        </label>
        <select
          aria-label={t('pro_export_dialog_format_of', { doc: t(`pro_export_doc_${doc}`) })}
          className="tblr-input w-auto text-sm" disabled={!choix}
          value={choix ?? 'pdf'}
          onChange={e => setDocuments(prev => ({ ...prev, [doc]: e.target.value as FormatChoisi }))}
        >
          <option value="pdf">{t('pro_export_pdf')}</option>
          <option value="autre">{autre}</option>
          <option value="both">{t('pro_export_dialog_both', { autre })}</option>
        </select>
      </div>
    );
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
      <div className="max-h-40 overflow-y-auto rounded-md border border-[var(--tblr-border)] divide-y divide-[var(--tblr-border)]">
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

  const titreSection = (texte: string) => (
    <h3 className="text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)] mb-1.5">{texte}</h3>
  );

  return (
    <DialogShell
      open
      title={t('pro_export_dialog_title')}
      subtitle={t('pro_export_dialog_subtitle')}
      onClose={onClose}
      busy={busy}
      footer={(
        <>
          <span className="mr-auto text-xs text-[var(--tblr-muted)] flex items-center gap-1.5" aria-live="polite">
            {nbFichiers > 1 && <IconFileZip size={14} aria-hidden />}
            {nbFichiers === 0 ? t('pro_export_dialog_none') : nbFichiers === 1 ? t('pro_export_dialog_one_file') : t('pro_export_dialog_zip', { count: nbFichiers })}
          </span>
          <button type="button" className={boutonSecondaire} onClick={onClose} disabled={busy}>{t('pro_versions_close')}</button>
          <button type="button" className={boutonPrincipal} disabled={nbFichiers === 0 || busy} onClick={() => { void lancer(); }}>
            {busy ? t('pro_export_dialog_running') : t('pro_export')}
          </button>
        </>
      )}
    >
      <div className="space-y-5">
        <section>
          {titreSection(t('pro_export_dialog_documents'))}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PRESETS.map(p => (
              <button key={p.id} type="button" className="btn btn-secondary text-xs"
                onClick={() => setDocuments(prev => ({ ...p.documents, ...(prev.estimation ? { estimation: prev.estimation } : {}) }))}>
                {t(`pro_export_preset_${p.id}`)}
              </button>
            ))}
          </div>
          <div className="rounded-md border border-[var(--tblr-border)] divide-y divide-[var(--tblr-border)]">
            {DOCUMENTS_DOSSIER.filter(d => d !== 'estimation').map(ligneDocument)}
          </div>
        </section>

        <section>
          {titreSection(t('pro_export_dialog_internal'))}
          <div className="rounded-md border border-[var(--tblr-border)]">{ligneDocument('estimation')}</div>
        </section>

        <section className="space-y-3">
          {titreSection(t('pro_export_dialog_scope'))}
          <div role="radiogroup" aria-label={t('pro_export_dialog_scope')} className="space-y-1">
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
          {mode === 'custom' && (
            <>
              {groupe(t('pro_export_dialog_lots'), lots, lotIds, setLotIds)}
              {batiments.length > 0 && groupe(t('pro_export_dialog_buildings'), batiments, batIds, setBatIds)}
              {phases.length > 0 && groupe(t('pro_export_dialog_phases'), phases, phaseIds, setPhaseIds)}
              {batiments.length > 0 && documents.cctp && (
                <p className="text-xs text-[var(--tblr-muted)]">{t('pro_export_dialog_cctp_buildings_hint')}</p>
              )}
            </>
          )}
        </section>

        <section className="space-y-1">
          {titreSection(t('pro_export_dialog_options'))}
          <label className="flex items-start gap-2.5 text-sm cursor-pointer min-h-[2.75rem] sm:min-h-0">
            <input type="checkbox" className="w-4 h-4 mt-0.5 accent-[var(--tblr-primary)]" checked={avecPrix} onChange={e => setAvecPrix(e.target.checked)} />
            <span>
              <span className="font-medium text-[var(--tblr-text)]">{t('pro_export_dialog_prices')}</span>
              <span className="block text-xs text-[var(--tblr-muted)]">{t('pro_export_dialog_prices_hint')}</span>
            </span>
          </label>
          {avecPrix && documents.dpgf && (
            <label className="flex items-start gap-2.5 text-sm cursor-pointer min-h-[2.75rem] sm:min-h-0 ml-6">
              <input type="checkbox" className="w-4 h-4 mt-0.5 accent-[var(--tblr-primary)]" checked={avecTva} onChange={e => setAvecTva(e.target.checked)} />
              <span>
                <span className="font-medium text-[var(--tblr-text)]">{t('pro_export_dialog_vat')}</span>
                <span className="block text-xs text-[var(--tblr-muted)]">{t('pro_export_dialog_vat_hint')}</span>
              </span>
            </label>
          )}
          {dpgf.multiBatiments && documents.cctp && (
            <label className="flex items-start gap-2.5 text-sm cursor-pointer min-h-[2.75rem] sm:min-h-0">
              <input type="checkbox" className="w-4 h-4 mt-0.5 accent-[var(--tblr-primary)]" checked={cctpParBatiment} onChange={e => setCctpParBatiment(e.target.checked)} />
              <span className="font-medium text-[var(--tblr-text)]">{t('pro_export_dialog_cctp_per_building')}</span>
            </label>
          )}
        </section>

        {nbDocuments === 0 && <p className="text-xs text-[var(--tblr-muted)]">{t('pro_export_dialog_pick')}</p>}
        {erreur && <p role="alert" className="text-sm text-red-600">{erreur}</p>}
      </div>
    </DialogShell>
  );
};
