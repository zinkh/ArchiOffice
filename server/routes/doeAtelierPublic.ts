// Portail public du DOE : ce que voit et fait une entreprise avec son lien
// personnel. Aucun compte, aucun JWT : le jeton du lien est la seule barrière
// (haché en base, voir server/doe/tokens.ts). Le préfixe /api/public est
// exempté du middleware d'authentification de server.ts (AUTH_EXEMPT).
//
// Garanties :
//   1. à CHAQUE appel on revérifie le lien (révoqué, expiré) et que le cabinet
//      n'est pas suspendu ; un lien invalide donne toujours la même réponse ;
//   2. les octets sont contrôlés (signature, macros, scripts), jamais le nom ni
//      le type MIME annoncés ;
//   3. une entreprise ne voit et ne retire que SES documents, et seulement tant
//      que le maître d'œuvre ne les a pas analysés ;
//   4. un dépôt tardif n'est jamais refusé : un DOE se remet toujours, même en retard.
import crypto from 'crypto';
import multer from 'multer';
import type { Express } from 'express';
import { depotReadLimiter, depotWriteLimiter } from '../rateLimit';
import { loadSuspendedTenants } from '../tenantSuspension';
import { notifyUsers } from '../push';
import { destinatairesAffaire } from '../consultationDepot/notifications';
import { isValidEmail } from '../../src/lib/crDiffusion';
import { MAX_DEPOT_OCTETS, MAX_FICHIER_OCTETS, MAX_FICHIERS_PAR_DEPOT } from '../../src/lib/consultationDepot';
import {
  DOE_ACCEPT, DOE_EXTENSIONS, DOE_FORMATS_LIBELLE, DOE_PIECES, DOE_PIECE_LABELS, avisDocument, classerPiece,
  construireAccuseDepotDoe, controlerFichiersDoe, formatDoeAutorise, pieceConnue,
  type DoePieceKey, type ElementAccuseDoe,
} from '../../src/lib/doeAtelier';
import { chargerDossier, libelleLot } from '../doe/dossier';
import { verifierFichierDoe } from '../doe/fileRules';
import { envoyerMailCabinet, nomCabinet } from '../doe/mail';
import { enregistrerDocumentDoe, supprimerDocumentDoe } from '../doe/storage';
import { hacherJetonDoe, jetonDoePlausible } from '../doe/tokens';
import type { RemoveBusinessFile, StoreBusinessFile } from '../externalStorage/storeBusinessFile';

export interface RouteDeps {
  supabaseAdmin: any;
  checkQuota: (tenantId: string, resource: 'projects' | 'users' | 'documents') => Promise<void>;
  storeBusinessFile: StoreBusinessFile;
  removeBusinessFile: RemoveBusinessFile;
}

const MSG_LIEN = 'Ce lien est invalide ou a expiré. Contactez le cabinet pour en obtenir un nouveau.';
const MSG_INDISPONIBLE = 'Le dépôt est momentanément indisponible. Merci de contacter le cabinet.';

const televersement = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8',
  limits: { fileSize: MAX_FICHIER_OCTETS, files: MAX_FICHIERS_PAR_DEPOT, fields: 10, fieldSize: 4096 },
  fileFilter: (_req, file, cb) => {
    if (!formatDoeAutorise(file.originalname)) {
      return cb(new Error(`« ${file.originalname} » : format non accepté. Formats admis : ${DOE_FORMATS_LIBELLE}.`));
    }
    cb(null, true);
  },
}).array('files', MAX_FICHIERS_PAR_DEPOT);

export async function resoudreDemandeDoe(supabaseAdmin: any, jeton: unknown, now: Date = new Date()): Promise<any | null> {
  if (!jetonDoePlausible(jeton)) return null;
  const { data } = await supabaseAdmin.from('doe_requests').select('*').eq('token_hash', hacherJetonDoe(jeton)).maybeSingle();
  if (!data || (data as any).revoked_at) return null;
  if (new Date((data as any).expires_at).getTime() <= now.getTime()) return null;
  return { ...(data as any), lots_ids: Array.isArray((data as any).lots_ids) ? (data as any).lots_ids : [] };
}

