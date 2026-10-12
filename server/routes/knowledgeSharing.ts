/**
 * Contributions volontaires, anonymisées, revues et confirmées avant publication.
 * Les fichiers originaux restent privés. Un journal durable permet la suppression
 * distante même après suppression locale ou retrait du consentement.
 */
import type { Express } from 'express';
import { resolveKnowledgeLibraryId } from '../knowledge/mistralLibrary';
import { extractDocumentSource, MAX_SOURCE_BYTES } from '../knowledge/documentSource';
import { publishContribution, publishEnabled } from '../knowledge/publishContribution';
import { flushPendingMistralDeletions, reconcileStalePublications } from '../knowledge/mistralLifecycle';
import { isSuperAdmin } from '../superAdminAuth';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { isOwnStorageRef } from '../externalStorage/externalRef';
import { anonymizeTechnicalText, MAX_SHARED_EXCERPT_CHARS } from '../knowledge/anonymize';
import {
  AUTO_SHARE_DAILY_CAP, enqueueAutoContribution, getAutoSharePrefs, runAutoSharingCycle, SHAREABLE_DOC_TYPES,
} from '../knowledge/autoContribution';
import { makeMistralReviewer } from '../knowledge/aiReview';

export interface KnowledgeSharingDeps {
  supabaseAdmin: any;
  requireTenantAdmin: (userId: string) => Promise<string>;
}


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

  // `delete_attempts` n'existe qu'une fois la migration de reprise passée : sans
  // elle, on relit sans cette colonne plutôt que de casser tout l'écran.
  const PUBLICATION_COLUMNS = 'contribution_id,remote_document_id,state,deletion_requested_at,deleted_at,created_at,published_at';
  async function listPublications(tenantId: string) {
    const read = (columns: string) => tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_remote_documents')
      .select(columns).order('created_at', { ascending: false }).limit(200);
    const withAttempts = await read(PUBLICATION_COLUMNS + ',delete_attempts');
    return withAttempts.error ? read(PUBLICATION_COLUMNS) : withAttempts;
  }

  // Colonnes ajoutées par supabase/migrate_knowledge_zzz_auto_sharing.sql : sans
  // elles, on relit les colonnes d'origine plutôt que de casser tout l'écran.
  const CONTRIBUTION_COLUMNS = 'id,document_id,status,sanitized_text,warnings,reviewed_at,created_at';
  async function listContributions(tenantId: string) {
    const read = (columns: string) => tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions')
      .select(columns).order('created_at', { ascending: false }).limit(100);
    const extended = await read(CONTRIBUTION_COLUMNS + ',origin,review_mode,withheld,analysis,updated_at');
    return extended.error ? read(CONTRIBUTION_COLUMNS) : extended;
  }

  /** Nombre de documents du cabinet par type partageable, pour que le choix soit éclairé. */
  async function countShareableTypes(tenantId: string) {
    const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents').select('doc_type').limit(10000);
    const counts = new Map<string, number>();
    for (const row of data || []) if (row.doc_type) counts.set(row.doc_type, (counts.get(row.doc_type) || 0) + 1);
    return SHAREABLE_DOC_TYPES.map(name => ({ name, count: counts.get(name) || 0 }));
  }

  app.get('/api/knowledge-sharing', guarded(async (_req, res, tenantId) => {
    const [preference, contributions, publications, auto, types] = await Promise.all([
      getPreference(tenantId),
      listContributions(tenantId),
      listPublications(tenantId),
      getAutoSharePrefs(supabaseAdmin, tenantId),
      countShareableTypes(tenantId),
    ]);
    if (contributions.error) throw contributions.error;
    if (publications.error) throw publications.error;
    res.json({
      opted_in: preference, contributions: contributions.data || [],
      publications: publications.data || [],
      publication_active: publishEnabled(),
      auto: { enabled: auto.enabled, categories: auto.categories, available: types, daily_cap: AUTO_SHARE_DAILY_CAP },
    });
  }));

  // Partage automatique : un consentement DISTINCT, car il couvre l'analyse du texte
  // par une IA avant toute relecture humaine, puis l'envoi sans validation.
  app.put('/api/knowledge-sharing/auto', guarded(async (req, res, tenantId) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'Le choix doit être explicite (true ou false).' });
    if (!(await getPreference(tenantId))) return res.status(403).json({ error: 'Autorisez d’abord la contribution anonymisée.' });
    const enabled: boolean = req.body.enabled;
    const requested = Array.isArray(req.body.categories) ? req.body.categories : [];
    const categories = [...new Set(requested.filter((c: unknown): c is string => typeof c === 'string'))] as string[];
    if (categories.some(c => !(SHAREABLE_DOC_TYPES as readonly string[]).includes(c))) {
      return res.status(400).json({ error: 'Type de document non partageable : ' + SHAREABLE_DOC_TYPES.join(', ') + '.' });
    }
    if (enabled) {
      if (!categories.length) return res.status(400).json({ error: 'Choisissez au moins un type de document.' });
      if (req.body.confirmed_ai_review !== true) {
        return res.status(400).json({ error: 'Confirmez que le texte sera analysé par Mistral avant tout envoi.' });
      }
    }
    const patch: Record<string, unknown> = enabled
      ? { auto_share_enabled: true, auto_share_categories: categories, auto_share_consented_at: new Date().toISOString(), auto_share_consented_by: req.user.id }
      : { auto_share_enabled: false, ...(requested.length ? { auto_share_categories: categories } : {}) };
    const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_sharing_preferences')
      .upsert({ tenant_id: tenantId, opted_in: true, updated_by: req.user.id, updated_at: new Date().toISOString(), ...patch },
        { onConflict: 'tenant_id' });
    if (error) throw error;
    if (!enabled) {
      // Ce qui n'est pas encore parti ne partira pas : file d'attente, relu en attente d'envoi, retenu.
      const { data: auto } = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions')
        .select('id').eq('origin', 'auto').in('status', ['queued', 'analyzing', 'reviewed', 'held']);
      const ids = (auto || []).map((c: any) => c.id);
      if (ids.length) {
        const { data: sent } = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_remote_documents')
          .select('contribution_id').in('contribution_id', ids);
        const published = new Set((sent || []).map((r: any) => r.contribution_id));
        const unsent = ids.filter((id: string) => !published.has(id));
        if (unsent.length) await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions').delete().in('id', unsent);
      }
    }
    res.json({ enabled, categories });
  }));

  // Met aussi en file les documents déjà présents des types choisis : geste explicite,
  // jamais fait d'office à l'activation.
  app.post('/api/knowledge-sharing/auto/backfill', guarded(async (_req, res, tenantId) => {
    const prefs = await getAutoSharePrefs(supabaseAdmin, tenantId);
    if (!prefs.enabled || !prefs.categories.length) return res.status(403).json({ error: 'Le partage automatique n’est pas activé.' });
    const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents')
      .select('id,name,file_url,mime_type,size_bytes,doc_type').in('doc_type', prefs.categories).limit(200);
    if (error) throw error;
    let queued = 0;
    for (const doc of data || []) if (await enqueueAutoContribution(supabaseAdmin, tenantId, doc)) queued++;
    res.json({ examined: (data || []).length, queued });
  }));

  app.put('/api/knowledge-sharing/consent', guarded(async (req, res, tenantId) => {
    if (typeof req.body?.opted_in !== 'boolean') {
      return res.status(400).json({ error: 'Le choix doit être explicite (true ou false).' });
    }
    const optedIn = req.body.opted_in;
    const row = { tenant_id: tenantId, opted_in: optedIn, updated_by: req.user.id, updated_at: new Date().toISOString() };
    const prefs = () => tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_sharing_preferences');
    // Retirer l'autorisation arrête aussi le partage automatique : il ne doit pas
    // reprendre tout seul si le cabinet la redonne plus tard. (Colonne ajoutée par
    // la migration du partage automatique : repli sans elle si elle n'est pas passée.)
    let { error } = await prefs().upsert(optedIn ? row : { ...row, auto_share_enabled: false }, { onConflict: 'tenant_id' });
    if (error && !optedIn && (error.code === '42703' || error.code === 'PGRST204')) {
      ({ error } = await prefs().upsert(row, { onConflict: 'tenant_id' }));
    }
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
      let deletedNow = 0;
      try {
        deletedNow = (await flushPendingMistralDeletions(supabaseAdmin, tenantId, 50)).deleted;
      } catch {
        // Consent withdrawal has already been committed. Never make its
        // success appear contingent on Mistral availability.
      }
      const remaining = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_remote_documents')
        .select('id', { count: 'exact', head: true }).neq('state', 'deleted');
      if (remaining.error) throw remaining.error;
      return res.status((remaining.count || 0) ? 202 : 200).json({
        opted_in: false, pending_deletions: remaining.count || 0, deleted_now: deletedNow,
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

    const extracted = await extractDocumentSource(supabaseAdmin, tenantId, doc);
    if (extracted.unreadable) return res.status(422).json({ error: 'Fichier illisible.' });
    const source = extracted.text;
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

  async function fetchLibrary(apiKey: string, libraryId: string) {
    const response = await fetch('https://api.mistral.ai/v1/libraries/' + encodeURIComponent(libraryId), {
      headers: { Authorization: 'Bearer ' + apiKey }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { ok: false as const, status: response.status };
    const library = await response.json() as { id?: string; name?: string };
    return { ok: library.id === libraryId, library, status: response.status };
  }

  // Côté cabinet : un simple « la liaison fonctionne ». Ni l'identifiant, ni le
  // nom, ni le contenu de la bibliothèque commune de la plateforme ne sont
  // exposés à un administrateur de cabinet.
  app.get('/api/knowledge-sharing/mistral/status', guarded(async (_req, res) => {
    const apiKey = process.env.MISTRAL_API_KEY;
    const libraryId = resolveKnowledgeLibraryId();
    const base = { publication_active: publishEnabled() };
    if (!apiKey || !libraryId) return res.json({ ...base, configured: false, connected: false });
    try {
      const result = await fetchLibrary(apiKey, libraryId);
      res.json({ ...base, configured: true, connected: result.ok });
    } catch {
      res.json({ ...base, configured: true, connected: false });
    }
  }));

  // Côté plateforme : diagnostic détaillé de la bibliothèque, pour l'opérateur seul.
  app.get('/api/admin/knowledge-library/status', async (req: any, res: any) => {
    if (!(await isSuperAdmin(supabaseAdmin, req.user))) {
      return res.status(403).json({ error: 'Accès réservé au super-administrateur' });
    }
    const apiKey = process.env.MISTRAL_API_KEY;
    const libraryId = resolveKnowledgeLibraryId();
    if (!apiKey) return res.status(503).json({ connected: false, error: 'Clé Mistral absente.' });
    if (!libraryId) return res.status(503).json({ connected: false, error: 'MISTRAL_KNOWLEDGE_LIBRARY_ID absent ou invalide.' });
    try {
      const result = await fetchLibrary(apiKey, libraryId);
      if (!result.ok) return res.status(502).json({ connected: false, upstream_status: result.status });
      const listing = await fetch('https://api.mistral.ai/v1/libraries/' + encodeURIComponent(libraryId) + '/documents?page_size=100', {
        headers: { Authorization: 'Bearer ' + apiKey }, signal: AbortSignal.timeout(10000),
      });
      const visible = listing.ok ? await listing.json() as { data?: unknown[] } : null;
      res.json({
        connected: true, library_id: libraryId, name: result.library?.name || null,
        visible_documents_on_first_page: Array.isArray(visible?.data) ? visible.data.length : null,
        publication_active: publishEnabled(),
      });
    } catch {
      res.status(502).json({ connected: false, error: 'Mistral injoignable.' });
    }
  });

  // A unique database reservation precedes every remote upload. No originals.
  app.post('/api/knowledge-sharing/contributions/:id/publish', guarded(async (req, res, tenantId) => {
    if (!publishEnabled()) {
      return res.status(403).json({ error: 'Publication externe désactivée sur cette instance.' });
    }
    if (req.body?.confirmed_external_transfer !== true) {
      return res.status(400).json({ error: 'Confirmez explicitement le transfert vers Mistral.' });
    }
    const outcome = await publishContribution(supabaseAdmin, tenantId, req.params.id);
    res.status(outcome.status).json(outcome.body);
  }));

  // Rapprochement à la demande : cherche les envois restés sans issue par leur
  // nom opaque (jamais de nouvel envoi) puis rejoue les suppressions en attente.
  app.post('/api/knowledge-sharing/mistral/reconcile', guarded(async (_req, res, tenantId) => {
    const uploads = await reconcileStalePublications(supabaseAdmin, tenantId, 20, 0);
    const result = await flushPendingMistralDeletions(supabaseAdmin, tenantId, 50, { ignoreBackoff: true });
    res.json({
      ...result, reconciled_uploads: uploads.reconciled,
      uncertain_uploads: uploads.uncertain + uploads.errors, abandoned_uploads: uploads.abandoned,
    });
  }));

  app.delete('/api/knowledge-sharing/contributions/:id', guarded(async (req, res, tenantId) => {
    const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions')
      .delete().eq('id', req.params.id);
    if (error) throw error;
    try {
      const result = await flushPendingMistralDeletions(supabaseAdmin, tenantId, 30);
      res.status(result.pending ? 202 : 200).json({ success: true, pending_deletions: result.pending });
    } catch {
      // Durable deletion intent was recorded by trigger even if the provider
      // is unavailable; the retry worker will complete the erasure later.
      res.status(202).json({ success: true, remote_deletion_retry_scheduled: true });
    }
  }));

  // Background deletion retries survive the original request and run even
  // when publishing is disabled. Never log excerpts, secrets or remote bodies.
  if (process.env.MISTRAL_API_KEY) {
    const interval = setInterval(() => {
      void (async () => {
        await flushPendingMistralDeletions(supabaseAdmin, undefined, 30);
        await reconcileStalePublications(supabaseAdmin, undefined, 20);
        // Partage automatique : analyse de la file puis envoi. Inactif tant que
        // l'instance n'autorise pas la publication (voir runAutoSharingCycle).
        await runAutoSharingCycle(supabaseAdmin, { review: makeMistralReviewer() });
      })().catch(() => {});
    }, 60_000);
    interval.unref?.();
  }
}
