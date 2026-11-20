import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconSearch, IconSend, IconLink, IconTrash, IconPlus, IconAlertTriangle, IconX, IconUserPlus, IconCalendarEvent, IconPhone,
} from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { groupByLot } from '../lib/actExport';
import {
  type EntrepriseSuivi, type StatutEntreprise, type FiltresEntreprises,
  STATUT_LABELS, STATUT_ORDER, SANS_LOT, MIN_ENTREPRISES_PAR_LOT, FILTRES_VIDES,
  statutEntreprise, resumeSuivi, couverture, suggererContacts, filtrerEntreprises,
  filtresActifs, nomContact, todayIso, listeAPlat, type Regroupement, destinatairesEntreprise, telephoneEntreprise } from '../lib/actEntreprises';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useMailAccounts } from '../hooks/useMailAccounts';
import type { Contact, ProjectLot } from '../types';
import { EntrepriseAutocomplete } from './EntrepriseAutocomplete';
import { MultiSelectDropdown, type MultiSelectOption } from './MultiSelectDropdown';
import { QualificationBadge } from './QualificationBadge';
import { resumeQualifications, type Qualification } from '../lib/qualifications';
import MailComposeModal from './MailComposeModal';
import { documentToFile } from '../lib/emailAttachments';
import { apiFetch } from '../lib/api';
import type { PieceMarcheGeneree } from '../lib/marchePieces';
import { formaterDateHeure } from '../lib/depotAffichage';
import { documentsAJoindre, lignesIndices, piecesDeEntreprise, type DocumentDce } from '../lib/dceIndices';
import { genererTableauIndicesPdf } from '../lib/dceIndicesPdf';
import DossierPartageDialog, { type NouveauPartage } from './act/DossierPartageDialog';
import { ENTETE_DOSSIER_PARTAGE, ENTETE_DOSSIER_PARTAGE_LIENS, type ElementDossierPartage } from '../lib/dossierPartageMail';
import { bilanVisite, libelleVisite, type CreneauVisite, type PresenceVisite } from '../lib/actVisites';

export type EntrepriseRow = EntrepriseSuivi & { corps_etat_codes?: string[] };

/** Une pièce du DCE, déjà libellée, avec les lots qu'elle concerne. */
export interface PieceDce {
  libelle: string;
  tous_lots: boolean;
  lots_ids: string[];
  document_ids?: string[];
  type_doc?: string;
}

/** Dossier partagé (zip, document de l'affaire, lien externe) : une pièce du DCE qui ne part jamais en pièce jointe. */
export interface PartageDce {
  id: string;
  libelle: string;
  tous_lots: boolean;
  lots_ids: string[];
  document_ids?: string[];
  liens_externes?: Array<{ libelle: string; url: string }>;
}

interface Props {
  projectName: string;
  lots: ProjectLot[];
  /** Dossiers partagés de la consultation (hors pièces jointes), pour l'envoi du DCE. */
  dcePartages?: PartageDce[];
  /** Crée la pièce partagée pour ces lots (vide : tous les lots) et rend son identifiant. */
  onAjouterPartage?: (partage: NouveauPartage, lotsIds: string[]) => string;
  onRetirerPartage?: (id: string) => void;
  /** Un fichier vient d'être déposé dans les documents de l'affaire : relire la liste. */
  onDocumentDepose?: () => void;
  entreprises: EntrepriseRow[];
  creneauxVisite?: CreneauVisite[];
  onChangeCreneaux?: (next: CreneauVisite[]) => void;
  onChange: (next: EntrepriseRow[]) => void;
  dcePieces: PieceDce[];
  /** Documents de l'affaire (fichiers et indices des pièces du DCE). */
  documentsAffaire?: DocumentDce[];
  entrepriseContacts: Contact[];
  contactsTelephone?: Parameters<typeof telephoneEntreprise>[1];
  corpsEtatOptions: MultiSelectOption[];
  lotOptions: MultiSelectOption[];
  onChangeCorpsEtat: (e: EntrepriseRow, next: string[]) => void;
  onSelectContact: (rowId: string, contact: Contact) => void;
  onCreateContact: (rowId: string, name: string) => void;
  /** Appelé à la sortie des champs d'adresses : reporte les adresses saisies sur la fiche de l'entreprise. */
  onSyncEmails?: (e: EntrepriseRow, avant: string[]) => void;
  /** Appelé à la sortie du champ téléphone : reporte le numéro saisi sur la fiche de l'entreprise. */
  onSyncTelephone?: (e: EntrepriseRow, numero: string) => void;
  corpsEtatCodesFromContact: (contact: Contact) => string[];
  /** Qualifications des fiches contacts, par identifiant de contact. */
  qualifications?: Record<string, Qualification[]>;
  /** Espace de dépôt des offres : actif (plan, marché privé, stockage externe) ou la raison de son indisponibilité. */
  depot?: { actif: boolean; indisponible?: string };
  projectId?: string;
  /** Date limite de remise des offres, rappelée dans le mail avec le lien de dépôt. */
  depotDeadlineAt?: string | null;
  /** Génère le RC, le CCAP et le formulaire d'acte d'engagement, joints d'office au mail d'invitation. */
  genererPiecesMarche?: () => Promise<PieceMarcheGeneree[]>;
  /** Dernière remise à traiter, par identifiant d'entreprise (voir useConsultationDepot). */
  depotRecuLe?: Record<string, string>;
  onInviterDepot?: (entreprise: EntrepriseRow) => void;
  /** Ligne tout juste ajoutée : on lève les filtres, on défile jusqu'à elle et on la surligne un instant. */
  miseEnAvant?: { id: string; n: number } | null;
}

const PILL: Record<StatutEntreprise, string> = {
  a_envoyer: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
  dce_envoye: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  a_relancer: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  offre_deposee: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  offre_recue: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  sans_reponse: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  hors_envoi: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

const STATUT_OPTIONS: MultiSelectOption[] = [
  { value: 'envoyer_dce', label: 'DCE à envoyer' },
  { value: 'ne_repond_pas', label: 'Ne répond pas' },
];

const FIELD = 'text-xs border border-[var(--tblr-border)] rounded-lg px-2 py-1.5 bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500';
const TH = 'px-3 py-2.5 text-left text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]';

const CLE_REGROUPEMENT = 'act-entreprises-regroupement';
function lireRegroupement(): Regroupement {
  try { return localStorage.getItem(CLE_REGROUPEMENT) === 'aucun' ? 'aucun' : 'lot'; } catch { return 'lot'; }
}

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '');

/**
 * Téléphone de l'entreprise : la valeur vient de la fiche contact et la saisie y est reportée
 * à la sortie du champ (jamais à chaque frappe). Sans fiche liée, le champ est grisé.
 */
