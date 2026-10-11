/**
 * Circuit de contribution à une base de connaissances commune, désactivé par défaut.
 *
 * IMPORTANT : la phase pilote s'arrête à une revue humaine interne.
 * Aucun extrait, fichier ou métadonnée n'est envoyé à Mistral ou rendu visible
 * aux autres cabinets tant qu'une intégration externe et son audit RGPD ne sont
 * pas approuvés. Les documents de projet restent dans leur stockage privé.
 */
import type { Express } from 'express';
import * as XLSX from 'xlsx';
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
    const [preference, contributions] = await Promise.all([
      getPreference(tenantId),
      tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions')
        .select('id,document_id,status,sanitized_text,warnings,reviewed_at,created_at')
        .order('created_at', { ascending: false }).limit(100),
    ]);
    if (contributions.error) throw contributions.error;
    res.json({ opted_in: preference, contributions: contributions.data || [], publication_active: false });
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
    res.json({ opted_in: optedIn });
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
    if (!/^[0-9a-f-]{36}$/i.test(documentId)) return res.status(400).json({ error: 'Document invalide.' });
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
    const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions')
      .upsert({
        tenant_id: tenantId, document_id: documentId, status: 'draft',
        sanitized_text: preview.text, warnings: preview.warnings, updated_by: req.user.id,
        reviewed_at: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,document_id' }).select().single();
    if (error) throw error;
    res.status(201).json(data);
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

  app.delete('/api/knowledge-sharing/contributions/:id', guarded(async (req, res, tenantId) => {
    const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'knowledge_contributions')
      .delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  }));
}
