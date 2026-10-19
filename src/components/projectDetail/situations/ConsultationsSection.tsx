import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlus, IconTrophy } from '@tabler/icons-react';
import { apiFetch } from '../../../lib/api';
import {
  classerOffres, totalOffre,
  type ArticleBordereau, type LigneConsultation, type OffreConcurrence,
} from '../../../lib/accordCadre';
import { Champ, DialogShell, boutonPrincipal, boutonSecondaire, formatEuros, inputClass } from './DialogShell';

export interface Consultation {
  id: string;
  numero: number;
  objet: string;
  date_limite?: string | null;
  lignes: LigneConsultation[];
  offres: OffreConcurrence[];
  statut: 'en_cours' | 'attribuee' | 'abandonnee';
  retenue_marche_id?: string | null;
  subsequent_id?: string | null;
  motif_choix?: string | null;
}

export interface Titulaire { id: string; entreprise_nom: string }

const nombre = (brut: string): number => Number(brut.trim().replace(/\s/g, '').replace(',', '.'));

/**
 * Remises en concurrence entre les titulaires d'un accord-cadre : l'architecte
 * décrit ce qu'il veut commander, saisit le prix de chaque titulaire (jamais au-dessus
 * de son bordereau), puis retient une offre ; l'attribution émet le marché
 * subséquent aux prix de l'offre retenue, sous le plafond commun.
 */
