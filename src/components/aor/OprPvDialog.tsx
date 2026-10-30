// Formulaire du PV d'OPR, privé (modèle simplifié du cabinet) ou public (formulaires EXE4 et EXE5) :
// lot, présences et constats (A), proposition du maître d'œuvre (B), décision du maître d'ouvrage
// (C, privé seulement pour l'instant), réserves de l'annexe, délais, contrôles de cohérence et
// signature. À monter comme enfant direct d'un AnimatePresence (ModalShell).
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconDownload, IconLock } from '@tabler/icons-react';
import { reservesDuPv } from '../../lib/oprPvReserves';
import { ModalShell } from '../ui/ModalShell';
import type { AgencySettings } from '../../lib/proposalExport';
import {
  NATURES_AVEC_ANNEXE, NATURES_RESERVE, controlerPv, formulairesDuPv, pvVierge, statutPv,
  type AvisReception, type ConditionReserve, type Constats, type Decision, type IssueDecision, type Levee, type NatureReserve, type OprPv, type OptionLevee, type Presences, type RegimeMarche,
} from '../../lib/oprPv';
import { DELAIS_PAR_DEFAUT, echeances } from '../../lib/oprPvDelais';
import { libelleLot, dateFr, type DonneesPvPrive } from '../../lib/oprPvDocument';
import type { FormulaireExeAvecRendu } from '../../lib/oprPvExe';
import { donneesExe, donneesPvPrive, telechargerExe, telechargerPvDocx, telechargerPvPdf } from '../../lib/oprPvExport';
import {
  STATUTS_RESERVE_LEVEE, type MarcheOpr, type PvOpr, type ReserveOpr, type useOprPv,
} from '../../hooks/useOprPv';

const CHAMP = 'w-full px-3 py-2 pointer-coarse:min-h-11 text-sm border border-[var(--tblr-border)] rounded-lg bg-[var(--tblr-surface)] text-[var(--tblr-text)] focus:outline-none focus:ring-2 focus:ring-[var(--tblr-primary)] disabled:opacity-60';
const LABEL = 'block text-xs font-semibold mb-1 text-[var(--tblr-muted)]';

export interface ProjetOpr {
  nom: string;
  code?: string | null;
  maitreOuvrage?: string | null;
  /** Fiche contact du maître d'ouvrage (adresse et SIRET du pouvoir adjudicateur). */
  maitreOuvrageId?: string | null;
  objet?: string | null;
}

interface Props {
  pv: PvOpr | null;
  /** Régime du PV à créer : celui de l'affaire (un PV existant garde le sien). */
  regime: RegimeMarche;
  marches: MarcheOpr[];
  reserves: ReserveOpr[];
  projet: ProjetOpr;
  settings: AgencySettings;
  api: ReturnType<typeof useOprPv>;
  onClose: () => void;
}

type CleConstat = 'epreuves' | 'travaux' | 'ouvrages' | 'pose_equipements' | 'installations' | 'terrains';
const CONSTATS: Array<{ cle: CleConstat; valeurs: string[]; publicSeul?: boolean }> = [
  { cle: 'epreuves', valeurs: ['non_effectuees', 'effectuees_sauf_annexe', 'concluantes', 'concluantes_sauf_annexe'] },
  { cle: 'travaux', valeurs: ['executes', 'executes_sauf_annexe'] },
  { cle: 'ouvrages', valeurs: ['conformes', 'conformes_sauf_annexe'] },
  { cle: 'pose_equipements', valeurs: ['conforme', 'non_conforme'], publicSeul: true },
  { cle: 'installations', valeurs: ['repliees', 'non_repliees'] },
  { cle: 'terrains', valeurs: ['remis_en_etat', 'non_remis_en_etat'] },
];

/** Constat « à l'exception de » : renvoie à une annexe numérotée (cerfa). */
const ANNEXE_DU_CONSTAT: Partial<Record<CleConstat, { nature: NatureReserve; valeurs: string[] }>> = {
  epreuves: { nature: 'epreuves', valeurs: ['effectuees_sauf_annexe', 'concluantes_sauf_annexe'] },
  travaux: { nature: 'travaux', valeurs: ['executes_sauf_annexe'] },
  ouvrages: { nature: 'malfacons', valeurs: ['conformes_sauf_annexe'] },
};

