// ── Préparation de l'envoi du DCE à UNE entreprise ───────────────────────────
// Fichiers joints (pièces du DCE, tableau d'indices, pièces du marché), lien de dépôt
// personnel et données du message. Partagé par l'envoi d'une entreprise (DceMailDialog) et
// l'envoi groupé. Un document illisible n'empêche jamais le message : il est signalé.
import { apiFetch } from './api';
import { documentToFile } from './emailAttachments';
import { dateFr, documentsAJoindre, lignesIndices, piecesDeEntreprise, type DocumentDce } from './dceIndices';
import { blocAdditif, type DceRevision } from './dceRevisions';
import { genererTableauIndicesPdf } from './dceIndicesPdf';
import type { PieceMarcheGeneree } from './marchePieces';
import { formaterDateHeure } from './depotAffichage';
import type { DonneesMessageDce } from './dceEnvoiMessage';
import type { EntrepriseSuivi } from './actEntreprises';
import { visitePourMessage, type CreneauVisite, type VisiteSite } from './actVisites';
import type { ProjectLot } from '../types';

/** Pièce du DCE telle que la reçoit la préparation (même forme que PieceDce du tableau). */
export interface PieceDcePreparation {
  /** Identifiant dans consultation.dce_documents (nécessaire pour un additif). */
  id?: string;
  libelle: string;
  tous_lots: boolean;
  lots_ids: string[];
  document_ids?: string[];
  type_doc?: string;
}

export interface ContexteEnvoiDce {
  projectId?: string;
  projectName: string;
  lots: ProjectLot[];
  pieces: PieceDcePreparation[];
  documents: DocumentDce[];
  genererPiecesMarche?: () => Promise<PieceMarcheGeneree[]>;
  /** Espace de dépôt utilisable : un lien personnel est alors créé pour l'entreprise. */
  depotActif: boolean;
  depotIndisponible?: string;
  deadlineAt?: string | null;
  /** Créneaux de visite, lieu et consignes : le message annonce la visite quand un créneau est citable. */
  visite?: { creneaux: CreneauVisite[]; site?: VisiteSite };
  /** Diffusion d'une réponse publique : la question (sans auteur) et sa réponse. */
  questionReponse?: { objet?: string; question: string; reponse: string };
  /**
   * Additif au DCE : seuls les fichiers des pièces modifiées sont joints (le tableau d'indices reste complet),
   * sans pièces du marché ni nouveau lien de dépôt (un nouveau lien révoquerait celui que l'entreprise a déjà).
   */
  additif?: { revision: DceRevision; numero: number };
}

export interface PreparationEntreprise {
  fichiers: File[];
  donnees: DonneesMessageDce;
}

/** Lots et indices d'une entreprise, sans aucun accès réseau : sert aux aperçus. */
export function donneesSansReseau(ctx: ContexteEnvoiDce, entreprise: EntrepriseSuivi): DonneesMessageDce {
  const piecesEntreprise = piecesDeEntreprise(ctx.pieces, entreprise.lots_ids);
  return {
    operation: ctx.projectName,
    entreprise: entreprise.nom,
    lots: ctx.lots.filter(l => entreprise.lots_ids.includes(l.id)),
    piecesMarche: [],
    lignesIndices: lignesIndices(piecesEntreprise, ctx.documents),
    visite: ctx.visite ? visitePourMessage(entreprise, ctx.visite.creneaux, ctx.visite.site) : undefined,
    questionReponse: ctx.questionReponse,
    additif: ctx.additif ? blocAdditif(ctx.additif.revision, ctx.additif.numero, dateFr(ctx.additif.revision.cree_le)) : undefined,
    dateLimite: ctx.deadlineAt ? formaterDateHeure(ctx.deadlineAt) : undefined,
    depotNonPropose: !ctx.depotActif ? ctx.depotIndisponible : undefined,
    echecsPieces: [],
  };
}

export async function preparerEnvoiEntreprise(ctx: ContexteEnvoiDce, entreprise: EntrepriseSuivi): Promise<PreparationEntreprise> {
  const piecesEntreprise = piecesDeEntreprise(ctx.pieces, entreprise.lots_ids);
  const lignes = lignesIndices(piecesEntreprise, ctx.documents);
  const revisees = ctx.additif ? new Set(ctx.additif.revision.pieces.map(p => p.id)) : null;
  const aJoindre = documentsAJoindre(revisees ? piecesEntreprise.filter(p => !!p.id && revisees.has(p.id)) : piecesEntreprise, ctx.documents);
  const lotsEntreprise = ctx.lots.filter(l => entreprise.lots_ids.includes(l.id));
  const lotsCourts = lotsEntreprise.map(l => `Lot ${l.lot_number}`).join(', ');

  const resultats = await Promise.allSettled(aJoindre.map(documentToFile));
  const fichiers: File[] = [];
  const echecs: string[] = [];
  resultats.forEach((r, i) => { if (r.status === 'fulfilled') fichiers.push(r.value); else echecs.push(aJoindre[i].name); });
  if (lignes.length > 0) {
    try { fichiers.unshift(await genererTableauIndicesPdf({ projectName: ctx.projectName, lignes, lots: lotsCourts || undefined })); }
    catch { echecs.push('Tableau d\'indices'); }
  }

  // Pièces du marché (RC, CCAP, acte d'engagement), générées d'après les réglages actuels. Une
  // pièce déjà versée au DCE part avec le DCE : on ne la joint pas deux fois.
  const piecesMarche: string[] = [];
  if (ctx.genererPiecesMarche && !ctx.additif) {
    const versees = new Set<string>();
    for (const p of piecesEntreprise) {
      if (!(p.document_ids ?? []).some(id => ctx.documents.some(d => d.id === id))) continue;
      if (p.type_doc === 'RC') versees.add('RC');
      else if (p.type_doc === 'CCAP') versees.add('CCAP');
      else if (/acte d.engagement/i.test(p.libelle)) versees.add('ACTE');
    }
    try {
      const generees = (await ctx.genererPiecesMarche()).filter(g => !versees.has(g.type));
      fichiers.unshift(...generees.map(g => g.fichier));
      piecesMarche.push(...generees.map(g => g.libelle));
    } catch { echecs.push('Pièces du marché (RC, CCAP, acte d\'engagement)'); }
  }

  // Lien de dépôt personnel : un lien précédent de cette entreprise est alors révoqué (le jeton
  // n'est jamais conservé en clair).
  let lienDepot: string | undefined; let echecLienDepot = false;
  if (ctx.depotActif && ctx.projectId && !ctx.additif) {
    try {
      const r = await apiFetch<{ url: string }>(`/api/projects/${ctx.projectId}/depot/invites`, {
        method: 'POST',
        body: JSON.stringify({
          entreprise_id: entreprise.id, entreprise_nom: entreprise.nom, email: entreprise.email || undefined,
          contact_id: entreprise.contact_id || undefined, lots_ids: entreprise.lots_ids,
        }),
      });
      lienDepot = r.url;
    } catch { echecLienDepot = true; }
  }

  return {
    fichiers,
    donnees: {
      ...donneesSansReseau(ctx, entreprise),
      piecesMarche, lienDepot, echecLienDepot, echecsPieces: echecs,
    },
  };
}
