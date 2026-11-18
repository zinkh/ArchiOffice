// Onglet « Planning » du chantier (DET) : diagramme de Gantt décomposé par lot, avec
// génération par l'IA. Les données vivent dans project_chantier_planning (voir
// server/routes/planningChantier.ts) ; la logique pure dans lib/planningChantier.ts.
//
// Enregistrement automatique 1,2 s après la dernière modification, écritures
// chaînées (c'est l'état du moment de l'envoi qui part), nouvel essai après un échec,
// et rien n'est écrit avant la fin de la lecture : une modification précoce
// écraserait sinon le planning enregistré par un planning vide.
import type { PointerEvent as ReactPointerEvent } from 'react';
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
  datesParGeste, dateDepuisPositionPlanning, dimensionsPlanning, verifierLienPlanning, joursEntre, type GesteDatesPlanning,
  AFFICHAGE_PLANNING, sanitizeAffichage, periodesPlanning, positionPlanning, incoherencesDependances, type AffichagePlanning,
  PLANNING_VIDE, aujourdhuiIso, appliquerGeneration, bornesPlanning, etatTache, lundiDe, planningParLot,
  sanitizePlanning, ajouterJours, type EtatTache, type PlanningChantier, type PlanningGenere, type TachePlanning,
} from '../../lib/planningChantier';
import { PlanningTacheDialog } from './PlanningTacheDialog';
import { usePlanningPressDrag } from '../../hooks/usePlanningPressDrag';
import { PlanningBarre } from './PlanningBarre';
import { PlanningGenerateDialog } from './PlanningGenerateDialog';

