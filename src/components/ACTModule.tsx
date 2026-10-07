import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  IconPlus, IconTrash, IconCheck, IconChevronRight, IconChevronLeft,
  IconFileText, IconBuilding, IconUsers, IconScale, IconTrophy,
  IconDownload, IconMessageDots, IconMail, IconAlertTriangle,
  IconClipboardList, IconCurrencyEuro, IconPercentage, IconStar,
  IconX, IconEdit, IconEye, IconSend, IconCircleCheck, IconSearch, IconArrowsExchange, IconAdjustments,
} from '@tabler/icons-react';
import { apiFetch, fetchJson } from '../lib/api';
import { cn } from '../lib/utils';
import type { Contact, ProjectLot } from '../types';
import type { Referentiels, CorpsEtat } from '../types/library';
import { useSettings } from '../hooks/useSettings';
import { generateRAO, generateComparatifExcel } from '../lib/actAnalysisExport';
import {
  exportEntreprisesConsulteesToExcel, exportEntreprisesConsulteesToPDF, groupByLot,
  exportLotsToExcel, exportLotsToPDF,
} from '../lib/actExport';
import { EntrepriseAutocomplete } from './EntrepriseAutocomplete';
import ACTEntreprisesTable from './ACTEntreprisesTable';
import { EntrepriseSearchDialog, type EntrepriseChoisie } from './EntrepriseSearchDialog';
import { EntrepriseAddForm, type NouvelleEntreprise } from './EntrepriseAddForm';
import { useQualifications } from '../hooks/useQualifications';
import { ContactModal } from './ContactModal';
import { isEntrepriseContact, CONTACT_CATEGORY_ENTREPRISE } from '../lib/contactCategories';
import NegociationPhase from './act/NegociationPhase';
import LignesOffreEditor from './act/LignesOffreEditor';
import {
  montantAttribution, offresAuPrixCourant, trouverNegociation,
  type DonneesNegociation,
} from '../lib/actNegociation';
import { genererPVOuverture } from '../lib/actNegociationExport';
import MarcheDocumentsPanel, { type OperationMarche } from './act/MarcheDocumentsPanel';
import type { ParametresMarche } from '../lib/actMarche';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DCEDocument {
  id: string;
  nom: string;
  type_doc: 'RC' | 'CCAP' | 'CCTP' | 'DPGF' | 'BPU' | 'DQE' | 'Plans' | 'Autre';
  tous_lots: boolean;
  lots_ids: string[];
}

interface EntrepriseConsultee {
  id: string;
  contact_id?: string;
  nom: string;
  email?: string;
  lots_ids: string[];
  envoyer_dce: boolean;
  /** Codes de la nomenclature FFB (ref_corps_etat, Bibliothèque d'ouvrages) — une entreprise en couvre souvent plusieurs. */
  corps_etat_codes?: string[];
  dce_transmis_le?: string;
  relance_le?: string;
  offre_recue_le?: string;
  ne_repond_pas?: boolean;
}

interface CritereNotation {
  id: string;
  nom: string;
  poids: number;
}

interface PieceAdmin {
  id: string;
  nom: string;
}

interface QuestionReponse {
  id: string;
  entreprise_id: string;
  entreprise_nom: string;
  question: string;
  date_question: string;
  reponse?: string;
  date_reponse?: string;
  publique: boolean;
}

interface Offre {
  id: string;
  lot_id: string;
  entreprise_id: string;
  montant_base: number;
  note_technique: number;
  conforme: boolean;
  motif_nc?: string;
}

interface Attribution {
  lot_id: string;
  entreprise_id: string;
  montant: number;
}

interface ComparatifArticle {
  id: string;
  code: string;
  titre: string;
  unite?: string;
  quantite?: number;
  estimatif?: number;
  prix: Record<string, number>;
  is_section_header?: boolean;
  is_subtotal?: boolean;
}

interface ComparatifLot {
  lot_id: string;
  articles: ComparatifArticle[];
}

interface Consultation extends DonneesNegociation {
  dce_documents: DCEDocument[];
  entreprises: EntrepriseConsultee[];
  criteres: CritereNotation[];
  pieces_admin: PieceAdmin[];
  questions: QuestionReponse[];
  offres: Offre[];
  attributions: Attribution[];
  comparatif: ComparatifLot[];
  /** Réglages des documents du marché (RC, CCAP, acte d'engagement). */
  marche?: ParametresMarche;
}

type Phase = 'preparation' | 'criteres' | 'portail' | 'collecte' | 'negociation' | 'analyse';

const PHASES: { id: Phase; label: string; short: string; icon: React.ElementType }[] = [
  { id: 'preparation', label: 'Préparation de la consultation', short: 'Préparation', icon: IconFileText },
  { id: 'criteres', label: 'Critères d\'analyse', short: 'Critères', icon: IconScale },
  { id: 'portail', label: 'Portail entreprises / Q&R', short: 'Q & R', icon: IconMessageDots },
  { id: 'collecte', label: 'Collecte des offres', short: 'Offres', icon: IconCurrencyEuro },
  { id: 'negociation', label: 'Négociation des offres', short: 'Négociation', icon: IconArrowsExchange },
  { id: 'analyse', label: 'Analyse & Attribution', short: 'Attribution', icon: IconTrophy },
];

const TYPE_DOC_LABELS: Record<string, string> = {
  RC: 'Règlement de la Consultation',
  CCAP: 'CCAP',
  CCTP: 'CCTP',
  DPGF: 'DPGF',
  BPU: 'BPU — Bordereau de Prix Unitaires',
  DQE: 'DQE — Détail Quantitatif Estimatif',
  Plans: 'Plans',
  Autre: 'Autre document',
};

/** Identifiant de « ligne » donné à la création d'une fiche lancée depuis le formulaire d'ajout. */
const NOUVELLE_LIGNE = '__nouvelle__';

/** Délai entre la dernière modification et l'enregistrement automatique. */
const AUTOSAVE_DELAY_MS = 1200;
const AUTOSAVE_RETRY_MS = 5000;

const EMPTY_CONSULTATION: Consultation = {
  dce_documents: [],
  entreprises: [],
  criteres: [
    { id: 'prix', nom: 'Prix (offre financière)', poids: 60 },
    { id: 'tech', nom: 'Valeur technique (mémoire)', poids: 40 },
  ],
  pieces_admin: [
    { id: 'kbis', nom: 'Extrait Kbis ou équivalent' },
    { id: 'dc1', nom: 'DC1 — Lettre de candidature' },
    { id: 'dc2', nom: 'DC2 — Déclaration du candidat' },
    { id: 'assurance', nom: 'Attestation assurance décennale' },
    { id: 'urssaf', nom: 'Attestation de vigilance URSSAF' },
  ],
  questions: [],
  offres: [],
  attributions: [],
  comparatif: [],
};

