// Onglet « Planning » du chantier (DET) : diagramme de Gantt décomposé par lot, avec
// génération par l'IA. Les données vivent dans project_chantier_planning (voir
// server/routes/planningChantier.ts) ; la logique pure dans lib/planningChantier.ts.
//
// Enregistrement automatique 1,2 s après la dernière modification, écritures
// chaînées (c'est l'état du moment de l'envoi qui part), nouvel essai après un échec,
// et rien n'est écrit avant la fin de la lecture : une modification précoce
// écraserait sinon le planning enregistré par un planning vide.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconChevronDown, IconChevronRight, IconSparkles, IconPlus, IconFileDownload, IconAlertTriangle, IconLoader2, IconCheck } from '@tabler/icons-react';
import { saveAs } from 'file-saver';
import { useTranslation } from 'react-i18next';
import { useUser } from '../../UserContext';
import { couleursPlanning, RESERVE_COULEUR_NEUTRE } from '../../lib/reserveCouleurs';
import { exportPlanningChantierXml } from '../../lib/planningChantierXml';
import { apiFetch } from '../../lib/api';
import { fetchAgencySettings } from '../../lib/pdfLetterhead';
import type { AgencySettings } from '../../lib/proposalExport';
import type { Project, ProjectLot } from '../../types';
import { telechargerPdf } from '../../lib/observationsExport';
import { exportPlanningToPDF } from '../../lib/planningChantierPdf';
import {
  AFFICHAGE_PLANNING, sanitizeAffichage, periodesPlanning, positionPlanning, incoherencesDependances, type AffichagePlanning,
  PLANNING_VIDE, aujourdhuiIso, appliquerGeneration, bornesPlanning, etatTache, lundiDe, planningParLot,
  sanitizePlanning, ajouterJours, type EtatTache, type PlanningChantier, type PlanningGenere, type TachePlanning,
} from '../../lib/planningChantier';
import { PlanningTacheDialog } from './PlanningTacheDialog';
import { PlanningGenerateDialog } from './PlanningGenerateDialog';

