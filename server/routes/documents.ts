// Phase 7 extraction — moved out of server.ts's Document Routes section
// (CRUD, versioning, statut transitions, diffusions to external contacts).
// Distinct from documentTemplates.ts (lot 4, generated documents from a
// template) — this is the general document repository.
//
// Les fichiers passent par storeBusinessFile/removeBusinessFile
// (server/externalStorage/storeBusinessFile.ts) et non plus par
// uploadToStorage/deleteFromStorage : c'est cette couche qui décide, selon le
// cabinet, entre Supabase Storage et l'espace de stockage qu'il a branché
// (Google Drive, Dropbox, Nextcloud, kDrive). C'est elle aussi qui porte
// désormais le contrôle de quota, qui était appelé ici avant même qu'on sache
// où le fichier irait.
import type { Express } from 'express';
import { sanitizeFilename } from '../sanitizeFilename';
import { handleDocumentUpload } from '../documentUpload';
import { assertTenantEntity } from '../assertTenantEntity';
import { isOwnStorageRef } from '../externalStorage/externalRef';
import { buildDocumentFolderPath } from '../externalStorage/businessFolderPath';
import type { RemoveBusinessFile, StoreBusinessFile } from '../externalStorage/storeBusinessFile';

// Ressources auxquelles une pièce jointe peut se rattacher au-delà d'un
// projet (resource_type/resource_id, voir migrate_documents_attachments.sql).
// Liste explicite plutôt qu'un import d'AGENT_RESOURCES : plusieurs clés de
// ce jeu-là (ex. "references", "articles_type") ont un basePath qui ne
// correspond PAS au nom réel de leur table, et assertTenantEntity() prend le
// nom de table tel quel — mieux vaut une liste vérifiée à la main que de
// risquer un `.from()` sur une table inexistante ou, pire, sur la mauvaise.
// 'agents' porte la bibliothèque de connaissances d'un agent IA (voir
// migrate_agent_knowledge.sql, capabilities.knowledge dans
// packages/archioffice-agents) : réglementation, DTU, notices — auto-injectés
// dans le prompt de CET agent à chaque tour (buildAgentContext), jamais
// affichés comme un document de projet.
export const ATTACHABLE_RESOURCE_TYPES: string[] = [
  'projects', 'contacts', 'proposals', 'tenders', 'permits', 'meetings',
  'receptions', 'reserves', 'contrats_moe', 'ordres_de_service', 'visas',
  'notes_honoraires', 'marches_entreprises', 'tasks', 'milestones', 'agents',
];

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
  checkQuota: (tenantId: string, resource: 'projects' | 'users' | 'documents') => Promise<void>;
  storeBusinessFile: StoreBusinessFile;
  removeBusinessFile: RemoveBusinessFile;
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => Promise<void>;
}