/** État d'une pièce vu de l'entreprise. */
function etatPiece(documents: any[]): 'manquante' | 'recue' | 'validee' | 'a_corriger' {
  if (!documents.length) return 'manquante';
  if (documents.some(d => avisDocument(d.validation_status) === 'approved')) return 'validee';
  if (documents.some(d => avisDocument(d.validation_status) === 'pending')) return 'recue';
  return 'a_corriger';
}

export function registerDoeAtelierPublicRoutes(app: Express, deps: RouteDeps) {
  const { supabaseAdmin, checkQuota, storeBusinessFile, removeBusinessFile } = deps;

  const garde = async (req: any, res: any, next: any) => {
    try {
      const demande = await resoudreDemandeDoe(supabaseAdmin, req.params.token);
      if (!demande) return res.status(404).json({ error: MSG_LIEN, code: 'LIEN_INVALIDE' });
      const suspendus = await loadSuspendedTenants(supabaseAdmin);
      if (suspendus.has(demande.tenant_id)) return res.status(503).json({ error: MSG_INDISPONIBLE, code: 'DEPOT_INDISPONIBLE' });
      const { data: projet } = await supabaseAdmin.from('projects').select('id, name, project_code')
        .eq('id', demande.project_id).eq('tenant_id', demande.tenant_id).maybeSingle();
      if (!projet) return res.status(404).json({ error: MSG_LIEN, code: 'LIEN_INVALIDE' });
      req.doe = { demande, projet };
      next();
    } catch (e: any) {
      console.error('[public doe] garde', e?.message);
      res.status(500).json({ error: MSG_INDISPONIBLE });
    }
  };

  // ── Contexte du portail ────────────────────────────────────────────────────
  app.get('/api/public/doe/:token', depotReadLimiter, garde, async (req: any, res: any) => {
    try {
      const { demande, projet } = req.doe;
      const dossier = await chargerDossier(supabaseAdmin, demande.tenant_id, demande.project_id);
      const entreprise = dossier.entreprises.find(e => e.key === demande.entreprise_key);
      const documents = entreprise?.documents ?? [];
      const { data: agence } = await supabaseAdmin.from('settings')
        .select('agency_name, logo_url, address, email, phone').eq('tenant_id', demande.tenant_id).maybeSingle();

      const dernier = demande.last_opened_at ? new Date(demande.last_opened_at).getTime() : 0;
      if (Date.now() - dernier > 10 * 60 * 1000) {
        supabaseAdmin.from('doe_requests').update({ last_opened_at: new Date().toISOString() }).eq('id', demande.id).then(() => {}, () => {});
      }

      const visa = entreprise?.visa;
      res.json({
        operation: projet.name,
        entreprise: demande.entreprise_nom,
        cabinet: {
          nom: (agence as any)?.agency_name || null, logo: (agence as any)?.logo_url || null,
          adresse: (agence as any)?.address || null, email: (agence as any)?.email || null, telephone: (agence as any)?.phone || null,
        },
        lots: (entreprise?.lots ?? []).map(l => ({ id: l.id, libelle: libelleLot(l) })),
        deadline_at: dossier.reglages.deadline_at,
        en_retard: !!dossier.reglages.deadline_at && new Date(dossier.reglages.deadline_at).getTime() < Date.now(),
        instructions: dossier.reglages.instructions,
        statut: entreprise?.statut ?? 'sollicitee',
        pieces: DOE_PIECES.map(p => ({
          key: p.key, label: p.label, description: p.description, requise: dossier.requises.includes(p.key),
          etat: etatPiece(documents.filter(d => d.doe_piece === p.key)),
        })),
        documents: documents.map(d => ({
          id: d.id, nom: d.name, piece: d.doe_piece ?? null, lot_id: d.doe_lot_id ?? null,
          avis: avisDocument(d.validation_status), commentaire: d.validation_comments ?? null,
          recu_le: d.uploaded_at, taille: d.size_bytes ?? null,
          peut_retirer: d.doe_source === 'entreprise' && avisDocument(d.validation_status) === 'pending',
        })),
        visa: visa ? { numero: visa.numero, avis: visa.avis, observations: visa.observations ?? null, issued_at: visa.issued_at } : null,
        limites: {
          fichier_octets: MAX_FICHIER_OCTETS, depot_octets: MAX_DEPOT_OCTETS, fichiers_max: MAX_FICHIERS_PAR_DEPOT,
          extensions: DOE_EXTENSIONS, accept: DOE_ACCEPT, formats: DOE_FORMATS_LIBELLE,
        },
      });
    } catch (e: any) {
      console.error('[GET /api/public/doe/:token]', e?.message);
      res.status(500).json({ error: MSG_INDISPONIBLE });
    }
  });

  // ── Dépôt de fichiers ──────────────────────────────────────────────────────
  app.post('/api/public/doe/:token/fichiers', depotWriteLimiter, garde, (req: any, res: any, next: any) => {
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
    const { demande, projet } = req.doe;
    const fichiers: Express.Multer.File[] = req.files || [];
    try {
      const controle = controlerFichiersDoe(fichiers.map(f => ({ name: f.originalname, size: f.size })));
      if (!controle.ok) return res.status(400).json({ error: controle.raison });

      const lotId = typeof req.body?.lot_id === 'string' && req.body.lot_id.trim() ? req.body.lot_id.trim() : null;
      if (lotId && !demande.lots_ids.includes(lotId)) return res.status(400).json({ error: "Ce lot ne fait pas partie de votre dossier." });
      const pieceChoisie: DoePieceKey | null = pieceConnue(req.body?.doe_piece) ? req.body.doe_piece : null;

      // Contrôle des octets AVANT tout dépôt : un seul fichier refusé arrête le lot.
      const mimes: string[] = [];
      for (const f of fichiers) {
        const v = verifierFichierDoe(f.originalname, f.buffer);
        if (!v.ok) return res.status(400).json({ error: v.raison });
        mimes.push(v.mime);
      }
      try {
        await checkQuota(demande.tenant_id, 'documents');
      } catch {
        return res.status(503).json({ error: "Le cabinet ne peut pas recevoir de documents pour le moment. Merci de le contacter." });
      }

      const recuLe = new Date();
      const recus: any[] = [];
      const elements: ElementAccuseDoe[] = [];
      try {
        for (let i = 0; i < fichiers.length; i += 1) {
          const f = fichiers[i];
          // Sans pièce choisie, le nom du fichier peut la désigner ; sinon le document reste « non classé ».
          const reconnue = pieceChoisie ?? (() => { const c = classerPiece(f.originalname); return c && c.confiance >= 0.5 ? c.piece : null; })();
          const sha256 = crypto.createHash('sha256').update(f.buffer).digest('hex');
          const doc = await enregistrerDocumentDoe({ supabaseAdmin, storeBusinessFile }, {
            tenantId: demande.tenant_id, project: projet, entrepriseKey: demande.entreprise_key, entrepriseNom: demande.entreprise_nom,
            lotId, piece: reconnue, requestId: demande.id, source: 'entreprise', deposePar: `${demande.entreprise_nom} (lien DOE)`,
            fichier: { originalname: f.originalname, buffer: f.buffer, mimetype: mimes[i] },
          });
          recus.push({ id: doc.id, nom: f.originalname, piece: reconnue, taille: doc.size_bytes, sha256 });
          elements.push({ nom: f.originalname, pieceLabel: reconnue ? DOE_PIECE_LABELS[reconnue] : undefined, tailleOctets: doc.size_bytes, sha256 });
        }
      } catch (e: any) {
        console.error('[POST /api/public/doe/:token/fichiers]', e?.cause?.message || e?.message);
        if (recus.length) await apresDepot(demande, projet, recuLe, elements);
        return res.status(e?.status && e.status >= 400 ? e.status : 502).json({
          error: recus.length
            ? `Seuls ${recus.length} fichier(s) sur ${fichiers.length} ont pu être enregistrés. Renvoyez les autres dans quelques instants.`
            : "Le dépôt n'a pas pu être enregistré. Merci de réessayer dans quelques instants ou de contacter le cabinet.",
          deposes: recus,
        });
      }

      const accuse = await apresDepot(demande, projet, recuLe, elements);
      res.status(201).json({ depots: recus, recu_le: recuLe.toISOString(), accuse_envoye: accuse });
    } catch (e: any) {
      console.error('[POST /api/public/doe/:token/fichiers]', e?.message);
      res.status(500).json({ error: MSG_INDISPONIBLE });
    }
  });

  /** Accusé à l'entreprise et notification des personnes de l'affaire. Meilleur effort : un dépôt déjà enregistré ne se perd jamais pour un message raté. */
  async function apresDepot(demande: any, projet: any, recuLe: Date, elements: ElementAccuseDoe[]): Promise<boolean> {
    let accuse = false;
    try {
      if (isValidEmail(demande.email)) {
        const message = construireAccuseDepotDoe({
          cabinet: await nomCabinet(supabaseAdmin, demande.tenant_id), operation: projet.name || 'Opération',
          entreprise: demande.entreprise_nom, recuLe, elements,
        });
        accuse = (await envoyerMailCabinet(supabaseAdmin, demande.tenant_id, { to: demande.email, ...message })).ok;
      }
    } catch { /* meilleur effort */ }
    try {
      const n = elements.length;
      await notifyUsers(supabaseAdmin, demande.tenant_id, await destinatairesAffaire(supabaseAdmin, demande.tenant_id, demande.project_id), {
        title: 'DOE déposé',
        body: `${demande.entreprise_nom} a remis ${n} document${n > 1 ? 's' : ''} pour ${projet.name || "l'opération"}.`,
        url: `/projects/${demande.project_id}?tab=AOR`,
        category: 'Projets',
        tag: `doe-${demande.project_id}`,
      });
    } catch { /* meilleur effort */ }
    return accuse;
  }

  // ── Retrait d'un document par l'entreprise ─────────────────────────────────
  // Possible tant que le maître d'œuvre n'a pas donné d'avis dessus et que le
  // document vient bien du portail (jamais un document déposé par le cabinet).
  app.delete('/api/public/doe/:token/documents/:id', depotWriteLimiter, garde, async (req: any, res: any) => {
    const { demande } = req.doe;
    try {
      const { data } = await supabaseAdmin.from('documents').select('*')
        .eq('id', req.params.id).eq('tenant_id', demande.tenant_id).eq('project_id', demande.project_id)
        .eq('doc_type', 'DOE').eq('contact_id', demande.entreprise_key).maybeSingle();
      if (!data) return res.status(404).json({ error: 'Document introuvable.' });
      const doc = data as any;
      if (doc.doe_source !== 'entreprise' || avisDocument(doc.validation_status) !== 'pending') {
        return res.status(409).json({ error: 'Ce document a déjà été analysé par le cabinet : il ne peut plus être retiré.' });
      }
      await supprimerDocumentDoe({ supabaseAdmin, removeBusinessFile }, demande.tenant_id, doc);
      res.json({ ok: true });
    } catch (e: any) {
      console.error('[DELETE /api/public/doe/:token/documents/:id]', e?.message);
      res.status(500).json({ error: 'Le retrait a échoué.' });
    }
  });
}
