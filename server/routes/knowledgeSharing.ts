/**
 * Contributions volontaires, anonymisées, revues et confirmées avant publication.
 * Les fichiers originaux restent privés. Un journal durable permet la suppression
 * distante même après suppression locale ou retrait du consentement.
 */
import type { Express } from 'express';
import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import { DEFAULT_KNOWLEDGE_LIBRARY_ID, makeMistralLibraryClient } from '../knowledge/mistralLibrary';
import { flushPendingMistralDeletions, processRemoteDeletion } from '../knowledge/mistralLifecycle';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { isOwnStorageRef } from '../externalStorage/externalRef';
import { anonymizeTechnicalText, MAX_SHARED_EXCERPT_CHARS } from '../knowledge/anonymize';

export interface KnowledgeSharingDeps {
  supabaseAdmin: any;
  requireTenantAdmin: (userId: string) => Promise<string>;
}

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

export function registerKnowledgeSharingRoutes(app: Express, deps: KnowledgeSharingDeps) {
  const { supabaseAdmin, requireTenantAdmin } = deps;
  const guarded = (handler: (req: any, res: any, tenantId: string) => Promise<any>) =>
    async (req: any, res: any) => {
      try {
        const tenantId = await requireTenantAdmin(req.user.id);
        await handler(req, res, tenantId);
      } catch (error: any) {
        if (!res.headersSent) res.status(error.status || 500).json({
          error: error.status ? error.message : 'Opération sur la bibliothèque impossible.',
        });
      }
    };

  async function getPreference(tenantId: string): Promise<boolean> {
    const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_sharing_preferences')
      .select('opted_in').maybeSingle();
    if (error) throw error;
    return data?.opted_in === true;
  }

  app.get('/api/knowledge-sharing', guarded(async (_req, res, tenantId) => {
    const [preference, contributions, publications] = await Promise.all([
      getPreference(tenantId),
      tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions')
        .select('id,document_id,status,sanitized_text,warnings,reviewed_at,created_at')
        .order('created_at', { ascending: false }).limit(100),
      tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_remote_documents')
        .select('contribution_id,remote_document_id,state,deletion_requested_at,deleted_at,created_at')
        .order('created_at', { ascending: false }).limit(200),
    ]);
    if (contributions.error) throw contributions.error;
    if (publications.error) throw publications.error;
    res.json({
      opted_in: preference, contributions: contributions.data || [],
      publications: publications.data || [],
      publication_active: process.env.MISTRAL_KNOWLEDGE_PUBLISH_ENABLED === 'true',
    });
  }));

  app.put('/api/knowledge-sharing/consent', guarded(async (req, res, tenantId) => {
    if (typeof req.body?.opted_in !== 'boolean') {
      return res.status(400).json({ error: 'Le choix doit être explicite (true ou false).' });
    }
    const optedIn = req.body.opted_in;
    const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_sharing_preferences')
      .upsert({ tenant_id: tenantId, opted_in: optedIn, updated_by: req.user.id, updated_at: new Date().toISOString() },
        { onConflict: 'tenant_id' });
    if (error) throw error;
    // Désactivation d'abord : la lecture de ce flag reste le verrou de
    // publication, même si l'effacement des brouillons rencontre une erreur.
    if (!optedIn) {
      const deleted = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions').delete().neq('status', '__none__');
      if (deleted.error) throw deleted.error;
    }
    const logged = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_sharing_events')
      .insert({ tenant_id: tenantId, actor_id: req.user.id, action: optedIn ? 'opt_in' : 'opt_out' });
    if (logged.error) throw logged.error;
    if (!optedIn) {
      // Outbox marked atomically by a DB trigger when consent is withdrawn.
      const result = await flushPendingMistralDeletions(supabaseAdmin, tenantId, 50);
      const remaining = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_remote_documents')
        .select('id', { count: 'exact', head: true }).neq('state', 'deleted');
      if (remaining.error) throw remaining.error;
      return res.status((remaining.count || 0) ? 202 : 200).json({
        opted_in: false, pending_deletions: remaining.count || 0, deleted_now: result.deleted,
      });
    }
    res.json({ opted_in: true });
  }));

  async function getDocument(tenantId: string, id: string) {
    const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents')
      .select('id,name,file_url,mime_type,size_bytes').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }

  // La préparation est déclenchée par un administrateur : jamais lors d'un
  // simple upload ni sur la base de la case RGPD obligatoire à l'inscription.
  app.post('/api/knowledge-sharing/drafts', guarded(async (req, res, tenantId) => {
    if (!(await getPreference(tenantId))) return res.status(403).json({ error: 'Contribution désactivée pour ce cabinet.' });
    const documentId = typeof req.body?.document_id === 'string' ? req.body.document_id : '';
    if (!documentId || documentId.length > 255 || /[\u0000-\u001f\u007f]/.test(documentId)) return res.status(400).json({ error: 'Document invalide.' });
    const doc = await getDocument(tenantId, documentId);
    if (!doc) return res.status(404).json({ error: 'Document absent de ce cabinet.' });
    if (!isOwnStorageRef(doc.file_url, 'documents')) {
      return res.status(400).json({ error: 'Source non gérée : importez ce fichier dans le stockage privé du cabinet.' });
    }
    if (doc.size_bytes > MAX_SOURCE_BYTES) return res.status(413).json({ error: 'Fichier trop volumineux pour la préparation.' });
    const existing = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions')
      .select('status').eq('document_id', documentId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.status === 'reviewed') return res.status(409).json({ error: 'Cette contribution a déjà été validée.' });

    // Ne jamais utiliser le parseur Nomic : son moteur optionnel est externe.
    const { extractKnowledgeDocText, readStorageObject } = await import('@zinkh/archioffice-agents/server');
    let source: string | null;
    if (/\.xlsx?$/i.test(doc.name)) {
      const fetched = await readStorageObject(supabaseAdmin, tenantId, doc.file_url);
      if (!fetched || fetched.buffer.length > MAX_SOURCE_BYTES) return res.status(422).json({ error: 'Fichier illisible.' });
      const workbook = XLSX.read(fetched.buffer, { type: 'buffer' });
      source = workbook.SheetNames.slice(0, 10)
        .map((sheet) => XLSX.utils.sheet_to_csv(workbook.Sheets[sheet]).slice(0, 12000)).join('\n');
    } else {
      source = await extractKnowledgeDocText(supabaseAdmin, tenantId, doc, false);
    }
    if (!source?.trim()) return res.status(422).json({ error: 'Aucun texte extractible. Vérifiez le PDF ou la numérisation.' });
    const preview = anonymizeTechnicalText(source);
    if (!preview.text) return res.status(422).json({ error: 'Aucun contenu exploitable.' });
    const payload = {
      document_id: documentId, status: 'draft', sanitized_text: preview.text,
      warnings: preview.warnings, updated_by: req.user.id,
      reviewed_at: null, updated_at: new Date().toISOString(),
    };
    // Do not upsert: a concurrent review could otherwise be overwritten and
    // silently revert a validated contribution back to draft.
    if (existing.data) {
      const updated = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions')
        .update(payload).eq('document_id', documentId).eq('status', 'draft').select().maybeSingle();
      if (updated.error) throw updated.error;
      if (!updated.data) return res.status(409).json({ error: 'Contribution validée entre-temps.' });
      return res.status(201).json(updated.data);
    }
    const inserted = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions')
      .insert(payload).select().single();
    if (inserted.error?.code === '23505') return res.status(409).json({ error: 'Contribution créée simultanément : actualisez la liste.' });
    if (inserted.error) throw inserted.error;
    res.status(201).json(inserted.data);
  }));

  app.put('/api/knowledge-sharing/drafts/:id', guarded(async (req, res, tenantId) => {
    if (!(await getPreference(tenantId))) return res.status(403).json({ error: 'Contribution désactivée.' });
    const source = req.body?.sanitized_text;
    if (typeof source !== 'string' || !source.trim() || source.length > MAX_SHARED_EXCERPT_CHARS) {
      return res.status(400).json({ error: 'Extrait invalide ou trop long.' });
    }
    const preview = anonymizeTechnicalText(source);
    const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions')
      .update({ sanitized_text: preview.text, warnings: preview.warnings, updated_by: req.user.id, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('status', 'draft').select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Brouillon introuvable ou déjà validé.' });
    res.json(data);
  }));

  app.post('/api/knowledge-sharing/drafts/:id/review', guarded(async (req, res, tenantId) => {
    if (!(await getPreference(tenantId))) return res.status(403).json({ error: 'Contribution désactivée.' });
    if (req.body?.confirmed_anonymity !== true || req.body?.confirmed_rights !== true) {
      return res.status(400).json({ error: 'Confirmez la relecture et les droits de partage.' });
    }
    const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions')
      .update({ status: 'reviewed', reviewed_at: new Date().toISOString(), reviewed_by: req.user.id })
      .eq('id', req.params.id).eq('status', 'draft').select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Brouillon introuvable.' });
    // Toujours PAS de publication externe : une étape distincte sera requise.
    res.json({ ...data, publication_active: false });
  }));

  // Sandbox connectivity check: no customer document is transferred.
  app.get('/api/knowledge-sharing/mistral/status', guarded(async (_req, res) => {
    const apiKey = process.env.MISTRAL_API_KEY;
    const libraryId = process.env.MISTRAL_KNOWLEDGE_LIBRARY_ID || DEFAULT_KNOWLEDGE_LIBRARY_ID;
    if (!apiKey) return res.status(503).json({ connected: false, error: 'Mistral API key not configured.' });
    try {
      const response = await fetch('https://api.mistral.ai/v1/libraries/' + encodeURIComponent(libraryId), {
        headers: { Authorization: 'Bearer ' + apiKey },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return res.status(502).json({ connected: false, error: 'Mistral library unavailable or inaccessible.', upstream_status: response.status });
      const library = await response.json() as { id?: string; name?: string };
      res.json({ connected: library.id === libraryId, library_id: libraryId, name: library.name || null, publication_active: false });
    } catch {
      res.status(502).json({ connected: false, error: 'Unable to contact Mistral.' });
    }
  }));

  // A unique database reservation precedes every remote upload. No originals.
  app.post('/api/knowledge-sharing/contributions/:id/publish', guarded(async (req, res, tenantId) => {
    if (process.env.MISTRAL_KNOWLEDGE_PUBLISH_ENABLED !== 'true') {
      return res.status(403).json({ error: 'Publication externe désactivée sur cette instance.' });
    }
    if (req.body?.confirmed_external_transfer !== true) {
      return res.status(400).json({ error: 'Confirmez explicitement le transfert vers Mistral.' });
    }
    if (!(await getPreference(tenantId))) return res.status(403).json({ error: 'Consentement du cabinet absent.' });
    const { data: contribution, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions')
      .select('id,status,sanitized_text').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!contribution || contribution.status !== 'reviewed') {
      return res.status(409).json({ error: 'Seuls les extraits relus peuvent être publiés.' });
    }
    const checked = anonymizeTechnicalText(contribution.sanitized_text);
    if (!contribution.sanitized_text.trim() || checked.text !== contribution.sanitized_text) {
      return res.status(409).json({ error: 'L’extrait nécessite une nouvelle anonymisation et relecture.' });
    }
    const key = process.env.MISTRAL_API_KEY;
    const libraryId = process.env.MISTRAL_KNOWLEDGE_LIBRARY_ID || DEFAULT_KNOWLEDGE_LIBRARY_ID;
    if (!key) return res.status(503).json({ error: 'Clé API Mistral absente.' });
    const remoteName = 'archioffice-' + contribution.id + '.txt';
    const hash = createHash('sha256').update(contribution.sanitized_text).digest('hex');

    // UNIQUE(contribution_id) and a DB trigger protect against concurrent
    // sends, cross-tenant access and consent-withdrawal races.
    const reserved = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_remote_documents')
      .insert({ contribution_id: contribution.id, library_id: libraryId, remote_name: remoteName,
        content_sha256: hash, state: 'uploading' }).select().single();
    if (reserved.error?.code === '23505') {
      return res.status(409).json({ error: 'Transfert déjà réservé, envoyé ou en rapprochement. Aucun doublon créé.' });
    }
    if (reserved.error?.code === '23514') {
      return res.status(409).json({ error: 'Consentement retiré ou contribution non validée.' });
    }
    if (reserved.error) throw reserved.error;
    const job = reserved.data;
    const scope = tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_remote_documents');
    const current = await scope.select('deletion_requested_at').eq('id', job.id).single();
    if (current.error) throw current.error;
    if (current.data?.deletion_requested_at || !(await getPreference(tenantId))) {
      const cancelled = await scope.update({ state: 'deleted', deleted_at: new Date().toISOString() })
        .eq('id', job.id).eq('state', 'uploading');
      if (cancelled.error) throw cancelled.error;
      return res.status(409).json({ error: 'Transfert annulé : consentement retiré.' });
    }

    let remote: { id: string };
    try {
      remote = await makeMistralLibraryClient(key, libraryId).upload(contribution.sanitized_text, contribution.id);
    } catch {
      // Remote success with a lost response is possible: do NOT retry upload.
      const uncertain = await scope.update({
        state: 'uncertain', last_error: 'Transfert non confirmé, rapprochement requis.',
        updated_at: new Date().toISOString(),
      }).eq('id', job.id).eq('state', 'uploading');
      if (uncertain.error) throw uncertain.error;
      return res.status(502).json({ error: 'Transfert Mistral non confirmé : vérification distante nécessaire.' });
    }
    const saved = await scope.update({
      remote_document_id: remote.id, state: 'published',
      published_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', job.id).eq('state', 'uploading').select().maybeSingle();
    if (saved.error || !saved.data) {
      return res.status(503).json({ error: 'Envoi distant réalisé, enregistrement local non confirmé. Ne pas réessayer le transfert.' });
    }
    const stillAuthorized = await getPreference(tenantId);
    if (!stillAuthorized || saved.data.deletion_requested_at) {
      const queued = await scope.update({
        deletion_requested_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', job.id).neq('state', 'deleted').select().single();
      if (queued.error) throw queued.error;
      const removed = await processRemoteDeletion(supabaseAdmin, queued.data);
      return res.status(removed ? 200 : 202).json({
        published: false, deletion_pending: !removed, remote_document_id: remote.id,
      });
    }
    res.status(201).json({ published: true, remote_document_id: remote.id });
  }));

  // Admin-initiated retry of pending remote deletions (no new uploads).
  app.post('/api/knowledge-sharing/mistral/reconcile', guarded(async (_req, res, tenantId) => {
    const result = await flushPendingMistralDeletions(supabaseAdmin, tenantId, 50);
    res.json(result);
  }));

  app.delete('/api/knowledge-sharing/contributions/:id', guarded(async (req, res, tenantId) => {
    const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions')
      .delete().eq('id', req.params.id);
    if (error) throw error;
    const result = await flushPendingMistralDeletions(supabaseAdmin, tenantId, 30);
    res.status(result.pending ? 202 : 200).json({ success: true, pending_deletions: result.pending });
  }));

  // Background deletion retries survive the original request and run even
  // when publishing is disabled. Never log excerpts, secrets or remote bodies.
  if (process.env.MISTRAL_API_KEY) {
    const interval = setInterval(() => {
      void flushPendingMistralDeletions(supabaseAdmin, undefined, 30).catch(() => {});
    }, 60_000);
    interval.unref?.();
  }
}