export function ConsultationsSection({
  teteId, titulaires, articles, onAwarded, showToast,
}: {
  teteId: string;
  titulaires: Titulaire[];
  /** Articles du bordereau de l'accord-cadre, point de départ des lignes de la consultation. */
  articles: ArticleBordereau[];
  /** Un subséquent vient d'être émis : l'écran relit les marchés. */
  onAwarded: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const { t } = useTranslation();
  const [liste, setListe] = useState<Consultation[]>([]);
  const [creation, setCreation] = useState(false);
  const [ouverte, setOuverte] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      setListe(await apiFetch<Consultation[]>(`/api/marches-entreprises/${teteId}/consultations`) ?? []);
    } catch { setListe([]); }
  }, [teteId]);
  useEffect(() => { charger(); }, [charger]);

  const nom = (id?: string | null) => titulaires.find((x) => x.id === id)?.entreprise_nom ?? '';
  const courante = liste.find((c) => c.id === ouverte) ?? null;

  const creer = async (body: { objet: string; date_limite: string | null; lignes: LigneConsultation[] }) => {
    const c = await apiFetch<Consultation>(`/api/marches-entreprises/${teteId}/consultations`, { method: 'POST', body: JSON.stringify(body) });
    setListe((prev) => [...prev, c]);
    setCreation(false);
    setOuverte(c.id);
    showToast(t('accord_cadre_consult_created'));
  };

  return (
    <div className="border-t border-[var(--tblr-border)]">
      <div className="px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-[var(--tblr-text)]">{t('accord_cadre_consult_title')}</h4>
        <button type="button" className={boutonSecondaire} onClick={() => setCreation(true)} disabled={articles.length === 0}>
          <IconPlus size={14} /> {t('accord_cadre_consult_add')}
        </button>
      </div>
      {liste.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-[var(--tblr-muted)]">{t('accord_cadre_consult_empty')}</p>
      ) : (
        <ul className="divide-y divide-[var(--tblr-border)] border-t border-[var(--tblr-border)]">
          {liste.map((c) => (
            <li key={c.id} className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1 basis-60">
                <p className="text-sm font-bold text-[var(--tblr-text)]">
                  {t('accord_cadre_consult_short', { n: c.numero })}
                  {c.objet ? <span className="font-normal text-[var(--tblr-muted)]"> · {c.objet}</span> : null}
                </p>
                <p className="text-xs text-[var(--tblr-muted)]">
                  {[
                    t(`accord_cadre_consult_status_${c.statut}`),
                    c.statut === 'attribuee' ? t('accord_cadre_consult_awarded_to', { company: nom(c.retenue_marche_id) }) : '',
                    c.statut === 'en_cours' ? t('accord_cadre_consult_offers_count', { count: c.offres.filter((o) => !o.declinee).length }) : '',
                  ].filter(Boolean).join(' · ')}
                </p>
              </div>
              <button type="button" className={boutonSecondaire} onClick={() => setOuverte(c.id)}>
                {c.statut === 'en_cours' ? t('accord_cadre_consult_open') : t('accord_cadre_consult_view')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <NouvelleConsultationDialog open={creation} articles={articles} onClose={() => setCreation(false)} onSave={creer} />
      {courante && (
        <OffresDialog
          consultation={courante}
          titulaires={titulaires}
          onClose={() => setOuverte(null)}
          onChanged={(c) => setListe((prev) => prev.map((x) => (x.id === c.id ? c : x)))}
          onAwarded={() => { setOuverte(null); charger(); onAwarded(); showToast(t('accord_cadre_consult_awarded')); }}
          onDeleted={() => { setListe((prev) => prev.filter((x) => x.id !== courante.id)); setOuverte(null); }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function NouvelleConsultationDialog({
  open, articles, onClose, onSave,
}: {
  open: boolean;
  articles: ArticleBordereau[];
  onClose: () => void;
  onSave: (body: { objet: string; date_limite: string | null; lignes: LigneConsultation[] }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [objet, setObjet] = useState('');
  const [limite, setLimite] = useState('');
  const [quantites, setQuantites] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!open) return;
    setObjet(''); setLimite(''); setQuantites({}); setErreur(''); setEnCours(false);
  }, [open]);

  const lignes: LigneConsultation[] = articles
    .filter((a) => nombre(quantites[a.articleId] ?? '') > 0)
    .map((a) => ({ articleId: a.articleId, refBpu: a.numero, designation: a.designation, unite: a.unite, quantite: nombre(quantites[a.articleId]) }));

  const enregistrer = async () => {
    setEnCours(true); setErreur('');
    try {
      await onSave({ objet: objet.trim(), date_limite: limite || null, lignes });
    } catch (e: any) {
      setErreur(e?.message || t('situations_travaux_save_failed'));
      setEnCours(false);
    }
  };

  return (
    <DialogShell
      open={open} wide busy={enCours} onClose={onClose}
      title={t('accord_cadre_consult_new_title')}
      footer={(
        <>
          <button type="button" className={boutonSecondaire} onClick={onClose} disabled={enCours}>{t('accord_cadre_cancel')}</button>
          <button type="button" className={boutonPrincipal} onClick={enregistrer} disabled={enCours || lignes.length === 0}>{t('accord_cadre_consult_create')}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--tblr-muted)]">{t('accord_cadre_consult_new_desc')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Champ label={t('accord_cadre_sub_object')} htmlFor={`${id}-objet`}>
            <input id={`${id}-objet`} className={inputClass} value={objet} onChange={(e) => setObjet(e.target.value)} />
          </Champ>
          <Champ label={t('accord_cadre_consult_deadline')} htmlFor={`${id}-limite`}>
            <input id={`${id}-limite`} type="date" className={inputClass} value={limite} onChange={(e) => setLimite(e.target.value)} />
          </Champ>
        </div>
        <ul className="divide-y divide-[var(--tblr-border)] border border-[var(--tblr-border)] rounded-lg">
          {articles.map((a) => (
            <li key={a.articleId} className="px-3 py-2 flex items-center gap-3">
              <label htmlFor={`${id}-${a.articleId}`} className="flex-1 min-w-0 text-sm text-[var(--tblr-text)]">
                <span className="text-[var(--tblr-muted)]">{a.numero}</span> {a.designation}
                <span className="text-[var(--tblr-muted)]"> · {a.unite}</span>
              </label>
              <input
                id={`${id}-${a.articleId}`} inputMode="decimal" className={inputClass + ' w-24 text-right'} placeholder="0"
                value={quantites[a.articleId] ?? ''} onChange={(e) => setQuantites((q) => ({ ...q, [a.articleId]: e.target.value }))}
              />
            </li>
          ))}
        </ul>
        {erreur && <p role="alert" className="text-sm text-[var(--tblr-danger)]">{erreur}</p>}
      </div>
    </DialogShell>
  );
}

function OffresDialog({
  consultation, titulaires, onClose, onChanged, onAwarded, onDeleted, showToast,
}: {
  consultation: Consultation;
  titulaires: Titulaire[];
  onClose: () => void;
  onChanged: (c: Consultation) => void;
  onAwarded: () => void;
  onDeleted: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const ouverte = consultation.statut === 'en_cours';
  // Prix saisis en texte : titulaire -> article -> prix.
  const [prix, setPrix] = useState<Record<string, Record<string, string>>>({});
  const [declinees, setDeclinees] = useState<Record<string, boolean>>({});
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    const p: Record<string, Record<string, string>> = {};
    const d: Record<string, boolean> = {};
    for (const o of consultation.offres) {
      p[o.marche_id] = Object.fromEntries(Object.entries(o.prix ?? {}).filter(([, v]) => v !== null).map(([k, v]) => [k, String(v)]));
      d[o.marche_id] = !!o.declinee;
    }
    setPrix(p); setDeclinees(d); setMotif(''); setErreur('');
  }, [consultation.id, consultation.offres]);

  const offresSaisies = useMemo<OffreConcurrence[]>(() => titulaires
    .filter((x) => declinees[x.id] || Object.values(prix[x.id] ?? {}).some((v) => v !== ''))
    .map((x) => ({
      marche_id: x.id, declinee: !!declinees[x.id],
      prix: Object.fromEntries(Object.entries(prix[x.id] ?? {}).filter(([, v]) => v !== '').map(([k, v]) => [k, nombre(v)])),
    })), [titulaires, prix, declinees]);

  const totaux = (marcheId: string) => totalOffre(consultation.lignes, offresSaisies.find((o) => o.marche_id === marcheId) ?? { marche_id: marcheId, prix: {} });
  const classement = classerOffres(consultation.lignes, offresSaisies);
  const moinsDisant = classement[0]?.offre.marche_id ?? null;

  const enregistrer = async (): Promise<Consultation | null> => {
    setEnCours(true); setErreur('');
    try {
      const c = await apiFetch<Consultation>(`/api/accord-cadre-consultations/${consultation.id}`, { method: 'PUT', body: JSON.stringify({ offres: offresSaisies }) });
      onChanged(c);
      setEnCours(false);
      return c;
    } catch (e: any) {
      setErreur(e?.message || t('situations_travaux_save_failed'));
      setEnCours(false);
      return null;
    }
  };

  const retenir = async (marcheId: string) => {
    if (!(await enregistrer())) return;
    setEnCours(true);
    try {
      await apiFetch(`/api/accord-cadre-consultations/${consultation.id}/attribuer`, {
        method: 'POST', body: JSON.stringify({ marche_id: marcheId, motif_choix: motif.trim() }),
      });
      onAwarded();
    } catch (e: any) {
      setErreur(e?.message || t('situations_travaux_save_failed'));
      setEnCours(false);
    }
  };

  const abandonner = async () => {
    setEnCours(true);
    try {
      const c = await apiFetch<Consultation>(`/api/accord-cadre-consultations/${consultation.id}/abandonner`, { method: 'POST', body: JSON.stringify({}) });
      onChanged(c);
      showToast(t('accord_cadre_consult_abandoned'));
      onClose();
    } catch (e: any) {
      setErreur(e?.message || t('situations_travaux_save_failed'));
      setEnCours(false);
    }
  };

  const supprimer = async () => {
    setEnCours(true);
    try {
      await apiFetch(`/api/accord-cadre-consultations/${consultation.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (e: any) {
      setErreur(e?.message || t('situations_travaux_save_failed'));
      setEnCours(false);
    }
  };

  const necessiteMotif = (marcheId: string) => !!moinsDisant && marcheId !== moinsDisant;

  return (
    <DialogShell
      open wide busy={enCours} onClose={onClose}
      title={t('accord_cadre_consult_dlg_title', { n: consultation.numero })}
      subtitle={consultation.objet}
      footer={(
        <>
          {ouverte && <button type="button" className={boutonSecondaire + ' mr-auto'} onClick={abandonner} disabled={enCours}>{t('accord_cadre_consult_abandon')}</button>}
          {!ouverte && consultation.statut === 'abandonnee' && <button type="button" className={boutonSecondaire + ' mr-auto'} onClick={supprimer} disabled={enCours}>{t('situations_travaux_delete')}</button>}
          <button type="button" className={boutonSecondaire} onClick={onClose} disabled={enCours}>{t('situations_travaux_close')}</button>
          {ouverte && <button type="button" className={boutonPrincipal} onClick={enregistrer} disabled={enCours}>{t('accord_cadre_save')}</button>}
        </>
      )}
    >
      <div className="space-y-4">
        <div className="overflow-x-auto border border-[var(--tblr-border)] rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] text-[0.6875rem] font-bold uppercase">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">{t('accord_cadre_consult_col_article')}</th>
                {titulaires.map((x) => <th key={x.id} scope="col" className="px-3 py-2 text-right">{x.entreprise_nom}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--tblr-border)]">
              {consultation.lignes.map((l) => (
                <tr key={l.articleId}>
                  <td className="px-3 py-2 text-[var(--tblr-text)]">{l.designation}<span className="text-[var(--tblr-muted)]"> · {l.quantite} {l.unite}</span></td>
                  {titulaires.map((x) => (
                    <td key={x.id} className="px-3 py-2 text-right">
                      <input
                        aria-label={`${l.designation}, ${x.entreprise_nom}`}
                        inputMode="decimal" className={inputClass + ' w-24 text-right'} disabled={!ouverte || !!declinees[x.id]}
                        value={prix[x.id]?.[l.articleId] ?? ''}
                        onChange={(e) => setPrix((p) => ({ ...p, [x.id]: { ...(p[x.id] ?? {}), [l.articleId]: e.target.value } }))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-[var(--tblr-surface-2)]">
              <tr>
                <th scope="row" className="px-3 py-2 text-left text-sm font-bold">{t('accord_cadre_consult_total')}</th>
                {titulaires.map((x) => {
                  const total = totaux(x.id);
                  return (
                    <td key={x.id} className="px-3 py-2 text-right tabular-nums font-bold">
                      {declinees[x.id] ? <span className="font-normal text-[var(--tblr-muted)]">{t('accord_cadre_consult_declined')}</span> : total === null ? '—' : formatEuros(total)}
                      {x.id === moinsDisant && <span className="block text-[0.6875rem] font-normal text-[var(--tblr-muted)]">{t('accord_cadre_consult_lowest')}</span>}
                      {consultation.retenue_marche_id === x.id && <span className="block text-[0.6875rem] font-normal"><IconTrophy size={12} className="inline" aria-hidden /> {t('accord_cadre_consult_retained')}</span>}
                    </td>
                  );
                })}
              </tr>
              {ouverte && (
                <tr>
                  <td className="px-3 py-2 text-xs text-[var(--tblr-muted)]">{t('accord_cadre_consult_declined_label')}</td>
                  {titulaires.map((x) => (
                    <td key={x.id} className="px-3 py-2 text-right">
                      <input type="checkbox" aria-label={`${t('accord_cadre_consult_declined_label')} ${x.entreprise_nom}`} checked={!!declinees[x.id]} onChange={(e) => setDeclinees((d) => ({ ...d, [x.id]: e.target.checked }))} />
                    </td>
                  ))}
                </tr>
              )}
              {ouverte && (
                <tr>
                  <td />
                  {titulaires.map((x) => (
                    <td key={x.id} className="px-3 py-2 text-right">
                      <button type="button" className={boutonPrincipal + ' text-xs'} disabled={enCours || totaux(x.id) === null || (necessiteMotif(x.id) && !motif.trim())} onClick={() => retenir(x.id)}>
                        {t('accord_cadre_consult_retain')}
                      </button>
                    </td>
                  ))}
                </tr>
              )}
            </tfoot>
          </table>
        </div>
        {ouverte && (
          <Champ label={t('accord_cadre_consult_motive')} htmlFor={`${id}-motif`} hint={t('accord_cadre_consult_motive_hint')}>
            <input id={`${id}-motif`} className={inputClass} value={motif} onChange={(e) => setMotif(e.target.value)} />
          </Champ>
        )}
        {!ouverte && consultation.motif_choix && <p className="text-sm text-[var(--tblr-muted)]">{consultation.motif_choix}</p>}
        {erreur && <p role="alert" className="text-sm text-[var(--tblr-danger)]">{erreur}</p>}
      </div>
    </DialogShell>
  );
}
