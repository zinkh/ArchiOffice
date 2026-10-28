// Fusion de contacts : POST /api/contacts/merge. Le travail se fait dans la fonction SQL
// merge_contacts (supabase/migrate_merge_contacts.sql), en une seule transaction.
//
// Ce que la route garantit, sans rien attendre du client :
//  - réservée aux administrateurs et managers ;
//  - confirmation forte exigée (le mot FUSIONNER), pas seulement côté écran ;
//  - le client n'envoie que des CHOIX (champ -> fiche) : les valeurs écrites sont
//    recalculées ici depuis les fiches lues en base (resolveMergePatch) ;
//  - jamais de fusion d'un contact personnel d'un autre utilisateur, ni d'un contact
//    personnel avec un contact partagé (ses données deviendraient visibles de tous).
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { contactName, isMergeConfirmed, MERGE_MAX_CONTACTS, planSafeMerges, resolveMergePatch, type MergeContact } from '../../src/lib/contactMerge';
import { selectAllPages } from '../selectAllPages';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => Promise<void>;
}

/** Fusions exécutées par appel : le client rappelle la route jusqu'à épuisement. */
const SAFE_BATCH_SIZE = 25;

const MIGRATION_MISSING = 'La fusion de contacts n’est pas encore disponible sur cette instance (migration merge_contacts à appliquer).';

function cleanPicks(raw: unknown): Record<string, string> {
  const picks: Record<string, string> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') picks[key] = value;
    }
  }
  return picks;
}