/** Conditions proposées en marché privé : le modèle simplifié réunit « sous réserve » et « avec réserve ». */
const CONDITIONS_PRIVE: NatureReserve[] = ['travaux', 'epreuves', 'malfacons', 'installations'];
/** Marché public : le cerfa sépare « sous réserve » (épreuves, travaux) et « avec réserve » (malfaçons, repli, pose). */
const CONDITIONS_PUBLIC: Record<'sous_reserve' | 'avec_reserve', NatureReserve[]> = {
  sous_reserve: ['epreuves', 'travaux'],
  avec_reserve: ['malfacons', 'installations', 'pose'],
};
const AVEC_DATE: NatureReserve[] = ['travaux', 'malfacons', 'installations', 'pose'];

function Champ({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL}>{label}</label>
      {children(id)}
    </div>
  );
}

function Choix<T extends string>({ legende, valeur, options, onChange }: {
  legende: string; valeur: T | null; options: Array<[T, string]>; onChange: (v: T | null) => void;
}) {
  const { t } = useTranslation();
  const nom = useId();
  return (
    <fieldset className="space-y-1">
      <legend className={LABEL}>{legende}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {options.map(([v, texte]) => (
          <label key={v} className="flex items-center gap-2 text-sm pointer-coarse:min-h-11">
            <input type="radio" name={nom} checked={valeur === v} onChange={() => onChange(v)} />
            {texte}
          </label>
        ))}
        {valeur !== null && (
          <button type="button" aria-label={t('opr_clear_choice')} className="px-2 text-xs underline text-[var(--tblr-muted)] pointer-coarse:min-h-11" onClick={() => onChange(null)}>×</button>
        )}
      </div>
    </fieldset>
  );
}

function Conditions({ conditions, refaction, natures, avecAnnexe, datees = AVEC_DATE, onChange, onRefaction }: {
  conditions: ConditionReserve[]; refaction: number | null; natures: NatureReserve[]; avecAnnexe: boolean;
  /** Natures qui demandent une date limite. */
  datees?: readonly NatureReserve[];
  onChange: (c: ConditionReserve[]) => void; onRefaction?: (v: number | null) => void;
}) {
  const { t } = useTranslation();
  const basculer = (nature: NatureReserve) =>
    onChange(conditions.some(c => c.nature === nature)
      ? conditions.filter(c => c.nature !== nature)
      : [...conditions, { nature, avant_le: null, annexe: null }]);
  const maj = (nature: NatureReserve, patch: Partial<ConditionReserve>) =>
    onChange(conditions.map(c => (c.nature === nature ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-2 pl-1">
      {natures.map(nature => {
        const c = conditions.find(x => x.nature === nature);
        return (
          <div key={nature} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <label className="flex items-center gap-2 text-sm pointer-coarse:min-h-11 flex-1 min-w-56">
              <input type="checkbox" checked={!!c} onChange={() => basculer(nature)} />
              {t(`opr_cond_${nature}`)}
            </label>
            {c && datees.includes(nature) && (
              <label className="flex items-center gap-2 text-xs text-[var(--tblr-muted)]">
                {t('opr_cond_before')}
                <input type="date" className={`${CHAMP} w-auto`} value={c.avant_le ?? ''} onChange={e => maj(nature, { avant_le: e.target.value || null })} />
              </label>
            )}
            {c && avecAnnexe && NATURES_AVEC_ANNEXE.includes(nature) && (
              <label className="flex items-center gap-2 text-xs text-[var(--tblr-muted)]">
                {t('opr_annex_number')}
                <input type="text" maxLength={20} className={`${CHAMP} w-24`} value={c.annexe ?? ''} onChange={e => maj(nature, { annexe: e.target.value || null })} />
              </label>
            )}
          </div>
        );
      })}
      {onRefaction && natures.includes('malfacons') && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--tblr-muted)] text-xs font-semibold">{t('opr_refaction')}</span>
          <input type="number" min={0} step="0.01" className={`${CHAMP} w-40`} value={refaction ?? ''}
            onChange={e => onRefaction(e.target.value === '' ? null : Number(e.target.value))} />
        </label>
      )}
    </div>
  );
}

function PresencesChoix({ valeur, onChange, publique }: { valeur: Presences; onChange: (p: Presences) => void; publique: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <Choix legende={publique ? t('opr_presence_moa_public') : t('opr_presence_moa')} valeur={valeur.moa}
        options={[['present', t('opr_opt_present')], ['absent_avise', t('opr_opt_absent_avise')], ['absent', t('opr_opt_absent')]]}
        onChange={v => onChange({ ...valeur, moa: v })} />
      <Choix legende={publique ? t('opr_presence_company_public') : t('opr_presence_company')} valeur={valeur.entreprise}
        options={[['presente', t('opr_opt_presente')], ['absente_convoquee', t('opr_opt_absente_convoquee')]]}
        onChange={v => onChange({ ...valeur, entreprise: v })} />
      {valeur.entreprise === 'absente_convoquee' && (
        <Champ label={t('opr_convocation_date')}>
          {id => <input id={id} type="date" className={`${CHAMP} sm:w-60`} value={valeur.date_convocation ?? ''} onChange={e => onChange({ ...valeur, date_convocation: e.target.value || null })} />}
        </Champ>
      )}
    </>
  );
}

