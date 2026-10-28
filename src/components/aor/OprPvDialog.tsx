// Formulaire du PV d'OPR privé (modèle simplifié du cabinet) : lot, présences et constats (A),
// proposition du maître d'œuvre (B), décision du maître d'ouvrage (C), réserves de l'annexe,
// délais, contrôles de cohérence et signature. À monter comme enfant direct d'un
// AnimatePresence (ModalShell).
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconDownload, IconLock, IconTrash } from '@tabler/icons-react';
import { ModalShell } from '../ui/ModalShell';
import type { AgencySettings } from '../../lib/proposalExport';
import {
  controlerPv, pvVierge, statutPv, type AvisReception, type ConditionReserve, type IssueDecision, type NatureReserve, type OprPv,
} from '../../lib/oprPv';
import { DELAIS_PAR_DEFAUT, echeances } from '../../lib/oprPvDelais';
import { libelleLot, dateFr, type DonneesPvPrive } from '../../lib/oprPvDocument';
import { donneesPvPrive, telechargerPvDocx, telechargerPvPdf } from '../../lib/oprPvExport';
import {
  STATUTS_RESERVE_LEVEE, type MarcheOpr, type NouvelleReserve, type PvOpr, type ReserveOpr, type useOprPv,
} from '../../hooks/useOprPv';

const CHAMP = 'w-full px-3 py-2 pointer-coarse:min-h-11 text-sm border border-[var(--tblr-border)] rounded-lg bg-[var(--tblr-surface)] text-[var(--tblr-text)] focus:outline-none focus:ring-2 focus:ring-[var(--tblr-primary)] disabled:opacity-60';
const LABEL = 'block text-xs font-semibold mb-1 text-[var(--tblr-muted)]';

export interface ProjetOpr {
  nom: string;
  code?: string | null;
  maitreOuvrage?: string | null;
  objet?: string | null;
}

interface Props {
  pv: PvOpr | null;
  marches: MarcheOpr[];
  reserves: ReserveOpr[];
  projet: ProjetOpr;
  settings: AgencySettings;
  api: ReturnType<typeof useOprPv>;
  onClose: () => void;
}

const CONSTATS: Array<{ cle: 'epreuves' | 'travaux' | 'ouvrages' | 'installations' | 'terrains'; valeurs: string[] }> = [
  { cle: 'epreuves', valeurs: ['non_effectuees', 'effectuees_sauf_annexe', 'concluantes', 'concluantes_sauf_annexe'] },
  { cle: 'travaux', valeurs: ['executes', 'executes_sauf_annexe'] },
  { cle: 'ouvrages', valeurs: ['conformes', 'conformes_sauf_annexe'] },
  { cle: 'installations', valeurs: ['repliees', 'non_repliees'] },
  { cle: 'terrains', valeurs: ['remis_en_etat', 'non_remis_en_etat'] },
];

/** Les conditions proposées en marché privé (la pose des équipements est propre au public). */
const CONDITIONS: NatureReserve[] = ['travaux', 'epreuves', 'malfacons', 'installations'];
const AVEC_DATE: NatureReserve[] = ['travaux', 'malfacons', 'installations'];

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

