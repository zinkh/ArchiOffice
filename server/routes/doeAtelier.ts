// Atelier DOE (onglet AOR), côté cabinet : état de l'opération, réglages,
// sollicitation et relance des entreprises, analyse des documents reçus, visas,
// archive transmise au maître d'ouvrage. Le côté entreprise (public, par jeton)
// est dans doeAtelierPublic.ts.
//
// Principes :
//   - le statut d'une entreprise se DÉDUIT (server/doe/dossier.ts), jamais saisi ;
//   - une analyse SUGGÈRE (pièce reconnue, anomalies) : seul l'architecte donne
//     l'avis sur un document, et c'est lui qui émet le visa ;
//   - le visa est numéroté par une séquence atomique, figé (photographie des
//     pièces) et déposé comme document de l'affaire ;
//   - rien n'est envoyé au maître d'ouvrage sans geste explicite.
import crypto from 'crypto';
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';
import { handleDocumentUpload } from '../documentUpload';
import { aiGenerationLimiter } from '../rateLimit';
import { isValidEmail } from '../../src/lib/crDiffusion';
import {
  DOE_PIECE_LABELS, analyserDocument, avisDocument, avisVisaValide, construireMessageVisa, intervalleRelance, maxRelances,
  numeroVisa, pieceConnue,
  type DoeAvisVisa, type DoePieceKey,
} from '../../src/lib/doeAtelier';
import type { PieceVisee } from '../../src/lib/doePdf';
import type { RemoveBusinessFile, StoreBusinessFile } from '../externalStorage/storeBusinessFile';
import { lireTexteDepot } from '../consultationDepot/analyse';
import { ArchiveTropGrosse, construireArchive } from '../doe/archive';
import { chargerDossier, demandePublique, libelleLot, piecesConcernees, tableAbsente, type DossierDoe, type EntrepriseDossier } from '../doe/dossier';
import { envoyerMailCabinet, nomCabinet } from '../doe/mail';
import { construireVisaPdf } from '../doe/pdf';
import { emettreDemande, type ModeDemande } from '../doe/relances';
import { dossierDoe, enregistrerDocumentDoe, lireFichierStocke } from '../doe/storage';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  checkQuota: (tenantId: string, resource: 'projects' | 'users' | 'documents') => Promise<void>;
  storeBusinessFile: StoreBusinessFile;
  removeBusinessFile: RemoveBusinessFile;
}

const MAX_CONSIGNES = 4000;
const MAX_OBSERVATIONS = 4000;
const MAX_COMMENTAIRE = 2000;
const MIGRATION_ABSENTE = "L'atelier DOE n'est pas disponible sur cette instance (migration non jouée).";
/** Au-delà, une archive ne part plus en pièce jointe d'un e-mail. */
const MAX_PIECE_JOINTE_OCTETS = 20 * 1024 * 1024;
const MAX_DOCUMENTS_ANALYSES = 25;
const MAX_LECTURE_ANALYSE_OCTETS = 25 * 1024 * 1024;
const DELAI_LECTURE_MS = 20_000;
const MODES_PUBLICS: ModeDemande[] = ['sollicitation', 'relance', 'lien'];

const docPublic = (d: any) => ({
  id: d.id, name: d.name, doe_piece: d.doe_piece ?? null, doe_lot_id: d.doe_lot_id ?? null, doe_source: d.doe_source ?? null,
  validation_status: avisDocument(d.validation_status), validation_comments: d.validation_comments ?? null,
  uploaded_at: d.uploaded_at, uploaded_by: d.uploaded_by ?? null, size_bytes: d.size_bytes ?? null,
  file_url: d.file_url, contact_id: d.contact_id ?? null,
});

const visaPublic = (v: any, documents: Map<string, any>) => ({
  id: v.id, numero: v.numero, avis: v.avis, observations: v.observations ?? null, issued_at: v.issued_at,
  issued_by_name: v.issued_by_name ?? null, sent_at: v.sent_at ?? null, document_id: v.document_id ?? null,
  file_url: v.document_id ? documents.get(v.document_id)?.file_url ?? null : null,
});