function ChampTelephone({ valeur, nom, disabled, onCommit }: {
  valeur: string; nom: string; disabled: boolean; onCommit: (numero: string) => void;
}) {
  const [saisie, setSaisie] = useState(valeur);
  return (
    <label className="mt-1 flex items-center gap-1 px-2 text-[var(--tblr-muted)]">
      <IconPhone size={12} aria-hidden="true" className="shrink-0" />
      <input
        className="min-w-0 flex-1 text-[0.6875rem] border border-transparent hover:border-[var(--tblr-border)] focus:border-[var(--tblr-border)] rounded-md px-1.5 py-1 bg-transparent outline-none disabled:opacity-50"
        type="tel" inputMode="tel" aria-label={`Téléphone de ${nom || "l'entreprise"}`}
        placeholder={disabled ? 'Choisir une entreprise' : 'Téléphone'}
        title={disabled ? "Sélectionnez ou créez la fiche de l'entreprise pour saisir son numéro" : 'Enregistré sur la fiche contact'}
        value={saisie} disabled={disabled}
        onChange={ev => setSaisie(ev.target.value)}
        onBlur={() => { if (saisie.trim() && saisie.trim() !== valeur) onCommit(saisie); }}
      />
    </label>
  );
}

// ── Envoi du DCE par mail ────────────────────────────────────────────────────
// Les comptes mail ne sont lus qu'à l'ouverture, pas à chaque affichage du tableau.