function Conditions({ conditions, refaction, onChange, onRefaction }: {
  conditions: ConditionReserve[]; refaction: number | null;
  onChange: (c: ConditionReserve[]) => void; onRefaction: (v: number | null) => void;
}) {
  const { t } = useTranslation();
  const basculer = (nature: NatureReserve) =>
    onChange(conditions.some(c => c.nature === nature)
      ? conditions.filter(c => c.nature !== nature)
      : [...conditions, { nature, avant_le: null, annexe: null }]);
  const dater = (nature: NatureReserve, avant_le: string) =>
    onChange(conditions.map(c => (c.nature === nature ? { ...c, avant_le: avant_le || null } : c)));
  return (
    <div className="space-y-2 pl-1">
      {CONDITIONS.map(nature => {
        const c = conditions.find(x => x.nature === nature);
        return (
          <div key={nature} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <label className="flex items-center gap-2 text-sm pointer-coarse:min-h-11 flex-1 min-w-56">
              <input type="checkbox" checked={!!c} onChange={() => basculer(nature)} />
              {t(`opr_cond_${nature}`)}
            </label>
            {c && AVEC_DATE.includes(nature) && (
              <label className="flex items-center gap-2 text-xs text-[var(--tblr-muted)]">
                {t('opr_cond_before')}
                <input type="date" className={`${CHAMP} w-auto`} value={c.avant_le ?? ''} onChange={e => dater(nature, e.target.value)} />
              </label>
            )}
          </div>
        );
      })}
      <label className="flex items-center gap-2 text-sm">
        <span className="text-[var(--tblr-muted)] text-xs font-semibold">{t('opr_refaction')}</span>
        <input type="number" min={0} step="0.01" className={`${CHAMP} w-40`} value={refaction ?? ''}
          onChange={e => onRefaction(e.target.value === '' ? null : Number(e.target.value))} />
      </label>
    </div>
  );
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);