function fmt(n?: number) {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface ACTModuleProps {
  projectId: string;
  projectName: string;
  lots: ProjectLot[];
  contacts: Contact[];
  /** Données de l'affaire reprises dans les documents du marché. */
  operation?: Omit<OperationMarche, 'nom'>;
}

export default function ACTModule({ projectId, projectName, lots, contacts, operation }: ACTModuleProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('preparation');
  const [consultation, setConsultation] = useState<Consultation>(EMPTY_CONSULTATION);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Enregistrement automatique : rien n'est écrit avant la fin de la lecture
  // (une saisie arrivée trop tôt écraserait la consultation enregistrée par
  // une consultation vide), et un échec relance une tentative plus tard.
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const editVersion = useRef(0);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const { settings } = useSettings();
  const [corpsEtat, setCorpsEtat] = useState<CorpsEtat[]>([]);

  useEffect(() => {
    fetchJson<Referentiels>('/api/referentiels')
      .then(r => setCorpsEtat(r.corpsEtat || []))
      .catch(() => { /* le classement par corps d'état reste facultatif */ });
  }, []);

  // Contacts créés ou modifiés (corps d'état) depuis ce module : superposés à
  // la liste reçue du parent, qui ne se resynchronise pas toute seule tant que
  // la fiche projet n'est pas rechargée.
  const [extraContacts, setExtraContacts] = useState<Contact[]>([]);
  const allContacts = useMemo(() => {
    const byId = new Map(contacts.map(c => [c.id, c]));
    for (const c of extraContacts) byId.set(c.id, c);
    return [...byId.values()];
  }, [contacts, extraContacts]);
  const entrepriseContacts = useMemo(() => allContacts.filter(isEntrepriseContact), [allContacts]);

  const { parContactId: qualificationsParContact, reload: rechargerQualifications } = useQualifications();
  const [rechercheOuverte, setRechercheOuverte] = useState(false);
  // Formulaire d'ajout au-dessus du tableau, et ligne à mettre en avant une fois classée.
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [ficheCreee, setFicheCreee] = useState<Contact | null>(null);
  const [miseEnAvant, setMiseEnAvant] = useState<{ id: string; n: number } | null>(null);

  // Nouvelle fiche entreprise à créer depuis la saisie de la consultation.
  const [contactModalFor, setContactModalFor] = useState<{ rowId: string; name: string } | null>(null);

  /** Codes FFB déjà déclarés sur la fiche contact, pour préremplir la consultation à la sélection. */
  const corpsEtatCodesFromContact = useCallback((contact: Contact): string[] => {
    const libelles = new Set((contact.corps_etat || []).map(l => l.trim().toLowerCase()));
    return corpsEtat.filter(ce => libelles.has(ce.libelle.trim().toLowerCase())).map(ce => ce.code);
  }, [corpsEtat]);

  /**
   * Répercute la sélection de corps d'état de cette consultation sur la fiche
   * contact — sans jamais toucher aux étiquettes qui ne viennent pas de la
   * nomenclature FFB (des tags libres saisis ailleurs sur ce même champ).
   */
  const syncCorpsEtatToContact = useCallback(async (contactId: string, codes: string[]) => {
    const contact = allContacts.find(c => c.id === contactId);
    if (!contact) return;
    const ffbLibelles = new Set(corpsEtat.map(ce => ce.libelle));
    const autresTags = (contact.corps_etat || []).filter(tag => !ffbLibelles.has(tag));
    const selectedLibelles = codes.map(code => corpsEtat.find(ce => ce.code === code)?.libelle).filter((l): l is string => !!l);
    const next = [...autresTags, ...selectedLibelles];
    const unchanged = next.length === (contact.corps_etat || []).length && next.every(l => (contact.corps_etat || []).includes(l));
    if (unchanged) return;
    try {
      await apiFetch(`/api/contacts/${contactId}`, { method: 'PUT', body: JSON.stringify({ corps_etat: next }) });
      setExtraContacts(prev => [...prev.filter(c => c.id !== contactId), { ...contact, corps_etat: next }]);
    } catch (err) { console.error('Échec de la synchronisation du corps d\'état vers le contact:', err); }
  }, [allContacts, corpsEtat]);

  // Q&R form
  const [showQRForm, setShowQRForm] = useState(false);
  const [qrForm, setQrForm] = useState({ entreprise_id: '', question: '', reponse: '', publique: false });
  const [repondreId, setRepondreId] = useState<string | null>(null);

  // Lignes « options / variantes » dépliées dans la collecte (clé lot:entreprise).
  const [lignesOuvertes, setLignesOuvertes] = useState<Set<string>>(new Set());
  const basculerLignes = (cle: string) => setLignesOuvertes(prev => {
    const n = new Set(prev);
    if (n.has(cle)) n.delete(cle); else n.add(cle);
    return n;
  });

  // Comparatif
  const [showComparatif, setShowComparatif] = useState(false);
  const [expandedComparatifLots, setExpandedComparatifLots] = useState<Set<string>>(new Set());

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<any>(`/api/projects/${projectId}/act`);
      if (data?.consultation && Object.keys(data.consultation).length > 0) {
        // Une consultation enregistrée avant le passage à plusieurs corps
        // d'état par entreprise ne porte que l'ancien champ singulier — migré
        // à la lecture plutôt que perdu, jamais réécrit tant que rien d'autre
        // ne change (l'enregistrement suivant l'actera).
        const entreprises = (data.consultation.entreprises || []).map((e: any) =>
          e.corps_etat_codes ? e : { ...e, corps_etat_codes: e.corps_etat_code ? [e.corps_etat_code] : [] }
        );
        setConsultation({ ...EMPTY_CONSULTATION, ...data.consultation, entreprises });
      }
      if (data?.act_phase) setPhase(data.act_phase as Phase);
    } catch { /* first load */ }
    finally { setLoaded(true); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback((c: Consultation, p: Phase): Promise<void> => {
    // Les écritures partent l'une après l'autre : deux requêtes en vol
    // pourraient sinon se doubler, et la plus ancienne gagner.
    const version = editVersion.current;
    const run = async () => {
      setSaving(true);
      try {
        await apiFetch(`/api/projects/${projectId}/act`, {
          method: 'PUT',
          body: JSON.stringify({ consultation: c, act_phase: p }),
        });
        setSaveError(false);
        // Une modification faite pendant l'écriture reste à enregistrer.
        if (editVersion.current === version) setDirty(false);
      } catch (e) {
        console.error(e);
        setSaveError(true);
        setTimeout(() => setRetryTick(t => t + 1), AUTOSAVE_RETRY_MS);
      } finally { setSaving(false); }
    };
    saveChain.current = saveChain.current.then(run, run);
    return saveChain.current;
  }, [projectId]);

  const update = (c: Consultation) => {
    editVersion.current += 1;
    setConsultation(c);
    setDirty(true);
  };

  // Enregistrement automatique, quelques instants après la dernière modification :
  // ajouter une entreprise ou changer un lot n'exige plus d'appuyer sur « Sauvegarder ».
  useEffect(() => {
    if (!dirty || !loaded) return;
    const timer = setTimeout(() => { void save(consultation, phase); }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [consultation, phase, dirty, loaded, retryTick, save]);

  // Quitter l'onglet avant l'échéance du délai ne perd pas la dernière saisie.
  const latest = useRef({ consultation, phase, dirty, loaded, save });
  latest.current = { consultation, phase, dirty, loaded, save };
  useEffect(() => () => {
    const { consultation: c, phase: p, dirty: d, loaded: l, save: doSave } = latest.current;
    if (d && l) void doSave(c, p);
  }, []);

  const updateEntreprise = (id: string, patch: Partial<EntrepriseConsultee>) => {
    update({ ...consultation, entreprises: consultation.entreprises.map(e => e.id === id ? { ...e, ...patch } : e) });
  };

  const patchNegociation = (patch: Partial<DonneesNegociation>) => update({ ...consultation, ...patch });

  /** Pièces manquantes : marque non conformes les offres de l'entreprise, avec ce motif (geste explicite de l'architecte). */
  const marquerNonConforme = (entrepriseId: string, motif: string) => {
    update({
      ...consultation,
      offres: consultation.offres.map(o => (o.entreprise_id === entrepriseId ? { ...o, conforme: false, motif_nc: motif } : o)),
    });
  };

  const changeCorpsEtat = (e: EntrepriseConsultee, next: string[]) => {
    updateEntreprise(e.id, { corps_etat_codes: next });
    if (e.contact_id) void syncCorpsEtatToContact(e.contact_id, next);
  };

  /**
   * Ajoute l'entreprise du formulaire. Une fiche déjà consultée n'est pas
   * dupliquée : les lots choisis s'ajoutent à sa ligne. La ligne se classe
   * d'elle-même sous son lot (le tableau est regroupé par lot), et on la met en
   * avant pour qu'on la voie arriver.
   */
  const enregistrerNouvelleEntreprise = (v: NouvelleEntreprise, continuer: boolean) => {
    const existante = consultation.entreprises.find(e => e.contact_id === v.contact_id);
    const id = existante?.id ?? crypto.randomUUID();
    const union = (a: string[] = [], b: string[] = []) => [...new Set([...a, ...b])];
    const codes = union(existante?.corps_etat_codes, v.corps_etat_codes);
    const ligne: EntrepriseConsultee = existante
      ? {
          ...existante,
          email: existante.email || v.email,
          lots_ids: union(existante.lots_ids, v.lots_ids),
          corps_etat_codes: codes,
          dce_transmis_le: existante.dce_transmis_le || v.dce_transmis_le,
          relance_le: existante.relance_le || v.relance_le,
          offre_recue_le: existante.offre_recue_le || v.offre_recue_le,
        }
      : {
          id, contact_id: v.contact_id, nom: v.nom, email: v.email, lots_ids: v.lots_ids,
          envoyer_dce: v.envoyer_dce, corps_etat_codes: v.corps_etat_codes,
          dce_transmis_le: v.dce_transmis_le, relance_le: v.relance_le, offre_recue_le: v.offre_recue_le,
        };
    update({
      ...consultation,
      entreprises: existante
        ? consultation.entreprises.map(e => (e.id === id ? ligne : e))
        : [...consultation.entreprises, ligne],
    });
    if (v.corps_etat_codes.length > 0) void syncCorpsEtatToContact(v.contact_id, codes);
    setMiseEnAvant({ id, n: Date.now() });
    if (!continuer) setAjoutOuvert(false);
  };

  /** Une entreprise choisie dans la recherche rejoint la consultation, éventuellement sur un lot. */
  const ajouterDepuisRecherche = (choix: EntrepriseChoisie) => {
    if (consultation.entreprises.some(e => e.contact_id === choix.contactId)) return;
    const fiche = {
      id: choix.contactId, first_name: '', last_name: '', company_name: choix.nom,
      category: CONTACT_CATEGORY_ENTREPRISE, siret: choix.siret,
    } as unknown as Contact;
    setExtraContacts(prev => [...prev.filter(c => c.id !== choix.contactId), fiche]);
    update({
      ...consultation,
      entreprises: [...consultation.entreprises, {
        id: crypto.randomUUID(), contact_id: choix.contactId, nom: choix.nom, email: choix.email,
        lots_ids: choix.lotId ? [choix.lotId] : [], envoyer_dce: true, corps_etat_codes: [],
      }],
    });
  };

  const corpsEtatOptions = useMemo(
    () => corpsEtat.map(ce => ({ value: ce.code, label: ce.libelle })),
    [corpsEtat],
  );
  const lotOptions = useMemo(
    () => lots.map(l => ({ value: l.id, label: `Lot ${l.lot_number} — ${l.lot_title}`, shortLabel: `Lot ${l.lot_number}` })),
    [lots],
  );

  const dcePieces = useMemo(
    () => consultation.dce_documents.map(d => ({
      libelle: d.nom || TYPE_DOC_LABELS[d.type_doc] || d.type_doc,
      tous_lots: d.tous_lots,
      lots_ids: d.lots_ids,
    })),
    [consultation.dce_documents],
  );

  // ── Phase helpers ─────────────────────────────────────────────────────────

  const goPhase = (p: Phase) => {
    void save(consultation, p);
    setPhase(p);
  };

  const phaseIdx = PHASES.findIndex(p => p.id === phase);

  // L'analyse, l'attribution et les exports lisent les prix de la négociation en
  // cours (dernier tour, sinon prix vérifié), pas ceux de l'ouverture des plis.
  const offresCourantes = useMemo(
    () => offresAuPrixCourant(consultation.offres, consultation.negociations),
    [consultation.offres, consultation.negociations],
  );
  const consultationCourante = useMemo(
    () => ({ ...consultation, offres: offresCourantes }),
    [consultation, offresCourantes],
  );

  // ── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Stepper */}
      <div className="rounded-lg p-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
        <div className="flex items-center gap-0 overflow-x-auto">
          {PHASES.map((p, i) => {
            const Icon = p.icon;
            const active = p.id === phase;
            const done = i < phaseIdx;
            return (
              <React.Fragment key={p.id}>
                <button
                  onClick={() => goPhase(p.id)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold transition flex-shrink-0',
                    active ? 'bg-blue-600 text-white shadow-sm' :
                    done ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100' :
                    'text-[var(--tblr-muted)] hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  )}
                >
                  {done && !active ? <IconCircleCheck size={14} /> : <Icon size={14} />}
                  <span className="hidden sm:inline">{p.short}</span>
                  <span className="sm:hidden">{i + 1}</span>
                </button>
                {i < PHASES.length - 1 && (
                  <IconChevronRight size={14} className="flex-shrink-0 mx-1 text-zinc-300 dark:text-zinc-600" />
                )}
              </React.Fragment>
            );
          })}
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            <span
              role="status" aria-live="polite"
              className={cn('hidden sm:inline text-[0.6875rem] font-bold', saveError ? 'text-red-600' : 'text-[var(--tblr-muted)]')}
            >
              {saveError
                ? "Échec de l'enregistrement, nouvel essai…"
                : saving ? 'Enregistrement…'
                : dirty ? 'Modifications en attente'
                : 'Enregistré'}
            </span>
            <button
              onClick={() => save(consultation, phase)}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition"
            >
              <IconCheck size={12} />
              {saving ? 'Enregistrement…' : 'Sauvegarder'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Phase 1 : Préparation ─────────────────────────────────────── */}
      {phase === 'preparation' && (
        <div className="space-y-6">

          {/* Lots */}
          <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <div className="p-5 border-b border-[var(--tblr-border)] flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--tblr-text)] uppercase tracking-wider flex items-center gap-2">
                  <IconClipboardList size={15} /> Lots de travaux
                </h3>
                <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-0.5">Repris de l'onglet PRO — créez ou modifiez les lots depuis PRO / DPGF</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => settings && exportLotsToExcel(lots, settings, projectName)}
                  disabled={!settings || lots.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition"
                >
                  <IconDownload size={13} /> Excel
                </button>
                <button
                  onClick={() => settings && exportLotsToPDF(lots, settings, projectName)}
                  disabled={!settings || lots.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-700 text-white hover:bg-zinc-800 disabled:opacity-50 transition"
                >
                  <IconDownload size={13} /> PDF
                </button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-[var(--tblr-surface-2)]">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)] w-16">N°</th>
                  <th className="px-4 py-2.5 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Désignation</th>
                  <th className="px-4 py-2.5 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Entreprise attribuée</th>
                  <th className="px-4 py-2.5 text-right text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Montant HT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--tblr-border)]">
                {lots.map(lot => {
                  const attr = consultation.attributions.find(a => a.lot_id === lot.id);
                  const entreprise = attr ? consultation.entreprises.find(e => e.id === attr.entreprise_id) : null;
                  return (
                    <tr key={lot.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                      <td className="px-4 py-3 font-bold text-zinc-700 dark:text-zinc-300">{lot.lot_number}</td>
                      <td className="px-4 py-3 font-medium text-[var(--tblr-text)]">{lot.lot_title}</td>
                      <td className="px-4 py-3 text-[var(--tblr-muted)]">{entreprise?.nom || lot.contact_name || '—'}</td>
                      <td className="px-4 py-3 text-right font-bold text-zinc-700 dark:text-zinc-300">
                        {attr?.montant ? fmt(attr.montant) : fmt((lot.base_amount || 0) + (lot.options_amount || 0))}
                      </td>
                    </tr>
                  );
                })}
                {lots.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-[var(--tblr-muted)] italic text-sm">Aucun lot défini. Créez les lots de travaux dans l'onglet PRO.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* DCE Documents */}
          <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <div className="p-5 border-b border-[var(--tblr-border)] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--tblr-text)] uppercase tracking-wider flex items-center gap-2">
                  <IconFileText size={15} /> Dossier de Consultation des Entreprises (DCE)
                </h3>
                <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-0.5">Listez les documents du DCE et précisez leur disponibilité par lot</p>
              </div>
              <button onClick={() => {
                const newDoc: DCEDocument = { id: crypto.randomUUID(), nom: '', type_doc: 'RC', tous_lots: true, lots_ids: [] };
                update({ ...consultation, dce_documents: [...consultation.dce_documents, newDoc] });
              }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition">
                <IconPlus size={13} /> Ajouter
              </button>
            </div>
            <div className="p-5 space-y-3">
              {consultation.dce_documents.length === 0 && (
                <p className="text-sm text-[var(--tblr-muted)] italic text-center py-4">Aucun document DCE. Cliquez sur "Ajouter" pour commencer.</p>
              )}
              {consultation.dce_documents.map((doc, idx) => (
                <div key={doc.id} className="flex items-start gap-3 p-3 rounded-lg bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)]">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      className="px-2.5 py-1.5 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                      value={doc.type_doc}
                      onChange={e => {
                        const docs = [...consultation.dce_documents];
                        docs[idx] = { ...doc, type_doc: e.target.value as DCEDocument['type_doc'], nom: TYPE_DOC_LABELS[e.target.value] || '' };
                        update({ ...consultation, dce_documents: docs });
                      }}
                    >
                      {Object.entries(TYPE_DOC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <input
                      className="px-2.5 py-1.5 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Intitulé précis"
                      value={doc.nom}
                      onChange={e => {
                        const docs = [...consultation.dce_documents];
                        docs[idx] = { ...doc, nom: e.target.value };
                        update({ ...consultation, dce_documents: docs });
                      }}
                    />
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="flex items-center gap-1.5 text-xs text-[var(--tblr-muted)] cursor-pointer">
                        <input type="checkbox" checked={doc.tous_lots} onChange={e => {
                          const docs = [...consultation.dce_documents];
                          docs[idx] = { ...doc, tous_lots: e.target.checked };
                          update({ ...consultation, dce_documents: docs });
                        }} className="rounded w-3.5 h-3.5" />
                        Tous les lots
                      </label>
                      {!doc.tous_lots && lots.map(lot => (
                        <label key={lot.id} className="flex items-center gap-1 text-xs text-[var(--tblr-muted)] cursor-pointer">
                          <input type="checkbox"
                            checked={doc.lots_ids.includes(lot.id)}
                            onChange={e => {
                              const docs = [...consultation.dce_documents];
                              const ids = e.target.checked ? [...doc.lots_ids, lot.id] : doc.lots_ids.filter(i => i !== lot.id);
                              docs[idx] = { ...doc, lots_ids: ids };
                              update({ ...consultation, dce_documents: docs });
                            }}
                            className="rounded w-3.5 h-3.5"
                          />
                          Lot {lot.lot_number}
                        </label>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => update({ ...consultation, dce_documents: consultation.dce_documents.filter(d => d.id !== doc.id) })} className="p-1 text-zinc-300 hover:text-red-500 transition-colors flex-shrink-0 mt-1"><IconTrash size={13} /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Entreprises consultées */}
          <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <div className="p-5 border-b border-[var(--tblr-border)] flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--tblr-text)] uppercase tracking-wider flex items-center gap-2">
                  <IconBuilding size={15} /> Entreprises consultées
                </h3>
                <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-0.5">Sélectionnez les entreprises, affectez-leur les lots et leur corps d'état (nomenclature FFB)</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => settings && exportEntreprisesConsulteesToExcel(consultation.entreprises, lots, settings, projectName)}
                  disabled={!settings}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition"
                >
                  <IconDownload size={13} /> Excel
                </button>
                <button
                  onClick={() => settings && exportEntreprisesConsulteesToPDF(consultation.entreprises, lots, settings, projectName)}
                  disabled={!settings}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-700 text-white hover:bg-zinc-800 disabled:opacity-50 transition"
                >
                  <IconDownload size={13} /> PDF
                </button>
                <button
                  onClick={() => setRechercheOuverte(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition"
                >
                  <IconSearch size={13} /> Rechercher
                </button>
                <button
                  onClick={() => setAjoutOuvert(o => !o)}
                  aria-expanded={ajoutOuvert}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition',
                    ajoutOuvert
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                  )}
                >
                  <IconPlus size={13} /> Ajouter
                </button>
              </div>
            </div>
            {ajoutOuvert && (
              <EntrepriseAddForm
                contacts={entrepriseContacts}
                lots={lots}
                corpsEtatOptions={corpsEtatOptions}
                lotOptions={lotOptions}
                corpsEtatCodesFromContact={corpsEtatCodesFromContact}
                libellesDeCodes={codes => codes.map(c => corpsEtat.find(ce => ce.code === c)?.libelle).filter((l): l is string => !!l)}
                ficheCreee={ficheCreee}
                onFicheConsommee={() => setFicheCreee(null)}
                onCreateContact={name => setContactModalFor({ rowId: NOUVELLE_LIGNE, name })}
                onSave={enregistrerNouvelleEntreprise}
                onCancel={() => setAjoutOuvert(false)}
              />
            )}
            <ACTEntreprisesTable
              miseEnAvant={miseEnAvant}
              projectName={projectName}
              lots={lots}
              entreprises={consultation.entreprises}
              onChange={next => update({ ...consultation, entreprises: next as EntrepriseConsultee[] })}
              dcePieces={dcePieces}
              entrepriseContacts={entrepriseContacts}
              corpsEtatOptions={corpsEtatOptions}
              lotOptions={lotOptions}
              onChangeCorpsEtat={changeCorpsEtat}
              corpsEtatCodesFromContact={corpsEtatCodesFromContact}
              qualifications={qualificationsParContact}
              onSelectContact={(rowId, c) => {
                const nom = c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim();
                const email = c.email_work || c.email || '';
                updateEntreprise(rowId, { contact_id: c.id, nom, email, corps_etat_codes: corpsEtatCodesFromContact(c) });
              }}
              onCreateContact={(rowId, name) => setContactModalFor({ rowId, name })}
            />
          </div>
        </div>
      )}

      {rechercheOuverte && (
        <EntrepriseSearchDialog
          lots={lots}
          dejaConsultes={new Set(consultation.entreprises.map(e => e.contact_id).filter((x): x is string => !!x))}
          onClose={() => setRechercheOuverte(false)}
          onAddToConsultation={ajouterDepuisRecherche}
          onContactReady={() => void rechargerQualifications()}
        />
      )}

      {/* ── Phase 2 : Critères ────────────────────────────────────────── */}
      {phase === 'criteres' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Critères de notation */}
          <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <div className="p-5 border-b border-[var(--tblr-border)] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--tblr-text)] uppercase tracking-wider flex items-center gap-2">
                  <IconPercentage size={15} /> Critères de notation
                </h3>
                <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-0.5">Total : {consultation.criteres.reduce((s, c) => s + c.poids, 0)} % (doit être 100 %)</p>
              </div>
              <button onClick={() => {
                const nc: CritereNotation = { id: crypto.randomUUID(), nom: '', poids: 0 };
                update({ ...consultation, criteres: [...consultation.criteres, nc] });
              }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                <IconPlus size={13} /> Ajouter
              </button>
            </div>
            <div className="p-5 space-y-2">
              {consultation.criteres.map((c, idx) => (
                <div key={c.id} className="flex items-center gap-3">
                  <input className="flex-1 text-sm px-3 py-2 border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Nom du critère" value={c.nom}
                    onChange={e => { const cr = [...consultation.criteres]; cr[idx] = { ...c, nom: e.target.value }; update({ ...consultation, criteres: cr }); }} />
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <input type="number" min={0} max={100}
                      className="w-16 text-sm text-center px-2 py-2 border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                      value={c.poids}
                      onChange={e => { const cr = [...consultation.criteres]; cr[idx] = { ...c, poids: parseInt(e.target.value) || 0 }; update({ ...consultation, criteres: cr }); }} />
                    <span className="text-xs text-[var(--tblr-muted)]">%</span>
                  </div>
                  <button onClick={() => update({ ...consultation, criteres: consultation.criteres.filter(x => x.id !== c.id) })} className="p-1 text-zinc-300 hover:text-red-500"><IconTrash size={13} /></button>
                </div>
              ))}
              {(() => {
                const total = consultation.criteres.reduce((s, c) => s + c.poids, 0);
                if (total !== 100) return (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 text-xs mt-3">
                    <IconAlertTriangle size={14} />
                    Total actuel : {total} % — Le total doit être égal à 100 %
                  </div>
                );
                return <p className="text-xs text-green-600 dark:text-green-400 font-bold flex items-center gap-1 mt-3"><IconCheck size={12} /> Total : 100 %</p>;
              })()}
            </div>
          </div>

          {/* Pièces administratives obligatoires */}
          <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <div className="p-5 border-b border-[var(--tblr-border)] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--tblr-text)] uppercase tracking-wider flex items-center gap-2">
                  <IconClipboardList size={15} /> Pièces administratives obligatoires
                </h3>
                <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-0.5">Documents requis pour la conformité de l'offre</p>
              </div>
              <button onClick={() => {
                const np: PieceAdmin = { id: crypto.randomUUID(), nom: '' };
                update({ ...consultation, pieces_admin: [...consultation.pieces_admin, np] });
              }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                <IconPlus size={13} /> Ajouter
              </button>
            </div>
            <div className="p-5 space-y-2">
              {consultation.pieces_admin.map((p, idx) => (
                <div key={p.id} className="flex items-center gap-2">
                  <IconCheck size={14} className="text-green-500 flex-shrink-0" />
                  <input className="flex-1 text-sm px-3 py-2 border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                    value={p.nom}
                    onChange={e => { const ps = [...consultation.pieces_admin]; ps[idx] = { ...p, nom: e.target.value }; update({ ...consultation, pieces_admin: ps }); }}
                    placeholder="ex : Attestation URSSAF" />
                  <button onClick={() => update({ ...consultation, pieces_admin: consultation.pieces_admin.filter(x => x.id !== p.id) })} className="p-1 text-zinc-300 hover:text-red-500"><IconTrash size={13} /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Documents du marché : RC, CCAP, acte d'engagement */}
          <div className="lg:col-span-2">
            <MarcheDocumentsPanel
              consultation={consultation as any}
              lots={lots}
              contacts={allContacts}
              operation={{ nom: projectName, ...operation }}
              onChange={marche => update({ ...consultation, marche })}
            />
          </div>
        </div>
      )}

      {/* ── Phase 3 : Portail / Q&R ──────────────────────────────────── */}
      {phase === 'portail' && (
        <div className="space-y-6">
          {/* Récapitulatif DCE */}
          <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <div className="p-5 border-b border-[var(--tblr-border)]">
              <h3 className="text-sm font-bold text-[var(--tblr-text)] uppercase tracking-wider flex items-center gap-2">
                <IconEye size={15} /> Documents DCE disponibles
              </h3>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {consultation.dce_documents.map(doc => (
                <div key={doc.id} className="flex items-start gap-3 p-3 rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface-2)]/30">
                  <IconFileText size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{doc.nom || TYPE_DOC_LABELS[doc.type_doc]}</p>
                    <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-0.5">
                      {doc.tous_lots ? 'Tous les lots' : `Lots : ${doc.lots_ids.map(lid => lots.find(l => l.id === lid)?.lot_number).filter(Boolean).join(', ')}`}
                    </p>
                  </div>
                </div>
              ))}
              {consultation.dce_documents.length === 0 && <p className="text-sm text-[var(--tblr-muted)] italic col-span-3">Aucun document DCE défini à la phase 1.</p>}
            </div>
          </div>

          {/* Questions / Réponses */}
          <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <div className="p-5 border-b border-[var(--tblr-border)] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--tblr-text)] uppercase tracking-wider flex items-center gap-2">
                  <IconMessageDots size={15} /> Questions / Réponses
                </h3>
                <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-0.5">Centralisez les questions des entreprises et les réponses publiques</p>
              </div>
              <button onClick={() => setShowQRForm(!showQRForm)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                <IconPlus size={13} /> Nouvelle question
              </button>
            </div>

            {showQRForm && (
              <div className="p-5 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <select className="text-sm px-3 py-2 border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none"
                    value={qrForm.entreprise_id}
                    onChange={e => setQrForm({ ...qrForm, entreprise_id: e.target.value })}>
                    <option value="">— Entreprise —</option>
                    {consultation.entreprises.map(e => <option key={e.id} value={e.id}>{e.nom}</option>)}
                  </select>
                  <label className="flex items-center gap-2 text-xs text-[var(--tblr-muted)] cursor-pointer">
                    <input type="checkbox" checked={qrForm.publique} onChange={e => setQrForm({ ...qrForm, publique: e.target.checked })} className="rounded w-4 h-4" />
                    Réponse publique (visible par tous)
                  </label>
                </div>
                <textarea className="w-full text-sm px-3 py-2 border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none resize-none h-20"
                  placeholder="Question de l'entreprise…"
                  value={qrForm.question} onChange={e => setQrForm({ ...qrForm, question: e.target.value })} />
                <textarea className="w-full text-sm px-3 py-2 border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none resize-none h-16"
                  placeholder="Réponse (optionnel pour l'instant)…"
                  value={qrForm.reponse} onChange={e => setQrForm({ ...qrForm, reponse: e.target.value })} />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowQRForm(false)} className="px-3 py-1.5 text-xs text-[var(--tblr-muted)]">Annuler</button>
                  <button onClick={() => {
                    if (!qrForm.question.trim()) return;
                    const entreprise = consultation.entreprises.find(e => e.id === qrForm.entreprise_id);
                    const newQ: QuestionReponse = {
                      id: crypto.randomUUID(),
                      entreprise_id: qrForm.entreprise_id,
                      entreprise_nom: entreprise?.nom || 'Anonyme',
                      question: qrForm.question,
                      date_question: new Date().toISOString().split('T')[0],
                      reponse: qrForm.reponse || undefined,
                      date_reponse: qrForm.reponse ? new Date().toISOString().split('T')[0] : undefined,
                      publique: qrForm.publique,
                    };
                    update({ ...consultation, questions: [...consultation.questions, newQ] });
                    setQrForm({ entreprise_id: '', question: '', reponse: '', publique: false });
                    setShowQRForm(false);
                  }} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold">Enregistrer</button>
                </div>
              </div>
            )}

            <div className="divide-y divide-[var(--tblr-border)]">
              {consultation.questions.map(q => (
                <div key={q.id} className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{q.entreprise_nom}</span>
                        <span className="text-[0.6875rem] text-[var(--tblr-muted)]">{new Date(q.date_question).toLocaleDateString('fr-FR')}</span>
                        {q.publique && <span className="text-[0.6875rem] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">Publique</span>}
                      </div>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 bg-[var(--tblr-surface-2)] rounded-lg px-3 py-2">{q.question}</p>
                      {q.reponse ? (
                        <div className="mt-2 ml-4 pl-3 border-l-2 border-blue-300">
                          <p className="text-xs text-[var(--tblr-muted)] mb-0.5">Réponse — {q.date_reponse && new Date(q.date_reponse).toLocaleDateString('fr-FR')}</p>
                          <p className="text-sm text-blue-700 dark:text-blue-300">{q.reponse}</p>
                        </div>
                      ) : (
                        repondreId === q.id ? (
                          <div className="mt-2 ml-4 space-y-2">
                            <textarea className="w-full text-sm px-3 py-2 border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none resize-none h-16"
                              placeholder="Votre réponse…"
                              onChange={e => {
                                const qs = consultation.questions.map(x => x.id === q.id ? { ...x, _draft: e.target.value } : x);
                                setConsultation({ ...consultation, questions: qs });
                              }} />
                            <div className="flex gap-2">
                              <button onClick={() => setRepondreId(null)} className="text-xs text-[var(--tblr-muted)] px-2 py-1">Annuler</button>
                              <button onClick={() => {
                                const qs = consultation.questions.map(x => {
                                  if (x.id !== q.id) return x;
                                  const { _draft, ...rest } = x as any;
                                  return { ...rest, reponse: _draft || '', date_reponse: new Date().toISOString().split('T')[0] };
                                });
                                update({ ...consultation, questions: qs });
                                setRepondreId(null);
                              }} className="text-xs px-3 py-1 bg-blue-600 text-white rounded-lg font-bold">Répondre</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setRepondreId(q.id)} className="mt-2 ml-4 text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
                            <IconSend size={11} /> Répondre
                          </button>
                        )
                      )}
                    </div>
                    <button onClick={() => update({ ...consultation, questions: consultation.questions.filter(x => x.id !== q.id) })} className="p-1 text-zinc-300 hover:text-red-500 flex-shrink-0"><IconTrash size={13} /></button>
                  </div>
                </div>
              ))}
              {consultation.questions.length === 0 && <div className="px-4 py-8 text-center text-[var(--tblr-muted)] italic text-sm">Aucune question enregistrée.</div>}
            </div>
          </div>
        </div>
      )}

      {/* ── Phase 4 : Collecte des offres ─────────────────────────────── */}
      {phase === 'collecte' && (
        <div className="space-y-6">
          {lots.map(lot => {
            const entreprisesLot = consultation.entreprises.filter(e => e.lots_ids.includes(lot.id));
            return (
              <div key={lot.id} className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                <div className="p-5 border-b border-[var(--tblr-border)]">
                  <h3 className="text-sm font-bold text-[var(--tblr-text)] flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[0.6875rem] font-black">Lot {lot.lot_number}</span>
                    {lot.lot_title}
                  </h3>
                  <div className="flex items-center justify-between gap-3 mt-0.5">
                    <p className="text-[0.6875rem] text-[var(--tblr-muted)]">{entreprisesLot.length} entreprise(s) consultée(s) sur ce lot</p>
                    <button
                      onClick={() => genererPVOuverture(lots, consultation, projectName, settings ?? {}, lot.id)}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[0.6875rem] font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition"
                    >
                      <IconDownload size={12} /> PV d'ouverture
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead className="bg-[var(--tblr-surface-2)]">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Entreprise</th>
                        <th className="px-4 py-2.5 text-right text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Montant HT (€)</th>
                        <th className="px-4 py-2.5 text-center text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Note technique /100</th>
                        <th className="px-4 py-2.5 text-center text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Conforme</th>
                        <th className="px-4 py-2.5 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Motif NC</th>
                        <th className="px-4 py-2.5 text-center text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Options / variantes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--tblr-border)]">
                      {entreprisesLot.map(entreprise => {
                        const offre = consultation.offres.find(o => o.lot_id === lot.id && o.entreprise_id === entreprise.id)
                          || { id: crypto.randomUUID(), lot_id: lot.id, entreprise_id: entreprise.id, montant_base: 0, note_technique: 0, conforme: true, motif_nc: '' };
                        const updateOffre = (updates: Partial<Offre>) => {
                          const existing = consultation.offres.find(o => o.lot_id === lot.id && o.entreprise_id === entreprise.id);
                          let newOffres;
                          if (existing) {
                            newOffres = consultation.offres.map(o => o.lot_id === lot.id && o.entreprise_id === entreprise.id ? { ...o, ...updates } : o);
                          } else {
                            newOffres = [...consultation.offres, { ...offre, ...updates }];
                          }
                          update({ ...consultation, offres: newOffres });
                        };
                        const cleLignes = `${lot.id}:${entreprise.id}`;
                        const negOffre = trouverNegociation(consultation.negociations, lot.id, entreprise.id);
                        const nbLignes = negOffre?.lignes.length ?? 0;
                        return (
                          <React.Fragment key={entreprise.id}>
                          <tr className={cn('hover:bg-zinc-50 dark:hover:bg-zinc-800/30', !offre.conforme && 'bg-red-50/50 dark:bg-red-900/10')}>
                            <td className="px-4 py-3 font-medium text-zinc-800 dark:text-zinc-200">{entreprise.nom}</td>
                            <td className="px-4 py-3">
                              <input type="number" min={0} step={100}
                                className="w-full text-right px-2 py-1.5 text-sm border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                                value={offre.montant_base || ''}
                                onChange={e => updateOffre({ montant_base: parseFloat(e.target.value) || 0 })}
                                placeholder="0.00" />
                            </td>
                            <td className="px-4 py-3">
                              <input type="number" min={0} max={100}
                                className="w-20 mx-auto block text-center px-2 py-1.5 text-sm border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500"
                                value={offre.note_technique || ''}
                                onChange={e => updateOffre({ note_technique: parseFloat(e.target.value) || 0 })}
                                placeholder="—" />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <input type="checkbox" checked={!!offre.conforme}
                                onChange={e => updateOffre({ conforme: e.target.checked })}
                                className="w-4 h-4 rounded accent-green-600" />
                            </td>
                            <td className="px-4 py-3">
                              {!offre.conforme && (
                                <input className="w-full text-xs px-2 py-1.5 border border-red-200 dark:border-red-800 rounded-lg bg-white dark:bg-zinc-900 outline-none"
                                  placeholder="Motif de non-conformité"
                                  value={offre.motif_nc || ''}
                                  onChange={e => updateOffre({ motif_nc: e.target.value })} />
                              )}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                type="button" aria-expanded={lignesOuvertes.has(cleLignes)} onClick={() => basculerLignes(cleLignes)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition"
                              >
                                <IconAdjustments size={12} /> {nbLignes > 0 ? `${nbLignes} ligne${nbLignes > 1 ? 's' : ''}` : 'Ajouter'}
                              </button>
                            </td>
                          </tr>
                          {lignesOuvertes.has(cleLignes) && (
                            <tr className="bg-[var(--tblr-surface-2)]/40">
                              <td colSpan={6} className="px-4 py-3">
                                <LignesOffreEditor
                                  lotId={lot.id} entrepriseId={entreprise.id} negociations={consultation.negociations}
                                  onChange={negociations => update({ ...consultation, negociations })}
                                />
                              </td>
                            </tr>
                          )}
                          </React.Fragment>
                        );
                      })}
                      {entreprisesLot.length === 0 && (
                        <tr><td colSpan={6} className="px-4 py-6 text-center text-[var(--tblr-muted)] italic text-sm">Aucune entreprise affectée à ce lot (phase 1).</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          {lots.length === 0 && <div className="rounded-lg p-8 text-center text-[var(--tblr-muted)] italic" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>Aucun lot défini. Créez les lots en phase 1.</div>}

          {/* ── Comparatif détaillé ──────────────────────────────────────── */}
          <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
            <div className="p-5 border-b border-[var(--tblr-border)] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--tblr-text)] uppercase tracking-wider flex items-center gap-2">
                  <IconScale size={15} /> Comparatif détaillé des offres
                </h3>
                <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-0.5">Tableau article par article — saisie manuelle ou auto-rempli depuis les offres</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    // Auto-fill lot totals from offres into comparatif
                    const comp: ComparatifLot[] = lots.map(lot => {
                      const existing = (consultation.comparatif || []).find(cl => cl.lot_id === lot.id);
                      const articles: ComparatifArticle[] = existing?.articles || [];
                      // Ensure a sous-total-lot row exists
                      const hasTotalRow = articles.some(a => a.is_subtotal && a.code === '__lot_total__');
                      const totalRow: ComparatifArticle = hasTotalRow
                        ? articles.find(a => a.is_subtotal && a.code === '__lot_total__')!
                        : { id: crypto.randomUUID(), code: '__lot_total__', titre: 'Sous-total du lot HT', is_subtotal: true, prix: {} };
                      // Fill prices from offres
                      const newPrix: Record<string, number> = { ...totalRow.prix };
                      consultation.offres.filter(o => o.lot_id === lot.id).forEach(o => {
                        if (o.montant_base) newPrix[o.entreprise_id] = o.montant_base;
                      });
                      const newTotalRow = { ...totalRow, prix: newPrix };
                      const filtered = articles.filter(a => !(a.is_subtotal && a.code === '__lot_total__'));
                      return { lot_id: lot.id, articles: [...filtered, newTotalRow] };
                    });
                    update({ ...consultation, comparatif: comp });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition"
                >
                  <IconCheck size={13} /> Auto-remplir totaux
                </button>
                <button
                  onClick={() => generateComparatifExcel(lots, consultationCourante, projectName, settings ?? {})}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 text-white hover:bg-green-700 transition"
                >
                  <IconDownload size={13} /> Export Excel
                </button>
                <button
                  onClick={() => setShowComparatif(!showComparatif)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 transition"
                >
                  {showComparatif ? <IconX size={13} /> : <IconEye size={13} />}
                  {showComparatif ? 'Masquer' : 'Afficher'}
                </button>
              </div>
            </div>

            {showComparatif && (
              <div className="p-5 space-y-6">
                {lots.length === 0 && <p className="text-sm text-[var(--tblr-muted)] italic text-center py-4">Aucun lot défini.</p>}
                {lots.map(lot => {
                  const cl: ComparatifLot = (consultation.comparatif || []).find(c => c.lot_id === lot.id) || { lot_id: lot.id, articles: [] };
                  const entreprisesLot = consultation.entreprises.filter(e => e.lots_ids.includes(lot.id));
                  const isExpanded = expandedComparatifLots.has(lot.id);

                  const updateCL = (newArticles: ComparatifArticle[]) => {
                    const newComp = (consultation.comparatif || []).filter(c => c.lot_id !== lot.id);
                    newComp.push({ lot_id: lot.id, articles: newArticles });
                    update({ ...consultation, comparatif: newComp });
                  };

                  const updateArticle = (idx: number, patch: Partial<ComparatifArticle>) => {
                    const arts = [...cl.articles];
                    arts[idx] = { ...arts[idx], ...patch };
                    updateCL(arts);
                  };

                  const updatePrix = (idx: number, entrepriseId: string, val: number) => {
                    const arts = [...cl.articles];
                    arts[idx] = { ...arts[idx], prix: { ...arts[idx].prix, [entrepriseId]: val } };
                    updateCL(arts);
                  };

                  const removeArticle = (idx: number) => {
                    updateCL(cl.articles.filter((_, i) => i !== idx));
                  };

                  const addSection = () => {
                    const art: ComparatifArticle = { id: crypto.randomUUID(), code: '', titre: 'Nouvelle section', is_section_header: true, prix: {} };
                    updateCL([...cl.articles, art]);
                  };

                  const addArticle = () => {
                    const art: ComparatifArticle = { id: crypto.randomUUID(), code: '', titre: '', estimatif: undefined, prix: {} };
                    updateCL([...cl.articles, art]);
                  };

                  const addSubtotal = () => {
                    const art: ComparatifArticle = { id: crypto.randomUUID(), code: '', titre: 'Sous-total HT', is_subtotal: true, prix: {} };
                    updateCL([...cl.articles, art]);
                  };

                  return (
                    <div key={lot.id} className="border border-[var(--tblr-border)] rounded-lg overflow-hidden">
                      <div
                        className="flex items-center justify-between px-4 py-3 bg-[var(--tblr-surface-2)] cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        onClick={() => setExpandedComparatifLots(prev => {
                          const next = new Set(prev);
                          next.has(lot.id) ? next.delete(lot.id) : next.add(lot.id);
                          return next;
                        })}
                      >
                        <div className="flex items-center gap-2">
                          {isExpanded ? <IconChevronRight size={14} className="rotate-90 transition-transform" /> : <IconChevronRight size={14} className="transition-transform" />}
                          <span className="text-xs font-black text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-lg bg-blue-100 dark:bg-blue-900/30">Lot {lot.lot_number}</span>
                          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{lot.lot_title}</span>
                          <span className="text-[0.6875rem] text-[var(--tblr-muted)]">({cl.articles.length} lignes)</span>
                        </div>
                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                          <button onClick={addSection} className="px-2 py-1 text-[0.6875rem] font-bold rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-300">+ Section</button>
                          <button onClick={addArticle} className="px-2 py-1 text-[0.6875rem] font-bold rounded bg-blue-100 text-blue-700 hover:bg-blue-200">+ Article</button>
                          <button onClick={addSubtotal} className="px-2 py-1 text-[0.6875rem] font-bold rounded bg-amber-100 text-amber-700 hover:bg-amber-200">+ Sous-total</button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs" style={{ minWidth: `${300 + entreprisesLot.length * 140}px` }}>
                            <thead className="bg-zinc-100 dark:bg-zinc-800">
                              <tr>
                                <th className="px-3 py-2 text-left font-bold text-[var(--tblr-muted)] w-20">Code</th>
                                <th className="px-3 py-2 text-left font-bold text-[var(--tblr-muted)]">Désignation</th>
                                <th className="px-3 py-2 text-right font-bold text-[var(--tblr-muted)] w-28">Estimatif HT</th>
                                {entreprisesLot.map(e => (
                                  <th key={e.id} className="px-3 py-2 text-right font-bold text-zinc-700 dark:text-zinc-300 w-36 whitespace-nowrap">{e.nom}</th>
                                ))}
                                <th className="w-8"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--tblr-border)]">
                              {cl.articles.map((article, idx) => {
                                if (article.is_section_header) {
                                  return (
                                    <tr key={article.id} className="bg-blue-50 dark:bg-blue-900/10">
                                      <td className="px-3 py-2">
                                        <input className="w-full bg-transparent text-[0.6875rem] font-bold text-blue-600 outline-none border-b border-blue-200 dark:border-blue-800"
                                          value={article.code} onChange={e => updateArticle(idx, { code: e.target.value })} placeholder="Réf." />
                                      </td>
                                      <td colSpan={2 + entreprisesLot.length} className="px-3 py-2">
                                        <input className="w-full bg-transparent text-xs font-bold text-blue-700 dark:text-blue-300 uppercase outline-none"
                                          value={article.titre} onChange={e => updateArticle(idx, { titre: e.target.value })} />
                                      </td>
                                      <td className="px-2 py-2 text-right">
                                        <button onClick={() => removeArticle(idx)} className="p-0.5 text-zinc-300 hover:text-red-500"><IconTrash size={11} /></button>
                                      </td>
                                    </tr>
                                  );
                                }
                                if (article.is_subtotal) {
                                  return (
                                    <tr key={article.id} className="bg-amber-50 dark:bg-amber-900/10 font-bold">
                                      <td className="px-3 py-2 text-[var(--tblr-muted)] text-[0.6875rem]">{article.code !== '__lot_total__' ? article.code : ''}</td>
                                      <td className="px-3 py-2">
                                        <input className="w-full bg-transparent text-xs font-bold text-amber-700 dark:text-amber-400 outline-none"
                                          value={article.titre} onChange={e => updateArticle(idx, { titre: e.target.value })} readOnly={article.code === '__lot_total__'} />
                                      </td>
                                      <td className="px-3 py-2 text-right text-[var(--tblr-muted)]">—</td>
                                      {entreprisesLot.map(e => (
                                        <td key={e.id} className="px-3 py-2 text-right">
                                          <input type="number" min={0} step={100}
                                            className="w-full text-right px-1.5 py-1 border border-amber-200 dark:border-amber-700 rounded bg-white dark:bg-zinc-900 outline-none focus:ring-1 focus:ring-amber-400 text-xs font-bold"
                                            value={article.prix[e.id] ?? ''}
                                            onChange={ev => updatePrix(idx, e.id, parseFloat(ev.target.value) || 0)}
                                            placeholder="—" />
                                        </td>
                                      ))}
                                      <td className="px-2 py-2 text-right">
                                        {article.code !== '__lot_total__' && (
                                          <button onClick={() => removeArticle(idx)} className="p-0.5 text-zinc-300 hover:text-red-500"><IconTrash size={11} /></button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                }
                                return (
                                  <tr key={article.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                                    <td className="px-3 py-2">
                                      <input className="w-full text-[0.6875rem] px-1.5 py-1 border border-[var(--tblr-border)] rounded bg-white dark:bg-zinc-900 outline-none focus:ring-1 focus:ring-blue-400"
                                        value={article.code} onChange={e => updateArticle(idx, { code: e.target.value })} placeholder="1.3.1" />
                                    </td>
                                    <td className="px-3 py-2">
                                      <input className="w-full text-xs px-1.5 py-1 border border-[var(--tblr-border)] rounded bg-white dark:bg-zinc-900 outline-none focus:ring-1 focus:ring-blue-400"
                                        value={article.titre} onChange={e => updateArticle(idx, { titre: e.target.value })} placeholder="Désignation de l'article" />
                                    </td>
                                    <td className="px-3 py-2">
                                      <input type="number" min={0} step={100}
                                        className="w-full text-right px-1.5 py-1 border border-[var(--tblr-border)] rounded bg-white dark:bg-zinc-900 outline-none focus:ring-1 focus:ring-blue-400 text-xs"
                                        value={article.estimatif ?? ''}
                                        onChange={e => updateArticle(idx, { estimatif: parseFloat(e.target.value) || undefined })}
                                        placeholder="—" />
                                    </td>
                                    {entreprisesLot.map(e => (
                                      <td key={e.id} className="px-3 py-2">
                                        <input type="number" min={0} step={100}
                                          className="w-full text-right px-1.5 py-1 border border-[var(--tblr-border)] rounded bg-white dark:bg-zinc-900 outline-none focus:ring-1 focus:ring-blue-400 text-xs"
                                          value={article.prix[e.id] ?? ''}
                                          onChange={ev => updatePrix(idx, e.id, parseFloat(ev.target.value) || 0)}
                                          placeholder="—" />
                                      </td>
                                    ))}
                                    <td className="px-2 py-2 text-right">
                                      <button onClick={() => removeArticle(idx)} className="p-0.5 text-zinc-300 hover:text-red-500"><IconTrash size={11} /></button>
                                    </td>
                                  </tr>
                                );
                              })}
                              {cl.articles.length === 0 && (
                                <tr>
                                  <td colSpan={4 + entreprisesLot.length} className="px-4 py-6 text-center text-[var(--tblr-muted)] italic">
                                    Cliquez sur "+ Section", "+ Article" ou "+ Sous-total" pour construire le comparatif de ce lot.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Phase 5 : Analyse & Attribution ──────────────────────────── */}
      {phase === 'negociation' && (
        <NegociationPhase
          lots={lots}
          consultation={{ ...consultation, entreprises: consultation.entreprises }}
          projectName={projectName}
          settings={settings ?? {}}
          onPatch={patchNegociation}
          onMotifNonConformite={marquerNonConforme}
        />
      )}

      {phase === 'analyse' && (
        <div className="space-y-6">
          {/* Bouton global RAO */}
          <div className="flex items-center justify-between rounded-lg p-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
            <div>
              <p className="text-sm font-bold text-[var(--tblr-text)]">Rapport d'Analyse des Offres (RAO)</p>
              <p className="text-[0.6875rem] text-[var(--tblr-muted)]">Génère un PDF comparatif pour tous les lots ou par lot</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => generateRAO(lots, consultationCourante, projectName, settings ?? {})}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 transition">
                <IconDownload size={14} /> RAO Global
              </button>
            </div>
          </div>

          {/* Par lot */}
          {lots.map(lot => {
            const offresLot = offresCourantes.filter(o => o.lot_id === lot.id);
            const offresConformes = offresLot.filter(o => o.conforme && o.montant_base > 0);
            const minMontant = offresConformes.length > 0 ? Math.min(...offresConformes.map(o => o.montant_base)) : 0;
            const attribution = consultation.attributions.find(a => a.lot_id === lot.id);
            const poidsPrix = consultation.criteres.find(c => c.id === 'prix')?.poids ?? 60;
            const poidsTech = consultation.criteres.find(c => c.id === 'tech')?.poids ?? 40;

            const scored = offresLot.map(offre => {
              const entreprise = consultation.entreprises.find(e => e.id === offre.entreprise_id);
              const notePrix = offre.conforme && offre.montant_base > 0 && minMontant > 0
                ? minMontant / offre.montant_base * 100 : 0;
              const noteGlobale = offre.conforme
                ? notePrix * poidsPrix / 100 + (offre.note_technique || 0) * poidsTech / 100 : 0;
              return { offre, entreprise, notePrix, noteGlobale };
            }).sort((a, b) => b.noteGlobale - a.noteGlobale);

            return (
              <div key={lot.id} className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
                <div className="p-5 border-b border-[var(--tblr-border)] flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[var(--tblr-text)] flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[0.6875rem] font-black">Lot {lot.lot_number}</span>
                    {lot.lot_title}
                    {attribution && (
                      <span className="text-[0.6875rem] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-bold">
                        ✓ Attribué à {consultation.entreprises.find(e => e.id === attribution.entreprise_id)?.nom}
                      </span>
                    )}
                  </h3>
                  <button onClick={() => generateRAO(lots, consultationCourante, projectName, settings ?? {}, lot.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 transition">
                    <IconDownload size={13} /> RAO Lot
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead className="bg-[var(--tblr-surface-2)]">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)]">Rang</th>
                        <th className="px-4 py-2.5 text-left text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)]">Entreprise</th>
                        <th className="px-4 py-2.5 text-right text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)]">Montant HT</th>
                        <th className="px-4 py-2.5 text-right text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)]">% / moins-disant</th>
                        <th className="px-4 py-2.5 text-center text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)]">Note prix ({poidsPrix}%)</th>
                        <th className="px-4 py-2.5 text-center text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)]">Note tech. ({poidsTech}%)</th>
                        <th className="px-4 py-2.5 text-center text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)]">NOTE GLOBALE</th>
                        <th className="px-4 py-2.5 text-center text-[0.6875rem] font-bold uppercase text-[var(--tblr-muted)]">Attribuer</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--tblr-border)]">
                      {scored.map(({ offre, entreprise, notePrix, noteGlobale }, rank) => {
                        const isAttribue = attribution?.entreprise_id === offre.entreprise_id;
                        const pctMinDisant = minMontant > 0 && offre.montant_base > 0
                          ? ((offre.montant_base - minMontant) / minMontant * 100).toFixed(1) : '—';
                        return (
                          <tr key={offre.id} className={cn(
                            'hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors',
                            isAttribue && 'bg-green-50 dark:bg-green-900/10',
                            !offre.conforme && 'bg-red-50/50 dark:bg-red-900/10',
                          )}>
                            <td className="px-4 py-3 text-center">
                              {offre.conforme ? (
                                <span className={cn('text-sm font-black', rank === 0 ? 'text-yellow-500' : rank === 1 ? 'text-[var(--tblr-muted)]' : rank === 2 ? 'text-amber-600' : 'text-[var(--tblr-muted)]')}>
                                  {rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `#${rank + 1}`}
                                </span>
                              ) : <span className="text-red-500 text-xs font-bold">NC</span>}
                            </td>
                            <td className="px-4 py-3 font-medium text-zinc-800 dark:text-zinc-200">{entreprise?.nom || '—'}</td>
                            <td className="px-4 py-3 text-right font-bold text-[var(--tblr-text)]">
                              {fmt(offre.montant_base)}
                              {(() => {
                                const ouverture = consultation.offres.find(o => o.id === offre.id)?.montant_base;
                                return ouverture != null && ouverture !== offre.montant_base
                                  ? <span className="block text-[0.6875rem] font-normal text-[var(--tblr-muted)] line-through">{fmt(ouverture)}</span>
                                  : null;
                              })()}
                            </td>
                            <td className="px-4 py-3 text-right text-[var(--tblr-muted)] text-xs">
                              {offre.conforme && pctMinDisant !== '—' ? `+${pctMinDisant}%` : '—'}
                            </td>
                            <td className="px-4 py-3 text-center font-bold" style={{ color: offre.conforme ? '#206bc4' : '#d63939' }}>
                              {offre.conforme ? notePrix.toFixed(1) : 'NC'}
                            </td>
                            <td className="px-4 py-3 text-center font-bold text-indigo-600 dark:text-indigo-400">
                              {offre.conforme ? (offre.note_technique || '—') : 'NC'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={cn('text-sm font-black px-2 py-0.5 rounded-lg', offre.conforme && rank === 0 ? 'bg-green-100 text-green-700' : 'text-[var(--tblr-muted)]')}>
                                {offre.conforme ? noteGlobale.toFixed(1) : 'NC'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              {offre.conforme && (
                                <button onClick={() => {
                                  const newAttrs = consultation.attributions.filter(a => a.lot_id !== lot.id);
                                  if (!isAttribue) {
                                    newAttrs.push({ lot_id: lot.id, entreprise_id: offre.entreprise_id, montant: montantAttribution(offre, consultation.negociations) });
                                  }
                                  update({ ...consultation, attributions: newAttrs });
                                }} className={cn(
                                  'px-3 py-1 rounded-lg text-xs font-bold transition',
                                  isAttribue
                                    ? 'bg-green-600 text-white hover:bg-red-100 hover:text-red-600'
                                    : 'bg-zinc-100 dark:bg-zinc-800 text-[var(--tblr-muted)] hover:bg-green-100 hover:text-green-700'
                                )}>
                                  {isAttribue ? '✓ Attribué' : 'Attribuer'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {scored.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--tblr-muted)] italic text-sm">Aucune offre saisie pour ce lot (phase 4).</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Navigation bas */}
      <div className="flex justify-between pt-2">
        <button
          onClick={() => phaseIdx > 0 && goPhase(PHASES[phaseIdx - 1].id)}
          disabled={phaseIdx === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-30 transition"
        >
          <IconChevronLeft size={14} /> Phase précédente
        </button>
        <button
          onClick={() => phaseIdx < PHASES.length - 1 && goPhase(PHASES[phaseIdx + 1].id)}
          disabled={phaseIdx === PHASES.length - 1}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-30 transition"
        >
          Phase suivante <IconChevronRight size={14} />
        </button>
      </div>

      {contactModalFor && (
        <ContactModal
          isOpen
          initialCategory={CONTACT_CATEGORY_ENTREPRISE}
          initialData={{ company_name: contactModalFor.name }}
          onClose={() => setContactModalFor(null)}
          onSuccess={c => {
            setExtraContacts(prev => [...prev, c]);
            if (contactModalFor.rowId === NOUVELLE_LIGNE) {
              // Création lancée depuis le formulaire d'ajout : la fiche y est sélectionnée.
              setFicheCreee(c);
              setContactModalFor(null);
              return;
            }
            const nom = c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim();
            const email = c.email_work || c.email || '';
            updateEntreprise(contactModalFor.rowId, { contact_id: c.id, nom, email, corps_etat_codes: corpsEtatCodesFromContact(c) });
            setContactModalFor(null);
          }}
        />
      )}
    </div>
  );
}
