import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconPlus, IconEdit, IconTrash, IconFileInvoice, IconListCheck, IconChevronRight, IconLoader2,
} from '@tabler/icons-react';
import { apiFetch } from '../../../lib/api';
import type { ProjectLot } from '../../../types';
import {
  certificatsDuMarche, estCertifiee, num, situationsDuMarche, syntheseMarche,
  type MarcheTravaux, type SituationTravaux,
} from '../../../lib/certificatPaiement';
import type { OperationInfo } from '../../../lib/certificatPaiementPdf';
import { telechargerCertificatPaiement, telechargerDecompteCloture } from '../../../lib/certificatPaiementExport';
import { useConfirmDialog } from '../../ui/ConfirmDialog';
import { CardHeader } from '../../ui/Card';
import { boutonPrincipal, boutonSecondaire, formatEuros } from './DialogShell';
import { MarcheDialog, marcheDepuisLot, montantLot } from './MarcheDialog';
import { SituationDialog } from './SituationDialog';
import { EtatSituationBadge } from './EtatSituationBadge';
import type { Plateforme, SituationLiee } from './FactureEntrepriseLink';
import type { DPGF, OffreDocument } from '../../../types/dpgf';

type Marche = MarcheTravaux & { project_id?: string };

export interface SituationsTravauxProps {
  projectId: string;
  lots: ProjectLot[];
  operation: OperationInfo;
  clientSiret?: string;
  isPublicClient?: boolean;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

/**
 * Onglet RDT : les situations de travaux adressées par les entreprises, et les
 * certificats de paiement que l'architecte établit à partir d'elles. Un bloc
 * par marché (une entreprise, un lot), parce que tout s'y calcule en cumul.
 */
export function SituationsTravaux({ projectId, lots, operation, clientSiret, isPublicClient, showToast }: SituationsTravauxProps) {
  const { t } = useTranslation();
  const { confirm, dialog } = useConfirmDialog();
  const [marches, setMarches] = useState<Marche[]>([]);
  const [situations, setSituations] = useState<SituationLiee[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [marcheEdite, setMarcheEdite] = useState<Marche | null | 'new'>(null);
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  // Situation créée par « Nouvelle situation » et jamais enregistrée depuis :
  // refermée vide, elle est retirée au lieu de laisser un numéro fantôme.
  const nouvelleId = useRef<string | null>(null);
  const [dpgf, setDpgf] = useState<DPGF | null>(null);
  const [offres, setOffres] = useState<OffreDocument[]>([]);
  const [plateformes, setPlateformes] = useState<{ chorus_pro: boolean; superpdp: boolean }>({ chorus_pro: false, superpdp: false });

  const charger = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([
        apiFetch<Marche[]>(`/api/marches-entreprises/${projectId}`),
        apiFetch<SituationLiee[]>(`/api/situations/${projectId}`),
      ]);
      setMarches(m ?? []);
      setSituations(s ?? []);
      setLoadError('');
    } catch (e: any) {
      setLoadError(e?.message || t('situations_travaux_load_failed'));
    } finally {
      setLoaded(true);
    }
  }, [projectId, t]);

  useEffect(() => { charger(); }, [charger]);

  // DPGF et offres importées : la saisie détaillée en tire ses lignes et ses
  // prix. Une affaire sans DPGF garde la saisie simple, rien ne casse.
  useEffect(() => {
    let vivant = true;
    Promise.all([
      apiFetch<DPGF>(`/api/projects/${projectId}/dpgf`).catch(() => null),
      apiFetch<OffreDocument[]>(`/api/projects/${projectId}/dpgf/offres`).catch(() => []),
    ]).then(([d, o]) => {
      if (!vivant) return;
      setDpgf(d && Array.isArray(d.lots) ? d : null);
      setOffres(Array.isArray(o) ? o : []);
    });
    return () => { vivant = false; };
  }, [projectId]);

  useEffect(() => {
    let vivant = true;
    Promise.all([
      apiFetch<{ connected: boolean }>('/api/chorus-pro/status').catch(() => ({ connected: false })),
      apiFetch<{ connected: boolean }>('/api/superpdp/status').catch(() => ({ connected: false })),
    ]).then(([c, p]) => { if (vivant) setPlateformes({ chorus_pro: !!c.connected, superpdp: !!p.connected }); });
    return () => { vivant = false; };
  }, []);

  // Public : la facture passe par Chorus Pro ; privé : par Super PDP.
  const plateforme: Plateforme | null = isPublicClient
    ? (plateformes.chorus_pro ? 'chorus_pro' : null)
    : (plateformes.superpdp ? 'superpdp' : null);

  const marchesTries = useMemo(
    () => [...marches].sort((a, b) => String(a.lot_numero ?? '').localeCompare(String(b.lot_numero ?? ''), 'fr', { numeric: true })),
    [marches],
  );
  const syntheses = useMemo(() => marchesTries.map((m) => syntheseMarche(m, situations)), [marchesTries, situations]);
  const totaux = useMemo(() => {
    const marchesHt = syntheses.reduce((t2, s) => t2 + num(s.marche.montant_ht), 0);
    const admisHt = syntheses.reduce((t2, s) => t2 + s.cumulAdmisHt, 0);
    return {
      marchesHt,
      admisHt,
      avancement: marchesHt > 0 ? Math.round(admisHt / marchesHt * 1000) / 10 : null,
      certifie: syntheses.reduce((t2, s) => t2 + s.certifieTtc, 0),
      aVerifier: syntheses.reduce((t2, s) => t2 + s.aCertifier, 0),
    };
  }, [syntheses]);

  // Lots du projet qui ont une entreprise mais pas encore de marché.
  const lotsSansMarche = useMemo(() => lots.filter((l) =>
    l.contact_name && !marches.some((m) => String(m.lot_numero ?? '') === String(l.lot_number ?? '')),
  ), [lots, marches]);

  const reprendreLots = async () => {
    try {
      const crees = await Promise.all(lotsSansMarche.map((l) => apiFetch<Marche>('/api/marches-entreprises', {
        method: 'POST', body: JSON.stringify({ project_id: projectId, ...marcheDepuisLot(l) }),
      })));
      setMarches((prev) => [...prev, ...crees]);
      showToast(t('situations_travaux_lots_imported', { count: crees.length }));
    } catch (e: any) {
      showToast(e?.message || t('situations_travaux_save_failed'), 'error');
      charger();
    }
  };

  const enregistrerMarche = async (body: Record<string, unknown>) => {
    if (marcheEdite && marcheEdite !== 'new') {
      const maj = await apiFetch<Marche>(`/api/marches-entreprises/${marcheEdite.id}`, { method: 'PUT', body: JSON.stringify(body) });
      setMarches((prev) => prev.map((m) => (m.id === maj.id ? maj : m)));
    } else {
      const cree = await apiFetch<Marche>('/api/marches-entreprises', { method: 'POST', body: JSON.stringify({ project_id: projectId, ...body }) });
      setMarches((prev) => [...prev, cree]);
    }
    setMarcheEdite(null);
    showToast(t('situations_travaux_marche_saved'));
  };

  const supprimerMarche = async (m: Marche) => {
    const ok = await confirm({
      title: t('situations_travaux_marche_delete_title', { company: m.entreprise_nom }),
      message: t('situations_travaux_marche_delete_message'),
      confirmLabel: t('situations_travaux_delete'),
      cancelLabel: t('projectdetail_dialog_cancel'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/marches-entreprises/${m.id}`, { method: 'DELETE' });
      setMarches((prev) => prev.filter((x) => x.id !== m.id));
    } catch (e: any) {
      showToast(e?.message || t('situations_travaux_save_failed'), 'error');
    }
  };

  const nouvelleSituation = async (m: Marche) => {
    setCreating(m.id);
    try {
      const cree = await apiFetch<SituationLiee>('/api/situations', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          marche_id: m.id,
          date_situation: new Date().toISOString().slice(0, 10),
          date_reception_situation: new Date().toISOString().slice(0, 10),
        }),
      });
      setSituations((prev) => [...prev, cree]);
      nouvelleId.current = cree.id;
      setOuverte(cree.id);
    } catch (e: any) {
      showToast(e?.message || t('situations_travaux_save_failed'), 'error');
    } finally {
      setCreating(null);
    }
  };

  const enregistrerSituation = async (id: string, body: Record<string, unknown>) => {
    const maj = await apiFetch<SituationLiee>(`/api/situations/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    setSituations((prev) => prev.map((s) => (s.id === id ? { ...s, ...maj } : s)));
    if (id === nouvelleId.current) nouvelleId.current = null;
    const etat = body.etat;
    showToast(t(
      etat === 'Validée' ? 'situations_travaux_toast_certified'
        : etat === 'Payée' ? 'situations_travaux_toast_paid'
          : etat === 'Brouillon' && Object.keys(body).length === 1 ? 'situations_travaux_toast_reopened'
            : 'situations_travaux_toast_saved',
    ));
    return maj;
  };

  const fermerSituation = () => {
    const id = ouverte;
    setOuverte(null);
    if (!id || id !== nouvelleId.current) return;
    nouvelleId.current = null;
    setSituations((prev) => prev.filter((s) => s.id !== id));
    apiFetch(`/api/situations/${id}`, { method: 'DELETE' }).catch(() => { charger(); });
  };

  const confirmerAbandon = () => confirm({
    title: t('situations_travaux_discard_title'),
    message: t('situations_travaux_discard_message'),
    confirmLabel: t('situations_travaux_discard_confirm'),
    cancelLabel: t('situations_travaux_discard_cancel'),
    tone: 'danger',
  });

  const marcheDe = (s: SituationTravaux) => marches.find((m) => m.id === s.marche_id) ?? null;

  const telechargerCertificat = async (s: SituationTravaux) => {
    const m = marcheDe(s);
    if (!m) return;
    // La situation enregistrée vient de changer : on calcule sur la liste à jour.
    const liste = situations.map((x) => (x.id === s.id ? { ...x, ...s } : x));
    try {
      await telechargerCertificatPaiement(s, m, situationsDuMarche(liste, m.id), operation);
    } catch (e: any) {
      showToast(e?.message || t('situations_travaux_pdf_failed'), 'error');
    }
  };

  const supprimerSituation = async (s: SituationTravaux) => {
    const ok = await confirm({
      title: t('situations_travaux_situation_delete_title', { n: s.numero_situation }),
      message: t('situations_travaux_situation_delete_message'),
      confirmLabel: t('situations_travaux_delete'),
      cancelLabel: t('projectdetail_dialog_cancel'),
      tone: 'danger',
    });
    if (!ok) return false;
    await apiFetch(`/api/situations/${s.id}`, { method: 'DELETE' });
    setSituations((prev) => prev.filter((x) => x.id !== s.id));
    if (s.id === nouvelleId.current) nouvelleId.current = null;
    return true;
  };

  const decompte = async (m: Marche) => {
    try {
      await telechargerDecompteCloture(m, situationsDuMarche(situations, m.id), operation);
    } catch (e: any) {
      showToast(e?.message || t('situations_travaux_pdf_failed'), 'error');
    }
  };

  const situationOuverte = situations.find((s) => s.id === ouverte) ?? null;

  return (
    <div className="space-y-6">
      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        <CardHeader
          icon={IconFileInvoice}
          title={t('situations_travaux_title')}
          description={t('situations_travaux_desc')}
          action={(
            <div className="flex flex-wrap gap-2">
              {lotsSansMarche.length > 0 && (
                <button type="button" className={boutonSecondaire} onClick={reprendreLots}>
                  <IconListCheck size={14} /> {t('situations_travaux_import_lots', { count: lotsSansMarche.length })}
                </button>
              )}
              <button type="button" className={boutonPrincipal} onClick={() => setMarcheEdite('new')}>
                <IconPlus size={14} /> {t('situations_travaux_marche_add')}
              </button>
            </div>
          )}
        />

        {!loaded ? (
          <p className="px-6 py-10 text-center text-sm text-[var(--tblr-muted)]" role="status">
            <IconLoader2 size={16} className="inline animate-spin mr-2" aria-hidden />{t('situations_travaux_loading')}
          </p>
        ) : loadError ? (
          <div className="px-6 py-8 text-center space-y-3" role="alert">
            <p className="text-sm text-[var(--tblr-danger)]">{loadError}</p>
            <button type="button" className={boutonSecondaire} onClick={charger}>{t('situations_travaux_retry')}</button>
          </div>
        ) : marches.length === 0 ? (
          <div className="px-6 py-10 text-center max-w-xl mx-auto space-y-2">
            <p className="text-sm font-bold text-[var(--tblr-text)]">{t('situations_travaux_empty_title')}</p>
            <p className="text-sm text-[var(--tblr-muted)]">{t('situations_travaux_empty_desc')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--tblr-border)] border-t border-[var(--tblr-border)]">
            <Kpi label={t('situations_travaux_kpi_contracts')} value={formatEuros(totaux.marchesHt)} />
            <Kpi
              label={t('situations_travaux_kpi_admitted')}
              value={formatEuros(totaux.admisHt)}
              sub={totaux.avancement === null ? undefined : t('situations_travaux_progress_overall', { pct: totaux.avancement.toLocaleString('fr-FR') })}
            />
            <Kpi label={t('situations_travaux_kpi_certified')} value={formatEuros(totaux.certifie)} />
            <Kpi
              label={t('situations_travaux_kpi_to_check')}
              value={<span className={totaux.aVerifier ? 'text-[var(--tblr-warning)]' : undefined}>{totaux.aVerifier}</span>}
            />
          </div>
        )}
      </div>

      {loaded && !loadError && syntheses.map((syn) => {
        const m = syn.marche as Marche;
        const liste = situationsDuMarche(situations, m.id) as SituationLiee[];
        const certificats = certificatsDuMarche(m, situations);
        const pct = syn.avancementPct;
        return (
          <section
            key={m.id}
            aria-labelledby={`marche-${m.id}`}
            className="rounded-lg overflow-hidden"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
          >
            <div className="px-4 sm:px-5 py-4 flex flex-wrap items-start gap-x-6 gap-y-3">
              <div className="min-w-0 flex-1 basis-72">
                <h3 id={`marche-${m.id}`} className="text-sm font-bold text-[var(--tblr-text)]">
                  {[m.lot_numero ? t('situations_travaux_lot_short', { n: m.lot_numero }) : '', m.lot_titre].filter(Boolean).join(' · ') || m.entreprise_nom}
                </h3>
                <p className="text-xs text-[var(--tblr-muted)] mt-0.5">
                  {m.entreprise_nom}{num(m.montant_ht) ? ` · ${t('situations_travaux_marche_of', { amount: formatEuros(num(m.montant_ht)) })}` : ''}
                </p>
                {pct !== null && (
                  <div className="mt-2 flex items-center gap-2 max-w-sm">
                    <div
                      className="h-1.5 flex-1 rounded-full bg-[var(--tblr-surface-2)] overflow-hidden"
                      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pct)}
                      aria-label={t('situations_travaux_progress_label', { company: m.entreprise_nom })}
                    >
                      <div className={pct > 100 ? 'h-full bg-[var(--tblr-danger)]' : 'h-full bg-[var(--tblr-text)]'} style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-[var(--tblr-muted)]">{pct.toLocaleString('fr-FR')} %</span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                <button type="button" className={boutonPrincipal + ' flex-1 md:flex-none justify-center'} onClick={() => nouvelleSituation(m)} disabled={creating === m.id}>
                  {creating === m.id ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlus size={14} />}
                  {t('situations_travaux_situation_add')}
                </button>
                {liste.length > 0 && (
                  <button type="button" className={boutonSecondaire} onClick={() => decompte(m)}>
                    <IconFileInvoice size={14} /> {t('situations_travaux_closing')}
                  </button>
                )}
                <button type="button" className={boutonSecondaire + ' px-2'} onClick={() => setMarcheEdite(m)} aria-label={t('situations_travaux_marche_edit_named', { company: m.entreprise_nom })}>
                  <IconEdit size={14} />
                </button>
                <button
                  type="button"
                  className={boutonSecondaire + ' px-2'}
                  onClick={() => supprimerMarche(m)}
                  disabled={liste.length > 0}
                  title={liste.length > 0 ? t('situations_travaux_marche_delete_blocked') : undefined}
                  aria-label={t('situations_travaux_marche_delete_named', { company: m.entreprise_nom })}
                >
                  <IconTrash size={14} />
                </button>
              </div>
            </div>

            {liste.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-[var(--tblr-muted)]">{t('situations_travaux_no_situation')}</p>
            ) : (
              <>
              {/* Téléphone : une ligne par situation, touchable sur toute sa largeur. */}
              <ul className="md:hidden border-t border-[var(--tblr-border)] divide-y divide-[var(--tblr-border)]">
                {liste.map((s, i) => {
                  const c = certificats[i];
                  const date = s.date_reception_situation || s.date_situation;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setOuverte(s.id)}
                        aria-label={t('situations_travaux_open_named', { n: s.numero_situation, company: m.entreprise_nom })}
                        className="w-full min-h-14 px-4 py-3 flex items-center gap-3 text-left active:bg-[var(--tblr-surface-2)] focus-visible:outline-2 focus-visible:outline-blue-500"
                      >
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="text-sm font-bold text-[var(--tblr-text)]">{t('situations_travaux_number', { n: s.numero_situation })}</span>
                            <EtatSituationBadge etat={s.etat} />
                          </span>
                          <span className="block text-xs text-[var(--tblr-muted)] mt-0.5 truncate">
                            {[s.reference_entreprise, date ? new Date(`${String(date).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : ''].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <span className="text-right shrink-0">
                          <span className={'block text-sm tabular-nums ' + (estCertifiee(s) ? 'font-bold text-[var(--tblr-text)]' : 'text-[var(--tblr-muted)]')}>{formatEuros(c.netAPayer)}</span>
                          <span className="block text-[0.6875rem] text-[var(--tblr-muted)] tabular-nums">{t('situations_travaux_period_short', { amount: formatEuros(c.periodeHt) })}</span>
                        </span>
                        <IconChevronRight size={16} className="text-[var(--tblr-muted)] shrink-0" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="hidden md:block overflow-x-auto border-t border-[var(--tblr-border)]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] text-[0.6875rem] font-bold uppercase">
                    <tr>
                      <th scope="col" className="px-5 py-2 text-left">{t('situations_travaux_col_number')}</th>
                      <th scope="col" className="px-3 py-2 text-left hidden lg:table-cell">{t('situations_travaux_company_ref')}</th>
                      <th scope="col" className="px-3 py-2 text-left">{t('situations_travaux_received_on')}</th>
                      <th scope="col" className="px-3 py-2 text-right hidden lg:table-cell">{t('situations_travaux_admitted_ht')}</th>
                      <th scope="col" className="px-3 py-2 text-right">{t('situations_travaux_period_ht')}</th>
                      <th scope="col" className="px-3 py-2 text-right">{t('situations_travaux_net_to_pay')}</th>
                      <th scope="col" className="px-5 py-2 text-left">{t('situations_travaux_col_state')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--tblr-border)]">
                    {liste.map((s, i) => {
                      const c = certificats[i];
                      const date = s.date_reception_situation || s.date_situation;
                      return (
                        <tr key={s.id} className="hover:bg-[var(--tblr-surface-2)] cursor-pointer" onClick={() => setOuverte(s.id)}>
                          <td className="px-5 py-2.5">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 font-bold text-[var(--tblr-text)] focus-visible:outline-2 focus-visible:outline-blue-500 rounded"
                              onClick={(e) => { e.stopPropagation(); setOuverte(s.id); }}
                              aria-label={t('situations_travaux_open_named', { n: s.numero_situation, company: m.entreprise_nom })}
                            >
                              {t('situations_travaux_number', { n: s.numero_situation })}
                              <IconChevronRight size={14} className="text-[var(--tblr-muted)]" aria-hidden />
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-[var(--tblr-muted)] hidden lg:table-cell">{s.reference_entreprise || '—'}</td>
                          <td className="px-3 py-2.5 text-[var(--tblr-muted)] tabular-nums whitespace-nowrap">{date ? new Date(`${String(date).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums hidden lg:table-cell whitespace-nowrap">{s.montant_presente_ht === null || s.montant_presente_ht === undefined ? '—' : formatEuros(c.cumulAdmisHt)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatEuros(c.periodeHt)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-bold text-[var(--tblr-text)]">{estCertifiee(s) ? formatEuros(c.netAPayer) : <span className="font-normal text-[var(--tblr-muted)]">{formatEuros(c.netAPayer)}</span>}</td>
                          <td className="px-5 py-2.5"><EtatSituationBadge etat={s.etat} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </section>
        );
      })}

      <MarcheDialog
        open={marcheEdite !== null}
        marche={marcheEdite && marcheEdite !== 'new' ? marcheEdite : null}
        lots={lots.filter((l) => !!(l.lot_number || l.lot_title) && (montantLot(l) > 0 || !!l.contact_name))}
        onClose={() => setMarcheEdite(null)}
        onSave={enregistrerMarche}
      />
      <SituationDialog
        situation={situationOuverte}
        marche={situationOuverte ? marcheDe(situationOuverte) : null}
        situations={situations}
        plateforme={plateforme}
        clientSiret={clientSiret}
        dpgf={dpgf}
        offres={offres}
        onClose={fermerSituation}
        confirmDiscard={confirmerAbandon}
        onSave={enregistrerSituation}
        onDownload={telechargerCertificat}
        onDelete={supprimerSituation}
        onLinked={(s) => setSituations((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...s } : x)))}
      />
      {dialog}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="bg-[var(--tblr-surface)] px-5 py-4">
      <p className="text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)]">{label}</p>
      <p className="text-lg font-bold tabular-nums text-[var(--tblr-text)] mt-0.5">{value}</p>
      {sub && <p className="text-xs text-[var(--tblr-muted)]">{sub}</p>}
    </div>
  );
}