export function OprPvDialog({ pv, marches, reserves, projet, settings, api, onClose }: Props) {
  const { t } = useTranslation();
  const [form, setForm] = useState<OprPv>(() => pv?.pv ?? pvVierge('prive'));
  const [nouvelles, setNouvelles] = useState<NouvelleReserve[]>([]);
  const [brouillon, setBrouillon] = useState<NouvelleReserve>({ batiment: '', localisation: '', points: '' });
  const [modeSignature, setModeSignature] = useState<'papier' | 'electronique'>('papier');
  const [dateSignature, setDateSignature] = useState(aujourdhui());
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const initial = useRef(JSON.stringify(form));
  const signe = !!pv?.signed_at;

  const marche = marches.find(m => m.id === form.marche_id) ?? null;
  const lot = libelleLot(marche?.lot_numero, marche?.lot_titre);
  const entreprise = marche?.entreprise_nom ?? '';
  const modifie = JSON.stringify(form) !== initial.current || nouvelles.length > 0;
  const set = <K extends keyof OprPv>(cle: K, valeur: OprPv[K]) => setForm(f => ({ ...f, [cle]: valeur }));

  const reservesOuvertes = reserves.filter(r => !STATUTS_RESERVE_LEVEE.has(r.status ?? '')).length;
  const controle = useMemo(() => controlerPv(form, { reservesOuvertes }), [form, reservesOuvertes]);
  const liste = useMemo(() => echeances(form, aujourdhui()), [form]);
  const statut = statutPv(form);

  /** Ce que l'écran montre : le formulaire tel que saisi, réserves non encore enregistrées comprises. */
  const donneesExport = (): DonneesPvPrive => {
    const base = donneesPvPrive({
      pv: form, reference: pv?.reference_pv, maitreOuvrage: projet.maitreOuvrage, objet: projet.objet || projet.nom,
      marche, reserves, agence: settings.agencyName,
    });
    return {
      ...base,
      reserves: [...base.reserves, ...nouvelles.map(r => ({ numero: null, batiment: r.batiment, localisation: r.localisation, date: null, points: r.points }))],
    };
  };

  const exporter = async (format: 'pdf' | 'docx') => {
    setErreur(null);
    try {
      if (format === 'pdf') await telechargerPvPdf(donneesExport(), settings);
      else await telechargerPvDocx(donneesExport(), settings);
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
      };
      const id: string = pv
        ? (await api.modifier(pv.id, corps), pv.id)
        : (await api.creer({ ...corps, date: form.date_opr || aujourdhui() })).id;
      for (const r of nouvelles.filter(x => x.points.trim())) await api.ajouterReserve(id, r, lot, entreprise);
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

  /** Retire une réserve déjà enregistrée sans fermer la fenêtre : la saisie en cours est conservée. */
  const retirer = async (id: string) => {
    setErreur(null);
    try { await api.retirerReserve(id); } catch (e: any) { setErreur(e?.message || t('opr_error_generic')); }
  };

  const ajouterBrouillon = () => {
    if (!brouillon.points.trim()) return;
    setNouvelles(n => [...n, brouillon]);
    setBrouillon({ batiment: brouillon.batiment, localisation: '', points: '' });
  };

  const avis: Array<[AvisReception, string]> = [
    ['sans_reserve', t('opr_avis_sans_reserve')], ['sous_reserve', t('opr_avis_sous_reserve')], ['non_reception', t('opr_avis_non_reception')],
  ];
  const issues: Array<[IssueDecision, string]> = [
    ['sans_reserve', t('opr_issue_sans_reserve')], ['sous_reserve', t('opr_issue_sous_reserve')], ['non_receptionnee', t('opr_issue_non_receptionnee')],
  ];
  const sousReserve = (v: string | null) => v === 'sous_reserve' || v === 'avec_reserve';
  const section = (titre: string) => <h3 className="text-sm font-bold uppercase tracking-wide border-b border-[var(--tblr-border)] pb-1 pt-2">{titre}</h3>;

  return (
    <ModalShell
      size="lg" onClose={onClose} busy={enCours} dirty={modifie && !signe} bodyClassName="p-4 sm:p-6 space-y-5"
      title={pv ? t('opr_dialog_edit', { ref: pv.reference_pv ?? '' }) : t('opr_dialog_new')}
      subtitle={[lot, entreprise].filter(Boolean).join(' · ') || undefined}
      footer={(
        <>
          {pv && (
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

        {section(t('opr_section_a'))}
        <Choix legende={t('opr_presence_moa')} valeur={form.presences.moa}
          options={[['present', t('opr_opt_present')], ['absent_avise', t('opr_opt_absent_avise')], ['absent', t('opr_opt_absent')]]}
          onChange={v => set('presences', { ...form.presences, moa: v })} />
        <Choix legende={t('opr_presence_company')} valeur={form.presences.entreprise}
          options={[['presente', t('opr_opt_presente')], ['absente_convoquee', t('opr_opt_absente_convoquee')]]}
          onChange={v => set('presences', { ...form.presences, entreprise: v })} />
        {form.presences.entreprise === 'absente_convoquee' && (
          <Champ label={t('opr_convocation_date')}>
            {id => <input id={id} type="date" className={`${CHAMP} sm:w-60`} value={form.presences.date_convocation ?? ''} onChange={e => set('presences', { ...form.presences, date_convocation: e.target.value || null })} />}
          </Champ>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {CONSTATS.map(({ cle, valeurs }) => (
            <Champ key={cle} label={t(`opr_c_${cle}`)}>
              {id => (
                <select id={id} className={CHAMP} value={form.constats[cle] ?? ''}
                  onChange={e => set('constats', { ...form.constats, [cle]: e.target.value || null })}>
                  <option value="">{t('opr_unset')}</option>
                  {valeurs.map(v => <option key={v} value={v}>{t(`opr_opt_${v}`)}</option>)}
                </select>
              )}
            </Champ>
          ))}
        </div>

        {section(t('opr_section_b'))}
        <Choix legende={t('opr_section_b')} valeur={form.proposition.avis} options={avis}
          onChange={v => set('proposition', { ...form.proposition, avis: v, conditions: sousReserve(v) ? form.proposition.conditions : [] })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ label={t('opr_date_proposition')}>{id => <input id={id} type="date" className={CHAMP} value={form.proposition.date_proposition ?? ''} onChange={e => set('proposition', { ...form.proposition, date_proposition: e.target.value || null })} />}</Champ>
          <Champ label={t('opr_date_achevement')}>{id => <input id={id} type="date" className={CHAMP} value={form.proposition.date_achevement_retenue ?? ''} onChange={e => set('proposition', { ...form.proposition, date_achevement_retenue: e.target.value || null })} />}</Champ>
        </div>
        {sousReserve(form.proposition.avis) && (
          <Conditions conditions={form.proposition.conditions} refaction={form.proposition.refaction_montant}
            onChange={c => set('proposition', { ...form.proposition, conditions: c })}
            onRefaction={v => set('proposition', { ...form.proposition, refaction_montant: v })} />
        )}

        {section(t('opr_section_c'))}
        <Choix legende={t('opr_section_c')} valeur={form.decision.issue} options={issues}
          onChange={v => set('decision', { ...form.decision, issue: v, conditions: sousReserve(v) ? form.decision.conditions : [] })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ label={t('opr_date_decision')}>{id => <input id={id} type="date" className={CHAMP} value={form.decision.date_decision ?? ''} onChange={e => set('decision', { ...form.decision, date_decision: e.target.value || null })} />}</Champ>
          <Champ label={t('opr_date_effet')}>{id => <input id={id} type="date" className={CHAMP} value={form.decision.date_effet ?? ''} onChange={e => set('decision', { ...form.decision, date_effet: e.target.value || null })} />}</Champ>
        </div>
        {sousReserve(form.decision.issue) && (
          <Conditions conditions={form.decision.conditions} refaction={form.decision.refaction_montant}
            onChange={c => set('decision', { ...form.decision, conditions: c })}
            onRefaction={v => set('decision', { ...form.decision, refaction_montant: v })} />
        )}

        {section(t('opr_reserves_title'))}
        {reserves.length === 0 && nouvelles.length === 0 && <p className="text-sm text-[var(--tblr-muted)]">{t('opr_reserves_empty')}</p>}
        <ul className="space-y-1">
          {reserves.map(r => (
            <li key={r.id} className="flex items-start gap-2 text-sm">
              <span className="w-8 shrink-0 tabular-nums text-[var(--tblr-muted)]">{r.number ?? ''}</span>
              <span className="flex-1 min-w-0">{[r.batiment, r.local].filter(Boolean).join(' · ')}{r.batiment || r.local ? ' : ' : ''}{r.title}</span>
              <button type="button" aria-label={t('opr_reserve_remove')} className="p-2 pointer-coarse:min-h-11 text-[var(--tblr-muted)] hover:text-red-600" onClick={() => retirer(r.id)}><IconTrash size={14} /></button>
            </li>
          ))}
          {nouvelles.map((r, i) => (
            <li key={`n${i}`} className="flex items-start gap-2 text-sm">
              <span className="w-8 shrink-0 text-[var(--tblr-muted)]">+</span>
              <span className="flex-1 min-w-0">{[r.batiment, r.localisation].filter(Boolean).join(' · ')}{r.batiment || r.localisation ? ' : ' : ''}{r.points}</span>
              <button type="button" aria-label={t('opr_reserve_remove')} className="p-2 pointer-coarse:min-h-11 text-[var(--tblr-muted)] hover:text-red-600" onClick={() => setNouvelles(n => n.filter((_, j) => j !== i))}><IconTrash size={14} /></button>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-[8rem_10rem_1fr_auto] items-end">
          <Champ label={t('opr_reserve_building')}>{id => <input id={id} className={CHAMP} value={brouillon.batiment} onChange={e => setBrouillon(b => ({ ...b, batiment: e.target.value }))} />}</Champ>
          <Champ label={t('opr_reserve_location')}>{id => <input id={id} className={CHAMP} value={brouillon.localisation} onChange={e => setBrouillon(b => ({ ...b, localisation: e.target.value }))} />}</Champ>
          <Champ label={t('opr_reserve_points')}>{id => <input id={id} className={CHAMP} value={brouillon.points} onChange={e => setBrouillon(b => ({ ...b, points: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ajouterBrouillon(); } }} />}</Champ>
          <button type="button" className="btn btn-secondary" onClick={ajouterBrouillon} disabled={!brouillon.points.trim()}>{t('opr_reserve_add')}</button>
        </div>

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
          <Champ label={t('opr_levee_pv_date')}>{id => <input id={id} type="date" className={CHAMP} value={form.levee.date_pv ?? ''} onChange={e => set('levee', { ...form.levee, date_pv: e.target.value || null })} />}</Champ>
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