export function registerContactMergeRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity, requireRole }: RouteDeps) {
  app.post('/api/contacts/merge', requireRole('admin', 'manager'), async (req: any, res: any) => {
    try {
      const tenantId: string = req.tenantId || await getTenantId(req.user.id);
      const primaryId = req.body?.primary_id;
      const rawDups = req.body?.duplicate_ids;
      if (typeof primaryId !== 'string' || !primaryId || !Array.isArray(rawDups) || rawDups.some((d: unknown) => typeof d !== 'string' || !d)) {
        return res.status(400).json({ error: 'Fiche à conserver et fiches à fusionner requises.', code: 'INVALID_BODY' });
      }
      const duplicateIds: string[] = [...new Set<string>(rawDups)].filter(id => id !== primaryId);
      if (duplicateIds.length < 1) {
        return res.status(400).json({ error: 'Choisissez au moins une fiche différente de celle à conserver.', code: 'INVALID_BODY' });
      }
      if (duplicateIds.length + 1 > MERGE_MAX_CONTACTS) {
        return res.status(400).json({ error: `${MERGE_MAX_CONTACTS} fiches au plus par fusion.`, code: 'TOO_MANY' });
      }
      if (!isMergeConfirmed(req.body?.confirm)) {
        return res.status(400).json({ error: 'Confirmation requise : tapez le mot FUSIONNER.', code: 'CONFIRMATION_REQUIRED' });
      }

      const ids = [primaryId, ...duplicateIds];
      const { data, error: readError } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select('*').in('id', ids);
      if (readError) throw readError;
      const contacts = (data || []) as MergeContact[];
      if (contacts.length !== ids.length) {
        return res.status(404).json({ error: 'Contact introuvable.', code: 'NOT_FOUND' });
      }
      if (contacts.some(c => c.is_personal && c.owner_user_id && c.owner_user_id !== req.user.id)) {
        return res.status(403).json({ error: 'Un contact personnel appartient à un autre utilisateur.', code: 'PERSONAL_FORBIDDEN' });
      }
      if (new Set(contacts.map(c => !!c.is_personal)).size > 1) {
        return res.status(409).json({ error: 'Un contact personnel ne peut pas être fusionné avec un contact partagé.', code: 'MIXED_PERSONAL' });
      }

      const patch = resolveMergePatch(contacts, primaryId, cleanPicks(req.body?.picks));
      const { data: result, error } = await supabaseAdmin.rpc('merge_contacts', {
        p_tenant: tenantId, p_primary: primaryId, p_dups: duplicateIds, p_patch: patch, p_actor: req.user.id,
      });
      if (error) {
        if (['PGRST202', '42883'].includes(error.code)) return res.status(503).json({ error: MIGRATION_MISSING, code: 'MIGRATION_MISSING' });
        if (error.code === 'P0002') return res.status(404).json({ error: 'Contact introuvable.', code: 'NOT_FOUND' });
        if (error.code === '22023') return res.status(400).json({ error: 'Demande de fusion invalide.', code: 'INVALID_BODY' });
        throw error;
      }

      const primary = contacts.find(c => c.id === primaryId)!;
      const names = contacts.filter(c => c.id !== primaryId).map(contactName).join(', ');
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Fusion de contacts dans "${contactName(primary)}"`, names, primaryId, 'contact', 'Contacts');
      res.json({
        success: true,
        primary_id: primaryId,
        merged_ids: result?.merged_ids ?? duplicateIds,
        moved: result?.moved ?? {},
        updated_fields: Object.keys(patch),
      });
    } catch (e: any) {
      console.error('Error merging contacts:', e?.message);
      res.status(500).json({ error: 'Échec de la fusion : ' + (e?.message || 'erreur inconnue') });
    }
  });

  // Fusion automatique des doublons « sûrs » (même nom, aucune valeur en conflit).
  // dry_run : aperçu seul. Sinon confirmation FUSIONNER exigée, SAFE_BATCH_SIZE groupes par appel.
  app.post('/api/contacts/merge-safe', requireRole('admin', 'manager'), async (req: any, res: any) => {
    try {
      const tenantId: string = req.tenantId || await getTenantId(req.user.id);
      const dryRun = req.body?.dry_run === true;
      if (!dryRun && !isMergeConfirmed(req.body?.confirm)) {
        return res.status(400).json({ error: 'Confirmation requise : tapez le mot FUSIONNER.', code: 'CONFIRMATION_REQUIRED' });
      }
      const { data, error: readError } = await selectAllPages<MergeContact>(
        () => tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').select('*') as any);
      if (readError) throw readError;
      const contacts = data.filter(c => !c.is_personal);
      const byId = new Map(contacts.map(c => [c.id, c]));
      const { safe, skipped } = planSafeMerges(contacts);
      const label = (g: { primaryId: string; duplicateIds: string[] }) => ({
        primary_id: g.primaryId,
        duplicate_ids: g.duplicateIds,
        name: contactName(byId.get(g.primaryId)!),
        count: g.duplicateIds.length + 1,
      });
      if (dryRun) {
        return res.json({ groups: safe.length, duplicates: safe.reduce((n, g) => n + g.duplicateIds.length, 0), skipped, sample: safe.slice(0, 50).map(label) });
      }

      const batch = safe.slice(0, SAFE_BATCH_SIZE);
      const merged: string[] = [];
      const failed: { primary_id: string; error: string }[] = [];
      for (const g of batch) {
        const members = [g.primaryId, ...g.duplicateIds].map(id => byId.get(id)!);
        const patch = resolveMergePatch(members, g.primaryId, {});
        const { error } = await supabaseAdmin.rpc('merge_contacts', {
          p_tenant: tenantId, p_primary: g.primaryId, p_dups: g.duplicateIds, p_patch: patch, p_actor: req.user.id,
        });
        if (error) {
          if (['PGRST202', '42883'].includes(error.code)) return res.status(503).json({ error: MIGRATION_MISSING, code: 'MIGRATION_MISSING' });
          failed.push({ primary_id: g.primaryId, error: error.message || 'erreur inconnue' });
          continue;
        }
        merged.push(g.primaryId);
      }
      if (merged.length) {
        const userName = await getUserName(tenantId, req.user.id, req.user.email);
        logActivity(tenantId, req.user.id, userName, `Fusion automatique de ${merged.length} groupe(s) de doublons`, '', merged[0], 'contact', 'Contacts');
      }
      // Les groupes en échec restent « sûrs » au prochain passage : le client s'arrête s'il n'avance plus.
      res.json({ merged: merged.length, failed, remaining: Math.max(0, safe.length - batch.length) + failed.length, skipped });
    } catch (e: any) {
      console.error('Error merging safe duplicates:', e?.message);
      res.status(500).json({ error: 'Échec de la fusion automatique : ' + (e?.message || 'erreur inconnue') });
    }
  });
}