export function registerDocumentRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity, checkQuota, storeBusinessFile, removeBusinessFile, requireRole }: RouteDeps) {
  // Le numéro et le nom de l'affaire nomment son dossier sur l'espace du
  // cabinet (« 26014 - Villa Martin »). Lecture sautée pour un document sans
  // affaire, et sans incidence quand le cabinet n'a branché aucun espace :
  // storeBusinessFile ignore alors le chemin logique.
  async function loadFolderProject(projectId: string | null, tenantId: string) {
    if (!projectId) return null;
    const { data } = await supabaseAdmin.from('projects')
      .select('project_code, name').eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();
    return (data as any) || null;
  }

  // Le sous-dossier d'une pièce jointe rattachée à autre chose qu'un projet
  // (permis, réunion, réserve...) : la plupart de ces ressources portent
  // elles-mêmes un project_id, donc le fichier va nicher dans le dossier de
  // l'affaire — sinon (contacts, devis, appels d'offres, qui n'ont pas
  // encore d'affaire) il tombe dans un sous-dossier nommé d'après la
  // ressource, à la racine « Général », comme un document sans affaire.
  const RESOURCE_FOLDER_LABELS: Record<string, string> = {
    contacts: 'Contacts', proposals: 'Devis', tenders: "Appels d'offres",
    permits: 'Permis', meetings: 'Réunions', receptions: 'Réceptions', reserves: 'Réserves',
    contrats_moe: 'Contrats MOE', ordres_de_service: 'Ordres de service', visas: 'VISA',
    notes_honoraires: "Notes d'honoraires", marches_entreprises: 'Marchés entreprises',
    tasks: 'Tâches', milestones: 'Jalons', agents: 'Bibliothèque de connaissances',
  };

  async function folderPathForResource(resourceType: string, resourceId: string | null, tenantId: string): Promise<string[]> {
    if (resourceType === 'projects') return buildDocumentFolderPath(await loadFolderProject(resourceId, tenantId), null);
    if (!resourceId) return buildDocumentFolderPath(null, RESOURCE_FOLDER_LABELS[resourceType] || resourceType);
    const { data } = await supabaseAdmin.from(resourceType).select('project_id').eq('id', resourceId).eq('tenant_id', tenantId).maybeSingle();
    const linkedProjectId = (data as any)?.project_id || null;
    const project = linkedProjectId ? await loadFolderProject(linkedProjectId, tenantId) : null;
    return buildDocumentFolderPath(project, RESOURCE_FOLDER_LABELS[resourceType] || resourceType);
  }

  app.get("/api/documents", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, resource_type, resource_id } = req.query;
      const query = supabaseAdmin.from('documents').select('*').eq('tenant_id', tenantId);
      // resource_type/resource_id (fiche permis, devis, appel d'offres...)
      // et project_id (l'onglet Documents d'une affaire) filtrent
      // indépendamment — aucun des deux n'implique l'autre, puisque
      // resource_type vaut 'projects' par défaut sur toute ligne existante.
      if (resource_type) query.eq('resource_type', resource_type as string);
      if (resource_id) query.eq('resource_id', resource_id as string);
      if (project_id) query.eq('project_id', project_id as string);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch documents" }); }
  });

  app.post("/api/documents", handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      await checkQuota(tenantId, 'documents');
      const { project_id, name, category, phase, description } = req.body;
      // Derived from the authenticated caller, never trusted from the request
      // body — the client used to be able to submit any uploaded_by value and
      // falsify a document's apparent author (security audit finding).
      const uploaded_by = await getUserName(tenantId, req.user.id, req.user.email);
      const projectIdVal = project_id === '' || project_id === 'null' ? null : project_id;
      if (projectIdVal && !(await assertTenantEntity(supabaseAdmin, 'projects', projectIdVal, tenantId))) {
        return res.status(400).json({ error: "Projet introuvable pour ce cabinet." });
      }
      const { indice, emetteur, doc_type, contact_id, contact_name } = req.body;
      if (contact_id && !(await assertTenantEntity(supabaseAdmin, 'contacts', contact_id, tenantId))) {
        return res.status(400).json({ error: "Contact introuvable pour ce cabinet." });
      }

      // Rattachement générique (voir migrate_documents_attachments.sql) : par
      // défaut une pièce jointe reste rattachée à un projet comme avant.
      // resource_type/resource_id (le permis, l'appel d'offres... visé) prend
      // le relais quand le formulaire (ou un outil MCP) en fournit un autre —
      // resource_id retombe sur project_id pour ne pas casser l'onglet
      // Documents existant, qui n'envoie jamais ces deux champs.
      const resourceTypeRaw = req.body.resource_type;
      if (resourceTypeRaw && !ATTACHABLE_RESOURCE_TYPES.includes(resourceTypeRaw)) {
        return res.status(400).json({ error: `resource_type "${resourceTypeRaw}" non pris en charge.` });
      }
      const resourceType = resourceTypeRaw || 'projects';
      const resourceIdVal = req.body.resource_id || (resourceType === 'projects' ? projectIdVal : null);
      if (resourceType !== 'projects') {
        if (!resourceIdVal) return res.status(400).json({ error: 'resource_id est requis avec resource_type.' });
        if (!(await assertTenantEntity(supabaseAdmin, resourceType, resourceIdVal, tenantId))) {
          return res.status(400).json({ error: `Fiche "${resourceType}" introuvable pour ce cabinet.` });
        }
      }

      const phaseVal = phase || null;
      const id = crypto.randomUUID();
      const phaseSegment = phaseVal ? `${phaseVal}/` : '';
      const stored = await storeBusinessFile({
        tenantId,
        bucket: 'documents',
        folderPath: resourceType === 'projects'
          ? buildDocumentFolderPath(await loadFolderProject(projectIdVal, tenantId), phaseVal)
          : await folderPathForResource(resourceType, resourceIdVal, tenantId),
        fileName: file.originalname,
        supabasePath: `${tenantId}/${projectIdVal || resourceIdVal || 'general'}/${phaseSegment}${id}/${sanitizeFilename(file.originalname)}`,
      }, file.buffer, file.mimetype);
      const file_url = stored.fileUrl;
      const uploaded_at = new Date().toISOString();
      const { error: e1 } = await supabaseAdmin.from('documents').insert({ id, tenant_id: tenantId, project_id: projectIdVal, resource_type: resourceType, resource_id: resourceIdVal, name, category, phase: phaseVal, version: 1, file_url, storage_backend: stored.storageBackend, mime_type: file.mimetype, size_bytes: stored.sizeBytes, uploaded_by, uploaded_at, description, indice: indice || 'A', doc_statut: 'en_cours', emetteur: emetteur || null, doc_type: doc_type || null, contact_id: contact_id || null, contact_name: contact_name || null, validation_status: 'pending' });
      if (e1) throw e1;
      await supabaseAdmin.from('document_versions').insert({ id: crypto.randomUUID(), tenant_id: tenantId, document_id: id, version: 1, file_url, storage_backend: stored.storageBackend, uploaded_by, uploaded_at, description, size_bytes: stored.sizeBytes });
      logActivity(tenantId, req.user.id, uploaded_by, `Ajout du document "${name}"`, name, id, 'document', 'Documents');
      res.status(201).json({ id, file_url, size_bytes: stored.sizeBytes, uploaded_at });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to upload document" }); }
  });

  // admin/manager/pm only — any authenticated tenant member (including the
  // base 'user' role) could previously delete any document (security audit
  // finding); there's no per-document ownership/project-membership model
  // yet to check against, so this is the narrowest fix available today.
  app.delete("/api/documents/:id", requireRole('admin', 'manager', 'pm'), async (req: any, res: any) => {
    try {
      const tenantId = req.tenantId as string;
      const { id } = req.params;
      // Fetch all version URLs before deleting DB rows
      const { data: doc } = await supabaseAdmin.from('documents').select('name').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { data: versions } = await supabaseAdmin.from('document_versions').select('file_url').eq('document_id', id).eq('tenant_id', tenantId);
      await supabaseAdmin.from('document_versions').delete().eq('document_id', id).eq('tenant_id', tenantId);
      const { error } = await supabaseAdmin.from('documents').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      // Delete storage files (best-effort, don't fail if storage cleanup fails).
      // isOwnStorageRef reconnaît les deux formes de référence : un document
      // déposé sur l'espace du cabinet doit y être supprimé aussi, sans quoi il
      // y resterait orphelin, sans plus rien pour le désigner.
      if (versions?.length) {
        for (const v of versions) {
          if (isOwnStorageRef(v.file_url, 'documents')) {
            removeBusinessFile(tenantId, 'documents', v.file_url).catch(() => {});
          }
        }
      }
      const docName = (doc as any)?.name || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression du document "${docName}"`, docName, id, 'document', 'Documents');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete document" }); }
  });

  app.put("/api/documents/:id", handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { name, category, phase, description, indice, emetteur, doc_type, contact_id, contact_name, validation_status, validation_comments } = req.body;
      if (contact_id && !(await assertTenantEntity(supabaseAdmin, 'contacts', contact_id, tenantId))) {
        return res.status(400).json({ error: "Contact introuvable pour ce cabinet." });
      }
      const file = req.file;
      const phaseVal = phase || null;
      if (file) {
        // Derived from the authenticated caller, not the request body — see the
        // same fix on POST /api/documents above.
        const uploaded_by = await getUserName(tenantId, req.user.id, req.user.email);
        const { data: doc } = await supabaseAdmin.from('documents').select('version, project_id, phase, indice').eq('id', id).eq('tenant_id', tenantId).single();
        const newVersion = ((doc as any)?.version || 1) + 1;
        const currentIndice = (doc as any)?.indice || 'A';
        const nextIndice = String.fromCharCode(currentIndice.charCodeAt(0) + 1);
        const existingPhase = phaseVal || (doc as any)?.phase || null;
        const projectId = (doc as any)?.project_id || 'general';
        const phaseSegment = existingPhase ? `${existingPhase}/` : '';
        // Une nouvelle version rejoint le dossier de sa phase, à côté des
        // précédentes — le « v2- » du chemin Supabase n'a pas d'équivalent ici :
        // les fournisseurs versionnent eux-mêmes un fichier de même nom.
        const stored = await storeBusinessFile({
          tenantId,
          bucket: 'documents',
          folderPath: buildDocumentFolderPath(await loadFolderProject((doc as any)?.project_id || null, tenantId), existingPhase),
          fileName: file.originalname,
          supabasePath: `${tenantId}/${projectId}/${phaseSegment}${id}/v${newVersion}-${sanitizeFilename(file.originalname)}`,
        }, file.buffer, file.mimetype);
        const file_url = stored.fileUrl;
        const uploaded_at = new Date().toISOString();
        const updateFields: any = { name, category, description, version: newVersion, file_url, storage_backend: stored.storageBackend, uploaded_at, indice: nextIndice, doc_statut: 'en_cours', emetteur: emetteur || null, doc_type: doc_type || null };
        if (phaseVal !== undefined) updateFields.phase = phaseVal;
        if (contact_id !== undefined) updateFields.contact_id = contact_id || null;
        if (contact_name !== undefined) updateFields.contact_name = contact_name || null;
        if (validation_status !== undefined) updateFields.validation_status = validation_status;
        if (validation_comments !== undefined) updateFields.validation_comments = validation_comments || null;
        const { error } = await supabaseAdmin.from('documents').update(updateFields).eq('id', id).eq('tenant_id', tenantId);
        if (error) throw error;
        await supabaseAdmin.from('document_versions').insert({ id: crypto.randomUUID(), tenant_id: tenantId, document_id: id, version: newVersion, file_url, storage_backend: stored.storageBackend, uploaded_by, uploaded_at, description, size_bytes: stored.sizeBytes });
      } else {
        const updateFields: any = { name, category, description, emetteur: emetteur || null, doc_type: doc_type || null };
        if (indice !== undefined) updateFields.indice = indice;
        if (phaseVal !== undefined) updateFields.phase = phaseVal;
        if (contact_id !== undefined) updateFields.contact_id = contact_id || null;
        if (contact_name !== undefined) updateFields.contact_name = contact_name || null;
        if (validation_status !== undefined) updateFields.validation_status = validation_status;
        if (validation_comments !== undefined) updateFields.validation_comments = validation_comments || null;
        const { error } = await supabaseAdmin.from('documents').update(updateFields).eq('id', id).eq('tenant_id', tenantId);
        if (error) throw error;
      }
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update document: " + e.message }); }
  });

  app.get("/api/documents/:id/versions", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data, error } = await supabaseAdmin.from('document_versions').select('*').eq('tenant_id', tenantId).eq('document_id', id).order('version', { ascending: false });
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch document versions" }); }
  });

  // PATCH statut d'un document
  app.patch("/api/documents/:id/statut", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { doc_statut, approbateur } = req.body;
      if (!['en_cours', 'approuve', 'perime'].includes(doc_statut)) {
        return res.status(400).json({ error: 'Invalid statut' });
      }
      const updateData: any = { doc_statut };
      if (doc_statut === 'approuve') {
        updateData.approbateur = approbateur || null;
        updateData.date_approbation = new Date().toISOString();
      }
      const { error } = await supabaseAdmin.from('documents').update(updateData).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // GET diffusions d'un document
  app.get("/api/documents/:id/diffusions", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data, error } = await supabaseAdmin.from('document_diffusions').select('*').eq('tenant_id', tenantId).eq('document_id', id).order('sent_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // POST diffusion (send to recipient)
  app.post("/api/documents/:id/diffusions", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { contact_name, contact_email, notes } = req.body;
      if (!contact_name) return res.status(400).json({ error: 'contact_name required' });
      const diffusion = { id: crypto.randomUUID(), tenant_id: tenantId, document_id: id, contact_name, contact_email: contact_email || null, sent_at: new Date().toISOString(), notes: notes || null };
      const { error } = await supabaseAdmin.from('document_diffusions').insert(diffusion);
      if (error) throw error;
      res.status(201).json(diffusion);
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // PATCH acknowledge
  app.patch("/api/documents/:id/diffusions/:diffId/acknowledge", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { diffId } = req.params;
      const { error } = await supabaseAdmin.from('document_diffusions').update({ acknowledged_at: new Date().toISOString() }).eq('id', diffId).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });
}