interface Props {
  project: Project;
  lots: ProjectLot[];
  settings?: AgencySettings | null;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

type EtatEnregistrement = 'repos' | 'envoi' | 'ok' | 'echec';

/** Largeur d'une semaine dans le diagramme. */
const SEMAINE_PX = 84;
const LIGNE_PX = 34;

const LIBELLE_ETAT: Record<EtatTache, string> = { a_venir: 'À venir', en_cours: 'En cours', terminee: 'Terminée', en_retard: 'En retard' };

const fmtCourt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export default function PlanningChantierTab(props: Props) {
  const { currentUser, activeTenantId } = useUser();
  return <PlanningChantierView {...props} preferenceScope={`${activeTenantId}:${currentUser?.id}`} />;
}

export function PlanningChantierView({ project, lots, settings, showToast, preferenceScope }: Props & { preferenceScope: string }) {
  const { t: tr } = useTranslation();
  const cleAffichage = `chantier-planning:${preferenceScope}:${project.id}`;
  const [preferences, setPreferences] = useState<{ cle: string; valeur: AffichagePlanning }>({ cle: '', valeur: AFFICHAGE_PLANNING });
  const affichage = preferences.cle === cleAffichage ? preferences.valeur : AFFICHAGE_PLANNING;
  useEffect(() => {
    try { setPreferences({ cle: cleAffichage, valeur: sanitizeAffichage(JSON.parse(localStorage.getItem(cleAffichage) ?? '{}')) }); }
    catch { setPreferences({ cle: cleAffichage, valeur: AFFICHAGE_PLANNING }); }
  }, [cleAffichage]);
  const regler = (patch: Partial<AffichagePlanning>) => {
    const valeur = { ...affichage, ...patch };
    setPreferences({ cle: cleAffichage, valeur });
    try { localStorage.setItem(cleAffichage, JSON.stringify(valeur)); } catch { /* mode privé */ }
  };
  const [couleursAor, setCouleursAor] = useState<Record<string, string>>({});
  const [planning, setPlanning] = useState<PlanningChantier>(PLANNING_VIDE);
  const [lu, setLu] = useState(false);
  const [disponible, setDisponible] = useState(true);
  const [erreurLecture, setErreurLecture] = useState<string | null>(null);
  const [etat, setEtat] = useState<EtatEnregistrement>('repos');
  const [tacheOuverte, setTacheOuverte] = useState<{ tache: TachePlanning; nouvelle: boolean } | null>(null);
  const [genererOuvert, setGenererOuvert] = useState(false);
  const [enExport, setEnExport] = useState<string | null>(null);

  const base = `/api/projects/${encodeURIComponent(project.id)}/planning-chantier`;
  // Entreprises titulaires issues des marchés, rapprochés des lots par le serveur : la fiche du lot n'en porte pas toujours.
  const [entreprises, setEntreprises] = useState<Record<string, string>>({});
  const lotsPlanif = useMemo(
    () => lots.map(l => ({ id: l.id, lot_number: String(l.lot_number ?? ''), lot_title: l.lot_title, contact_name: entreprises[l.id] || l.contact_name })),
    [lots, entreprises],
  );

  const couleurs = useMemo(() => couleursPlanning(lotsPlanif, couleursAor), [lotsPlanif, couleursAor]);

  // ── Lecture et enregistrement automatique ──
  const dernier = useRef(planning);
  const version = useRef(0);
  const enregistree = useRef(0);
  const chaine = useRef<Promise<void>>(Promise.resolve());
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const luRef = useRef(false);
  const disponibleRef = useRef(true);
  luRef.current = lu;
  disponibleRef.current = disponible;

  const vider = useCallback((): Promise<void> => {
    if (minuteur.current) { clearTimeout(minuteur.current); minuteur.current = null; }
    chaine.current = chaine.current.then(async () => {
      if (!luRef.current || !disponibleRef.current || enregistree.current === version.current) return;
      const v = version.current;
      setEtat('envoi');
      try {
        // Le délai coupe une requête qui ne répond jamais : sans lui la chaîne d'écritures reste bloquée.
        await apiFetch(base, { method: 'PUT', body: JSON.stringify(dernier.current), keepalive: true, signal: AbortSignal.timeout(30_000) });
        enregistree.current = v;
        setEtat(version.current === v ? 'ok' : 'envoi');
      } catch {
        setEtat('echec');
        minuteur.current = setTimeout(() => void vider(), 5000);
      }
    });
    return chaine.current;
  }, [base]);

  useEffect(() => {
    let annule = false;
    setLu(false); setErreurLecture(null);
    apiFetch<{ available: boolean; planning: unknown; entreprises?: Record<string, string>; couleursAor?: Record<string, string> }>(base)
      .then(r => {
        if (annule) return;
        const relu = sanitizePlanning(r.planning);
        dernier.current = relu; version.current = 0; enregistree.current = 0;
        setCouleursAor(r.couleursAor ?? {}); setPlanning(relu); setDisponible(r.available !== false); setEntreprises(r.entreprises ?? {}); setLu(true);
      })
      .catch((e: any) => { if (!annule) setErreurLecture(e?.message || 'Lecture du planning impossible.'); });
    return () => { annule = true; void vider(); };
  }, [base, vider]);

  // Une fermeture d'onglet envoie la modification en attente.
  useEffect(() => {
    const envoyer = () => { void vider(); };
    window.addEventListener('pagehide', envoyer);
    return () => window.removeEventListener('pagehide', envoyer);
  }, [vider]);

  const modifier = (suivant: PlanningChantier) => {
    dernier.current = suivant; version.current += 1;
    setPlanning(suivant); setEtat('envoi');
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => void vider(), 1200);
  };

  // ── Actions ──
  const nouvelleTache = (lotId = ''): TachePlanning => {
    const apres = planning.taches.filter(t => t.lotId === lotId).reduce((m, t) => (t.fin > m ? t.fin : m), '');
    const debut = apres ? ajouterJours(apres, 3) : lundiDe(aujourdhuiIso());
    return { id: crypto.randomUUID(), lotId, libelle: '', debut, fin: ajouterJours(debut, 4), avancement: 0, source: 'manuel' };
  };

