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
import { depotReadLimiter, depotWriteLimiter } from '../rateLimit';
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
      if (!publies.includes(req.params.docId)) return res.status(404).json({ error: 'Pièce introuvable.' });

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