interface Props {
  project: Project;
  lots: ProjectLot[];
  settings?: AgencySettings | null;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

type EtatEnregistrement = 'repos' | 'envoi' | 'ok' | 'echec';

const LIGNE_PX = 44;

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
  const regionRef = useRef<HTMLDivElement>(null);
  const diagrammeRef = useRef<HTMLDivElement>(null);
  const [largeurDisponible, setLargeurDisponible] = useState(1000);
  const [apercu, setApercu] = useState<TachePlanning | null>(null);
  const [lienSource, setLienSource] = useState<string | null>(null);
  const [lienGeste, setLienGeste] = useState<{ source: string; x: number; y: number; cible: string | null } | null>(null);
  const [messageGeste, setMessageGeste] = useState('');
  const commencerGeste = usePlanningPressDrag(`${cleAffichage}:${affichage.echelle}:${affichage.relatif}`);
  useEffect(() => {
    const annuler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setLienSource(null); setLienGeste(null); setMessageGeste(''); } };
    window.addEventListener('keydown', annuler);
    return () => { window.removeEventListener('keydown', annuler); };
  }, []);
  useEffect(() => { setLienSource(null); setLienGeste(null); setApercu(null); setMessageGeste(''); }, [cleAffichage]);
  const [couleursAor, setCouleursAor] = useState<Record<string, string>>({});
  const [planning, setPlanning] = useState<PlanningChantier>(PLANNING_VIDE);
  const [lu, setLu] = useState(false);
  const [disponible, setDisponible] = useState(true);
  const [erreurLecture, setErreurLecture] = useState<string | null>(null);
  const [etat, setEtat] = useState<EtatEnregistrement>('repos');
  const [tacheOuverte, setTacheOuverte] = useState<{ tache: TachePlanning; nouvelle: boolean } | null>(null);
  const [genererOuvert, setGenererOuvert] = useState(false);
  const [enExport, setEnExport] = useState<string | null>(null);
  // Le composant peut être monté avant la lecture, ou sans tâche : observer dès que la région existe.
  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    const observer = new ResizeObserver(() => setLargeurDisponible(region.clientWidth));
    setLargeurDisponible(region.clientWidth); observer.observe(region);
    return () => observer.disconnect();
  }, [lu, planning.taches.length === 0]);

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

  const enregistrerDates = (tache: TachePlanning) => {
    const originale = dernier.current.taches.find(t => t.id === tache.id);
    if (!originale || (originale.debut === tache.debut && originale.fin === tache.fin)) return;
    modifier(sanitizePlanning({ ...dernier.current, taches: dernier.current.taches.map(t => t.id === tache.id ? { ...t, debut: tache.debut, fin: tache.fin, source: 'manuel' } : t) }));
    setMessageGeste(tr('planning_dates_saved', { name: tache.libelle, start: tache.debut, end: tache.fin }));
  };
  const commencerDates = (e: ReactPointerEvent<HTMLElement>, tache: TachePlanning, geste: GesteDatesPlanning) => {
    if (!disponible || lienSource) return;
    const origineDate = geste === 'fin' ? ajouterJours(tache.fin, 1) : tache.debut;
    const originePosition = positionPlanning(origineDate, periodes);
    const largeurColonne = COLONNE_PX;
    const axe = periodes;
    const scrollInitial = regionRef.current?.scrollLeft ?? 0;
    let depart = e.clientX;
    let candidate = tache;
    const actualiser = (clientX: number) => {
      const delta = clientX - depart + (regionRef.current?.scrollLeft ?? 0) - scrollInitial;
      const date = dateDepuisPositionPlanning(originePosition + delta / largeurColonne, axe, affichage.echelle);
      candidate = datesParGeste(tache, geste, geste === 'fin' ? ajouterJours(date, -1) : date);
      setApercu(prev => prev?.debut === candidate.debut && prev?.fin === candidate.fin ? prev : candidate);
      setMessageGeste(tr('planning_dates_preview', { start: candidate.debut, end: candidate.fin }));
    };
    commencerGeste(e, {
      onLift: (start, current) => { depart = start.x; actualiser(current.x); },
      onMove: current => actualiser(current.x),
      onEnd: end => {
        setApercu(null);
        if (end.cancelled) { setMessageGeste(tr('planning_gesture_cancelled')); return; }
        actualiser(end.x); setApercu(null); enregistrerDates(candidate);
      },
    });
  };
  const creerLien = (source: string, cible: string) => {
    const resultat = verifierLienPlanning(dernier.current.taches, source, cible);
    setMessageGeste(tr(`planning_link_${resultat}`));
    setLienSource(null); setLienGeste(null);
    if (resultat !== 'ajoute') return;
    modifier(sanitizePlanning({ ...dernier.current, taches: dernier.current.taches.map(t => t.id === cible ? { ...t, source: 'manuel', dependencies: [...(t.dependencies ?? []), source] } : t) }));
  };
  const cibleAuPoint = (x: number, y: number) => {
    const cible = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-planning-task-id]');
    return cible && diagrammeRef.current?.contains(cible) ? cible.dataset.planningTaskId ?? null : null;
  };
  const commencerLien = (e: ReactPointerEvent<HTMLElement>, tache: TachePlanning) => {
    if (!disponible) return;
    commencerGeste(e, {
      onLift: (_, point) => { setLienSource(null); setLienGeste({ source: tache.id, x: point.x, y: point.y, cible: cibleAuPoint(point.x, point.y) }); setMessageGeste(tr('planning_link_gesture_help')); },
      onMove: point => setLienGeste({ source: tache.id, x: point.x, y: point.y, cible: cibleAuPoint(point.x, point.y) }),
      onEnd: point => {
        setLienGeste(null);
        const cible = cibleAuPoint(point.x, point.y);
        if (point.cancelled || !cible) { setMessageGeste(tr('planning_gesture_cancelled')); return; }
        creerLien(tache.id, cible);
      },
    });
  };
  const ouvrirTache = (tache: TachePlanning) => {
    if (lienSource) creerLien(lienSource, tache.id);
    else setTacheOuverte({ tache, nouvelle: false });
  };
  const commencerLargeur = (e: ReactPointerEvent<HTMLElement>) => {
    const initiale = affichage.largeurLibelles;
    const largeurDepart = dimensions.libelles;
    let depart = e.clientX;
    commencerGeste(e, {
      onLift: start => { depart = start.x; },
      onMove: point => regler({ largeurLibelles: Math.max(140, Math.min(560, largeurDepart + Math.round(point.x - depart))) }),
      onEnd: point => { if (point.cancelled) regler({ largeurLibelles: initiale }); },
    });
  };

  // ── Rendu du diagramme ──
  const toutesLignes = useMemo(() => planningParLot(planning, lotsPlanif), [planning, lotsPlanif]);
  const lignes = toutesLignes.filter(l => affichage.generales || l.lot);
  const bornes = bornesPlanning(planning);
  const aujourdhui = aujourdhuiIso();
  const periodes = bornes ? periodesPlanning(bornes.debut, bornes.fin, affichage) : [];
  const dimensions = dimensionsPlanning(largeurDisponible, periodes.length, affichage);
  const COLONNE_PX = dimensions.periode;
  // Une marge accueille la poignée de liaison, sans couper la dernière tâche.
  const largeur = periodes.length * COLONNE_PX;
  const margeLien = 80;
  const x = (iso: string) => positionPlanning(iso, periodes) * COLONNE_PX;
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
    backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${Math.max(0, COLONNE_PX - 1)}px, var(--tblr-border) ${Math.max(0, COLONNE_PX - 1)}px, var(--tblr-border) ${COLONNE_PX}px)`,
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
          <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={affichage.avancement} onChange={event => regler({ avancement: event.target.checked })} />{tr('planning_show_progress')}</label>
          <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={affichage.ajusterLargeur} onChange={event => regler({ ajusterLargeur: event.target.checked })} />{tr('planning_fit_width')}</label>
          <label className="flex flex-wrap items-center gap-2">{tr('planning_labels_width')}
            <input type="range" min={140} max={560} step={1} value={affichage.largeurLibelles} onChange={event => regler({ largeurLibelles: Number(event.target.value) })} /><output>{affichage.largeurLibelles} px</output>
          </label>
          <label className="flex flex-wrap items-center gap-2">{tr('planning_period_width')}
            <input type="range" min={28} max={240} step={4} disabled={affichage.ajusterLargeur} value={affichage.largeurPeriode} onChange={event => regler({ largeurPeriode: Number(event.target.value) })} /><output>{affichage.largeurPeriode} px</output>
          </label>
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
      <details className="text-xs text-[var(--tblr-muted)]"><summary className="cursor-pointer font-semibold">{tr('planning_gestures_title')}</summary><p className="mt-2">{tr('planning_gestures_help')}</p></details>
      <p role="status" aria-live="polite" className="text-sm text-[var(--tblr-text)]">{messageGeste}</p>
      {lienSource && <button type="button" className="btn btn-secondary" onClick={() => { setLienSource(null); setMessageGeste(tr('planning_gesture_cancelled')); }}>{tr('planning_cancel_link')}</button>}
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
          <div ref={regionRef} className="overflow-x-auto" role="region" aria-label="Diagramme de Gantt du chantier" tabIndex={0}>
            <div ref={diagrammeRef} className="relative" style={{ '--etiq': `${dimensions.libelles}px`, minWidth: `calc(var(--etiq) + ${largeur + margeLien}px)` } as React.CSSProperties}>
              {/* Axe : mois puis lundis */}
              <div className="flex sticky top-0 z-10" style={{ background: surface2, borderBottom: '1px solid var(--tblr-border)' }}>
                <div className="shrink-0 sticky left-0 z-20 px-3 py-2 text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)] w-[var(--etiq)]" style={{ background: surface2 }}>Lot / tâche
                  <div role="separator" aria-label={tr('planning_labels_width')} aria-orientation="vertical" aria-valuemin={140} aria-valuemax={560} aria-valuenow={affichage.largeurLibelles} tabIndex={0}
                    onPointerDown={commencerLargeur} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); regler({ largeurLibelles: Math.max(140, Math.min(560, affichage.largeurLibelles + (event.key === 'ArrowRight' ? 8 : -8))) }); } }}
                    className="absolute top-0 bottom-0 right-0 w-2 cursor-col-resize border-r border-[var(--tblr-muted)] hover:bg-[var(--tblr-primary)] focus:bg-[var(--tblr-primary)]" />
                </div>
                <div className="relative" style={{ width: largeur, height: 38 }}>
                  {periodes.map((p, i) => <div key={p.debut} className="absolute top-2 text-xs text-center whitespace-nowrap text-[var(--tblr-text)]" style={{ left: i * COLONNE_PX, width: Math.max(70, COLONNE_PX) }}>{i % Math.max(1, Math.ceil(70 / COLONNE_PX)) === 0 ? p.libelle : ''}</div>)}
                </div>
              </div>

              {lignes.map(ligne => (
                <div key={ligne.lot?.id ?? 'general'}>
                  <div className="flex" style={{ height: 96, background: surface2, borderBottom: '1px solid var(--tblr-border)' }}>
                    <div className="shrink-0 sticky left-0 z-[5] px-3 py-1.5 w-[var(--etiq)]" style={{ background: surface2 }}>
                      <button type="button" className="flex items-center gap-1 text-xs font-bold min-h-11 text-left w-full" aria-expanded={!affichage.replies.includes(ligne.lot?.id ?? 'general')}
                        onClick={() => { const id = ligne.lot?.id ?? 'general'; regler({ replies: affichage.replies.includes(id) ? affichage.replies.filter(k => k !== id) : [...affichage.replies, id] }); }}>
                        {affichage.replies.includes(ligne.lot?.id ?? 'general') ? <IconChevronRight size={12} className="shrink-0" /> : <IconChevronDown size={12} className="shrink-0" />}
                        <span className="inline-block shrink-0 w-2 h-2 rounded-sm" style={{ background: couleurs.get(ligne.lot?.id ?? '') ?? RESERVE_COULEUR_NEUTRE }} />
                      <span className="min-w-0 text-xs font-bold text-[var(--tblr-text)] truncate" title={ligne.lot ? `Lot ${ligne.lot.lot_number} · ${ligne.lot.lot_title}` : undefined}>
                        {ligne.lot ? `Lot ${ligne.lot.lot_number} · ${ligne.lot.lot_title}` : 'Tâches générales'}
                      </span></button>
                      {ligne.lot && (
                        <div className="text-[0.6875rem] text-[var(--tblr-muted)] truncate" title={ligne.lot.contact_name || undefined}>
                          {ligne.lot.contact_name || 'Entreprise à désigner'}
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-[0.6875rem] text-[var(--tblr-muted)]">
                        <span className="shrink-0">{affichage.avancement && `${ligne.avancement} %`}</span>
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

                  {!affichage.replies.includes(ligne.lot?.id ?? 'general') && ligne.taches.map(originale => {
                    const t = apercu?.id === originale.id ? apercu : originale;
                    const e = etatTache(t, aujourdhui);
                    return (
                      <div key={t.id} data-planning-task-id={t.id} className="flex" style={{ height: LIGNE_PX, outline: (lienGeste?.cible === t.id || (lienSource && lienSource !== t.id)) ? '1px solid var(--tblr-primary)' : undefined, outlineOffset: -1, borderBottom: '1px solid var(--tblr-border)' }}>
                        <button type="button" onClick={() => ouvrirTache(t)}
                          className="shrink-0 sticky left-0 z-[5] px-3 pl-6 text-left w-[var(--etiq)] focus-visible:outline focus-visible:outline-2"
                          style={{ background: `color-mix(in srgb, ${couleurs.get(ligne.lot?.id ?? '') ?? RESERVE_COULEUR_NEUTRE} 8%, var(--tblr-surface))`, borderLeft: `1px solid ${couleurs.get(ligne.lot?.id ?? '') ?? RESERVE_COULEUR_NEUTRE}` }}
                          aria-label={`${t.libelle}, ${affichage.avancement ? `${t.avancement} %, ` : ''}du ${fmtCourt(t.debut)} au ${fmtCourt(t.fin)}, ${LIBELLE_ETAT[e]}. Modifier`}>
                          <span className="block text-xs text-[var(--tblr-text)] truncate">{t.libelle}</span>
                          <span className="block truncate text-[0.6875rem] text-[var(--tblr-muted)]" title={`${affichage.avancement ? `${t.avancement} % · ` : ''}${LIBELLE_ETAT[e]} · ${t.debut} – ${t.fin}`}>{affichage.avancement && `${t.avancement} % · `} {LIBELLE_ETAT[e]} · {fmtCourt(t.debut)} – {fmtCourt(t.fin)}</span>
                        </button>
                        <div className="relative" style={{ width: largeur, ...fond }}>
                          <PlanningBarre tache={t} left={x(t.debut)} width={largeurBarre(t.debut, t.fin)} hauteur={LIGNE_PX}
                            couleur={couleurs.get(ligne.lot?.id ?? '') ?? RESERVE_COULEUR_NEUTRE} avancement={affichage.avancement} disabled={!disponible}
                            onOpen={() => ouvrirTache(t)} onDateStart={(event, geste) => commencerDates(event, originale, geste)}
                            onDateKeyboard={(geste, date) => enregistrerDates(datesParGeste(originale, geste, date))}
                            onLinkStart={event => commencerLien(event, originale)}
                            onLinkClick={() => { setLienSource(t.id); setMessageGeste(tr('planning_link_choose_target', { name: t.libelle })); }} />
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
              {lienGeste && positions.has(lienGeste.source) && diagrammeRef.current && (() => {
                const source = planning.taches.find(t => t.id === lienGeste.source)!;
                const rect = diagrammeRef.current!.getBoundingClientRect();
                const dx = lienGeste.x - rect.left - dimensions.libelles;
                const dy = lienGeste.y - rect.top;
                return <svg className="absolute top-0 pointer-events-none" style={{ left: 'var(--etiq)', width: largeur, height: hauteur }} aria-hidden="true"><path d={`M${x(ajouterJours(source.fin, 1))},${positions.get(source.id)} L${dx},${dy}`} stroke="var(--tblr-primary)" strokeWidth="2" strokeDasharray="4 2" fill="none" /></svg>;
              })()}
              {/* Aujourd'hui */}
              {periodes.length > 0 && aujourdhui >= periodes[0].debut && aujourdhui <= periodes[periodes.length - 1].fin && (
                <div className="pointer-events-none absolute top-0 bottom-0"
                  style={{ left: `calc(var(--etiq) + ${x(aujourdhui)}px)`, width: 2, background: 'var(--tblr-text)', opacity: 0.55 }} aria-hidden="true" />
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-[0.6875rem] text-[var(--tblr-muted)]" style={{ borderTop: '1px solid var(--tblr-border)' }}>
            <span>{tr(affichage.avancement ? 'planning_color_help' : 'planning_color_no_progress')}</span>
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