  const enregistrerTache = (tache: TachePlanning) => {
    const existe = planning.taches.some(t => t.id === tache.id);
    // Une tâche d'origine IA que l'architecte modifie devient la sienne : elle survit à une nouvelle génération.
    const finale: TachePlanning = { ...tache, source: 'manuel' };
    modifier(sanitizePlanning({ ...planning, taches: existe ? planning.taches.map(t => (t.id === tache.id ? finale : t)) : [...planning.taches, finale] }));
    setTacheOuverte(null);
  };

  const supprimerTache = (id: string) => {
    modifier(sanitizePlanning({ ...planning, taches: planning.taches.filter(t => t.id !== id) }));
    setTacheOuverte(null);
    showToast('Tâche supprimée.');
  };

  const appliquerIa = (genere: PlanningGenere, lotIds: Set<string>, garderManuel: boolean) => {
    modifier(appliquerGeneration(planning, genere, lotIds, { garderManuel }));
    setGenererOuvert(false);
    showToast(`${genere.taches.length} tâche${genere.taches.length > 1 ? 's' : ''} ajoutée${genere.taches.length > 1 ? 's' : ''} au planning.`);
  };

  const exporter = async (lotId?: string) => {
    const reglages = settings ?? await fetchAgencySettings().catch(() => null);
    if (!reglages) { showToast('Réglages du cabinet non chargés, réessayez dans un instant.', 'error'); return; }
    setEnExport(lotId ?? '*');
    try {
      const pdf = await exportPlanningToPDF(planning, lotsPlanif, reglages, {
        lotId, affichage, couleurs, project: { name: project.name, project_code: project.project_code, address: project.address },
      });
      telechargerPdf(pdf);
    } catch (e: any) {
      showToast(e?.message || 'Export impossible.', 'error');
    } finally {
      setEnExport(null);
    }
  };

