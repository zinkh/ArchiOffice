// Portail public de dépôt des offres : ce que voit et fait une entreprise
// consultée avec son lien personnel. Aucun compte, aucun JWT : le jeton du lien
// est la seule barrière (haché en base, voir server/consultationDepot/tokens.ts).
// Le préfixe /api/public est exempté du middleware d'authentification de
// server.ts (AUTH_EXEMPT).
//
// Quatre garanties tiennent tout le reste :
//   1. à CHAQUE appel on revérifie lien, plan Enterprise, marché privé et
//      espace de stockage du cabinet (evaluerEligibilite) : perdre l'une des
//      conditions ferme le portail, sans rien supprimer ;
//   2. jamais d'octet dans Supabase : les fichiers vont sur le drive du cabinet
//      (storeDepotFile.ts), et un drive en panne fait échouer le dépôt ;
//   3. un dépôt n'écrase jamais l'offre : il arrive dans consultation_depots et
//      c'est l'architecte qui l'intègre ;
//   4. une entreprise ne voit que ses propres dépôts et jamais les autres.
//
// Un dépôt reçu après la date limite n'est pas refusé : il est signalé
// « hors délai ».
import crypto from 'crypto';
import multer from 'multer';
import type { Express } from 'express';
import { depotReadLimiter, depotWriteLimiter, depotZipLimiter } from '../rateLimit';
import {
  DOSSIER_COMPLEMENTAIRE, construireArchive, nomArchive, reserverConstruction,
  type EntreeArchive, type LienArchive,
} from '../consultationDepot/dossierZip';
import { evaluerEligibilite, type DepsEligibilite, type ProjetDepot } from '../consultationDepot/eligibility';
import { resoudreInvitation, type InvitationDepot } from '../consultationDepot/invites';
import { verifierOctets } from '../consultationDepot/fileRules';
import { deposerFichierConsultation } from '../consultationDepot/storeDepotFile';
import { buildConsultationFolderPath, nomFichierDepot } from '../consultationDepot/folderPath';
import { envoyerAccuse, notifierDepot } from '../consultationDepot/notifications';
import { parseExternalRef, isExternalRef } from '../externalStorage/externalRef';
import { signExternalTicket } from '../externalStorage/externalTicket';
import { getConnectionById } from '../externalStorage/externalConnection';
import { parseStorageRef } from '../storagePaths';
import { loadSuspendedTenants } from '../tenantSuspension';
import { piecesDeEntreprise } from '../../src/lib/dceIndices';
import { assainirLiensExternes } from '../../src/lib/dossierPartageMail';
import { MAX_QUESTIONS_PAR_ENTREPRISE, questionsOuvertes, validerQuestion } from '../../src/lib/depotQuestions';
import { additifsDeLentreprise, type DceRevision } from '../../src/lib/dceRevisions';
import { lotsAConfirmer, sourcesQuantites } from '../consultationDepot/quantitesAConfirmer';
import { validerReponsesQuantites } from '../../src/lib/quantitesConfirmation';
import { echapperHtml, lireAccuse, type AccusePayload } from '../consultationDepot/accuseAdditif';
import {
  DEPOT_EXTENSIONS, DEPOT_FORMAT_LABELS, DEPOT_KINDS_FICHIER, DEPOT_TABLEURS,
  MAX_DEPOT_OCTETS, MAX_FICHIER_OCTETS, MAX_FICHIERS_PAR_DEPOT,
  controlerLot, estHorsDelai, extensionDe, formatAutorise, validerSaisie,
  type DepotKind, type ElementAccuse, type ReglagesDepot,
} from '../../src/lib/consultationDepot';

export interface RouteDeps extends DepsEligibilite {
  supabaseAdmin: any;
}

/** Durée de vie du lien d'ouverture d'une pièce du DCE : le temps de cliquer. */
const TICKET_PIECE_DCE_SECONDS = 10 * 60;

const MSG_LIEN = 'Ce lien est invalide ou a expiré. Contactez le cabinet pour en obtenir un nouveau.';
const MSG_INDISPONIBLE = 'Le dépôt est momentanément indisponible. Merci de contacter le cabinet.';

interface ContexteDepot {
  invitation: InvitationDepot;
  project: ProjetDepot;
  connection: any;
  reglages: ReglagesDepot & { id?: string };
}

const televersement = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8',
  limits: { fileSize: MAX_FICHIER_OCTETS, files: MAX_FICHIERS_PAR_DEPOT, fields: 10, fieldSize: 4096 },
  fileFilter: (_req, file, cb) => {
    if (!formatAutorise(file.originalname)) {
      return cb(new Error(`« ${file.originalname} » : format non accepté. Formats admis : PDF, Word, Excel, ODS, ODT.`));
    }
    cb(null, true);
  },
}).array('files', MAX_FICHIERS_PAR_DEPOT);