function DceMailDialog({ projectId, depotActif, depotIndisponible, genererPiecesMarche, deadlineAt, projectName, entreprise, lots, pieces, documents, partages, onAjouterPartage, onRetirerPartage, onDocumentDepose, onSent, onClose }: {
  projectId?: string;
  partages: PartageDce[];
  onAjouterPartage?: (partage: NouveauPartage, lotsIds: string[]) => string;
  onRetirerPartage?: (id: string) => void;
  onDocumentDepose?: () => void;
  /** Espace de dépôt utilisable : un lien personnel est alors créé et cité dans le message. */
  depotActif: boolean;
  depotIndisponible?: string;
  genererPiecesMarche?: () => Promise<PieceMarcheGeneree[]>;
  deadlineAt: string | null;
  projectName: string;
  entreprise: EntrepriseRow;
  lots: ProjectLot[];
  pieces: PieceDce[];
  documents: DocumentDce[];
  onSent: () => void;
  onClose: () => void;
}) {
  const { accounts, loading } = useMailAccounts();
  const lotsEntreprise = lots.filter(l => entreprise.lots_ids.includes(l.id));
  const piecesEntreprise = piecesDeEntreprise(pieces, entreprise.lots_ids);
  const lignes = lignesIndices(piecesEntreprise, documents);
  const aJoindre = documentsAJoindre(piecesEntreprise, documents);
  const lotsCourts = lotsEntreprise.map(l => `Lot ${l.lot_number}`).join(', ');

  // Dossier partagé : seuls les éléments ajoutés pendant CE message sont cités et retirables ici ;
  // les dossiers partagés plus tôt restent visibles sur la page de dépôt sans être redits.
  const [ajoutes, setAjoutes] = useState<string[]>([]);
  const [dialogueDossier, setDialogueDossier] = useState(false);
  const elementsPartages: ElementDossierPartage[] = partages
    .filter(p => ajoutes.includes(p.id))
    .map(p => ({ id: p.id, libelle: p.libelle, url: p.liens_externes?.[0]?.url }));

  // Les fichiers du DCE et le tableau d'indices sont joints d'office ; la personne
  // peut en retirer. Un document illisible n'empêche pas le message : il est signalé.
  const [pretes, setPretes] = useState<{ fichiers: File[]; echecs: string[]; piecesMarche: string[]; lienDepot?: string; echecDepot?: boolean } | null>(null);
  useEffect(() => {
    let vivant = true;
    (async () => {
      const resultats = await Promise.allSettled(aJoindre.map(documentToFile));
      const fichiers: File[] = [];
      const echecs: string[] = [];
      resultats.forEach((r, i) => { if (r.status === 'fulfilled') fichiers.push(r.value); else echecs.push(aJoindre[i].name); });
      if (lignes.length > 0) {
        try { fichiers.unshift(await genererTableauIndicesPdf({ projectName, lignes, lots: lotsCourts || undefined })); }
        catch { echecs.push('Tableau d\'indices'); }
      }
      // Pièces du marché (RC, CCAP, acte d'engagement), générées à l'envoi d'après les réglages
      // actuels. Une pièce déjà versée au DCE part avec le DCE : on ne la joint pas deux fois.
      const piecesMarche: string[] = [];
      if (genererPiecesMarche) {
        const versees = new Set<string>();
        for (const p of piecesEntreprise) {
          if (!(p.document_ids ?? []).some(id => documents.some(d => d.id === id))) continue;
          if (p.type_doc === 'RC') versees.add('RC');
          else if (p.type_doc === 'CCAP') versees.add('CCAP');
          else if (/acte d.engagement/i.test(p.libelle)) versees.add('ACTE');
        }
        try {
          const generees = (await genererPiecesMarche()).filter(g => !versees.has(g.type));
          fichiers.unshift(...generees.map(g => g.fichier));
          piecesMarche.push(...generees.map(g => g.libelle));
        } catch { echecs.push('Pièces du marché (RC, CCAP, acte d\'engagement)'); }
      }
      // Lien de dépôt personnel : créé à l'ouverture du message (un lien précédent de
      // cette entreprise est alors révoqué, le jeton n'étant jamais conservé en clair).
      let lienDepot: string | undefined; let echecDepot = false;
      if (depotActif && projectId) {
        try {
          const r = await apiFetch<{ url: string }>(`/api/projects/${projectId}/depot/invites`, {
            method: 'POST',
            body: JSON.stringify({
              entreprise_id: entreprise.id, entreprise_nom: entreprise.nom, email: entreprise.email || undefined,
              contact_id: entreprise.contact_id || undefined, lots_ids: entreprise.lots_ids,
            }),
          });
          lienDepot = r.url;
        } catch { echecDepot = true; }
      }
      if (vivant) setPretes({ fichiers, echecs, piecesMarche, lienDepot, echecDepot });
    })();
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (loading || !pretes) return null;

  const libelleLots = lotsEntreprise.map(l => `Lot ${l.lot_number} — ${l.lot_title}`);
  const body = [
    'Bonjour,',
    '',
    `Dans le cadre de la consultation des entreprises pour l'opération « ${projectName} », nous vous transmettons le dossier de consultation (DCE)${libelleLots.length ? ` relatif à :\n${libelleLots.map(l => `- ${l}`).join('\n')}` : '.'}`,
    ...(pretes.piecesMarche.length
      ? ['', 'Pièces du marché jointes :', ...pretes.piecesMarche.map(l => `- ${l}`),
         ...(pretes.piecesMarche.some(l => /acte/i.test(l)) ? ['L\'acte d\'engagement est à compléter, signer et remettre avec votre offre.'] : [])]
      : []),
    ...(lignes.length
      ? ['', 'Pièces du dossier (indice de révision) :', ...lignes.map(l => `- ${l.designation}${l.fichier ? ` : ${l.fichier}` : ''}${l.indice ? ` (indice ${l.indice})` : ''}`),
         '', 'Le tableau des indices est joint à ce message.']
      : []),
    ...(pretes.lienDepot
      ? ['', 'Vous pouvez remettre votre offre en ligne sur votre espace de dépôt personnel (saisie de l\'offre ou dépôt de vos documents) :', pretes.lienDepot,
         ...(deadlineAt ? [`Date limite de remise : ${formaterDateHeure(deadlineAt)}.`] : []),
         'Ce lien vous est personnel : merci de ne pas le transmettre.']
      : []),
    ...(!depotActif && depotIndisponible ? ['', `[Lien de dépôt non proposé : ${depotIndisponible}]`] : []),
    ...(pretes.echecDepot ? ['', '[Lien de dépôt non créé : à créer depuis la ligne de l\'entreprise (icône lien)]'] : []),
    ...(pretes.echecs.length ? ['', `[À joindre manuellement, téléchargement impossible : ${pretes.echecs.join(', ')}]`] : []),
    '',
    'Nous restons à votre disposition pour toute précision.',
    '',
    'Cordialement,',
  ].join('\n');
  const depotDisponible = !!pretes.lienDepot;
  const ajouterPartage = (p: NouveauPartage) => {
    if (!onAjouterPartage) return;
    const id = onAjouterPartage(p, entreprise.lots_ids);
    setAjoutes(prev => [...prev, id]);
    setDialogueDossier(false);
  };
  return (
    <>
      <MailComposeModal
        accounts={accounts}
        initialFiles={pretes.fichiers}
        initial={{
          to: destinatairesEntreprise(entreprise).join(', '),
          subject: `Consultation des entreprises — ${projectName}${lotsCourts ? ` — ${lotsCourts}` : ''}`,
          body,
        }}
        dossierPartage={onAjouterPartage && projectId ? {
          elements: elementsPartages,
          entete: depotDisponible ? ENTETE_DOSSIER_PARTAGE : ENTETE_DOSSIER_PARTAGE_LIENS,
          ancre: 'Nous restons à votre disposition',
          avertissement: depotDisponible ? undefined
            : `L'espace de dépôt n'est pas disponible${depotIndisponible ? ` (${depotIndisponible})` : ''} : seuls les liens externes seront accessibles à l'entreprise. Un fichier ajouté reste dans les documents de l'affaire sans être accessible depuis ce message.`,
          onOuvrir: () => setDialogueDossier(true),
          onRetirer: (id: string) => { onRetirerPartage?.(id); setAjoutes(prev => prev.filter(x => x !== id)); },
        } : undefined}
        onSent={onSent}
        onClose={onClose}
      />
      {dialogueDossier && projectId && (
        <DossierPartageDialog
          projectId={projectId}
          documents={documents}
          dejaPartages={partages.filter(p => ajoutes.includes(p.id)).flatMap(p => p.document_ids ?? [])}
          onAjouter={ajouterPartage}
          onDocumentDepose={() => onDocumentDepose?.()}
          onClose={() => setDialogueDossier(false)}
        />
      )}
    </>
  );
}

// ── Tableau ──────────────────────────────────────────────────────────────────

export default function ACTEntreprisesTable({
  projectName, lots, entreprises, onChange, dcePieces, documentsAffaire = [], entrepriseContacts,
  corpsEtatOptions, lotOptions, onChangeCorpsEtat, onSelectContact, onCreateContact, onSyncEmails, onSyncTelephone,
  corpsEtatCodesFromContact, qualifications = {}, miseEnAvant = null,
  depot, depotRecuLe, onInviterDepot, projectId, depotDeadlineAt = null, genererPiecesMarche,
  dcePartages = [], onAjouterPartage, onRetirerPartage, onDocumentDepose,
  creneauxVisite = [], onChangeCreneaux,
  contactsTelephone = entrepriseContacts,
}: Props) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const today = todayIso();

  const [filtres, setFiltres] = useState<FiltresEntreprises>(FILTRES_VIDES);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [suggestLotId, setSuggestLotId] = useState<string | null>(null);
  const [mailPour, setMailPour] = useState<string | null>(null);
  const [visitePour, setVisitePour] = useState<string | null>(null);
  const boutonVisiteActif = useRef<HTMLButtonElement | null>(null);
  const fermerVisite = () => { setVisitePour(null); requestAnimationFrame(() => boutonVisiteActif.current?.focus()); };
  const [nouveauCreneau, setNouveauCreneau] = useState('');
  const [erreurCreneau, setErreurCreneau] = useState('');

  const [clignote, setClignote] = useState<string | null>(null);
  useEffect(() => {
    if (!miseEnAvant) return;
    // Un filtre actif pourrait cacher la nouvelle ligne : on le lève.
    setFiltres(FILTRES_VIDES);
    setClignote(miseEnAvant.id);
    // Après le rendu des groupes recalculés.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelector(`[data-entreprise-id="${CSS.escape(miseEnAvant.id)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }));
    const fin = setTimeout(() => setClignote(null), 2600);
    return () => { cancelAnimationFrame(raf); clearTimeout(fin); };
  }, [miseEnAvant]);

  // Adresses de la ligne au moment où l'on entre dans un champ d'adresse : une adresse
  // corrigée remplace l'ancienne sur la fiche contact (voir completerEmailsContact).
  const adressesAvant = useRef<Record<string, string[]>>({});
  const entrerAdresses = (e: EntrepriseRow) => {
    if (!adressesAvant.current[e.id]) adressesAvant.current[e.id] = destinatairesEntreprise(e);
  };
  const quitterAdresses = (e: EntrepriseRow) => {
    const avant = adressesAvant.current[e.id] ?? [];
    delete adressesAvant.current[e.id];
    onSyncEmails?.(e, avant);
  };

  const patch = (id: string, p: Partial<EntrepriseRow>) =>
    onChange(entreprises.map(e => (e.id === id ? { ...e, ...p } : e)));
  const patchMany = (ids: Set<string>, p: (e: EntrepriseRow) => Partial<EntrepriseRow>) =>
    onChange(entreprises.map(e => (ids.has(e.id) ? { ...e, ...p(e) } : e)));

  // Lecture seule : la date d'une remise à traiter nourrit le statut affiché,
  // mais `patch` et `onChange` repartent de `entreprises`, jamais de cette vue,
  // pour qu'elle ne soit jamais enregistrée avec la consultation.
  const vue = useMemo(
    () => entreprises.map(e => (depotRecuLe?.[e.id] ? { ...e, depot_recu_le: depotRecuLe[e.id] } : e)),
    [entreprises, depotRecuLe],
  );

  const resume = useMemo(() => resumeSuivi(vue, today), [vue, today]);
  const couv = useMemo(() => couverture(entreprises, lots), [entreprises, lots]);

  const [regroupement, setRegroupement] = useState<Regroupement>(lireRegroupement);
  const choisirRegroupement = (r: Regroupement) => {
    setRegroupement(r);
    try { localStorage.setItem(CLE_REGROUPEMENT, r); } catch { /* préférence facultative */ }
  };
  const plat = regroupement === 'aucun';

  const groupes = useMemo(() => {
    const filtrees = filtrerEntreprises(vue, filtres, today);
    if (plat) return [{ key: '__plat__', libelle: '', entreprises: listeAPlat(filtrees, filtres.lot, lots) }]
      .filter(g => g.entreprises.length > 0);
    const tous = groupByLot(filtrees, lots);
    return filtres.lot ? tous.filter(g => g.key === filtres.lot) : tous;
  }, [vue, filtres, lots, today, plat]);

  const idsAffiches = useMemo(() => new Set(groupes.flatMap(g => g.entreprises.map(e => e.id))), [groupes]);
  const nbAffichees = idsAffiches.size;
  const selectionActive = useMemo(
    () => new Set([...selection].filter(id => entreprises.some(e => e.id === id))),
    [selection, entreprises],
  );
  const toutSelectionne = nbAffichees > 0 && [...idsAffiches].every(id => selectionActive.has(id));

  const toggleSelection = (id: string) =>
    setSelection(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleTout = () => setSelection(toutSelectionne ? new Set() : new Set(idsAffiches));

  const ajouterSurLot = (lotId: string, contact?: Contact) => {
    const e: EntrepriseRow = contact
      ? {
          id: crypto.randomUUID(), contact_id: contact.id, nom: nomContact(contact),
          email: contact.email_work || contact.email || '', lots_ids: [lotId], envoyer_dce: true,
          corps_etat_codes: corpsEtatCodesFromContact(contact),
        }
      : { id: crypto.randomUUID(), nom: '', lots_ids: [lotId], envoyer_dce: true };
    onChange([...entreprises, e]);
  };

  const supprimer = (ids: Set<string>) => {
    const noms = entreprises.filter(e => ids.has(e.id)).map(e => e.nom || 'sans nom');
    const message = ids.size === 1
      ? `Retirer « ${noms[0]} » de la consultation ?`
      : `Retirer ${ids.size} entreprises de la consultation ?`;
    if (!window.confirm(message)) return;
    onChange(entreprises.filter(e => !ids.has(e.id)));
    setSelection(prev => new Set([...prev].filter(id => !ids.has(id))));
  };

  const entrepriseMail = mailPour ? entreprises.find(e => e.id === mailPour) : undefined;
  const lotSuggestion = suggestLotId ? lots.find(l => l.id === suggestLotId) : undefined;
  const suggestions = useMemo(
    () => lotSuggestion
      ? suggererContacts(lotSuggestion, entrepriseContacts, new Set(entreprises.map(e => e.contact_id).filter((x): x is string => !!x)))
      : [],
    [lotSuggestion, entrepriseContacts, entreprises],
  );

  // ── Champs communs au tableau et aux cartes mobiles ────────────────────────

  const champNom = (e: EntrepriseRow) => (
    <>
      <EntrepriseAutocomplete
        contacts={entrepriseContacts}
        contactId={e.contact_id}
        fallbackName={e.nom}
        onSelect={c => onSelectContact(e.id, c)}
        onCreate={name => onCreateContact(e.id, name)}
        onEditContact={c => window.open(`/contacts?open=${encodeURIComponent(c.id)}`, '_blank', 'noopener,noreferrer')}
      />
      <div className="flex flex-wrap items-center gap-x-2">
      <input
        className="mt-1 min-w-[9rem] flex-1 text-[0.6875rem] border border-transparent hover:border-[var(--tblr-border)] focus:border-[var(--tblr-border)] rounded-md px-2 py-1 bg-transparent text-[var(--tblr-muted)] outline-none"
        type="email" aria-label="Email de l'entreprise"
        placeholder="email@entreprise.fr" value={e.email || ''}
        onChange={ev => patch(e.id, { email: ev.target.value })}
        onFocus={() => entrerAdresses(e)}
        onBlur={() => quitterAdresses(e)}
      />
      </div>
      <input
        className="mt-1 w-full text-[0.6875rem] border border-transparent hover:border-[var(--tblr-border)] focus:border-[var(--tblr-border)] rounded-md px-2 py-1 bg-transparent text-[var(--tblr-muted)] outline-none"
        type="text" aria-label="Autres adresses e-mail de l'entreprise"
        placeholder="Autres adresses (séparées par une virgule)" value={e.emails_supplementaires || ''}
        onChange={ev => patch(e.id, { emails_supplementaires: ev.target.value })}
        onFocus={() => entrerAdresses(e)}
        onBlur={() => quitterAdresses(e)}
      />
      <ChampTelephone
        key={`${e.id}:${telephoneEntreprise(e, contactsTelephone)}`}
        valeur={telephoneEntreprise(e, contactsTelephone)}
        nom={e.nom}
        disabled={!e.contact_id}
        onCommit={numero => onSyncTelephone?.(e, numero)}
      />
    </>
  );

  const champQualification = (e: EntrepriseRow) => e.contact_id
    ? (
      <QualificationBadge
        resume={resumeQualifications(qualifications[e.contact_id] || [], today)}
        liste={qualifications[e.contact_id] || []}
      />
    )
    : <span className="text-[0.6875rem] text-[var(--tblr-muted)]">Aucune fiche</span>;

  const champCorps = (e: EntrepriseRow) => (
    <MultiSelectDropdown
      options={corpsEtatOptions} selected={e.corps_etat_codes || []}
      onChange={next => onChangeCorpsEtat(e, next)}
      placeholder="Non classé" maxChips={1} tone="green" searchable
      ariaLabel={`Corps d'état de ${e.nom || "l'entreprise"}`}
    />
  );

  const champLots = (e: EntrepriseRow) => (
    <MultiSelectDropdown
      options={lotOptions} selected={e.lots_ids}
      onChange={next => patch(e.id, { lots_ids: next })}
      placeholder="Aucun lot" maxChips={3} tone="blue" bulkActions
      ariaLabel={`Lots de ${e.nom || "l'entreprise"}`}
    />
  );

  const champDates = (e: EntrepriseRow) => {
    const ligne = (label: string, cle: 'dce_transmis_le' | 'relance_le' | 'offre_recue_le') => (
      <label className="flex items-center gap-1.5">
        <span className="w-14 shrink-0 text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">{label}</span>
        <input type="date" aria-label={`${label} : ${e.nom || "l'entreprise"}`}
          className={cn(FIELD, 'py-1 flex-1 min-w-0 md:w-[8.5rem] md:flex-none')}
          value={e[cle] || ''} onChange={ev => patch(e.id, { [cle]: ev.target.value || undefined })} />
      </label>
    );
    return (
      <div className="flex flex-col gap-1">
        {ligne('DCE', 'dce_transmis_le')}
        {ligne('Relance', 'relance_le')}
        {ligne('Offre', 'offre_recue_le')}
      </div>
    );
  };

  const champVisite = (e: EntrepriseRow) => (
    <div className="space-y-1.5">
      <select className={cn(FIELD, 'w-full')} aria-label={`Rendez-vous de visite de ${e.nom || "l'entreprise"}`}
        value={e.visite_creneau_id || ''}
        onChange={event => patch(e.id, { visite_creneau_id: event.target.value || undefined, visite_presence: event.target.value ? 'prevue' : undefined })}>
        <option value="">Aucun rendez-vous</option>
        {e.visite_creneau_id && !creneauxVisite.some(c => c.id === e.visite_creneau_id) && <option value={e.visite_creneau_id}>Créneau indisponible</option>}
        {[...creneauxVisite].sort((a, b) => a.date_heure.localeCompare(b.date_heure)).map(c => <option key={c.id} value={c.id}>{libelleVisite(c.date_heure)}</option>)}
      </select>
      {e.visite_creneau_id && <select className={cn(FIELD, 'w-full')} aria-label={`Présence à la visite de ${e.nom || "l'entreprise"}`}
        value={e.visite_presence || 'prevue'} onChange={event => patch(e.id, { visite_presence: event.target.value as PresenceVisite })}>
        <option value="prevue">Prévue</option><option value="confirmee">Confirmée</option><option value="presente">Présente</option><option value="absente">Absente</option>
      </select>}
    </div>
  );

  const boutonVisite = (e: EntrepriseRow) => {
    const creneau = creneauxVisite.find(c => c.id === e.visite_creneau_id);
    const description = creneau ? libelleVisite(creneau.date_heure) : e.visite_creneau_id ? 'Créneau indisponible' : 'Aucun rendez-vous';
    const statut = ({ prevue: 'Prévue', confirmee: 'Confirmée', presente: 'Présente', absente: 'Absente' } as const)[e.visite_presence || 'prevue'];
    return <button type="button" onClick={event => { boutonVisiteActif.current = event.currentTarget; setVisitePour(e.id); }} aria-label={`Gérer la visite de ${e.nom || "l'entreprise"} : ${description}${e.visite_creneau_id ? `, ${statut}` : ''}`}
      title={`${description}${e.visite_creneau_id ? ` · ${statut}` : ''}`} className={cn('inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-[var(--tblr-border)] hover:bg-blue-50 dark:hover:bg-blue-900/20', e.visite_creneau_id ? 'text-blue-700 bg-blue-50 dark:bg-blue-900/20' : 'text-[var(--tblr-muted)]')}>
      <IconCalendarEvent size={17} aria-hidden="true" /><span className="sr-only">{description}</span>
    </button>;
  };
  const champObservation = (e: EntrepriseRow) => <textarea aria-label={`Observation pour ${e.nom || "l'entreprise"}`} rows={2}
    className={cn(FIELD, 'w-full min-w-0 resize-y')} placeholder="Ajouter une observation…" value={e.observation || ''}
    onChange={event => patch(e.id, { observation: event.target.value })} />;

  const champStatut = (e: EntrepriseRow) => {
    const statut = statutEntreprise(e, today);
    const coches = [e.envoyer_dce && 'envoyer_dce', e.ne_repond_pas && 'ne_repond_pas'].filter((x): x is string => !!x);
    return (
      <MultiSelectDropdown
        options={STATUT_OPTIONS} selected={coches}
        onChange={next => patch(e.id, { envoyer_dce: next.includes('envoyer_dce'), ne_repond_pas: next.includes('ne_repond_pas') })}
        placeholder="" menuMinWidth={200}
        ariaLabel={`Statut de ${e.nom || "l'entreprise"} : ${STATUT_LABELS[statut]}`}
        triggerContent={
          <span className={cn('inline-flex items-center px-2.5 py-1 rounded-full text-[0.6875rem] font-bold whitespace-nowrap', PILL[statut])}>
            {STATUT_LABELS[statut]}
          </span>
        }
      />
    );
  };

  const boutonsLigne = (e: EntrepriseRow) => (
    <div className="flex items-center gap-0.5">
      {depot && onInviterDepot && (
        <button
          type="button" onClick={() => onInviterDepot(e)} disabled={!depot.actif}
          title={depot.actif ? 'Lien de dépôt de l’offre' : depot.indisponible || 'Dépôt en ligne indisponible'}
          aria-label={`Lien de dépôt de l’offre de ${e.nom || "l'entreprise"}`}
          className="p-1.5 rounded-md text-zinc-400 hover:text-blue-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:hover:text-zinc-400 disabled:hover:bg-transparent"
        ><IconLink size={14} /></button>
      )}
      <button
        type="button" onClick={() => setMailPour(e.id)} disabled={destinatairesEntreprise(e).length === 0}
        title={destinatairesEntreprise(e).length > 0 ? 'Envoyer le DCE par mail' : "Renseignez l'email pour envoyer le DCE"}
        aria-label={`Envoyer le DCE à ${e.nom || "l'entreprise"}`}
        className="p-1.5 rounded-md text-zinc-400 hover:text-blue-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:hover:text-zinc-400 disabled:hover:bg-transparent"
      ><IconSend size={14} /></button>
      <button
        type="button" onClick={() => supprimer(new Set([e.id]))}
        aria-label={`Retirer ${e.nom || "l'entreprise"}`}
        className="p-1.5 rounded-md text-zinc-300 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      ><IconTrash size={14} /></button>
    </div>
  );

  const caseSelection = (e: EntrepriseRow) => (
    <input
      type="checkbox" className="w-4 h-4 rounded accent-blue-600 shrink-0"
      checked={selectionActive.has(e.id)} onChange={() => toggleSelection(e.id)}
      aria-label={`Sélectionner ${e.nom || "l'entreprise"}`}
    />
  );

  // ── Rendu ──────────────────────────────────────────────────────────────────

  const nbCols = 9;
  const aucuneEntreprise = entreprises.length === 0;
  const pctOffres = resume.total ? Math.round((resume.parStatut.offre_recue / resume.total) * 100) : 0;

  return (
    <div>
      <section className="px-5 py-4 border-b border-[var(--tblr-border)] space-y-3" aria-label="Créneaux de visites">
        <div><h3 className="font-semibold text-sm">Créneaux de visites</h3>
          <p className="text-xs text-[var(--tblr-muted)] mt-1">Créez les rendez-vous, puis affectez les entreprises dans le tableau. Les présences sont comptées après pointage.</p></div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
          event.preventDefault();
          if (!nouveauCreneau || Number.isNaN(new Date(nouveauCreneau).getTime())) { setErreurCreneau('Indiquez une date et une heure valides.'); return; }
          if (creneauxVisite.some(c => c.date_heure === nouveauCreneau)) { setErreurCreneau('Ce créneau existe déjà.'); return; }
          onChangeCreneaux?.([...creneauxVisite, { id: crypto.randomUUID(), date_heure: nouveauCreneau }]);
          setNouveauCreneau(''); setErreurCreneau('');
        }}>
          <label className="text-xs font-medium">Date et heure de visite
            <input className={cn(FIELD, 'block mt-1 min-h-10')} type="datetime-local" required value={nouveauCreneau} onChange={e => setNouveauCreneau(e.target.value)} />
          </label>
          <button type="submit" disabled={!onChangeCreneaux} className="min-h-10 px-3 rounded-lg border border-[var(--tblr-border)] text-sm font-medium">Ajouter le créneau</button>
        </form>
        {erreurCreneau && <p role="alert" className="text-sm text-red-600">{erreurCreneau}</p>}
        {creneauxVisite.length === 0 ? <p className="text-xs text-[var(--tblr-muted)]">Aucun créneau défini.</p> :
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{[...creneauxVisite].sort((a,b) => a.date_heure.localeCompare(b.date_heure)).map(c => {
            const bilan = bilanVisite(c.id, entreprises, lots);
            return <div key={c.id} className="rounded-lg border border-[var(--tblr-border)] p-3 text-xs space-y-1.5">
              <div className="flex items-start justify-between gap-2"><strong>{libelleVisite(c.date_heure)}</strong>
                <button type="button" className="text-red-600 underline" onClick={() => {
                  if (bilan.inscrites) { setErreurCreneau('Réaffectez ou retirez les entreprises inscrites avant de supprimer ce créneau.'); return; }
                  onChangeCreneaux?.(creneauxVisite.filter(x => x.id !== c.id)); setErreurCreneau('');
                }} aria-label={`Supprimer le créneau du ${libelleVisite(c.date_heure)}`}>Supprimer</button></div>
              <p>{bilan.inscrites} entreprise{bilan.inscrites > 1 ? 's' : ''} inscrite{bilan.inscrites > 1 ? 's' : ''} · {bilan.presentes} présente{bilan.presentes > 1 ? 's' : ''}</p>
              {bilan.lots.map(({ lot, inscrites, presentes }) => <p key={lot.id}>Lot {lot.lot_number} — {lot.lot_title} : {presentes} présente{presentes > 1 ? 's' : ''} / {inscrites} inscrite{inscrites > 1 ? 's' : ''}</p>)}
              {bilan.sansLot > 0 && <p>{bilan.sansLot} sans lot assigné</p>}
            </div>;
          })}</div>}
      </section>
      {/* Synthèse du suivi */}
      {!aucuneEntreprise && (
        <div className="px-5 py-3 border-b border-[var(--tblr-border)] space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-sm font-bold text-[var(--tblr-text)]">
              {resume.parStatut.offre_recue} offre{resume.parStatut.offre_recue > 1 ? 's' : ''} reçue{resume.parStatut.offre_recue > 1 ? 's' : ''} sur {resume.total}
            </p>
            <div className="flex-1 min-w-[80px] max-w-[220px] h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden" role="progressbar"
              aria-valuenow={pctOffres} aria-valuemin={0} aria-valuemax={100} aria-label="Offres reçues">
              <div className="h-full bg-emerald-500" style={{ width: `${pctOffres}%` }} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUT_ORDER.filter(s => resume.parStatut[s] > 0).map(s => (
                <button
                  key={s} type="button"
                  onClick={() => setFiltres(f => ({ ...f, statut: f.statut === s ? '' : s }))}
                  aria-pressed={filtres.statut === s}
                  className={cn(
                    'px-2 py-0.5 rounded-full text-[0.6875rem] font-bold transition',
                    PILL[s], filtres.statut === s && 'ring-2 ring-offset-1 ring-blue-500',
                  )}
                >
                  {resume.parStatut[s]} {STATUT_LABELS[s].toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Alertes de couverture */}
          {(couv.lotsInsuffisants.length > 0 || couv.sansLot.length > 0 || couv.sansEmail.length > 0) && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
              <IconAlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1.5 min-w-0">
                {couv.lotsInsuffisants.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span>Moins de {MIN_ENTREPRISES_PAR_LOT} entreprises consultées :</span>
                    {couv.lotsInsuffisants.map(({ lot, nb }) => (
                      <button
                        key={lot.id} type="button"
                        onClick={() => setSuggestLotId(id => (id === lot.id ? null : lot.id))}
                        aria-expanded={suggestLotId === lot.id}
                        className={cn(
                          'px-2 py-0.5 rounded-full font-bold border transition',
                          suggestLotId === lot.id
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-white dark:bg-zinc-900 border-amber-300 dark:border-amber-700 hover:bg-amber-100',
                        )}
                      >
                        Lot {lot.lot_number} · {nb}/{MIN_ENTREPRISES_PAR_LOT}
                      </button>
                    ))}
                  </div>
                )}
                {couv.sansLot.length > 0 && (
                  <p>
                    <button type="button" className="font-bold underline" onClick={() => setFiltres(f => ({ ...f, lot: SANS_LOT }))}>
                      {couv.sansLot.length} entreprise{couv.sansLot.length > 1 ? 's' : ''} sans lot
                    </button>
                    {' '}: elle{couv.sansLot.length > 1 ? 's ne recevront' : ' ne recevra'} aucun DCE ciblé.
                  </p>
                )}
                {couv.sansEmail.length > 0 && (
                  <p title={couv.sansEmail.map(e => e.nom || 'sans nom').join(', ')}>
                    <span className="font-bold">{couv.sansEmail.length} entreprise{couv.sansEmail.length > 1 ? 's' : ''} sans email</span>
                    {' '}alors que le DCE est à envoyer.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Suggestions pour un lot sous-couvert */}
          {lotSuggestion && (
            <div className="rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface-2)] p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs font-bold text-[var(--tblr-text)]">
                  Entreprises suggérées pour Lot {lotSuggestion.lot_number} — {lotSuggestion.lot_title}
                </p>
                <button type="button" onClick={() => setSuggestLotId(null)} aria-label="Fermer les suggestions" className="p-1 text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]"><IconX size={13} /></button>
              </div>
              {suggestions.length > 0 ? (
                <ul className="grid sm:grid-cols-2 gap-1.5">
                  {suggestions.map(c => (
                    <li key={c.id} className="flex items-center justify-between gap-2 rounded-md bg-[var(--tblr-surface)] border border-[var(--tblr-border)] px-2.5 py-1.5">
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{nomContact(c)}</p>
                        <p className="text-[0.6875rem] text-[var(--tblr-muted)] truncate">{(c.corps_etat || []).join(', ')}</p>
                      </div>
                      <button type="button" onClick={() => ajouterSurLot(lotSuggestion.id, c)}
                        className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[0.6875rem] font-bold bg-blue-600 text-white hover:bg-blue-700">
                        <IconUserPlus size={12} /> Ajouter
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--tblr-muted)] italic">
                  Aucun contact « Entreprise » dont le corps d'état recoupe ce lot. Renseignez les corps d'état sur les fiches contacts pour obtenir des suggestions.
                </p>
              )}
              <div className="mt-2 flex items-center gap-3">
                <button type="button" onClick={() => ajouterSurLot(lotSuggestion.id)} className="text-[0.6875rem] font-bold text-blue-600 hover:underline flex items-center gap-1">
                  <IconPlus size={11} /> Ajouter une ligne vide sur ce lot
                </button>
                <button type="button" onClick={() => setFiltres(f => ({ ...f, lot: lotSuggestion.id }))} className="text-[0.6875rem] font-bold text-[var(--tblr-muted)] hover:underline">
                  Filtrer le tableau sur ce lot
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filtres */}
      {!aucuneEntreprise && (
        <div className="px-5 py-3 border-b border-[var(--tblr-border)] flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <IconSearch size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)]" />
            <input
              type="search" value={filtres.recherche} aria-label="Rechercher une entreprise"
              onChange={ev => setFiltres(f => ({ ...f, recherche: ev.target.value }))}
              placeholder="Rechercher (nom, email)…"
              className={cn(FIELD, 'w-full pl-7')}
            />
          </div>
          <select aria-label="Filtrer par lot" value={filtres.lot} onChange={ev => setFiltres(f => ({ ...f, lot: ev.target.value }))} className={FIELD}>
            <option value="">Tous les lots</option>
            {lots.map(l => <option key={l.id} value={l.id}>Lot {l.lot_number} — {l.lot_title}</option>)}
            <option value={SANS_LOT}>Sans lot</option>
          </select>
          <select aria-label="Filtrer par statut" value={filtres.statut} onChange={ev => setFiltres(f => ({ ...f, statut: ev.target.value as StatutEntreprise | '' }))} className={FIELD}>
            <option value="">Tous les statuts</option>
            {STATUT_ORDER.map(s => <option key={s} value={s}>{STATUT_LABELS[s]}</option>)}
          </select>
          <div role="group" aria-label="Regroupement du tableau" className="inline-flex rounded-lg border border-[var(--tblr-border)] overflow-hidden text-xs font-bold">
            {([['lot', 'Par lot'], ['aucun', 'Une ligne par entreprise']] as const).map(([valeur, libelle]) => (
              <button
                key={valeur} type="button" aria-pressed={regroupement === valeur}
                onClick={() => choisirRegroupement(valeur)}
                className={cn('px-2.5 py-1.5 transition', regroupement === valeur
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-zinc-900 text-[var(--tblr-muted)] hover:bg-zinc-50 dark:hover:bg-zinc-800')}
              >{libelle}</button>
            ))}
          </div>
          {filtresActifs(filtres) && (
            <button type="button" onClick={() => setFiltres(FILTRES_VIDES)} className="text-xs font-bold text-blue-600 hover:underline">Réinitialiser</button>
          )}
          <span className="ml-auto text-[0.6875rem] text-[var(--tblr-muted)]">{nbAffichees} / {entreprises.length} entreprise{entreprises.length > 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Actions groupées */}
      {selectionActive.size > 0 && (
        <div className="px-5 py-2.5 border-b border-[var(--tblr-border)] bg-blue-50 dark:bg-blue-900/20 flex items-center gap-2 flex-wrap" role="toolbar" aria-label="Actions sur la sélection">
          <span className="text-xs font-bold text-blue-800 dark:text-blue-200">{selectionActive.size} sélectionnée{selectionActive.size > 1 ? 's' : ''}</span>
          <select aria-label="Ajouter la sélection à un lot" value="" className={FIELD}
            onChange={ev => { const id = ev.target.value; if (id) patchMany(selectionActive, e => ({ lots_ids: e.lots_ids.includes(id) ? e.lots_ids : [...e.lots_ids, id] })); }}>
            <option value="">Ajouter au lot…</option>
            {lots.map(l => <option key={l.id} value={l.id}>Lot {l.lot_number} — {l.lot_title}</option>)}
          </select>
          <select aria-label="Retirer la sélection d'un lot" value="" className={FIELD}
            onChange={ev => { const id = ev.target.value; if (id) patchMany(selectionActive, e => ({ lots_ids: e.lots_ids.filter(x => x !== id) })); }}>
            <option value="">Retirer du lot…</option>
            {lots.map(l => <option key={l.id} value={l.id}>Lot {l.lot_number} — {l.lot_title}</option>)}
          </select>
          <button type="button" className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] hover:bg-zinc-50"
            onClick={() => patchMany(selectionActive, e => ({ dce_transmis_le: e.dce_transmis_le || today, envoyer_dce: true, ne_repond_pas: false }))}>
            DCE transmis aujourd'hui
          </button>
          <label className="flex items-center gap-1.5 text-xs font-bold text-blue-800 dark:text-blue-200">
            Relance le
            <input type="date" aria-label="Date de relance de la sélection" value="" className={cn(FIELD, 'py-1')}
              onChange={ev => { const v = ev.target.value; if (v) patchMany(selectionActive, () => ({ relance_le: v })); }} />
          </label>
          <button type="button" className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] hover:bg-zinc-50"
            onClick={() => patchMany(selectionActive, () => ({ ne_repond_pas: true }))}>
            Ne répond pas
          </button>
          <button type="button" className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-red-600 bg-white dark:bg-zinc-900 border border-[var(--tblr-border)] hover:bg-red-50"
            onClick={() => supprimer(selectionActive)}>
            Retirer
          </button>
          <button type="button" className="ml-auto text-xs font-bold text-blue-800 dark:text-blue-200 hover:underline" onClick={() => setSelection(new Set())}>Tout désélectionner</button>
        </div>
      )}

      {/* Liste */}
      {isDesktop ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1200px]">
            <thead className="bg-[var(--tblr-surface-2)]">
              <tr>
                <th className={cn(TH, 'sticky left-0 z-[2] bg-[var(--tblr-surface-2)] min-w-[280px] w-[280px]')}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" className="w-4 h-4 rounded accent-blue-600" checked={toutSelectionne} onChange={toggleTout}
                      disabled={nbAffichees === 0} aria-label="Sélectionner toutes les entreprises affichées" />
                    Entreprise
                  </div>
                </th>
                <th className={cn(TH, 'min-w-[140px]')}>Qualification</th>
                <th className={cn(TH, 'min-w-[200px]')}>Corps d'état</th>
                <th className={cn(TH, 'min-w-[200px]')}>Lots assignés</th>
                <th className={cn(TH, 'min-w-[220px]')}>Suivi</th>
                <th className={cn(TH, 'w-16')} title="Rendez-vous de visite">Visite</th>
                <th className={cn(TH, 'min-w-[180px]')}>Observation</th>
                <th className={cn(TH, 'min-w-[130px]')}>Statut</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--tblr-border)]">
              {groupes.map(groupe => (
                <React.Fragment key={groupe.key}>
                  {!plat && (
                    <tr className="bg-zinc-100 dark:bg-zinc-800">
                      <td colSpan={nbCols} className="px-4 py-1.5 text-[0.6875rem] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                        {groupe.libelle} <span className="font-bold text-[var(--tblr-muted)]">· {groupe.entreprises.length}</span>
                      </td>
                    </tr>
                  )}
                  {groupe.entreprises.map(e => (
                    <tr key={`${e.id}::${groupe.key}`} data-entreprise-id={e.id} className={cn('hover:bg-zinc-50 dark:hover:bg-zinc-800/30 align-top transition-colors duration-700', e.ne_repond_pas && 'opacity-60', clignote === e.id && 'bg-blue-50 dark:bg-blue-900/20')}>
                      <td className={cn('px-3 py-2.5 sticky left-0 z-[1] bg-[var(--tblr-surface)] border-r border-[var(--tblr-border)] transition-colors duration-700', clignote === e.id && '!bg-blue-50 dark:!bg-blue-900/20')}>
                        <div className="flex items-start gap-2">
                          <div className="pt-2">{caseSelection(e)}</div>
                          <div className="flex-1 min-w-0">{champNom(e)}</div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 pt-3.5">{champQualification(e)}</td>
                      <td className="px-3 py-2.5">{champCorps(e)}</td>
                      <td className="px-3 py-2.5">{champLots(e)}</td>
                      <td className="px-3 py-2.5">{champDates(e)}</td>
                      <td className="px-3 py-2.5">{boutonVisite(e)}</td>
                      <td className="px-3 py-2.5">{champObservation(e)}</td>
                      <td className="px-3 py-2.5 pt-3.5">{champStatut(e)}</td>
                      <td className="px-3 py-2.5 text-right">{boutonsLigne(e)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              {groupes.length === 0 && (
                <tr><td colSpan={nbCols} className="px-4 py-8 text-center text-[var(--tblr-muted)] italic text-sm">
                  {aucuneEntreprise ? 'Aucune entreprise consultée.' : 'Aucune entreprise ne correspond aux filtres.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-3 space-y-4">
          {groupes.map(groupe => (
            <section key={groupe.key} aria-label={plat ? 'Entreprises consultées' : groupe.libelle}>
              {!plat && (
                <h4 className="px-1 pb-1.5 text-[0.6875rem] font-black uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                  {groupe.libelle} <span className="font-bold text-[var(--tblr-muted)]">· {groupe.entreprises.length}</span>
                </h4>
              )}
              <ul className="space-y-2.5">
                {groupe.entreprises.map(e => (
                  <li key={`${e.id}::${groupe.key}`} data-entreprise-id={e.id}
                    className={cn('rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface)] p-3 space-y-2.5 transition-colors duration-700', e.ne_repond_pas && 'opacity-60', clignote === e.id && 'bg-blue-50 dark:bg-blue-900/20 border-blue-300')}>
                    <div className="flex items-start gap-2">
                      <div className="pt-2">{caseSelection(e)}</div>
                      <div className="flex-1 min-w-0">{champNom(e)}</div>
                      {boutonsLigne(e)}
                    </div>
                    <div className="flex items-center justify-between gap-2">{champStatut(e)}{champQualification(e)}</div>
                    <div className="grid grid-cols-1 gap-2">
                      {champCorps(e)}
                      {champLots(e)}
                    </div>
                    {champDates(e)}
                    <div className="flex items-center gap-2"><span className="text-xs font-semibold">Rendez-vous de visite</span>{boutonVisite(e)}</div>
                    <label className="block text-xs font-semibold">Observation{champObservation(e)}</label>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {groupes.length === 0 && (
            <p className="px-4 py-8 text-center text-[var(--tblr-muted)] italic text-sm">
              {aucuneEntreprise ? 'Aucune entreprise consultée.' : 'Aucune entreprise ne correspond aux filtres.'}
            </p>
          )}
        </div>
      )}

      {visitePour && entreprises.find(e => e.id === visitePour) && (() => {
        const e = entreprises.find(row => row.id === visitePour)!;
        return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={fermerVisite}>
          <div role="dialog" aria-modal="true" aria-labelledby="visite-dialog-title" className="w-full max-w-sm rounded-xl bg-[var(--tblr-surface)] p-5 shadow-xl space-y-4" onClick={event => event.stopPropagation()} onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); fermerVisite(); }
            if (event.key === 'Tab') {
              const fields = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled])')];
              if (event.shiftKey && document.activeElement === fields[0]) { event.preventDefault(); fields.at(-1)?.focus(); }
              else if (!event.shiftKey && document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0]?.focus(); }
            }
          }}>
            <div className="flex justify-between gap-3"><h3 id="visite-dialog-title" className="font-semibold">Rendez-vous de visite — {e.nom || 'Entreprise'}</h3><button type="button" autoFocus onClick={fermerVisite} aria-label="Fermer la visite"><IconX size={18} /></button></div>
            <p className="text-xs text-[var(--tblr-muted)]">Sélectionnez un créneau puis indiquez la présence de l’entreprise.</p>
            {champVisite(e)}
            <button type="button" onClick={fermerVisite} className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm">Terminer</button>
          </div>
        </div>;
      })()}
      {entrepriseMail && (
        <DceMailDialog
          projectId={projectId} depotActif={!!depot?.actif} depotIndisponible={depot?.indisponible} genererPiecesMarche={genererPiecesMarche} deadlineAt={depotDeadlineAt}
          projectName={projectName} entreprise={entrepriseMail} lots={lots} pieces={dcePieces} documents={documentsAffaire}
          partages={dcePartages} onAjouterPartage={onAjouterPartage} onRetirerPartage={onRetirerPartage} onDocumentDepose={onDocumentDepose}
          onClose={() => setMailPour(null)}
          onSent={() => patch(entrepriseMail.id, {
            dce_transmis_le: entrepriseMail.dce_transmis_le || today, envoyer_dce: true, ne_repond_pas: false,
          })}
        />
      )}
    </div>
  );
}