  // ── Rendu du diagramme ──
  const toutesLignes = useMemo(() => planningParLot(planning, lotsPlanif), [planning, lotsPlanif]);
  const lignes = toutesLignes.filter(l => affichage.generales || l.lot);
  const bornes = bornesPlanning(planning);
  const aujourdhui = aujourdhuiIso();
  const periodes = bornes ? periodesPlanning(bornes.debut, bornes.fin, affichage) : [];
  const largeur = periodes.length * SEMAINE_PX;
  const x = (iso: string) => positionPlanning(iso, periodes) * SEMAINE_PX;
  const largeurBarre = (debut: string, fin: string) => Math.max(6, x(ajouterJours(fin, 1)) - x(debut));
  const conflits = incoherencesDependances(planning.taches);
  // Hauteurs déterministes : les liaisons utilisent les mêmes lignes que le rendu.
  const positions = new Map<string, number>();
  let hauteur = 38;
  for (const l of lignes) {
    hauteur += 96;
    if (!affichage.replies.includes(l.lot?.id ?? 'general')) for (const t of l.taches) {
      positions.set(t.id, hauteur + LIGNE_PX / 2); hauteur += LIGNE_PX;
    }
  }
  const liens = planning.taches.flatMap(t => (t.dependencies ?? []).map(id => ({ t, p: planning.taches.find(p => p.id === id)! }))).filter(l => l.p);
  const nomTache = (t: TachePlanning) => `${lotsPlanif.find(l => l.id === t.lotId)?.lot_number ? `Lot ${lotsPlanif.find(l => l.id === t.lotId)!.lot_number}` : tr('planning_general_short')} : ${t.libelle}`;
  const liensMasques = liens.filter(l => !positions.has(l.t.id) || !positions.has(l.p.id));
  const retards = planning.taches.filter(t => etatTache(t, aujourdhui) === 'en_retard').length;
  const fond = {
    backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${SEMAINE_PX - 1}px, var(--tblr-border) ${SEMAINE_PX - 1}px, var(--tblr-border) ${SEMAINE_PX}px)`,
  };
  const surface2 = 'var(--tblr-surface-2, var(--tblr-surface))';

  const indicateur = etat === 'envoi' ? <><IconLoader2 size={14} className="animate-spin" aria-hidden="true" />Enregistrement…</>
    : etat === 'ok' ? <><IconCheck size={14} aria-hidden="true" />Enregistré</>
    : etat === 'echec' ? <><IconAlertTriangle size={14} aria-hidden="true" />Échec de l’enregistrement</> : null;

  if (erreurLecture) return <p role="alert" className="text-sm text-red-600 p-4">{erreurLecture}</p>;
  if (!lu) return <div className="p-6 flex justify-center"><IconLoader2 className="animate-spin text-[var(--tblr-muted)]" aria-label="Chargement du planning" /></div>;

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div>
            <h3 className="text-base font-bold text-[var(--tblr-text)]">Planning de chantier</h3>
            <p className="text-xs text-[var(--tblr-muted)] mt-0.5">
              {bornes
                ? `Du ${fmtCourt(bornes.debut)}/${bornes.debut.slice(0, 4)} au ${fmtCourt(bornes.fin)}/${bornes.fin.slice(0, 4)} · ${planning.taches.length} tâche${planning.taches.length > 1 ? 's' : ''}`
                : 'Aucune tâche planifiée'}
              {retards > 0 && <span className="text-red-600 font-semibold"> · {retards} en retard</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span role="status" className="text-xs text-[var(--tblr-muted)] inline-flex items-center gap-1 min-w-[9rem] justify-end">{indicateur}</span>
            <button type="button" className="btn btn-secondary" onClick={() => setTacheOuverte({ tache: nouvelleTache(), nouvelle: true })} disabled={!disponible}>
              <IconPlus size={16} aria-hidden="true" />Tâche
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void exporter()} disabled={!planning.taches.length || enExport !== null}>
              {enExport === '*' ? <IconLoader2 size={16} className="animate-spin" aria-hidden="true" /> : <IconFileDownload size={16} aria-hidden="true" />}Exporter PDF
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setGenererOuvert(true)} disabled={!disponible || lots.length === 0}>
              <IconSparkles size={16} aria-hidden="true" />Générer avec l’IA
            </button>
          </div>
        </div>
        {!disponible && (
          <p role="alert" className="mt-3 text-xs text-amber-700">Le planning n’est pas encore disponible sur cette instance (migration à appliquer) : il ne pourra pas être enregistré.</p>
        )}
        {lots.length === 0 && (
          <p className="mt-3 text-xs text-[var(--tblr-muted)]">Renseignez d’abord les lots de l’opération (fiche affaire, onglet Infos) : le planning est décomposé lot par lot.</p>
        )}
      </div>

      <details className="rounded-lg p-3 border border-[var(--tblr-border)] bg-[var(--tblr-surface)]">
        <summary className="cursor-pointer font-semibold text-sm">{tr('planning_view_settings')}</summary>
        <div className="flex flex-wrap items-center gap-4 mt-3 text-sm">
          <label>{tr('planning_scale')} <select className="ml-2 p-2 bg-[var(--tblr-surface)] border border-[var(--tblr-border)] rounded" value={affichage.echelle} onChange={e => regler({ echelle: e.target.value as AffichagePlanning['echelle'] })}>
            <option value="semaines">{tr('planning_weeks')}</option><option value="mois">{tr('planning_months')}</option>
          </select></label>
          <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={affichage.relatif} onChange={e => regler({ relatif: e.target.checked })} />{tr('planning_relative')}</label>
          <label className="flex items-center gap-2 min-h-11"><input type="checkbox" disabled={affichage.echelle !== 'semaines' || affichage.relatif} checked={affichage.numerosSemaines} onChange={e => regler({ numerosSemaines: e.target.checked })} />{tr('planning_iso_weeks')}</label>
          <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={affichage.generales} onChange={e => regler({ generales: e.target.checked })} />{tr('planning_general')}</label>
          <button className="btn btn-secondary" onClick={() => regler({ replies: toutesLignes.map(l => l.lot?.id ?? 'general') })}>{tr('planning_collapse_all')}</button>
          <button className="btn btn-secondary" onClick={() => regler({ replies: [] })}>{tr('planning_expand_all')}</button>
          <label>{tr('planning_xml_export')} <select aria-label={tr('planning_xml_format')} className="p-2 bg-[var(--tblr-surface)] border border-[var(--tblr-border)] rounded" value="" disabled={!planning.taches.length} onChange={e => {
            const format = e.target.value as 'msproject' | 'ganttproject';
            if (!format) return;
            try { saveAs(new Blob([exportPlanningChantierXml(project, planning, lotsPlanif, format, couleurs)], { type: 'application/xml;charset=utf-8' }), `planning-chantier-${format}.${format === 'msproject' ? 'xml' : 'gan'}`); }
            catch (error) { showToast(error instanceof Error ? error.message : 'Export impossible.', 'error'); }
          }}><option value="">{tr('planning_choose_format')}</option><option value="msproject">Microsoft Project XML</option><option value="ganttproject">GanttProject XML (.gan)</option></select></label>
        </div>
        <p className="text-xs text-[var(--tblr-muted)] mt-2">{bornes ? tr('planning_origin', { date: bornes.debut }) : ''} {tr('planning_preferences_help')}</p>
      </details>
      {conflits.length > 0 && <div role="status" className="text-sm text-[var(--tblr-text)]">
        {conflits.map(c => <p key={`${c.tache.id}:${c.precedent.id}`}>{tr('planning_dates_conflict', { task: c.tache.libelle, predecessor: c.precedent.libelle, date: c.precedent.fin })}</p>)}
      </div>}
      {liens.length > 0 && <details className="text-sm"><summary>{tr('planning_links_count', { count: liens.length, hidden: liensMasques.length })}</summary><ul>{liens.map(l => <li key={`${l.p.id}:${l.t.id}`}>{nomTache(l.p)} → {nomTache(l.t)} ({tr('planning_link_type')})</li>)}</ul></details>}

      {planning.taches.length === 0 ? (
        <div className="rounded-xl p-8 text-center text-sm text-[var(--tblr-muted)]" style={{ border: '1px dashed var(--tblr-border)' }}>
          <p className="font-semibold text-[var(--tblr-text)] mb-1">Aucun planning pour l’instant</p>
          <p>Générez une première proposition avec l’IA à partir des lots, des entreprises et de leurs marchés, ou ajoutez les tâches une à une.</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
          <div className="overflow-x-auto" role="region" aria-label="Diagramme de Gantt du chantier" tabIndex={0}>
            <div className="relative [--etiq:11rem] sm:[--etiq:17rem]" style={{ minWidth: `calc(var(--etiq) + ${largeur}px)` }}>
              {/* Axe : mois puis lundis */}
              <div className="flex sticky top-0 z-10" style={{ background: surface2, borderBottom: '1px solid var(--tblr-border)' }}>
                <div className="shrink-0 sticky left-0 z-20 px-3 py-2 text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)] w-[var(--etiq)]" style={{ background: surface2 }}>Lot / tâche</div>
                <div className="relative" style={{ width: largeur, height: 38 }}>
                  {periodes.map((p, i) => <div key={p.debut} className="absolute top-2 text-xs text-center text-[var(--tblr-text)]" style={{ left: i * SEMAINE_PX, width: SEMAINE_PX }}>{p.libelle}</div>)}
                </div>
              </div>

              {lignes.map(ligne => (
                <div key={ligne.lot?.id ?? 'general'}>
                  <div className="flex" style={{ height: 96, background: surface2, borderBottom: '1px solid var(--tblr-border)' }}>
                    <div className="shrink-0 sticky left-0 z-[5] px-3 py-1.5 w-[var(--etiq)]" style={{ background: surface2 }}>
                      <button type="button" className="text-xs font-bold min-h-11 text-left w-full" aria-expanded={!affichage.replies.includes(ligne.lot?.id ?? 'general')}
                        onClick={() => { const id = ligne.lot?.id ?? 'general'; regler({ replies: affichage.replies.includes(id) ? affichage.replies.filter(k => k !== id) : [...affichage.replies, id] }); }}>
                        {affichage.replies.includes(ligne.lot?.id ?? 'general') ? <IconChevronRight size={12} className="inline mr-1" /> : <IconChevronDown size={12} className="inline mr-1" />}
                        <span className="inline-block w-2 h-2 mr-1 rounded-sm" style={{ background: couleurs.get(ligne.lot?.id ?? '') ?? RESERVE_COULEUR_NEUTRE }} />
                      <span className="text-xs font-bold text-[var(--tblr-text)] truncate" title={ligne.lot ? `Lot ${ligne.lot.lot_number} · ${ligne.lot.lot_title}` : undefined}>
                        {ligne.lot ? `Lot ${ligne.lot.lot_number} · ${ligne.lot.lot_title}` : 'Tâches générales'}
                      </span></button>
                      {ligne.lot && (
                        <div className="text-[0.6875rem] text-[var(--tblr-muted)] truncate" title={ligne.lot.contact_name || undefined}>
                          {ligne.lot.contact_name || 'Entreprise à désigner'}
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-[0.6875rem] text-[var(--tblr-muted)]">
                        <span className="shrink-0">{ligne.avancement} %</span>
                        <button type="button" className="shrink-0 px-1 rounded hover:underline pointer-coarse:min-h-11 pointer-coarse:px-2"
                          aria-label={`Ajouter une tâche au ${ligne.lot ? `lot ${ligne.lot.lot_number}` : 'chantier'}`}
                          onClick={() => setTacheOuverte({ tache: nouvelleTache(ligne.lot?.id ?? ''), nouvelle: true })}>+ tâche</button>
                        {ligne.lot && (
                          <button type="button" className="shrink-0 px-1 rounded hover:underline pointer-coarse:min-h-11 pointer-coarse:px-2" disabled={enExport !== null}
                            aria-label={`Exporter le planning du lot ${ligne.lot.lot_number} en PDF`} onClick={() => void exporter(ligne.lot!.id)}>PDF</button>
                        )}
                      </div>
                    </div>
                    <div className="relative" style={{ width: largeur, ...fond }}>
                      <div className="absolute rounded-sm" style={{ background: couleurs.get(ligne.lot?.id ?? '') ?? RESERVE_COULEUR_NEUTRE, left: x(ligne.debut), width: largeurBarre(ligne.debut, ligne.fin), top: '40%', height: 6 }} aria-hidden="true" />
                    </div>
                  </div>

                  {!affichage.replies.includes(ligne.lot?.id ?? 'general') && ligne.taches.map(t => {
                    const e = etatTache(t, aujourdhui);
                    return (
                      <div key={t.id} className="flex" style={{ height: LIGNE_PX, borderBottom: '1px solid var(--tblr-border)' }}>
                        <button type="button" onClick={() => setTacheOuverte({ tache: t, nouvelle: false })}
                          className="shrink-0 sticky left-0 z-[5] px-3 pl-6 text-left w-[var(--etiq)] focus-visible:outline focus-visible:outline-2"
                          style={{ background: `color-mix(in srgb, ${couleurs.get(ligne.lot?.id ?? '') ?? RESERVE_COULEUR_NEUTRE} 8%, var(--tblr-surface))`, borderLeft: `1px solid ${couleurs.get(ligne.lot?.id ?? '') ?? RESERVE_COULEUR_NEUTRE}` }}
                          aria-label={`${t.libelle}, ${t.avancement} %, du ${fmtCourt(t.debut)} au ${fmtCourt(t.fin)}, ${LIBELLE_ETAT[e]}. Modifier`}>
                          <span className="block text-xs text-[var(--tblr-text)] truncate">{t.libelle}</span>
                          <span className="block truncate text-[0.6875rem] text-[var(--tblr-muted)]" title={`${t.avancement} % · ${LIBELLE_ETAT[e]} · ${t.debut} – ${t.fin}`}>{t.avancement} % · {LIBELLE_ETAT[e]} · {fmtCourt(t.debut)} – {fmtCourt(t.fin)}</span>
                        </button>
                        <div className="relative" style={{ width: largeur, ...fond }}>
                          {t.jalon ? (
                            <button type="button" onClick={() => setTacheOuverte({ tache: t, nouvelle: false })} tabIndex={-1} aria-hidden="true"
                              className="absolute rotate-45 rounded-[2px]"
                              style={{ background: couleurs.get(ligne.lot?.id ?? '') ?? RESERVE_COULEUR_NEUTRE, left: x(t.debut) - 2, top: LIGNE_PX / 2 - 7, width: 14, height: 14 }} />
                          ) : (
                            <button type="button" onClick={() => setTacheOuverte({ tache: t, nouvelle: false })} tabIndex={-1} aria-hidden="true"
                              title={`${t.libelle} · ${t.avancement} %`}
                              className="absolute rounded overflow-hidden"
                              style={{ background: couleurs.get(ligne.lot?.id ?? '') ?? RESERVE_COULEUR_NEUTRE, opacity: 0.85, left: x(t.debut), width: largeurBarre(t.debut, t.fin), top: 7, height: LIGNE_PX - 14 }}>
                              <span className="block h-full bg-black/40" style={{ width: `${t.avancement}%` }} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}

              <svg className="absolute top-0 pointer-events-none" style={{ left: 'var(--etiq)', width: largeur, height: hauteur }} aria-hidden="true">
                <defs><marker id="chantier-fleche" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="var(--tblr-text)" /></marker></defs>
                {liens.filter(l => positions.has(l.p.id) && positions.has(l.t.id)).map(l => {
                  const a = x(ajouterJours(l.p.fin, 1)); const b = x(l.t.debut); const y1 = positions.get(l.p.id)!; const y2 = positions.get(l.t.id)!;
                  const detour = Math.min(largeur - 4, Math.max(a, b) + 10);
                  return <path key={`${l.p.id}:${l.t.id}`} d={`M${a},${y1} H${detour} V${y2 - 14} H${Math.max(1, b - 5)} V${y2} H${b}`} stroke="var(--tblr-text)" strokeWidth="1.2" strokeDasharray={l.t.debut <= l.p.fin ? '3 2' : undefined} fill="none" markerEnd="url(#chantier-fleche)" />;
                })}
              </svg>
              {/* Aujourd'hui */}
              {periodes.length > 0 && aujourdhui >= periodes[0].debut && aujourdhui <= periodes[periodes.length - 1].fin && (
                <div className="pointer-events-none absolute top-0 bottom-0"
                  style={{ left: `calc(var(--etiq) + ${x(aujourdhui)}px)`, width: 2, background: 'var(--tblr-text)', opacity: 0.55 }} aria-hidden="true" />
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-[0.6875rem] text-[var(--tblr-muted)]" style={{ borderTop: '1px solid var(--tblr-border)' }}>
            <span>{tr('planning_color_help')}</span>
            <span>{tr('planning_arrow_help')}</span>
            <span>Trait vertical : aujourd’hui</span>
          </div>
        </div>
      )}

      {planning.hypotheses.length > 0 && (
        <details className="rounded-xl p-3 text-xs text-[var(--tblr-text)]" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
          <summary className="cursor-pointer font-semibold">Hypothèses de la dernière génération IA</summary>
          <ul className="list-disc pl-5 mt-2 space-y-0.5">{planning.hypotheses.map(h => <li key={h}>{h}</li>)}</ul>
        </details>
      )}

      {tacheOuverte && (
        <PlanningTacheDialog
          tache={tacheOuverte.tache}
          nouvelle={tacheOuverte.nouvelle}
          lots={lotsPlanif}
          taches={planning.taches}
          onSave={enregistrerTache}
          onDelete={() => supprimerTache(tacheOuverte.tache.id)}
          onClose={() => setTacheOuverte(null)}
        />
      )}
      {genererOuvert && (
        <PlanningGenerateDialog
          projectId={project.id}
          // Une fiche dont le début et la fin sont identiques n'a pas de vraies dates de travaux.
          debutProjet={project.start_date && project.end_date && project.end_date > project.start_date ? project.start_date : undefined}
          lots={lotsPlanif}
          aDuManuel={planning.taches.some(t => t.source === 'manuel')}
          onApply={appliquerIa}
          onClose={() => setGenererOuvert(false)}
        />
      )}
    </div>
  );
}