export function registerConsultationDepotPublicRoutes(app: Express, deps: RouteDeps) {
  const { supabaseAdmin } = deps;

  /** Lien + conditions d'ouverture. Répond lui-même en cas d'échec et rend null. */
  async function ouvrir(req: any, res: any): Promise<ContexteDepot | null> {
    const invitation = await resoudreInvitation(supabaseAdmin, req.params.token);
    if (!invitation) {
      res.status(404).json({ error: MSG_LIEN, code: 'LIEN_INVALIDE' });
      return null;
    }
    const suspendus = await loadSuspendedTenants(supabaseAdmin);
    const eligibilite = suspendus.has(invitation.tenant_id)
      ? null
      : await evaluerEligibilite(deps, invitation.tenant_id, invitation.project_id);
    if (!eligibilite || !eligibilite.eligible) {
      // Message neutre : l'entreprise n'a pas à connaître le plan ni la
      // configuration de stockage du cabinet.
      res.status(503).json({ error: MSG_INDISPONIBLE, code: 'DEPOT_INDISPONIBLE' });
      return null;
    }
    const { data: reglages } = await supabaseAdmin
      .from('consultation_depot_settings').select('*').eq('project_id', invitation.project_id).maybeSingle();
    return { invitation, project: eligibilite.project, connection: eligibilite.connection, reglages: (reglages as any) || {} };
  }

  const garde = async (req: any, res: any, next: any) => {
    try {
      const ctx = await ouvrir(req, res);
      if (!ctx) return;
      req.depot = ctx;
      next();
    } catch (e: any) {
      console.error('[public depot] garde', e?.message);
      res.status(500).json({ error: MSG_INDISPONIBLE });
    }
  };

  const lotsDeLinvitation = async (inv: InvitationDepot) => {
    if (!inv.lots_ids.length) return [] as any[];
    const { data } = await supabaseAdmin
      .from('project_lots').select('id, lot_number, lot_title')
      .eq('tenant_id', inv.tenant_id).eq('project_id', inv.project_id).in('id', inv.lots_ids);
    return (data as any[]) || [];
  };

  /**
   * Pièces du DCE qui concernent cette entreprise : celles de tous les lots, ou
   * d'un lot qui lui est confié (même règle que le message d'envoi du DCE,
   * `piecesDeEntreprise`). Lues dans la consultation de l'affaire ; seuls les
   * fichiers qui existent encore dans l'affaire sont rendus. Meilleur effort :
   * une consultation illisible donne une liste vide, jamais une erreur.
   */
  const dceDeLinvitation = async (inv: InvitationDepot, lots: any[]) => {
    const { data: act } = await supabaseAdmin
      .from('act_data').select('consultation')
      .eq('tenant_id', inv.tenant_id).eq('project_id', inv.project_id).maybeSingle();
    const brutes = (act as any)?.consultation?.dce_documents;
    if (!Array.isArray(brutes)) return [];
    const pieces = piecesDeEntreprise(
      brutes.filter((p: any) => p && typeof p === 'object')
        .map((p: any) => ({
          id: String(p.id), nom: String(p.nom || ''), type_doc: String(p.type_doc || ''),
          tous_lots: !!p.tous_lots,
          lots_ids: Array.isArray(p.lots_ids) ? p.lots_ids.map(String) : [],
          document_ids: Array.isArray(p.document_ids) ? p.document_ids.map(String) : [],
          // Liens externes d'un dossier partagé : jamais crus tels quels (https seulement, bornés).
          liens: assainirLiensExternes(p.liens_externes),
        })),
      inv.lots_ids,
    ).filter(p => p.document_ids.length > 0 || p.liens.length > 0);
    const ids = [...new Set(pieces.flatMap(p => p.document_ids))];
    const { data: docs } = ids.length
      ? await supabaseAdmin
        .from('documents').select('id, name, size_bytes')
        .eq('tenant_id', inv.tenant_id).eq('project_id', inv.project_id).in('id', ids)
      : { data: [] };
    const parId = new Map(((docs as any[]) || []).map(d => [d.id, d]));
    const libelleLot = (id: string) => {
      const l = lots.find(x => x.id === id);
      return l ? `Lot ${l.lot_number} ${l.lot_title}` : null;
    };
    return pieces.flatMap(p => {
      const fichiers = p.document_ids.map(id => parId.get(id)).filter(Boolean)
        .map((d: any) => ({ id: d.id as string, nom: d.name as string, taille: (d.size_bytes ?? null) as number | null }));
      if (!fichiers.length && !p.liens.length) return [];
      return [{
        id: p.id, nom: p.nom, type_doc: p.type_doc,
        lots: p.tous_lots ? null : p.lots_ids.filter(id => inv.lots_ids.includes(id)).map(libelleLot).filter((x): x is string => !!x),
        fichiers,
        liens: p.liens,
      }];
    });
  };

  /**
   * Visite de site de cette entreprise, lue dans la consultation : son créneau, à défaut les créneaux
   * encore à venir qu'elle peut choisir, avec le lieu et les consignes. Les dates restent celles du
   * chantier, sans fuseau (voir src/lib/actVisites.ts). Meilleur effort : null en cas de doute.
   */
  const visiteDeLinvitation = async (inv: InvitationDepot) => {
    const { data: act } = await supabaseAdmin
      .from('act_data').select('consultation')
      .eq('tenant_id', inv.tenant_id).eq('project_id', inv.project_id).maybeSingle();
    const consultation = (act as any)?.consultation;
    const creneaux: Array<{ id: string; date_heure: string }> = (Array.isArray(consultation?.creneaux_visite) ? consultation.creneaux_visite : [])
      .filter((c: any) => c && typeof c.id === 'string' && typeof c.date_heure === 'string' && !Number.isNaN(new Date(c.date_heure).getTime()))
      .sort((a: any, b: any) => a.date_heure.localeCompare(b.date_heure));
    const entreprise = (Array.isArray(consultation?.entreprises) ? consultation.entreprises : []).find((e: any) => e?.id === inv.entreprise_id);
    // Une entreprise pointée « présente » a déjà visité : la page ne lui annonce ni ne lui propose aucune visite.
    if (entreprise?.visite_creneau_id && entreprise?.visite_presence === 'presente') return null;
    const affecte = creneaux.find(c => c.id === entreprise?.visite_creneau_id);
    const lieu = typeof consultation?.visite_site?.lieu === 'string' ? consultation.visite_site.lieu.trim().slice(0, 500) : '';
    const consignes = typeof consultation?.visite_site?.consignes === 'string' ? consultation.visite_site.consignes.trim().slice(0, 2000) : '';
    // Un créneau d'hier reste affiché (la visite peut avoir lieu aujourd'hui) ; au-delà, il est passé.
    const limite = Date.now() - 24 * 60 * 60 * 1000;
    const proposes = affecte ? [] : creneaux.filter(c => new Date(c.date_heure).getTime() >= limite).map(c => c.date_heure);
    if (!affecte && proposes.length === 0) return null;
    return {
      creneau: affecte ? affecte.date_heure : null, propositions: proposes, lieu: lieu || null, consignes: consignes || null,
      // La confirmation n'a de sens que pour un créneau affecté.
      confirmee_le: affecte ? (inv.visite_confirmee_le || null) : null,
    };
  };

  /**
   * Questions de l'entreprise et réponses publiques. Une question posée est lue dans la boîte de réception ;
   * sa réponse, saisie par l'architecte, est lue dans consultation.questions (où elle fait foi), par id.
   * Les réponses publiques sont rendues SANS le nom de l'entreprise qui avait posé la question.
   */
  const questionsDeLinvitation = async (inv: InvitationDepot) => {
    const { data: act } = await supabaseAdmin
      .from('act_data').select('consultation')
      .eq('tenant_id', inv.tenant_id).eq('project_id', inv.project_id).maybeSingle();
    const consultation = (act as any)?.consultation;
    const saisies: any[] = (Array.isArray(consultation?.questions) ? consultation.questions : []).filter((q: any) => q && typeof q === 'object');
    const { data: lignes } = await supabaseAdmin
      .from('consultation_depot_questions').select('id, objet, question, lot_id, created_at')
      .eq('invite_id', inv.id).order('created_at', { ascending: false });
    const reponseDe = (id: string) => {
      const q = saisies.find(x => String(x.id) === id);
      return q && typeof q.reponse === 'string' && q.reponse.trim() ? { reponse: q.reponse.trim(), reponse_le: q.date_reponse || null } : null;
    };
    const dateLimite = typeof consultation?.date_limite_questions === 'string' ? consultation.date_limite_questions : null;
    const mesIds = new Set(((lignes as any[]) || []).map(l => String(l.id)));
    return {
      date_limite: dateLimite,
      ouvertes: questionsOuvertes(dateLimite),
      mes_questions: ((lignes as any[]) || []).map(l => ({
        id: l.id as string, objet: l.objet || null, question: l.question as string, lot_id: l.lot_id || null,
        envoyee_le: l.created_at as string, ...(reponseDe(String(l.id)) || { reponse: null, reponse_le: null }),
      })),
      reponses_publiques: saisies
        .filter(q => q.publique === true && typeof q.reponse === 'string' && q.reponse.trim() && !mesIds.has(String(q.id))
          // Une question d'un lot est publique pour les entreprises de CE lot ; sans lot, pour toutes.
          && (!q.lot_id || inv.lots_ids.includes(String(q.lot_id))))
        .map(q => ({
          id: String(q.id), objet: typeof q.objet === 'string' ? q.objet : null, question: String(q.question || ''),
          reponse: String(q.reponse).trim(), reponse_le: q.date_reponse || null,
        })),
    };
  };


  /**
   * Additifs au DCE qui concernent cette entreprise (du plus récent au plus ancien), avec la date de son
   * accusé de réception. Les pièces modifiées sont déjà celles que la page propose au téléchargement.
   */
  const additifsDeLinvitation = async (inv: InvitationDepot) => {
    const { data: act } = await supabaseAdmin
      .from('act_data').select('consultation')
      .eq('tenant_id', inv.tenant_id).eq('project_id', inv.project_id).maybeSingle();
    const consultation = (act as any)?.consultation;
    const revisions: DceRevision[] = (Array.isArray(consultation?.dce_revisions) ? consultation.dce_revisions : [])
      .filter((r: any) => r && typeof r.id === 'string' && Array.isArray(r.pieces));
    if (revisions.length === 0) return [];
    const piecesDce = (Array.isArray(consultation?.dce_documents) ? consultation.dce_documents : [])
      .filter((p: any) => p && typeof p === 'object')
      .map((p: any) => ({ id: String(p.id), tous_lots: !!p.tous_lots, lots_ids: Array.isArray(p.lots_ids) ? p.lots_ids.map(String) : [] }));
    const { data: accuses } = await supabaseAdmin
      .from('consultation_additif_accuses').select('revision_id, accuse_le')
      .eq('project_id', inv.project_id).eq('entreprise_id', inv.entreprise_id);
    const accuseDe = (id: string) => ((accuses as any[]) || []).find(a => a.revision_id === id)?.accuse_le || null;
    return additifsDeLentreprise(revisions, piecesDce, inv.lots_ids).map(({ revision, numero }) => ({
      id: revision.id, numero, date: revision.cree_le, motif: String(revision.motif || ''),
      pieces: revision.pieces.map(p => ({ libelle: String(p.libelle || ''), indice: p.indice ? String(p.indice) : null })),
      accuse_le: accuseDe(revision.id),
    }));
  };


  /**
   * Quantités que le cabinet demande à CETTE entreprise de confirmer : seulement après l'envoi du message
   * « quantités à confirmer » (drapeau posé sur l'entreprise dans la consultation), et seulement ses propres
   * postes. Chaque ligne porte la réponse déjà donnée, pour qu'elle puisse la revoir.
   */
  const quantitesDeLinvitation = async (inv: InvitationDepot, lots: any[]) => {
    const { data: act } = await supabaseAdmin
      .from('act_data').select('consultation')
      .eq('tenant_id', inv.tenant_id).eq('project_id', inv.project_id).maybeSingle();
    const entreprise = (Array.isArray((act as any)?.consultation?.entreprises) ? (act as any).consultation.entreprises : []).find((e: any) => e?.id === inv.entreprise_id);
    if (!entreprise?.quantites_demandees_le) return null;
    const titre = (id: string) => { const l = lots.find(x => x.id === id); return l ? `Lot ${l.lot_number} ${l.lot_title}` : 'Lot'; };
    const aConfirmer = lotsAConfirmer(await sourcesQuantites(supabaseAdmin, inv.tenant_id, inv.project_id), inv.entreprise_id, inv.lots_ids, titre);
    if (!aConfirmer.length) return null;
    const { data: reponses } = await supabaseAdmin
      .from('consultation_quantites_reponses').select('ligne_id, choix, quantite').eq('invite_id', inv.id);
    const parLigne = new Map(((reponses as any[]) || []).map(r => [r.ligne_id, r]));
    return {
      demandees_le: String(entreprise.quantites_demandees_le),
      lots: aConfirmer.map(l => ({
        lot: l.lot,
        lignes: l.lignes.map(x => {
          const r = parLigne.get(x.ligneId);
          return {
            ligne_id: x.ligneId, code: x.code, titre: x.titre, unite: x.unite,
            quantite_dossier: x.quantiteDossier, quantite_entreprise: x.quantiteEntreprise,
            reponse: r ? { choix: r.choix, quantite: r.quantite == null ? null : Number(r.quantite) } : null,
          };
        }),
      })),
    };
  };

  // ── Contexte du portail ────────────────────────────────────────────────────
  app.get('/api/public/depot/:token', depotReadLimiter, garde, async (req: any, res: any) => {
    try {
      const { invitation: inv, project, reglages } = req.depot as ContexteDepot;
      const tenantId = inv.tenant_id;
      const lots = (await lotsDeLinvitation(inv)).sort((a, b) => String(a.lot_number).localeCompare(String(b.lot_number), 'fr', { numeric: true }));

      const publies: string[] = Array.isArray(reglages.published_document_ids) ? reglages.published_document_ids : [];
      let pieces: any[] = [];
      if (publies.length) {
        const { data } = await supabaseAdmin
          .from('documents').select('id, name, size_bytes, mime_type')
          .eq('tenant_id', tenantId).eq('project_id', inv.project_id).in('id', publies);
        pieces = (data as any[]) || [];
      }
      const dce = await dceDeLinvitation(inv, lots).catch(() => []);
      const visite = await visiteDeLinvitation(inv).catch(() => null);
      const questions = await questionsDeLinvitation(inv).catch(() => null);
      const additifs = await additifsDeLinvitation(inv).catch(() => []);
      const quantites = await quantitesDeLinvitation(inv, lots).catch(() => null);
      // Fichiers que l'archive « tout le dossier » contiendrait (sans doublon entre pièces du DCE et documents publiés).
      const fichiersDossier = new Map<string, number | null>();
      for (const p of dce) for (const f of p.fichiers) fichiersDossier.set(f.id, f.taille);
      for (const p of pieces) if (!fichiersDossier.has(p.id)) fichiersDossier.set(p.id, p.size_bytes ?? null);

      const { data: mesDepots } = await supabaseAdmin
        .from('consultation_depots')
        .select('id, lot_id, kind, version, file_name, size_bytes, status, hors_delai, received_at')
        .eq('invite_id', inv.id).order('received_at', { ascending: false });

      const { data: agence } = await supabaseAdmin
        .from('settings').select('agency_name, logo_url, address, email, phone').eq('tenant_id', tenantId).maybeSingle();

      // Meilleur effort, au plus une écriture toutes les dix minutes.
      const dernier = inv.last_opened_at ? new Date(inv.last_opened_at).getTime() : 0;
      if (Date.now() - dernier > 10 * 60 * 1000) {
        supabaseAdmin.from('consultation_depot_invites')
          .update({ last_opened_at: new Date().toISOString() }).eq('id', inv.id).then(() => {}, () => {});
      }

      res.json({
        operation: project.name,
        entreprise: inv.entreprise_nom,
        cabinet: {
          nom: (agence as any)?.agency_name || null,
          logo: (agence as any)?.logo_url || null,
          adresse: (agence as any)?.address || null,
          email: (agence as any)?.email || null,
          telephone: (agence as any)?.phone || null,
        },
        lots,
        deadline_at: reglages.deadline_at || null,
        en_retard: estHorsDelai(new Date(), reglages.deadline_at),
        instructions: reglages.instructions || null,
        pieces: pieces.map(p => ({ id: p.id, nom: p.name, taille: p.size_bytes ?? null })),
        dce,
        visite,
        questions,
        additifs,
        quantites,
        // Lien « tout le dossier en une archive » : absent s'il n'y a aucun fichier à rassembler.
        dossier_zip: fichiersDossier.size > 0
          ? { fichiers: fichiersDossier.size, taille: [...fichiersDossier.values()].reduce<number>((s, t) => s + (t ?? 0), 0) || null }
          : null,
        depots: ((mesDepots as any[]) || []).filter(d => d.status !== 'retire').map(d => ({
          id: d.id, lot_id: d.lot_id, kind: d.kind, version: d.version, nom: d.file_name,
          taille: d.size_bytes ?? null, hors_delai: !!d.hors_delai, recu_le: d.received_at,
        })),
        limites: {
          fichier_octets: MAX_FICHIER_OCTETS,
          depot_octets: MAX_DEPOT_OCTETS,
          fichiers_max: MAX_FICHIERS_PAR_DEPOT,
          extensions: DEPOT_EXTENSIONS,
          libelles: DEPOT_FORMAT_LABELS,
          tableurs: DEPOT_TABLEURS,
        },
      });
    } catch (e: any) {
      console.error('[GET /api/public/depot/:token]', e?.message);
      res.status(500).json({ error: MSG_INDISPONIBLE });
    }
  });

  // ── Pièce du DCE publiée ───────────────────────────────────────────────────
  app.get('/api/public/depot/:token/pieces/:docId', depotReadLimiter, garde, async (req: any, res: any) => {
    try {
      const { invitation: inv, reglages } = req.depot as ContexteDepot;
      const publies: string[] = Array.isArray(reglages.published_document_ids) ? reglages.published_document_ids : [];
      if (!publies.includes(req.params.docId)) {
        // Hors liste cochée : seule une pièce du DCE de CETTE entreprise reste téléchargeable.
        const lots = await lotsDeLinvitation(inv);
        const dce = await dceDeLinvitation(inv, lots).catch(() => []);
        if (!dce.some(p => p.fichiers.some(f => f.id === req.params.docId))) return res.status(404).json({ error: 'Pièce introuvable.' });
      }

      const { data: doc } = await supabaseAdmin
        .from('documents').select('id, name, file_url')
        .eq('id', req.params.docId).eq('tenant_id', inv.tenant_id).eq('project_id', inv.project_id).maybeSingle();
      if (!doc) return res.status(404).json({ error: 'Pièce introuvable.' });

      const fileUrl = (doc as any).file_url as string;
      if (isExternalRef(fileUrl)) {
        const ref = parseExternalRef(fileUrl);
        const connexion = ref && await getConnectionById(supabaseAdmin, inv.tenant_id, ref.connectionId);
        if (!ref || !connexion) return res.status(404).json({ error: 'Pièce indisponible.' });
        const ticket = signExternalTicket({ t: inv.tenant_id, c: ref.connectionId, e: ref.externalId, n: ref.fileName || (doc as any).name }, TICKET_PIECE_DCE_SECONDS);
        return res.redirect(302, `/api/storage/external/${encodeURIComponent(ticket)}`);
      }
      const ref = parseStorageRef(fileUrl);
      if (!ref || !ref.path.startsWith(`${inv.tenant_id}/`)) return res.status(404).json({ error: 'Pièce indisponible.' });
      const { data, error } = await supabaseAdmin.storage.from(ref.bucket).createSignedUrl(ref.path, TICKET_PIECE_DCE_SECONDS);
      if (error || !data?.signedUrl) return res.status(404).json({ error: 'Pièce indisponible.' });
      res.redirect(302, data.signedUrl);
    } catch (e: any) {
      console.error('[GET /api/public/depot/:token/pieces]', e?.message);
      res.status(500).json({ error: 'Pièce indisponible.' });
    }
  });

  // ── Tout le dossier de consultation en une archive ─────────────────────────
  // Ce que l'entreprise peut déjà télécharger pièce par pièce (pièces du DCE de ses lots et
  // documents publiés), rangé par pièce. Rien d'autre : la liste vient de `dceDeLinvitation` et des
  // réglages, comme la route des pièces.
  app.get('/api/public/depot/:token/dossier.zip', depotZipLimiter, garde, async (req: any, res: any) => {
    const { invitation: inv, project, reglages } = req.depot as ContexteDepot;
    let liberer: (() => void) | null = null;
    try {
      const lots = await lotsDeLinvitation(inv);
      const dce = await dceDeLinvitation(inv, lots).catch(() => []);
      const publies: string[] = Array.isArray(reglages.published_document_ids) ? reglages.published_document_ids : [];
      const ids = [...new Set([...dce.flatMap(p => p.fichiers.map(f => f.id)), ...publies])];
      const { data: docs } = ids.length
        ? await supabaseAdmin
          .from('documents').select('id, name, file_url')
          .eq('tenant_id', inv.tenant_id).eq('project_id', inv.project_id).in('id', ids)
        : { data: [] };
      const parId = new Map(((docs as any[]) || []).map(d => [d.id as string, d]));
      const vus = new Set<string>();
      const entrees: EntreeArchive[] = [];
      for (const piece of dce) {
        for (const f of piece.fichiers) {
          const d = parId.get(f.id);
          if (!d || vus.has(d.id)) continue;
          vus.add(d.id);
          entrees.push({ id: d.id, nom: d.name, dossier: piece.nom || 'Pièce du DCE', fileUrl: d.file_url });
        }
      }
      for (const id of publies) {
        const d = parId.get(id);
        if (!d || vus.has(id)) continue;
        vus.add(id);
        entrees.push({ id, nom: d.name, dossier: DOSSIER_COMPLEMENTAIRE, fileUrl: d.file_url });
      }
      const liens: LienArchive[] = dce.flatMap(p => (p.liens ?? []).map(l => ({ dossier: p.nom || 'Pièce du DCE', libelle: l.libelle, url: l.url })));
      // Sans aucun fichier, une archive ne contiendrait que des liens : la page les affiche déjà.
      if (entrees.length === 0) return res.status(404).json({ error: 'Aucun document à télécharger.' });

      liberer = reserverConstruction();
      if (!liberer) {
        res.setHeader('Retry-After', '15');
        return res.status(503).json({ error: 'Plusieurs archives sont en préparation. Réessayez dans quelques instants.' });
      }
      const archive = await construireArchive(supabaseAdmin, inv.tenant_id, entrees, liens);
      if (!archive.ok) {
        return res.status(archive.raison === 'vide' ? 404 : 413).json({
          error: archive.raison === 'vide'
            ? 'Aucun document à télécharger.'
            : 'Le dossier est trop volumineux pour une seule archive : téléchargez les pièces une par une.',
        });
      }
      const nom = nomArchive(project.name);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${nom.ascii}"; filename*=UTF-8''${encodeURIComponent(nom.utf8)}`);
      res.setHeader('Content-Length', String(archive.buffer.length));
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(archive.buffer);
    } catch (e: any) {
      console.error('[GET /api/public/depot/:token/dossier.zip]', e?.message);
      res.status(500).json({ error: "L'archive n'a pas pu être préparée. Téléchargez les pièces une par une." });
    } finally {
      liberer?.();
    }
  });

  // ── « J'ai bien reçu » : confirmation de réception d'un additif ────────────
  // Page HTML minimale servie par le serveur (aucun script) : le lien du mail ne fait qu'AFFICHER la page,
  // la confirmation est un POST. Un anti-virus de messagerie qui ouvre le lien ne confirme donc rien.
  // Le ticket (HMAC, accuseAdditif.ts) est la seule barrière ; il ne donne accès à rien d'autre.
  const pageAccuse = (res: any, statut: number, titre: string, corps: string, formulaire?: string) => {
    res.status(statut);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${echapperHtml(titre)}</title>`
      + '<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#18181b;line-height:1.5}h1{font-size:1.25rem}button{font-size:1rem;font-weight:700;padding:.75rem 1.25rem;border:0;border-radius:.5rem;background:#18181b;color:#fff;cursor:pointer}.muted{color:#52525b;font-size:.875rem}</style></head>'
      + `<body><h1>${echapperHtml(titre)}</h1><p>${corps}</p>${formulaire || ''}</body></html>`);
  };

  /** Ce que la page de confirmation annonce : opération, entreprise, numéro de l'additif, accusé déjà posé. */
  async function contexteAccuse(p: AccusePayload) {
    const suspendus = await loadSuspendedTenants(supabaseAdmin);
    if (suspendus.has(p.t)) return null;
    const { data: projet } = await supabaseAdmin.from('projects').select('id, name').eq('id', p.p).eq('tenant_id', p.t).maybeSingle();
    if (!projet) return null;
    const { data: act } = await supabaseAdmin.from('act_data').select('consultation').eq('tenant_id', p.t).eq('project_id', p.p).maybeSingle();
    const consultation = (act as any)?.consultation;
    const revisions: any[] = Array.isArray(consultation?.dce_revisions) ? consultation.dce_revisions : [];
    const index = revisions.findIndex(r => r?.id === p.r);
    const entreprise = (Array.isArray(consultation?.entreprises) ? consultation.entreprises : []).find((e: any) => e?.id === p.e);
    const { data: deja } = await supabaseAdmin.from('consultation_additif_accuses').select('accuse_le')
      .eq('project_id', p.p).eq('revision_id', p.r).eq('entreprise_id', p.e).maybeSingle();
    return {
      operation: (projet as any).name || 'la consultation',
      entreprise: String(entreprise?.nom || 'votre entreprise'),
      numero: index >= 0 ? index + 1 : null,
      accuseLe: ((deja as any)?.accuse_le as string | undefined) || null,
    };
  }

  const libelleAdditif = (numero: number | null) => (numero ? `l'additif n° ${numero}` : 'cet additif');

  app.get('/api/public/additif/accuse/:ticket', depotReadLimiter, async (req: any, res: any) => {
    try {
      const p = lireAccuse(req.params.ticket);
      const c = p ? await contexteAccuse(p) : null;
      if (!p || !c) return pageAccuse(res, 404, 'Lien invalide', 'Ce lien est invalide ou a expiré. Contactez le cabinet pour confirmer la réception de l\'additif.');
      const intro = `Consultation « ${echapperHtml(c.operation)} » : modification du dossier de consultation pour <strong>${echapperHtml(c.entreprise)}</strong>.`;
      if (c.accuseLe) {
        return pageAccuse(res, 200, 'Réception déjà confirmée', `${intro}<br>Vous avez confirmé la réception de ${libelleAdditif(c.numero)} le ${echapperHtml(new Date(c.accuseLe).toLocaleDateString('fr-FR'))}. Merci.`);
      }
      pageAccuse(res, 200, 'Confirmer la réception', `${intro}<br>Confirmez-vous avoir bien reçu ${libelleAdditif(c.numero)} et ses pièces ?`,
        `<form method="post" action="${echapperHtml(`/api/public/additif/accuse/${req.params.ticket}`)}"><button type="submit">J'ai bien reçu</button></form><p class="muted">Aucune autre information n'est collectée.</p>`);
    } catch (e: any) {
      console.error('[GET /api/public/additif/accuse]', e?.message);
      pageAccuse(res, 500, 'Indisponible', 'La page est momentanément indisponible. Merci de réessayer dans quelques instants.');
    }
  });

  app.post('/api/public/additif/accuse/:ticket', depotWriteLimiter, async (req: any, res: any) => {
    try {
      const p = lireAccuse(req.params.ticket);
      const c = p ? await contexteAccuse(p) : null;
      if (!p || !c) return pageAccuse(res, 404, 'Lien invalide', 'Ce lien est invalide ou a expiré. Contactez le cabinet pour confirmer la réception de l\'additif.');
      if (!c.accuseLe) {
        const { error } = await supabaseAdmin.from('consultation_additif_accuses').insert({
          tenant_id: p.t, project_id: p.p, revision_id: p.r, entreprise_id: p.e, entreprise_nom: c.entreprise, accuse_le: new Date().toISOString(),
        });
        // Un doublon (double clic, deux requêtes) est sans conséquence : le premier accusé fait foi.
        if (error && (error as any).code !== '23505') throw error;
        if (!error) {
          await notifierDepot(supabaseAdmin, p.t, p.p, {
            titre: 'Additif reçu', corps: `${c.entreprise} confirme avoir reçu ${libelleAdditif(c.numero)} pour ${c.operation}.`,
          }).catch(() => {});
        }
      }
      pageAccuse(res, 200, 'Réception confirmée', `Merci, la réception de ${libelleAdditif(c.numero)} pour la consultation « ${echapperHtml(c.operation)} » est confirmée.`);
    } catch (e: any) {
      console.error('[POST /api/public/additif/accuse]', e?.message);
      pageAccuse(res, 500, 'Indisponible', 'La confirmation n\'a pas pu être enregistrée. Merci de réessayer dans quelques instants.');
    }
  });

  // ── Question de l'entreprise ───────────────────────────────────────────────
  // Arrive dans la boîte de réception du cabinet (consultation_depot_questions), qui la reprend
  // dans consultation.questions. Jamais publiée par elle-même : c'est l'architecte qui répond et
  // choisit de rendre la réponse publique.
  app.post('/api/public/depot/:token/questions', depotWriteLimiter, garde, async (req: any, res: any) => {
    const { invitation: inv, project } = req.depot as ContexteDepot;
    try {
      const controle = validerQuestion(req.body);
      if (!controle.ok) return res.status(400).json({ error: controle.raison });
      const lot = lotAutorise(inv, req.body?.lot_id);
      if (!lot.ok) return res.status(400).json({ error: 'Ce lot ne fait pas partie de votre consultation.' });

      const { data: act } = await supabaseAdmin
        .from('act_data').select('consultation')
        .eq('tenant_id', inv.tenant_id).eq('project_id', inv.project_id).maybeSingle();
      if (!questionsOuvertes((act as any)?.consultation?.date_limite_questions)) {
        return res.status(403).json({ error: 'La date limite des questions est passée. Contactez directement le cabinet.' });
      }
      const { data: deja } = await supabaseAdmin.from('consultation_depot_questions').select('id').eq('invite_id', inv.id);
      if (((deja as any[]) || []).length >= MAX_QUESTIONS_PAR_ENTREPRISE) {
        return res.status(429).json({ error: `Vous avez atteint la limite de ${MAX_QUESTIONS_PAR_ENTREPRISE} questions. Contactez directement le cabinet.` });
      }

      const id = crypto.randomUUID();
      const creeLe = new Date().toISOString();
      const { error } = await supabaseAdmin.from('consultation_depot_questions').insert({
        id, tenant_id: inv.tenant_id, project_id: inv.project_id, invite_id: inv.id,
        entreprise_id: inv.entreprise_id, entreprise_nom: inv.entreprise_nom, lot_id: lot.lotId,
        objet: controle.objet, question: controle.question, created_at: creeLe,
      });
      if (error) throw error;
      // Meilleur effort : une notification ratée ne fait jamais perdre la question enregistrée.
      await notifierDepot(supabaseAdmin, inv.tenant_id, inv.project_id, {
        titre: 'Question d\'une entreprise',
        corps: `${inv.entreprise_nom} a posé une question pour ${project.name || "l'opération"}.`,
      }).catch(() => {});
      res.status(201).json({ question: { id, objet: controle.objet, question: controle.question, lot_id: lot.lotId, envoyee_le: creeLe } });
    } catch (e: any) {
      console.error('[POST /api/public/depot/:token/questions]', e?.message);
      res.status(500).json({ error: "La question n'a pas pu être enregistrée. Merci de réessayer." });
    }
  });


  // ── Réponse de l'entreprise aux quantités à confirmer ───────────────────────
  // Enregistrée à part (consultation_quantites_reponses) : elle ne change jamais l'offre, c'est
  // l'architecte qui l'applique. Une nouvelle réponse sur un poste remplace la précédente.
  app.post('/api/public/depot/:token/quantites', depotWriteLimiter, garde, async (req: any, res: any) => {
    const { invitation: inv, project } = req.depot as ContexteDepot;
    try {
      const lots = await lotsDeLinvitation(inv);
      const demande = await quantitesDeLinvitation(inv, lots);
      if (!demande) return res.status(409).json({ error: "Aucune quantité n'est à confirmer pour votre offre. Contactez le cabinet." });
      const autorises = new Set<string>(demande.lots.flatMap(l => l.lignes.map(x => x.ligne_id)));
      const controle = validerReponsesQuantites(req.body, autorises);
      if (!controle.ok) return res.status(400).json({ error: controle.raison });

      const { data: existantes } = await supabaseAdmin.from('consultation_quantites_reponses').select('id, ligne_id').eq('invite_id', inv.id);
      const idParLigne = new Map(((existantes as any[]) || []).map(r => [r.ligne_id, r.id]));
      const maintenant = new Date().toISOString();
      for (const r of controle.reponses) {
        const valeurs = { choix: r.choix, quantite: r.choix === 'autre' ? r.quantite ?? null : null, updated_at: maintenant };
        const idExistant = idParLigne.get(r.ligneId);
        const { error } = idExistant
          ? await supabaseAdmin.from('consultation_quantites_reponses').update(valeurs).eq('id', idExistant).eq('invite_id', inv.id)
          : await supabaseAdmin.from('consultation_quantites_reponses').insert({
            id: crypto.randomUUID(), tenant_id: inv.tenant_id, project_id: inv.project_id, invite_id: inv.id,
            entreprise_id: inv.entreprise_id, entreprise_nom: inv.entreprise_nom, ligne_id: r.ligneId, ...valeurs, created_at: maintenant,
          });
        if (error) throw error;
      }
      await notifierDepot(supabaseAdmin, inv.tenant_id, inv.project_id, {
        titre: 'Quantités confirmées par une entreprise',
        corps: `${inv.entreprise_nom} a répondu sur ${controle.reponses.length} poste${controle.reponses.length > 1 ? 's' : ''} pour ${project.name || "l'opération"}.`,
      }).catch(() => {});
      res.status(201).json({ enregistrees: controle.reponses.length, recu_le: maintenant });
    } catch (e: any) {
      console.error('[POST /api/public/depot/:token/quantites]', e?.message);
      res.status(500).json({ error: "Votre réponse n'a pas pu être enregistrée. Merci de réessayer." });
    }
  });

  // ── Confirmation de présence à la visite ───────────────────────────────────
  // Posée sur l'invitation, jamais dans la consultation : l'architecte reste maître du pointage.
  app.post('/api/public/depot/:token/visite/confirmer', depotWriteLimiter, garde, async (req: any, res: any) => {
    const { invitation: inv, project } = req.depot as ContexteDepot;
    try {
      const visite = await visiteDeLinvitation(inv).catch(() => null);
      if (!visite?.creneau) return res.status(409).json({ error: "Aucun créneau de visite ne vous est affecté. Contactez le cabinet." });
      if (inv.visite_confirmee_le) return res.json({ confirmee_le: inv.visite_confirmee_le });
      const confirmeeLe = new Date().toISOString();
      const { error } = await supabaseAdmin.from('consultation_depot_invites').update({ visite_confirmee_le: confirmeeLe }).eq('id', inv.id);
      if (error) throw error;
      await notifierDepot(supabaseAdmin, inv.tenant_id, inv.project_id, {
        titre: 'Présence à la visite confirmée',
        corps: `${inv.entreprise_nom} confirme sa présence à la visite de ${project.name || "l'opération"}.`,
      }).catch(() => {});
      res.json({ confirmee_le: confirmeeLe });
    } catch (e: any) {
      console.error('[POST /api/public/depot/:token/visite/confirmer]', e?.message);
      res.status(500).json({ error: "La confirmation n'a pas pu être enregistrée. Merci de réessayer." });
    }
  });

  // ── Calculs communs aux deux modes de remise ───────────────────────────────

  async function numeroVersion(inv: InvitationDepot, lotId: string | null, kind: DepotKind): Promise<number> {
    const { data } = await supabaseAdmin
      .from('consultation_depots').select('lot_id, kind, status').eq('invite_id', inv.id);
    const memes = ((data as any[]) || []).filter(d => d.kind === kind && (d.lot_id || null) === lotId && d.status !== 'retire');
    return memes.length + 1;
  }

  /** Le lot visé doit faire partie des lots de l'invitation ; vide = remise générale. */
  function lotAutorise(inv: InvitationDepot, brut: unknown): { ok: true; lotId: string | null } | { ok: false } {
    const lotId = typeof brut === 'string' && brut.trim() ? brut.trim() : null;
    if (lotId && !inv.lots_ids.includes(lotId)) return { ok: false };
    return { ok: true, lotId };
  }

  async function apresDepot(
    ctx: ContexteDepot, recuLe: Date, horsDelai: boolean, elements: ElementAccuse[],
  ): Promise<boolean> {
    const { invitation: inv, project, reglages } = ctx;
    const { data: agence } = await supabaseAdmin
      .from('settings').select('agency_name').eq('tenant_id', inv.tenant_id).maybeSingle();
    const cabinet = (agence as any)?.agency_name || 'Le cabinet';
    const accuse = await envoyerAccuse(supabaseAdmin, inv.tenant_id, inv.email, {
      cabinet, operation: project.name || 'Opération', entreprise: inv.entreprise_nom,
      recuLe, horsDelai, deadlineAt: reglages.deadline_at, elements,
    });
    const n = elements.length;
    await notifierDepot(supabaseAdmin, inv.tenant_id, inv.project_id, {
      titre: horsDelai ? 'Offre déposée hors délai' : 'Offre déposée',
      corps: `${inv.entreprise_nom} a remis ${n} élément${n > 1 ? 's' : ''} pour ${project.name || "l'opération"}.`,
    });
    return accuse;
  }

  // ── Dépôt de fichiers ──────────────────────────────────────────────────────
  app.post('/api/public/depot/:token/fichiers', depotWriteLimiter, garde, (req: any, res: any, next: any) => {
    televersement(req, res, (err: any) => {
      if (!err) return next();
      const trop = err?.code === 'LIMIT_FILE_SIZE';
      const nombre = err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE';
      res.status(trop ? 413 : 400).json({
        error: trop
          ? `Un fichier dépasse la taille maximale de ${Math.round(MAX_FICHIER_OCTETS / 1024 / 1024)} Mo.`
          : nombre ? `${MAX_FICHIERS_PAR_DEPOT} fichiers au plus par dépôt.` : (err.message || 'Envoi invalide.'),
      });
    });
  }, async (req: any, res: any) => {
    const ctx = req.depot as ContexteDepot;
    const { invitation: inv, project, connection, reglages } = ctx;
    const fichiers: Express.Multer.File[] = req.files || [];
    try {
      const lot = lotAutorise(inv, req.body?.lot_id);
      if (!lot.ok) return res.status(400).json({ error: "Ce lot ne fait pas partie de votre consultation." });

      const kind: DepotKind = DEPOT_KINDS_FICHIER.includes(req.body?.kind) ? req.body.kind : 'fichier';
      const controle = controlerLot(fichiers.map(f => ({ name: f.originalname, size: f.size })));
      if (!controle.ok) return res.status(400).json({ error: controle.raison });

      if (kind === 'bordereau') {
        if (!lot.lotId) return res.status(400).json({ error: 'Indiquez le lot concerné par ce bordereau.' });
        if (fichiers.length !== 1 || !(DEPOT_TABLEURS as string[]).includes(extensionDe(fichiers[0].originalname))) {
          return res.status(400).json({ error: 'Un bordereau chiffré se remet en un seul fichier Excel (.xlsx) ou ODS.' });
        }
      }
      if (kind === 'acte' && (fichiers.length !== 1 || extensionDe(fichiers[0].originalname) !== 'pdf')) {
        return res.status(400).json({ error: "L'acte d'engagement se remet en un seul PDF." });
      }

      // Contrôle des octets AVANT tout dépôt : un seul fichier refusé arrête le lot.
      const mimes: string[] = [];
      for (const f of fichiers) {
        const v = verifierOctets(f.originalname, f.buffer);
        if (!v.ok) return res.status(400).json({ error: v.raison });
        mimes.push(v.mime);
      }

      let lotLigne: any = null;
      if (lot.lotId) {
        const { data } = await supabaseAdmin
          .from('project_lots').select('id, lot_number, lot_title').eq('id', lot.lotId).eq('tenant_id', inv.tenant_id).maybeSingle();
        lotLigne = data || null;
      }
      const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : null;
      const recuLe = new Date();
      const horsDelai = estHorsDelai(recuLe, reglages.deadline_at);
      const dossier = buildConsultationFolderPath(project, lotLigne, inv.entreprise_nom);
      const lotLibelle = lotLigne ? `Lot ${lotLigne.lot_number} ${lotLigne.lot_title}` : 'Tous lots';

      const recus: any[] = [];
      const elements: ElementAccuse[] = [];
      let version = await numeroVersion(inv, lot.lotId, kind);
      try {
        for (let i = 0; i < fichiers.length; i += 1) {
          const f = fichiers[i];
          const sha256 = crypto.createHash('sha256').update(f.buffer).digest('hex');
          const depose = await deposerFichierConsultation(supabaseAdmin, {
            tenantId: inv.tenant_id, connection, folderPath: dossier,
            fileName: nomFichierDepot(recuLe, f.originalname), buffer: f.buffer, mimetype: mimes[i],
          });
          const id = crypto.randomUUID();
          const { error } = await supabaseAdmin.from('consultation_depots').insert({
            id, tenant_id: inv.tenant_id, project_id: inv.project_id, invite_id: inv.id,
            entreprise_id: inv.entreprise_id, entreprise_nom: inv.entreprise_nom, lot_id: lot.lotId,
            kind, version, file_url: depose.fileUrl, file_name: f.originalname, mime_type: mimes[i],
            size_bytes: depose.sizeBytes, sha256, note, status: 'recu', hors_delai: horsDelai,
            received_at: recuLe.toISOString(),
          });
          if (error) throw error;
          recus.push({ id, nom: f.originalname, kind, version, sha256, taille: depose.sizeBytes });
          elements.push({ nom: f.originalname, kind, tailleOctets: depose.sizeBytes, sha256, lotLibelle });
          version += 1;
        }
      } catch (e: any) {
        console.error('[POST /api/public/depot/:token/fichiers]', e?.cause?.message || e?.message);
        // Les fichiers déjà déposés restent valables et sont accusés : on le dit.
        if (recus.length) await apresDepot(ctx, recuLe, horsDelai, elements);
        return res.status(e?.status && e.status >= 400 ? e.status : 502).json({
          error: recus.length
            ? `Seuls ${recus.length} fichier(s) sur ${fichiers.length} ont pu être enregistrés. Renvoyez les autres dans quelques instants.`
            : "Le dépôt n'a pas pu être enregistré. Merci de réessayer dans quelques instants ou de contacter le cabinet.",
          deposes: recus,
        });
      }

      const accuse = await apresDepot(ctx, recuLe, horsDelai, elements);
      res.status(201).json({ depots: recus, hors_delai: horsDelai, recu_le: recuLe.toISOString(), accuse_envoye: accuse });
    } catch (e: any) {
      console.error('[POST /api/public/depot/:token/fichiers]', e?.message);
      res.status(500).json({ error: MSG_INDISPONIBLE });
    }
  });

  // ── Saisie en ligne ────────────────────────────────────────────────────────
  app.post('/api/public/depot/:token/saisie', depotWriteLimiter, garde, async (req: any, res: any) => {
    const ctx = req.depot as ContexteDepot;
    const { invitation: inv, reglages } = ctx;
    try {
      const lot = lotAutorise(inv, req.body?.lot_id);
      if (!lot.ok || !lot.lotId) return res.status(400).json({ error: 'Indiquez le lot concerné par cette offre.' });
      const controle = validerSaisie(req.body);
      if (!controle.ok) return res.status(400).json({ error: controle.raison });

      const { data: lotLigne } = await supabaseAdmin
        .from('project_lots').select('lot_number, lot_title').eq('id', lot.lotId).eq('tenant_id', inv.tenant_id).maybeSingle();
      const recuLe = new Date();
      const horsDelai = estHorsDelai(recuLe, reglages.deadline_at);
      const version = await numeroVersion(inv, lot.lotId, 'saisie');
      const id = crypto.randomUUID();
      const { error } = await supabaseAdmin.from('consultation_depots').insert({
        id, tenant_id: inv.tenant_id, project_id: inv.project_id, invite_id: inv.id,
        entreprise_id: inv.entreprise_id, entreprise_nom: inv.entreprise_nom, lot_id: lot.lotId,
        kind: 'saisie', version, payload: controle.saisie, status: 'recu', hors_delai: horsDelai,
        received_at: recuLe.toISOString(),
      });
      if (error) throw error;

      const accuse = await apresDepot(ctx, recuLe, horsDelai, [{
        nom: `Offre HT : ${controle.saisie.montant_base.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[\u00a0\u202f]/g, ' ')} €`,
        kind: 'saisie',
        lotLibelle: lotLigne ? `Lot ${(lotLigne as any).lot_number} ${(lotLigne as any).lot_title}` : undefined,
      }]);
      res.status(201).json({ depot: { id, version }, hors_delai: horsDelai, recu_le: recuLe.toISOString(), accuse_envoye: accuse });
    } catch (e: any) {
      console.error('[POST /api/public/depot/:token/saisie]', e?.message);
      res.status(500).json({ error: "La saisie n'a pas pu être enregistrée. Merci de réessayer." });
    }
  });

  // ── Retrait d'un dépôt par l'entreprise ────────────────────────────────────
  // Possible tant que la date limite n'est pas passée et que l'architecte n'a
  // pas traité la remise. Le fichier reste sur le drive du cabinet (trace) ; il
  // cesse seulement d'être proposé à l'intégration.
  app.delete('/api/public/depot/:token/depots/:id', depotWriteLimiter, garde, async (req: any, res: any) => {
    const { invitation: inv, reglages } = req.depot as ContexteDepot;
    try {
      if (estHorsDelai(new Date(), reglages.deadline_at)) {
        return res.status(403).json({ error: "La date limite est passée : cette remise ne peut plus être retirée. Contactez le cabinet." });
      }
      const { data } = await supabaseAdmin
        .from('consultation_depots').select('id, status').eq('id', req.params.id).eq('invite_id', inv.id).maybeSingle();
      if (!data) return res.status(404).json({ error: 'Dépôt introuvable.' });
      if ((data as any).status !== 'recu') return res.status(409).json({ error: 'Cette remise a déjà été traitée par le cabinet.' });
      const { error } = await supabaseAdmin
        .from('consultation_depots').update({ status: 'retire', reviewed_at: new Date().toISOString() }).eq('id', req.params.id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (e: any) {
      console.error('[DELETE /api/public/depot/:token/depots/:id]', e?.message);
      res.status(500).json({ error: 'Le retrait a échoué.' });
    }
  });
}
