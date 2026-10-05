// Synthèse économique de l'opération : estimations, moins-disants, écarts,
// objectif de négociation, décision par lot, totaux HT/TVA/TTC et contrôle
// de la tolérance du CCAP. Les cellules calculées ne se saisissent pas.
import { useState } from 'react';
import { IconDownload, IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react';
import type { ProjectLot } from '../../types';
import type { AgencySettings } from '../../lib/proposalExport';
import { cn } from '../../lib/utils';
import {
  DECISION_LIBELLES, controleTolerance, estimatifComparatif, lignesSynthese, parametresDe,
  totauxOperation, type DecisionLot, type DonneesNegociation, type Etage, type SyntheseLotSaisie,
} from '../../lib/actNegociation';
import {
  genererPVOuverture, genererSynthesePDF, genererSyntheseExcel, type ConsultationNegociationExport,
} from '../../lib/actNegociationExport';
import { BOUTON, CARTE_STYLE, CHAMP, ENTETE_TH, Ecart, NumInput, eur } from './negociationUi';

interface Props {
  lots: ProjectLot[];
  consultation: ConsultationNegociationExport;
  projectName: string;
  settings: AgencySettings;
  onPatch: (patch: Partial<DonneesNegociation>) => void;
}

const NIVEAU_STYLE = {
  ok: 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300',
  tolere: 'bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300',
  depasse: 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300',
} as const;
const NIVEAU_TEXTE = {
  ok: 'sous l\'estimation actualisée',
  tolere: 'au-dessus de l\'estimation, dans la tolérance du CCAP',
  depasse: 'au-delà de la tolérance du CCAP',
} as const;

export default function SyntheseEconomique({ lots, consultation, projectName, settings, onPatch }: Props) {
  const [etage, setEtage] = useState<Etage>('courant');
  const params = parametresDe(consultation);
  const lignes = lignesSynthese(lots, consultation, etage);
  const totaux = totauxOperation(lignes, params);
  const controleOffres = controleTolerance(totaux.offres_total, totaux.estimation_pro_options, params);
  const controleObjectif = controleTolerance(totaux.objectif, totaux.estimation_pro_options, params);

  const majLot = (lotId: string, patch: Partial<SyntheseLotSaisie>) =>
    onPatch({ synthese: { ...(consultation.synthese ?? {}), [lotId]: { ...(consultation.synthese?.[lotId] ?? {}), ...patch } } });
  const majParams = (patch: Partial<typeof params>) => onPatch({ parametres: { ...params, ...patch } });

  return (
    <div className="space-y-5">
      {/* Paramètres et exports */}
      <div className="rounded-lg p-4 flex flex-wrap items-end gap-4" style={CARTE_STYLE}>
        <label className="flex flex-col gap-1 text-[0.6875rem] font-bold text-[var(--tblr-muted)]">TVA (%)
          <NumInput label="Taux de TVA" value={params.tva_pct} onChange={v => majParams({ tva_pct: v ?? 20 })} className="w-24" />
        </label>
        <label className="flex flex-col gap-1 text-[0.6875rem] font-bold text-[var(--tblr-muted)]">Tolérance du CCAP (%)
          <NumInput label="Tolérance du CCAP" value={params.tolerance_pct} onChange={v => majParams({ tolerance_pct: v ?? 0 })} className="w-24" />
        </label>
        <label className="flex flex-col gap-1 text-[0.6875rem] font-bold text-[var(--tblr-muted)]">Indice à la date de l'estimation
          <NumInput label="Indice à la date de l'estimation" value={params.indice_estimation} onChange={v => majParams({ indice_estimation: v })} className="w-36" placeholder="BT01" />
        </label>
        <label className="flex flex-col gap-1 text-[0.6875rem] font-bold text-[var(--tblr-muted)]">Dernier indice connu
          <NumInput label="Dernier indice connu" value={params.indice_connu} onChange={v => majParams({ indice_connu: v })} className="w-36" placeholder="BT01" />
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Prix comparés" className="inline-flex rounded-lg overflow-hidden border border-[var(--tblr-border)]">
            {(['ouverture', 'courant'] as const).map(e => (
              <button key={e} type="button" aria-pressed={etage === e} onClick={() => setEtage(e)}
                className={cn('px-3 py-1.5 text-xs font-bold', etage === e ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900' : 'bg-transparent text-[var(--tblr-muted)]')}>
                {e === 'ouverture' ? 'À l\'ouverture' : 'Prix négociés'}
              </button>
            ))}
          </div>
          <button type="button" className={BOUTON} onClick={() => genererSynthesePDF(lots, consultation, projectName, settings, etage)}><IconDownload size={12} /> PDF</button>
          <button type="button" className={BOUTON} onClick={() => genererSyntheseExcel(lots, consultation, projectName, settings, etage)}><IconDownload size={12} /> Excel</button>
          <button type="button" className={BOUTON} onClick={() => genererPVOuverture(lots, consultation, projectName, settings)}><IconDownload size={12} /> PV d'ouverture</button>
        </div>
      </div>

      {/* Tolérance */}
      <div role="status" className={cn('rounded-lg p-4 text-sm flex flex-wrap items-start gap-3', NIVEAU_STYLE[controleOffres.niveau])}>
        {controleOffres.niveau === 'ok' ? <IconCircleCheck size={18} /> : <IconAlertTriangle size={18} />}
        <div className="space-y-1">
          <p className="font-bold">
            Offres : {eur(totaux.offres_total)} HT, {NIVEAU_TEXTE[controleOffres.niveau]}
            {controleOffres.niveau !== 'ok' && ` (${eur(controleOffres.depassement)}, ${(controleOffres.depassement_pct ?? 0) >= 0 ? '+' : ''}${((controleOffres.depassement_pct ?? 0) * 100).toFixed(1).replace('.', ',')} %)`}.
          </p>
          <p className="text-xs">
            Estimation actualisée (coefficient {controleOffres.coefficient.toFixed(4)}) : {eur(controleOffres.estimation_actualisee)}. Plafond avec {params.tolerance_pct} % de tolérance : {eur(controleOffres.plafond)}.
            Objectif de négociation : {eur(totaux.objectif)}, {NIVEAU_TEXTE[controleObjectif.niveau]}.
          </p>
          <p className="text-xs">Les lots sans offre exploitable sont comptés à leur estimation.</p>
        </div>
      </div>

      {/* Tableau */}
      <div className="rounded-lg overflow-hidden" style={CARTE_STYLE}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1250px]">
            <thead className="bg-[var(--tblr-surface-2)]">
              <tr>
                <th className={cn(ENTETE_TH, 'text-left sticky left-0 bg-[var(--tblr-surface-2)]')}>Lot</th>
                <th className={cn(ENTETE_TH, 'text-right')}>Estimation APD</th>
                <th className={cn(ENTETE_TH, 'text-right')}>PRO base</th>
                <th className={cn(ENTETE_TH, 'text-right')}>PRO + options</th>
                <th className={cn(ENTETE_TH, 'text-right')}>Évolution</th>
                <th className={cn(ENTETE_TH, 'text-left')}>Moins-disant</th>
                <th className={cn(ENTETE_TH, 'text-right')}>Base HT</th>
                <th className={cn(ENTETE_TH, 'text-right')}>Écart base</th>
                <th className={cn(ENTETE_TH, 'text-right')}>Base + options</th>
                <th className={cn(ENTETE_TH, 'text-right')}>Écart base + opt.</th>
                <th className={cn(ENTETE_TH, 'text-right')}>Objectif</th>
                <th className={cn(ENTETE_TH, 'text-left')}>Décision</th>
                <th className={cn(ENTETE_TH, 'text-left')}>Observations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--tblr-border)]">
              {lignes.map(l => {
                const lot = lots.find(x => x.id === l.lot_id)!;
                const saisie = consultation.synthese?.[l.lot_id];
                const defautDpgf = estimatifComparatif(consultation.comparatif, l.lot_id);
                const nom = consultation.entreprises.find(e => e.id === l.moinsDisantId)?.nom;
                return (
                  <tr key={l.lot_id} className="align-top">
                    <td className="px-3 py-2 font-medium sticky left-0 bg-[var(--tblr-surface)]">
                      <span className="text-[var(--tblr-muted)] mr-1">{lot.lot_number}</span>{lot.lot_title}
                    </td>
                    <td className="px-2 py-1.5 w-32"><NumInput label={`Estimation APD, lot ${lot.lot_number}`} value={saisie?.estimation_apd} onChange={v => majLot(l.lot_id, { estimation_apd: v })} /></td>
                    <td className="px-2 py-1.5 w-32"><NumInput label={`Estimation PRO base, lot ${lot.lot_number}`} value={saisie?.estimation_pro_base} placeholder={defautDpgf ? String(defautDpgf) : '—'} onChange={v => majLot(l.lot_id, { estimation_pro_base: v })} /></td>
                    <td className="px-2 py-1.5 w-32"><NumInput label={`Estimation PRO avec options, lot ${lot.lot_number}`} value={saisie?.estimation_pro_options} placeholder={l.estimation_pro_base != null ? String(l.estimation_pro_base) : '—'} onChange={v => majLot(l.lot_id, { estimation_pro_options: v })} /></td>
                    <td className="px-3 py-2 text-right"><Ecart valeur={l.evolution} pct={l.evolution_pct} /></td>
                    <td className="px-3 py-2">{nom ?? <span className="text-[var(--tblr-muted)]">—</span>}</td>
                    <td className="px-3 py-2 text-right">{eur(l.moinsDisantBase)}</td>
                    <td className="px-3 py-2 text-right"><Ecart valeur={l.ecart_base} pct={l.ecart_base_pct} /></td>
                    <td className="px-3 py-2 text-right">{eur(l.moinsDisantTotal)}</td>
                    <td className="px-3 py-2 text-right"><Ecart valeur={l.ecart_total} pct={l.ecart_total_pct} /></td>
                    <td className="px-2 py-1.5 w-32"><NumInput label={`Objectif, lot ${lot.lot_number}`} value={saisie?.objectif} placeholder={l.objectif != null ? String(l.objectif) : '—'} onChange={v => majLot(l.lot_id, { objectif: v })} /></td>
                    <td className="px-2 py-1.5">
                      <select aria-label={`Décision, lot ${lot.lot_number}`} className={CHAMP} value={l.decision} onChange={e => majLot(l.lot_id, { decision: e.target.value as DecisionLot })}>
                        {(Object.keys(DECISION_LIBELLES) as DecisionLot[]).map(d => <option key={d} value={d}>{DECISION_LIBELLES[d]}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 min-w-[12rem]">
                      <input aria-label={`Observations, lot ${lot.lot_number}`} className={cn(CHAMP, 'w-full')} value={saisie?.observation ?? ''} onChange={e => majLot(l.lot_id, { observation: e.target.value })} />
                    </td>
                  </tr>
                );
              })}
              {lignes.length === 0 && <tr><td colSpan={13} className="px-4 py-8 text-center italic text-[var(--tblr-muted)]">Aucun lot défini.</td></tr>}
            </tbody>
            <tfoot className="bg-zinc-100 dark:bg-zinc-800 font-bold">
              <tr>
                <td className="px-3 py-2.5 sticky left-0 bg-zinc-100 dark:bg-zinc-800">Total HT</td>
                <td className="px-3 py-2.5 text-right">{eur(totaux.estimation_apd)}</td>
                <td className="px-3 py-2.5 text-right">{eur(totaux.estimation_pro_base)}</td>
                <td className="px-3 py-2.5 text-right">{eur(totaux.estimation_pro_options)}</td>
                <td className="px-3 py-2.5 text-right"><Ecart valeur={totaux.evolution} pct={totaux.evolution_pct} /></td>
                <td />
                <td className="px-3 py-2.5 text-right">{eur(totaux.offres_base)}</td>
                <td className="px-3 py-2.5 text-right"><Ecart valeur={totaux.ecart_base} pct={totaux.ecart_base_pct} /></td>
                <td className="px-3 py-2.5 text-right">{eur(totaux.offres_total)}</td>
                <td className="px-3 py-2.5 text-right"><Ecart valeur={totaux.ecart_total} pct={totaux.ecart_total_pct} /></td>
                <td className="px-3 py-2.5 text-right">{eur(totaux.objectif)}</td>
                <td colSpan={2} />
              </tr>
              <tr className="font-medium text-[var(--tblr-muted)]">
                <td className="px-3 py-1.5 sticky left-0 bg-zinc-100 dark:bg-zinc-800">TVA {params.tva_pct} %</td>
                <td colSpan={7} />
                <td className="px-3 py-1.5 text-right">{eur(totaux.tva_total)}</td>
                <td colSpan={4} />
              </tr>
              <tr>
                <td className="px-3 py-2 sticky left-0 bg-zinc-100 dark:bg-zinc-800">Montant TTC</td>
                <td colSpan={2} />
                <td className="px-3 py-2 text-right">{eur(totaux.ttc_estimation_pro_options)}</td>
                <td colSpan={4} />
                <td className="px-3 py-2 text-right">{eur(totaux.ttc_offres_total)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