export function registerDoeAtelierRoutes(app: Express, deps: RouteDeps) {
  const { supabaseAdmin, getTenantId, getUserName, checkQuota, storeBusinessFile, removeBusinessFile } = deps;

  /** L'opération du cabinet, ou une réponse 404 déjà envoyée. */
  async function operation(req: any, res: any, tenantId: string): Promise<any | null> {
    const { data } = await supabaseAdmin.from('projects').select('*')
      .eq('id', req.params.projectId).eq('tenant_id', tenantId).maybeSingle();
    if (!data) { res.status(404).json({ error: 'Opération introuvable.' }); return null; }
    return data;
  }

  /** L'atelier disponible, ou une réponse 503 déjà envoyée (instance dont la migration n'est pas jouée). */
  function exigerDisponible(dossier: DossierDoe, res: any): boolean {
    if (dossier.disponible) return true;
    res.status(503).json({ error: MIGRATION_ABSENTE, code: 'doe_indisponible' });
    return false;
  }

  const trouverEntreprise = (dossier: DossierDoe, cle: unknown): EntrepriseDossier | null =>
    typeof cle === 'string' ? dossier.entreprises.find(e => e.key === cle) ?? null : null;

  // ── État de l'opération ────────────────────────────────────────────────────
  app.get('/api/projects/:projectId/doe', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projet = await operation(req, res, tenantId);
      if (!projet) return;
      const dossier = await chargerDossier(supabaseAdmin, tenantId, projet.id);

      const idsVisas = dossier.entreprises.flatMap(e => e.visas.map(v => v.document_id)).filter(Boolean);
      const documentsVisas = new Map<string, any>();
      if (idsVisas.length) {
        const { data } = await supabaseAdmin.from('documents').select('id, file_url').eq('tenant_id', tenantId).in('id', idsVisas);
        for (const d of (data as any[]) || []) documentsVisas.set(d.id, d);
      }
      const { data: archives } = await supabaseAdmin.from('documents').select('*')
        .eq('tenant_id', tenantId).eq('project_id', projet.id).eq('doc_type', 'DOE_ARCHIVE');

      res.json({
        disponible: dossier.disponible,
        reglages: dossier.reglages,
        requises: dossier.requises,
        synthese: dossier.synthese,
        archive_prete: dossier.archive_prete,
        entreprises: dossier.entreprises.map(e => ({
          key: e.key, nom: e.nom, contact_id: e.contact_id, email: e.email, lots: e.lots,
          request: demandePublique(e.request), statut: e.statut, couverture: e.couverture,
          avis_suggere: e.avis_suggere, prochaine_relance: e.prochaine_relance,
          documents: e.documents.map(docPublic),
          visa: e.visa ? visaPublic(e.visa, documentsVisas) : null,
          visas: e.visas.map(v => visaPublic(v, documentsVisas)),
        })),
        non_affectes: dossier.non_affectes.map(docPublic),
        archives: ((archives as any[]) || [])
          .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())
          .map(a => ({ id: a.id, name: a.name, size_bytes: a.size_bytes ?? null, uploaded_at: a.uploaded_at, uploaded_by: a.uploaded_by ?? null, file_url: a.file_url })),
        moa: { nom: projet.client ?? null, email: isValidEmail(projet.client_email) ? projet.client_email : null },
      });
    } catch (e: any) {
      console.error('[GET doe]', e?.message);
      res.status(500).json({ error: "Lecture de l'atelier DOE impossible." });
    }
  });

  // ── Réglages ───────────────────────────────────────────────────────────────
  app.put('/api/projects/:projectId/doe/settings', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projet = await operation(req, res, tenantId);
      if (!projet) return;
      const b = req.body || {};

      let deadline: string | null = null;
      if (b.deadline_at !== null && b.deadline_at !== undefined && b.deadline_at !== '') {
        const d = new Date(b.deadline_at);
        if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Date limite invalide.' });
        deadline = d.toISOString();
      }
      const pieces = Array.isArray(b.required_pieces) ? b.required_pieces.filter(pieceConnue) : null;
      const payload = {
        deadline_at: deadline,
        instructions: typeof b.instructions === 'string' && b.instructions.trim() ? b.instructions.trim().slice(0, MAX_CONSIGNES) : null,
        required_pieces: pieces && pieces.length ? [...new Set<DoePieceKey>(pieces)] : null,
        reminder_enabled: b.reminder_enabled !== false,
        reminder_interval_days: intervalleRelance({ reminder_interval_days: Number(b.reminder_interval_days) }),
        reminder_max: maxRelances({ reminder_max: b.reminder_max === undefined ? undefined : Number(b.reminder_max) }),
        updated_at: new Date().toISOString(),
      };

      const { data: existant, error: errLecture } = await supabaseAdmin.from('doe_settings').select('id')
        .eq('tenant_id', tenantId).eq('project_id', projet.id).maybeSingle();
      if (errLecture) {
        if (tableAbsente(errLecture)) return res.status(503).json({ error: MIGRATION_ABSENTE });
        throw errLecture;
      }
      const ecriture = existant
        ? await supabaseAdmin.from('doe_settings').update(payload).eq('id', (existant as any).id).eq('tenant_id', tenantId)
        : await supabaseAdmin.from('doe_settings').insert({ id: crypto.randomUUID(), tenant_id: tenantId, project_id: projet.id, ...payload });
      if (ecriture.error) throw ecriture.error;
      res.json(payload);
    } catch (e: any) {
      console.error('[PUT doe/settings]', e?.message);
      res.status(500).json({ error: "Les réglages n'ont pas pu être enregistrés." });
    }
  });

  // ── Sollicitation, relance, lien ───────────────────────────────────────────
  app.post('/api/projects/:projectId/doe/requests', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projet = await operation(req, res, tenantId);
      if (!projet) return;
      const mode: ModeDemande = MODES_PUBLICS.includes(req.body?.mode) ? req.body.mode : 'sollicitation';
      const dossier = await chargerDossier(supabaseAdmin, tenantId, projet.id);
      if (!exigerDisponible(dossier, res)) return;
      const entreprise = trouverEntreprise(dossier, req.body?.entreprise_key);
      if (!entreprise) return res.status(404).json({ error: 'Entreprise introuvable pour cette opération.' });

      const r = await emettreDemande(supabaseAdmin, {
        tenantId, projectId: projet.id, projet, dossier, entreprise, mode, email: req.body?.email, userId: req.user.id,
      });
      if (!r.ok) return res.status(r.status || 500).json({ error: r.raison });
      res.status(201).json({ ok: true, envoye: r.envoye, url: r.url, demande: demandePublique(r.demande) });
    } catch (e: any) {
      console.error('[POST doe/requests]', e?.message);
      res.status(500).json({ error: "La demande n'a pas pu être envoyée." });
    }
  });

  // Sollicite d'un coup toutes les entreprises encore « à solliciter » qui ont une adresse.
  app.post('/api/projects/:projectId/doe/requests/tout-solliciter', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projet = await operation(req, res, tenantId);
      if (!projet) return;
      const dossier = await chargerDossier(supabaseAdmin, tenantId, projet.id);
      if (!exigerDisponible(dossier, res)) return;
      const envoyees: string[] = [];
      const sansAdresse: string[] = [];
      const echecs: Array<{ entreprise: string; raison?: string }> = [];
      for (const entreprise of dossier.entreprises.filter(e => e.statut === 'a_solliciter' && e.lots.length)) {
        if (!isValidEmail(entreprise.email)) { sansAdresse.push(entreprise.nom); continue; }
        const r = await emettreDemande(supabaseAdmin, {
          tenantId, projectId: projet.id, projet, dossier, entreprise, mode: 'sollicitation', userId: req.user.id,
        });
        if (r.ok) envoyees.push(entreprise.nom); else echecs.push({ entreprise: entreprise.nom, raison: r.raison });
      }
      res.json({ envoyees, sans_adresse: sansAdresse, echecs });
    } catch (e: any) {
      console.error('[POST doe/requests/tout-solliciter]', e?.message);
      res.status(500).json({ error: "Les demandes n'ont pas pu être envoyées." });
    }
  });

  app.delete('/api/projects/:projectId/doe/requests/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('doe_requests').update({ revoked_at: new Date().toISOString() })
        .eq('id', req.params.id).eq('project_id', req.params.projectId).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ ok: true });
    } catch (e: any) {
      console.error('[DELETE doe/requests]', e?.message);
      res.status(500).json({ error: "Le lien n'a pas pu être révoqué." });
    }
  });

  // ── Documents ──────────────────────────────────────────────────────────────

  // Dépôt par le cabinet, pour une entreprise qui a envoyé ses pièces par un autre canal.
  app.post('/api/projects/:projectId/doe/documents', handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projet = await operation(req, res, tenantId);
      if (!projet) return;
      if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
      const dossier = await chargerDossier(supabaseAdmin, tenantId, projet.id);
      const entreprise = trouverEntreprise(dossier, req.body?.entreprise_key);
      if (!entreprise) return res.status(400).json({ error: "Choisissez l'entreprise concernée." });
      const lotId = typeof req.body?.lot_id === 'string' && req.body.lot_id ? req.body.lot_id : null;
      if (lotId && !entreprise.lots.some(l => l.id === lotId)) return res.status(400).json({ error: "Ce lot n'est pas celui de l'entreprise." });
      await checkQuota(tenantId, 'documents');
      const piece: DoePieceKey | null = pieceConnue(req.body?.doe_piece) ? req.body.doe_piece : null;
      const doc = await enregistrerDocumentDoe({ supabaseAdmin, storeBusinessFile }, {
        tenantId, project: projet, entrepriseKey: entreprise.key, entrepriseNom: entreprise.nom, lotId, piece,
        requestId: entreprise.request?.id ?? null, source: 'cabinet',
        deposePar: await getUserName(tenantId, req.user.id, req.user.email),
        fichier: { originalname: req.file.originalname, buffer: req.file.buffer, mimetype: req.file.mimetype },
      });
      res.status(201).json(docPublic(doc));
    } catch (e: any) {
      console.error('[POST doe/documents]', e?.message);
      res.status(e?.status || 500).json({ error: e?.status ? e.message : "Le document n'a pas pu être enregistré." });
    }
  });

  // Classement et avis sur un document : l'équivalent, pour le DOE, de l'avis d'un visa.
  app.put('/api/doe/documents/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: doc } = await supabaseAdmin.from('documents').select('*')
        .eq('id', req.params.id).eq('tenant_id', tenantId).eq('doc_type', 'DOE').maybeSingle();
      if (!doc) return res.status(404).json({ error: 'Document introuvable.' });
      const b = req.body || {};
      const maj: Record<string, any> = {};

      if (b.doe_piece !== undefined) {
        if (b.doe_piece !== null && !pieceConnue(b.doe_piece)) return res.status(400).json({ error: 'Pièce inconnue.' });
        maj.doe_piece = b.doe_piece;
      }
      if (b.validation_status !== undefined) {
        if (!['pending', 'approved', 'commented', 'rejected'].includes(b.validation_status)) return res.status(400).json({ error: 'Avis inconnu.' });
        maj.validation_status = b.validation_status;
      }
      if (b.validation_comments !== undefined) {
        maj.validation_comments = typeof b.validation_comments === 'string' ? b.validation_comments.trim().slice(0, MAX_COMMENTAIRE) || null : null;
      }
      if (b.entreprise_key !== undefined) {
        const dossier = await chargerDossier(supabaseAdmin, tenantId, (doc as any).project_id);
        const e = trouverEntreprise(dossier, b.entreprise_key);
        if (!e) return res.status(400).json({ error: 'Entreprise introuvable pour cette opération.' });
        maj.contact_id = e.key;
        maj.contact_name = e.nom;
      }
      if (!Object.keys(maj).length) return res.status(400).json({ error: 'Rien à modifier.' });

      const { data, error } = await supabaseAdmin.from('documents').update(maj)
        .eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(docPublic(data));
    } catch (e: any) {
      console.error('[PUT doe/documents/:id]', e?.message);
      res.status(500).json({ error: "Le document n'a pas pu être modifié." });
    }
  });

  // ── Analyse ────────────────────────────────────────────────────────────────
  // Lecture locale du texte (PDF, Word, tableur, ODT), sans modèle ni coût. Elle
  // reconnaît la pièce, classe les documents non classés quand elle est assez
  // sûre et signale des anomalies. Elle ne donne JAMAIS d'avis : c'est l'architecte.
  async function analyser(tenantId: string, docs: any[], autres: any[]) {
    const resultats: any[] = [];
    for (const doc of docs.slice(0, MAX_DOCUMENTS_ANALYSES)) {
      const ext = String(doc.name || '').split('.').pop()?.toLowerCase() || '';
      let texte: string | null | undefined;
      if (['pdf', 'docx', 'xlsx', 'ods', 'odt'].includes(ext)) {
        const buffer = await lireFichierStocke(supabaseAdmin, tenantId, doc.file_url, MAX_LECTURE_ANALYSE_OCTETS);
        if (buffer) {
          try {
            texte = await Promise.race([
              lireTexteDepot(doc.name, buffer),
              new Promise<never>((_, rejeter) => setTimeout(() => rejeter(new Error('délai')), DELAI_LECTURE_MS)),
            ]);
          } catch { texte = null; }
        }
      }
      const a = analyserDocument(doc, texte, autres);
      let applique = false;
      if (!pieceConnue(doc.doe_piece) && a.classement && a.classement.confiance >= 0.5) {
        const { error } = await supabaseAdmin.from('documents').update({ doe_piece: a.classement.piece })
          .eq('id', doc.id).eq('tenant_id', tenantId);
        if (!error) { applique = true; doc.doe_piece = a.classement.piece; }
      }
      resultats.push({ id: doc.id, name: doc.name, ...a, doe_piece: doc.doe_piece ?? null, classement_applique: applique });
    }
    return resultats;
  }

  app.post('/api/projects/:projectId/doe/analyser', aiGenerationLimiter, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projet = await operation(req, res, tenantId);
      if (!projet) return;
      const dossier = await chargerDossier(supabaseAdmin, tenantId, projet.id);
      const entreprise = trouverEntreprise(dossier, req.body?.entreprise_key);
      if (!entreprise) return res.status(404).json({ error: 'Entreprise introuvable pour cette opération.' });
      const docs = entreprise.documents.filter(d => avisDocument(d.validation_status) !== 'rejected' || req.body?.tout === true);
      res.json({ resultats: await analyser(tenantId, docs, entreprise.documents) });
    } catch (e: any) {
      console.error('[POST doe/analyser]', e?.message);
      res.status(500).json({ error: "L'analyse a échoué." });
    }
  });

  // ── Visa ───────────────────────────────────────────────────────────────────
  app.post('/api/projects/:projectId/doe/visas', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projet = await operation(req, res, tenantId);
      if (!projet) return;
      const b = req.body || {};
      if (!avisVisaValide(b.avis)) return res.status(400).json({ error: "Choisissez l'avis du visa." });
      const avis: DoeAvisVisa = b.avis;
      const observations = typeof b.observations === 'string' && b.observations.trim() ? b.observations.trim().slice(0, MAX_OBSERVATIONS) : null;

      const dossier = await chargerDossier(supabaseAdmin, tenantId, projet.id);
      if (!exigerDisponible(dossier, res)) return;
      const entreprise = trouverEntreprise(dossier, b.entreprise_key);
      if (!entreprise) return res.status(404).json({ error: 'Entreprise introuvable pour cette opération.' });
      if (!entreprise.documents.length) return res.status(409).json({ error: "Cette entreprise n'a remis aucun document : il n'y a rien à viser." });

      // Un visa favorable atteste un dossier complet et contrôlé.
      if (avis !== 'defavorable') {
        if (entreprise.couverture.manquantes.length) {
          return res.status(409).json({
            error: `Des pièces exigées manquent : ${entreprise.couverture.manquantes.map(k => DOE_PIECE_LABELS[k]).join(' ; ')}. Émettez un visa défavorable ou attendez-les.`,
            code: 'pieces_manquantes',
          });
        }
        if (entreprise.documents.some(d => avisDocument(d.validation_status) === 'pending')) {
          return res.status(409).json({ error: 'Des documents restent à analyser : donnez un avis sur chacun avant de viser le dossier.', code: 'documents_a_analyser' });
        }
      }

      const emisPar = await getUserName(tenantId, req.user.id, req.user.email);
      const maintenant = new Date();

      // Photographie du dossier au moment du visa.
      const pieces: PieceVisee[] = piecesConcernees(entreprise, dossier.requises).map(k => {
        const docs = entreprise.documents.filter(d => d.doe_piece === k);
        return {
          piece: k, label: DOE_PIECE_LABELS[k], requise: dossier.requises.includes(k),
          statut: entreprise.couverture.validees.includes(k) ? 'validee' as const
            : entreprise.couverture.enAttente.includes(k) ? 'en_attente' as const : 'manquante' as const,
          documents: docs.map(d => ({
            nom: d.name, avis: avisDocument(d.validation_status), commentaire: d.validation_comments, recu_le: d.uploaded_at,
          })),
        };
      });
      const nonClasses = entreprise.documents.filter(d => !pieceConnue(d.doe_piece));
      if (nonClasses.length) {
        pieces.push({
          piece: 'autre', label: 'Documents non classés', requise: false, statut: 'en_attente',
          documents: nonClasses.map(d => ({ nom: d.name, avis: avisDocument(d.validation_status), commentaire: d.validation_comments, recu_le: d.uploaded_at })),
        });
      }

      // Le numéro est RÉSERVÉ par l'insertion de la ligne : l'index unique (cabinet,
      // numéro) départage deux visas simultanés, le perdant reprend le numéro suivant.
      const annee = maintenant.getFullYear();
      const visa = {
        id: crypto.randomUUID(), tenant_id: tenantId, project_id: projet.id, entreprise_key: entreprise.key,
        entreprise_nom: entreprise.nom, numero: '', avis, observations, pieces,
        issued_at: maintenant.toISOString(), issued_by: req.user.id, issued_by_name: emisPar,
        document_id: null as string | null, sent_at: null as string | null,
      };
      for (let essai = 0; ; essai += 1) {
        const { data: existants, error: errLecture } = await supabaseAdmin.from('doe_visas').select('numero').eq('tenant_id', tenantId);
        if (errLecture) {
          if (tableAbsente(errLecture)) return res.status(503).json({ error: MIGRATION_ABSENTE });
          throw errLecture;
        }
        const prefixe = `DOE-${annee}-`;
        const dernier = Math.max(0, ...((existants as any[]) || [])
          .filter(v => String(v.numero).startsWith(prefixe)).map(v => parseInt(String(v.numero).slice(prefixe.length), 10) || 0));
        visa.numero = numeroVisa(dernier + 1, annee);
        const { error: errReserve } = await supabaseAdmin.from('doe_visas').insert(visa);
        if (!errReserve) break;
        if (errReserve.code !== '23505' || essai >= 5) throw errReserve;
      }
      const numero = visa.numero;
      const annulerVisa = () => supabaseAdmin.from('doe_visas').delete().eq('id', visa.id).eq('tenant_id', tenantId);

      let pdf: Buffer;
      let idDocument: string;
      let stocke: { fileUrl: string };
      const nomPdf = `Visa ${numero} - ${entreprise.nom}.pdf`;
      try {
        pdf = await construireVisaPdf(supabaseAdmin, tenantId, projet.id, {
          numero, issued_at: visa.issued_at, avis, observations, entreprise: entreprise.nom,
          lots: entreprise.lots.map(libelleLot), pieces, emisPar,
        });
        await checkQuota(tenantId, 'documents');
        idDocument = crypto.randomUUID();
        const depose = await storeBusinessFile({
          tenantId, bucket: 'documents', folderPath: [...dossierDoe(projet, entreprise.nom).slice(0, -1), 'Visas'],
          fileName: nomPdf, supabasePath: `${tenantId}/${projet.id}/AOR/${idDocument}/${nomPdf.replace(/[^A-Za-z0-9._-]+/g, '_')}`,
        }, pdf, 'application/pdf');
        stocke = depose;
        const { error: errDoc } = await supabaseAdmin.from('documents').insert({
          id: idDocument, tenant_id: tenantId, project_id: projet.id, resource_type: 'projects', resource_id: projet.id,
          name: nomPdf, category: 'DOE', phase: 'AOR', version: 1, file_url: depose.fileUrl, storage_backend: depose.storageBackend,
          mime_type: 'application/pdf', size_bytes: depose.sizeBytes, uploaded_by: emisPar, uploaded_at: visa.issued_at,
          indice: 'A', doc_statut: 'en_cours', doc_type: 'DOE_VISA', contact_id: entreprise.key, contact_name: entreprise.nom,
          validation_status: 'approved',
        });
        if (errDoc) throw errDoc;
        const { error: errLien } = await supabaseAdmin.from('doe_visas').update({ document_id: idDocument }).eq('id', visa.id).eq('tenant_id', tenantId);
        if (errLien) throw errLien;
        visa.document_id = idDocument;
      } catch (e) {
        // Aucun visa sans pièce : le numéro réservé est rendu.
        await annulerVisa();
        throw e;
      }

      // Envoi à l'entreprise, à la demande. Un visa défavorable porte un lien de
      // dépôt pour qu'elle corrige : la demande est renouvelée sans compter une relance.
      let envoye = false;
      let raison: string | undefined;
      if (b.envoyer === true) {
        const adresse = isValidEmail(b.email) ? String(b.email).trim() : entreprise.email;
        if (!isValidEmail(adresse)) {
          raison = `Aucune adresse e-mail pour ${entreprise.nom} : le visa est émis mais n'a pas été envoyé.`;
        } else {
          let lien = '';
          if (avis === 'defavorable') {
            const r = await emettreDemande(supabaseAdmin, {
              tenantId, projectId: projet.id, projet, dossier, entreprise, mode: 'visa', email: adresse, userId: req.user.id,
            });
            lien = r.url ?? '';
          }
          const message = construireMessageVisa({
            cabinet: await nomCabinet(supabaseAdmin, tenantId), operation: projet.name || 'Opération',
            entreprise: entreprise.nom, avis, observations, lien, numero,
          });
          const envoi = await envoyerMailCabinet(supabaseAdmin, tenantId, {
            to: String(adresse), ...message, attachments: [{ filename: nomPdf, content: pdf, contentType: 'application/pdf' }],
          });
          envoye = envoi.ok;
          if (envoi.ok) {
            visa.sent_at = new Date().toISOString();
            await supabaseAdmin.from('doe_visas').update({ sent_at: visa.sent_at }).eq('id', visa.id).eq('tenant_id', tenantId);
          } else raison = envoi.raison;
        }
      }

      res.status(201).json({
        visa: { id: visa.id, numero, avis, observations, issued_at: visa.issued_at, issued_by_name: emisPar, sent_at: visa.sent_at, document_id: idDocument, file_url: stocke.fileUrl },
        envoye, raison,
      });
    } catch (e: any) {
      console.error('[POST doe/visas]', e?.message);
      res.status(e?.status || 500).json({ error: e?.status ? e.message : "Le visa n'a pas pu être émis." });
    }
  });

  // ── Archive pour le maître d'ouvrage ───────────────────────────────────────
  app.post('/api/projects/:projectId/doe/archive', aiGenerationLimiter, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projet = await operation(req, res, tenantId);
      if (!projet) return;
      const b = req.body || {};
      const dossier = await chargerDossier(supabaseAdmin, tenantId, projet.id);
      if (!exigerDisponible(dossier, res)) return;

      const inclureNonVises = b.inclure_non_vises === true;
      const nonVisees = dossier.entreprises.filter(e => e.statut !== 'vise');
      const visees = dossier.entreprises.length - nonVisees.length;
      if (!inclureNonVises && visees === 0) {
        return res.status(409).json({ error: "Aucun dossier n'est encore visé : il n'y a rien à transmettre.", code: 'aucun_dossier_vise' });
      }
      if (!inclureNonVises && nonVisees.length && b.confirmer_partiel !== true) {
        return res.status(409).json({
          error: `${nonVisees.length} dossier(s) ne sont pas visés et ne figureront pas dans l'archive.`,
          code: 'dossiers_non_vises', entreprises: nonVisees.map(e => e.nom),
        });
      }
      const destinataire = isValidEmail(b.destinataire) ? String(b.destinataire).trim() : null;
      if (b.envoyer === true && !destinataire) return res.status(400).json({ error: "Indiquez l'adresse e-mail du maître d'ouvrage." });

      const archive = await construireArchive(supabaseAdmin, tenantId, projet.id, dossier, {
        inclurePlans: b.inclure_plans !== false, plansTous: b.plans_tous === true, inclureNonVises, destinataire,
      });

      await checkQuota(tenantId, 'documents');
      const deposePar = await getUserName(tenantId, req.user.id, req.user.email);
      const id = crypto.randomUUID();
      const stocke = await storeBusinessFile({
        tenantId, bucket: 'documents', folderPath: [...dossierDoe(projet, 'x').slice(0, -1), 'Archives'],
        fileName: archive.nom, supabasePath: `${tenantId}/${projet.id}/AOR/${id}/${archive.nom.replace(/[^A-Za-z0-9._-]+/g, '_')}`,
      }, archive.buffer, 'application/zip');
      const uploadedAt = new Date().toISOString();
      const { error } = await supabaseAdmin.from('documents').insert({
        id, tenant_id: tenantId, project_id: projet.id, resource_type: 'projects', resource_id: projet.id,
        name: archive.nom, category: 'DOE', phase: 'AOR', version: 1, file_url: stocke.fileUrl, storage_backend: stocke.storageBackend,
        mime_type: 'application/zip', size_bytes: stocke.sizeBytes, uploaded_by: deposePar, uploaded_at: uploadedAt,
        description: `Archive DOE transmise au maître d'ouvrage (${archive.fichiers} fichiers).`,
        indice: 'A', doc_statut: 'en_cours', doc_type: 'DOE_ARCHIVE',
      });
      if (error) throw error;

      let envoye = false;
      let raison: string | undefined;
      if (b.envoyer === true && destinataire) {
        if (archive.buffer.length > MAX_PIECE_JOINTE_OCTETS) {
          raison = "L'archive est trop volumineuse pour partir en pièce jointe : téléchargez-la et transmettez-la par votre espace de partage.";
        } else {
          const cabinet = await nomCabinet(supabaseAdmin, tenantId);
          const envoi = await envoyerMailCabinet(supabaseAdmin, tenantId, {
            to: destinataire,
            subject: `Dossier des ouvrages exécutés : ${projet.name || 'Opération'}`,
            html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111"><p>Bonjour,</p>
<p>Veuillez trouver ci-joint le dossier des ouvrages exécutés de l'opération <strong>${String(projet.name || '').replace(/</g, '&lt;')}</strong> : les plans de la maîtrise d'œuvre, les DOE des entreprises, leurs visas et le bordereau de transmission.</p>
<p>Cordialement,<br>${cabinet.replace(/</g, '&lt;')}</p></div>`,
            attachments: [{ filename: archive.nom, content: archive.buffer, contentType: 'application/zip' }],
          });
          envoye = envoi.ok;
          if (!envoi.ok) raison = envoi.raison;
        }
      }

      res.status(201).json({
        document: { id, name: archive.nom, size_bytes: stocke.sizeBytes, uploaded_at: uploadedAt, file_url: stocke.fileUrl },
        fichiers: archive.fichiers, ignores: archive.ignores, reserves: archive.reserves, envoye, raison,
      });
    } catch (e: any) {
      console.error('[POST doe/archive]', e?.message);
      if (e instanceof ArchiveTropGrosse) return res.status(413).json({ error: e.message, code: 'archive_trop_grosse' });
      res.status(e?.status || 500).json({ error: e?.status ? e.message : "L'archive n'a pas pu être constituée." });
    }
  });
}