function ConstatsGrid({ valeur, onChange, publique }: { valeur: Constats; onChange: (c: Constats) => void; publique: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {CONSTATS.filter(c => publique || !c.publicSeul).map(({ cle, valeurs }) => {
        const annexe = ANNEXE_DU_CONSTAT[cle];
        const choisi = valeur[cle] as string | null;
        return (
          <div key={cle} className="space-y-2">
            <Champ label={t(`opr_c_${cle}`)}>
              {id => (
                <select id={id} className={CHAMP} value={choisi ?? ''} onChange={e => onChange({ ...valeur, [cle]: e.target.value || null })}>
                  <option value="">{t('opr_unset')}</option>
                  {valeurs.map(v => <option key={v} value={v}>{t(`opr_opt_${v}`)}</option>)}
                </select>
              )}
            </Champ>
            {publique && annexe && choisi && annexe.valeurs.includes(choisi) && (
              <Champ label={`${t('opr_annex_number')} (${t(`opr_c_${cle}`)})`}>
                {id => <input id={id} maxLength={20} className={`${CHAMP} w-28`} value={valeur.annexes[annexe.nature] ?? ''}
                  onChange={e => onChange({ ...valeur, annexes: { ...valeur.annexes, [annexe.nature]: e.target.value || undefined } })} />}
              </Champ>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Décision du maître d'ouvrage en marché public (EXE6 : réception, EXE7 : non-réception). */
function DecisionPublique({ decision, onChange }: { decision: Decision; onChange: (d: Decision) => void }) {
  const { t } = useTranslation();
  const natures = decision.issue === 'sous_reserve' || decision.issue === 'avec_reserve' ? CONDITIONS_PUBLIC[decision.issue] : [];
  const issues: Array<[IssueDecision, string]> = [
    ['sans_reserve', t('opr_issue_sans_reserve')], ['sous_reserve', t('opr_avis_sous_reserve_public')],
    ['avec_reserve', t('opr_avis_avec_reserve_public')], ['non_receptionnee', t('opr_issue_non_receptionnee')],
  ];
  const changer = (issue: IssueDecision | null) => {
    const permises: NatureReserve[] = issue === 'sous_reserve' || issue === 'avec_reserve' ? CONDITIONS_PUBLIC[issue] : [];
    onChange({
      ...decision, issue, conditions: decision.conditions.filter(c => permises.includes(c.nature)),
      refaction_montant: permises.includes('malfacons') ? decision.refaction_montant : null,
      refaction_acceptee_le: permises.includes('malfacons') ? decision.refaction_acceptee_le : null,
    });
  };
  return (
    <>
      <Choix legende={t('opr_section_c')} valeur={decision.issue} options={issues} onChange={changer} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Champ label={t('opr_date_decision')}>{id => <input id={id} type="date" className={CHAMP} value={decision.date_decision ?? ''} onChange={e => onChange({ ...decision, date_decision: e.target.value || null })} />}</Champ>
        <Champ label={t('opr_date_effet')}>{id => <input id={id} type="date" className={CHAMP} value={decision.date_effet ?? ''} onChange={e => onChange({ ...decision, date_effet: e.target.value || null })} />}</Champ>
        {natures.includes('malfacons') && (
          <Champ label={t('opr_refaction_letter')}>{id => <input id={id} type="date" className={CHAMP} value={decision.refaction_acceptee_le ?? ''} onChange={e => onChange({ ...decision, refaction_acceptee_le: e.target.value || null })} />}</Champ>
        )}
      </div>
      {natures.length > 0 && (
        <Conditions conditions={decision.conditions} refaction={decision.refaction_montant} natures={natures} avecAnnexe
          onChange={c => onChange({ ...decision, conditions: c })} onRefaction={v => onChange({ ...decision, refaction_montant: v })} />
      )}
    </>
  );
}

const OPTIONS_LEVEE: OptionLevee[] = ['rapporter', 'lever_toutes', 'maintenir_toutes', 'lever_partie'];
const NATURES_LEVEE_DATEES: NatureReserve[] = ['installations', 'pose'];

/** Une option de levée (proposition du maître d'œuvre ou décision du maître d'ouvrage) avec ses réserves maintenues. */
function ChoixLevee<V extends { option: string | null; date: string | null; annexe_levees: string | null; maintenues: ConditionReserve[] }>({ legende, valeur, accepter, onChange }: {
  legende: string; valeur: V; accepter?: boolean; onChange: (v: V) => void;
}) {
  const { t } = useTranslation();
  const options: Array<[string, string]> = [
    ...(accepter ? [['accepter', t('opr_levee_opt_accepter')] as [string, string]] : []),
    ...OPTIONS_LEVEE.map(o => [o, t(`opr_levee_opt_${o}`)] as [string, string]),
  ];
  const partie = valeur.option === 'lever_partie';
  return (
    <div className="space-y-3">
      <Choix legende={legende} valeur={valeur.option} options={options}
        onChange={o => onChange({ ...valeur, option: o, ...(o === 'lever_partie' ? {} : { maintenues: [], annexe_levees: null }) })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Champ label={t('opr_date_levee_step')}>{id => <input id={id} type="date" className={CHAMP} value={valeur.date ?? ''} onChange={e => onChange({ ...valeur, date: e.target.value || null })} />}</Champ>
        {partie && <Champ label={t('opr_levee_annex')}>{id => <input id={id} maxLength={20} className={`${CHAMP} w-28`} value={valeur.annexe_levees ?? ''} onChange={e => onChange({ ...valeur, annexe_levees: e.target.value || null })} />}</Champ>}
      </div>
      {partie && (
        <>
          <p className="text-xs font-semibold text-[var(--tblr-muted)]">{t('opr_levee_kept')}</p>
          <Conditions conditions={valeur.maintenues} refaction={null} natures={[...NATURES_RESERVE]} avecAnnexe datees={NATURES_LEVEE_DATEES}
            onChange={c => onChange({ ...valeur, maintenues: c })} />
        </>
      )}
    </div>
  );
}

/** Levée des réserves en marché public : PV de levée (EXE8), puis propositions et décision (EXE9). */
function LeveePublique({ levee, onChange }: { levee: Levee; onChange: (l: Levee) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <Champ label={t('opr_levee_pv_date')}>{id => <input id={id} type="date" className={`${CHAMP} sm:w-60`} value={levee.date_pv ?? ''} onChange={e => onChange({ ...levee, date_pv: e.target.value || null })} />}</Champ>
      <PresencesChoix valeur={levee.presences} onChange={p => onChange({ ...levee, presences: p })} publique />
      <ConstatsGrid valeur={levee.constats} onChange={c => onChange({ ...levee, constats: c })} publique />
      <h4 className="text-sm font-semibold">{t('opr_levee_proposal')}</h4>
      <ChoixLevee legende={t('opr_levee_proposal')} valeur={levee.proposition} onChange={p => onChange({ ...levee, proposition: p })} />
      <h4 className="text-sm font-semibold">{t('opr_levee_decision')}</h4>
      <ChoixLevee legende={t('opr_levee_decision')} valeur={levee.decision} accepter onChange={d => onChange({ ...levee, decision: d })} />
    </div>
  );
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);

export function OprPvDialog({ pv, regime, marches, reserves: toutesReserves, projet, settings, api, onClose }: Props) {
  const { t } = useTranslation();
  const [form, setForm] = useState<OprPv>(() => pv?.pv ?? pvVierge(regime));
  const [lieu, setLieu] = useState(pv?.lieu ?? '');
  const [modeSignature, setModeSignature] = useState<'papier' | 'electronique'>('papier');
  const [dateSignature, setDateSignature] = useState(aujourdhui());
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const initial = useRef(JSON.stringify(form));
  const signe = !!pv?.signed_at;
  const publique = form.regime === 'public';

  const marche = marches.find(m => m.id === form.marche_id) ?? null;
  const lot = libelleLot(marche?.lot_numero, marche?.lot_titre);
  const entreprise = marche?.entreprise_nom ?? '';
  // Les réserves ne se saisissent pas dans le PV : elles viennent de la liste des réserves, celles de l'entreprise du marché.
  const reserves = useMemo(() => reservesDuPv(toutesReserves, marche, pv?.id), [toutesReserves, marche, pv?.id]);
  const modifie = JSON.stringify(form) !== initial.current || lieu !== (pv?.lieu ?? '');
  const set = <K extends keyof OprPv>(cle: K, valeur: OprPv[K]) => setForm(f => ({ ...f, [cle]: valeur }));
  const setInfo = (patch: Partial<OprPv['public_info']>) => set('public_info', { ...form.public_info, ...patch });

  const reservesOuvertes = reserves.filter(r => !STATUTS_RESERVE_LEVEE.has(r.status ?? '')).length;
  const controle = useMemo(() => controlerPv(form, { reservesOuvertes }), [form, reservesOuvertes]);
  const liste = useMemo(() => echeances(form, aujourdhui()), [form]);
  const statut = statutPv(form);

  /** Ce que l'écran montre : le formulaire tel que saisi, avec les réserves de la liste. */
  const donneesExport = (): DonneesPvPrive => donneesPvPrive({
    pv: form, reference: pv?.reference_pv, maitreOuvrage: projet.maitreOuvrage, objet: projet.objet || projet.nom,
    marche, reserves, agence: settings.agencyName,
  });

  const exporter = async (format: 'pdf' | 'docx') => {
    setErreur(null);
    try {
      if (format === 'pdf') await telechargerPvPdf(donneesExport(), settings);
      else await telechargerPvDocx(donneesExport(), settings);
    } catch (e: any) { setErreur(e?.message || t('opr_error_generic')); }
  };

  /** Cerfa du marché public : identité du titulaire et du pouvoir adjudicateur lue sur leurs fiches contact. */
  const exporterExe = async (code: FormulaireExeAvecRendu, format: 'pdf' | 'docx') => {
    setErreur(null);
    try {
      const [titulaireContact, maitreOuvrageContact] = await Promise.all([
        api.obtenirContact(marche?.contact_id), api.obtenirContact(projet.maitreOuvrageId),
      ]);
      const donnees = donneesExe({
        pv: form, reference: pv?.reference_pv, projet, maitreOuvrageContact, marche, titulaireContact, agence: settings, lieu: lieu || null,
        reserves,
      });
      await telechargerExe(code, donnees, format, settings);
    } catch (e: any) { setErreur(e?.message || t('opr_error_generic')); }
  };

  const enregistrer = async () => {
    setErreur(null);
    if (!form.marche_id) return setErreur(t('opr_error_lot_required'));
    setEnCours(true);
    try {
      const corps: Record<string, unknown> = {
        marche_id: form.marche_id,
        date_avis_achevement: form.date_avis_achevement, date_achevement_annoncee: form.date_achevement_annoncee, date_opr: form.date_opr,
        presences: form.presences, constats: form.constats, proposition: form.proposition, decision: form.decision,
        levee: form.levee, carence: form.carence, delais: form.delais,
        ...(publique ? { ccag_version: form.ccag_version, public_info: form.public_info, lieu: lieu || null } : {}),
      };
      const id: string = pv
        ? (await api.modifier(pv.id, corps), pv.id)
        : (await api.creer({ ...corps, date: form.date_opr || aujourdhui() })).id;
      onClose();
    } catch (e: any) {
      setErreur(e?.message || t('opr_error_generic'));
    } finally {
      setEnCours(false);
    }
  };

  const geste = async (action: () => Promise<unknown>) => {
    setErreur(null);
    setEnCours(true);
    try { await action(); onClose(); } catch (e: any) { setErreur(e?.message || t('opr_error_generic')); } finally { setEnCours(false); }
  };

  /** Change la nature d'une réserve déjà enregistrée sans fermer la fenêtre. */
  const changerNature = async (id: string, nature: NatureReserve | '') => {
    setErreur(null);
    try { await api.changerNatureReserve(id, nature); } catch (e: any) { setErreur(e?.message || t('opr_error_generic')); }
  };

  const avis: Array<[AvisReception, string]> = publique
    ? [['sans_reserve', t('opr_avis_sans_reserve')], ['sous_reserve', t('opr_avis_sous_reserve_public')], ['avec_reserve', t('opr_avis_avec_reserve_public')], ['non_reception', t('opr_avis_non_reception')]]
    : [['sans_reserve', t('opr_avis_sans_reserve')], ['sous_reserve', t('opr_avis_sous_reserve')], ['non_reception', t('opr_avis_non_reception')]];
  const issues: Array<[IssueDecision, string]> = [
    ['sans_reserve', t('opr_issue_sans_reserve')], ['sous_reserve', t('opr_issue_sous_reserve')], ['non_receptionnee', t('opr_issue_non_receptionnee')],
  ];
  const sousReserve = (v: string | null) => v === 'sous_reserve' || v === 'avec_reserve';
  /** Natures proposées pour un avis : public, celles du cerfa ; privé, les quatre du modèle simplifié. */
  const naturesPour = (v: string | null): NatureReserve[] =>
    !publique ? CONDITIONS_PRIVE : v === 'sous_reserve' || v === 'avec_reserve' ? CONDITIONS_PUBLIC[v] : [];
  const changerAvis = (v: AvisReception | null) => set('proposition', {
    ...form.proposition, avis: v,
    conditions: form.proposition.conditions.filter(c => naturesPour(v).includes(c.nature)),
    refaction_montant: naturesPour(v).includes('malfacons') ? form.proposition.refaction_montant : null,
  });
  const section = (titre: string) => <h3 className="text-sm font-bold uppercase tracking-wide border-b border-[var(--tblr-border)] pb-1 pt-2">{titre}</h3>;

  return (
    <ModalShell
      size="lg" onClose={onClose} busy={enCours} dirty={modifie && !signe} bodyClassName="p-4 sm:p-6 space-y-5"
      title={pv ? t('opr_dialog_edit', { ref: pv.reference_pv ?? '' }) : t('opr_dialog_new')}
      subtitle={[lot, entreprise].filter(Boolean).join(' · ') || undefined}
      footer={(
        <>
          {pv && !publique && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => exporter('pdf')}><IconDownload size={14} /> {t('opr_pdf')}</button>
              <button type="button" className="btn btn-secondary" onClick={() => exporter('docx')}><IconDownload size={14} /> {t('opr_word')}</button>
            </>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={enCours}>{t('btn_cancel')}</button>
          {!signe && <button type="button" className="btn btn-primary disabled:opacity-60" onClick={enregistrer} disabled={enCours}>{t('opr_save')}</button>}
        </>
      )}
    >
      {signe && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface-2)] p-3 text-sm">
          <IconLock size={16} aria-hidden />
          <span className="flex-1">{t('opr_signed_locked', { date: dateFr(pv?.signed_at) })}</span>
          <button type="button" className="btn btn-secondary" disabled={enCours} onClick={() => geste(() => api.rouvrir(pv!.id))}>{t('opr_reopen')}</button>
        </div>
      )}
      {erreur && <p role="alert" className="text-sm text-red-600">{erreur}</p>}

      <fieldset disabled={signe || enCours} className="space-y-5 min-w-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ label={t('opr_field_lot')}>
            {id => (
              <select id={id} className={CHAMP} value={form.marche_id ?? ''} disabled={!!pv} onChange={e => set('marche_id', e.target.value || null)}>
                <option value="">{t('opr_field_lot_placeholder')}</option>
                {marches.map(m => (
                  <option key={m.id} value={m.id}>{[libelleLot(m.lot_numero, m.lot_titre), m.entreprise_nom].filter(Boolean).join(' · ')}</option>
                ))}
              </select>
            )}
          </Champ>
          <Champ label={t('opr_field_opr_date')}>{id => <input id={id} type="date" className={CHAMP} value={form.date_opr ?? ''} onChange={e => set('date_opr', e.target.value || null)} />}</Champ>
          <Champ label={t('opr_field_notice_date')}>{id => <input id={id} type="date" className={CHAMP} value={form.date_avis_achevement ?? ''} onChange={e => set('date_avis_achevement', e.target.value || null)} />}</Champ>
          <Champ label={t('opr_field_announced_date')}>{id => <input id={id} type="date" className={CHAMP} value={form.date_achevement_annoncee ?? ''} onChange={e => set('date_achevement_annoncee', e.target.value || null)} />}</Champ>
        </div>

        {publique && (
          <>
            {section(t('opr_section_public'))}
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ label={t('opr_ccag')}>
                {id => (
                  <select id={id} className={CHAMP} value={form.ccag_version ?? ''} onChange={e => set('ccag_version', (e.target.value || null) as OprPv['ccag_version'])}>
                    <option value="">{t('opr_unset')}</option>
                    <option value="2021">{t('opr_ccag_2021')}</option>
                    <option value="2009">{t('opr_ccag_2009')}</option>
                  </select>
                )}
              </Champ>
              <Champ label={t('opr_market_reference')}>{id => <input id={id} maxLength={64} className={CHAMP} value={form.public_info.reference_marche ?? ''} onChange={e => setInfo({ reference_marche: e.target.value || null })} />}</Champ>
              <Champ label={t('opr_signatory')}>{id => <input id={id} maxLength={200} className={CHAMP} placeholder={settings.architectName ?? ''} value={form.public_info.signataire ?? ''} onChange={e => setInfo({ signataire: e.target.value || null })} />}</Champ>
              <Champ label={t('opr_place')}>{id => <input id={id} maxLength={120} className={CHAMP} value={lieu} onChange={e => setLieu(e.target.value)} />}</Champ>
            </div>
            <Choix legende={t('opr_scope')} valeur={form.public_info.portee}
              options={[['totale', t('opr_scope_totale')], ['partielle', t('opr_scope_partielle')]]}
              onChange={v => setInfo({ portee: v })} />
            <Champ label={t('opr_services')}>
              {id => <textarea id={id} rows={2} maxLength={2000} className={CHAMP} value={form.public_info.prestations ?? ''} onChange={e => setInfo({ prestations: e.target.value || null })} />}
            </Champ>
          </>
        )}

        {section(t('opr_section_a'))}
        <PresencesChoix valeur={form.presences} onChange={p => set('presences', p)} publique={publique} />
        <ConstatsGrid valeur={form.constats} onChange={c => set('constats', c)} publique={publique} />

        {section(t('opr_section_b'))}
        <Choix legende={t('opr_section_b')} valeur={form.proposition.avis} options={avis} onChange={changerAvis} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ label={t('opr_date_proposition')}>{id => <input id={id} type="date" className={CHAMP} value={form.proposition.date_proposition ?? ''} onChange={e => set('proposition', { ...form.proposition, date_proposition: e.target.value || null })} />}</Champ>
          <Champ label={t('opr_date_achevement')}>{id => <input id={id} type="date" className={CHAMP} value={form.proposition.date_achevement_retenue ?? ''} onChange={e => set('proposition', { ...form.proposition, date_achevement_retenue: e.target.value || null })} />}</Champ>
        </div>
        {sousReserve(form.proposition.avis) && (
          <Conditions conditions={form.proposition.conditions} refaction={form.proposition.refaction_montant}
            natures={naturesPour(form.proposition.avis)} avecAnnexe={publique}
            onChange={c => set('proposition', { ...form.proposition, conditions: c })}
            onRefaction={v => set('proposition', { ...form.proposition, refaction_montant: v })} />
        )}

        {section(t('opr_section_c'))}
        {publique ? (
          <DecisionPublique decision={form.decision} onChange={d => set('decision', d)} />
        ) : (
          <>
            <Choix legende={t('opr_section_c')} valeur={form.decision.issue} options={issues}
              onChange={v => set('decision', { ...form.decision, issue: v, conditions: sousReserve(v) ? form.decision.conditions : [] })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Champ label={t('opr_date_decision')}>{id => <input id={id} type="date" className={CHAMP} value={form.decision.date_decision ?? ''} onChange={e => set('decision', { ...form.decision, date_decision: e.target.value || null })} />}</Champ>
              <Champ label={t('opr_date_effet')}>{id => <input id={id} type="date" className={CHAMP} value={form.decision.date_effet ?? ''} onChange={e => set('decision', { ...form.decision, date_effet: e.target.value || null })} />}</Champ>
            </div>
            {sousReserve(form.decision.issue) && (
              <Conditions conditions={form.decision.conditions} refaction={form.decision.refaction_montant}
                natures={CONDITIONS_PRIVE} avecAnnexe={false}
                onChange={c => set('decision', { ...form.decision, conditions: c })}
                onRefaction={v => set('decision', { ...form.decision, refaction_montant: v })} />
            )}
          </>
        )}

        {publique && (form.decision.issue === 'sous_reserve' || form.decision.issue === 'avec_reserve') && (
          <>
            {section(t('opr_section_levee'))}
            <LeveePublique levee={form.levee} onChange={l => set('levee', l)} />
          </>
        )}

        {section(t('opr_reserves_title'))}
        <p className="text-xs text-[var(--tblr-muted)]">{t('opr_reserves_from_list', { entreprise: entreprise || t('opr_unset') })}</p>
        {reserves.length === 0 && <p className="text-sm text-[var(--tblr-muted)]">{t('opr_reserves_empty')}</p>}
        <ul className="space-y-1">
          {reserves.map(r => (
            <li key={r.id} className="flex items-start gap-2 text-sm">
              <span className="w-8 shrink-0 tabular-nums text-[var(--tblr-muted)]">{r.number ?? ''}</span>
              <span className="flex-1 min-w-0">{[r.batiment, r.local].filter(Boolean).join(' · ')}{r.batiment || r.local ? ' : ' : ''}{r.title}</span>
              {publique && (
                <select aria-label={t('opr_reserve_nature')} className={`${CHAMP} w-auto text-xs`} value={r.nature ?? ''} onChange={e => changerNature(r.id, e.target.value as NatureReserve | '')}>
                  <option value="">{t('opr_unset')}</option>
                  {NATURES_RESERVE.map(n => <option key={n} value={n}>{t(`opr_nature_${n}`)}</option>)}
                </select>
              )}
            </li>
          ))}
        </ul>

        {section(t('opr_deadlines_title'))}
        <p className="text-xs text-[var(--tblr-muted)]">{t('opr_delays_note')}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(['opr', 'decision', 'transmission_levee'] as const).map(cle => (
            <Champ key={cle} label={`${t(`opr_deadline_${cle}`)} (${t('opr_days')})`}>
              {id => (
                <input id={id} type="number" min={1} max={365} className={CHAMP} placeholder={String(DELAIS_PAR_DEFAUT[cle])} value={form.delais[cle] ?? ''}
                  onChange={e => {
                    const { [cle]: _retire, ...reste } = form.delais;
                    set('delais', e.target.value === '' ? reste : { ...reste, [cle]: Number(e.target.value) });
                  }} />
              )}
            </Champ>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {!publique && <Champ label={t('opr_levee_pv_date')}>{id => <input id={id} type="date" className={CHAMP} value={form.levee.date_pv ?? ''} onChange={e => set('levee', { ...form.levee, date_pv: e.target.value || null })} />}</Champ>}
          <Champ label={t('opr_levee_sent_date')}>{id => <input id={id} type="date" className={CHAMP} value={form.levee.date_transmission ?? ''} onChange={e => set('levee', { ...form.levee, date_transmission: e.target.value || null })} />}</Champ>
        </div>
      </fieldset>

      <ul className="space-y-1 text-sm" aria-label={t('opr_deadlines_title')}>
        {liste.map(e => (
          <li key={e.cle} className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{t(`opr_deadline_${e.cle}`)}</span>
            <span className="text-[var(--tblr-muted)]">{e.date_limite ? dateFr(e.date_limite) : ''}</span>
            <span className={e.etat === 'depasse' || e.etat === 'hors_delai' ? 'text-red-600 font-semibold' : e.etat === 'proche' ? 'text-amber-600 font-semibold' : e.etat === 'respectee' ? 'text-emerald-700' : 'text-[var(--tblr-muted)]'}>
              {t(`opr_state_${e.etat}`)}{e.jours_restants !== null ? ` (${e.jours_restants} ${t('opr_days')})` : ''}
            </span>
          </li>
        ))}
      </ul>

      {(controle.erreurs.length > 0 || controle.avertissements.length > 0) && (
        <div className="rounded-lg border border-[var(--tblr-border)] p-3 text-sm space-y-1">
          {controle.erreurs.length > 0 && <p className="font-semibold">{t('opr_to_fix')}</p>}
          {controle.erreurs.map(a => <p key={a.code + a.message} className="text-red-600">{a.message}</p>)}
          {controle.avertissements.length > 0 && <p className="font-semibold pt-1">{t('opr_warnings')}</p>}
          {controle.avertissements.map(a => <p key={a.code} className="text-amber-700">{a.message}</p>)}
        </div>
      )}

      {pv && publique && (
        <div className="rounded-lg border border-[var(--tblr-border)] p-3 space-y-2">
          <p className="text-sm font-semibold">{t('opr_documents')}</p>
          <ul className="space-y-1">
            {formulairesDuPv(form).map(code => (
              <li key={code} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex-1 min-w-48"><span className="font-semibold">{code}</span> · {t(`opr_form_${code}`)}</span>
                <button type="button" className="btn btn-secondary" onClick={() => exporterExe(code, 'pdf')}><IconDownload size={14} /> {t('opr_pdf')}</button>
                <button type="button" className="btn btn-secondary" onClick={() => exporterExe(code, 'docx')}><IconDownload size={14} /> {t('opr_word')}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pv && !signe && (
        <div className="rounded-lg border border-[var(--tblr-border)] p-3 space-y-2">
          <p className="text-sm font-semibold">{t('opr_sign_title')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <Champ label={t('opr_sign_mode')}>
              {id => (
                <select id={id} className={`${CHAMP} w-auto`} value={modeSignature} onChange={e => setModeSignature(e.target.value as 'papier' | 'electronique')}>
                  <option value="papier">{t('opr_sign_paper')}</option>
                  <option value="electronique">{t('opr_sign_electronic')}</option>
                </select>
              )}
            </Champ>
            <Champ label={t('opr_sign_date')}>{id => <input id={id} type="date" className={`${CHAMP} w-auto`} value={dateSignature} onChange={e => setDateSignature(e.target.value)} />}</Champ>
            <button type="button" className="btn btn-secondary disabled:opacity-60" disabled={enCours || modifie || controle.erreurs.length > 0}
              title={modifie ? t('opr_sign_save_first') : undefined} onClick={() => geste(() => api.signer(pv.id, modeSignature, dateSignature))}>
              {t('opr_sign_action')}
            </button>
          </div>
          <p className="text-xs text-[var(--tblr-muted)]">{t('opr_status_label')} : {t(`opr_status_${statut}`)}</p>
        </div>
      )}
    </ModalShell>
  );
}
