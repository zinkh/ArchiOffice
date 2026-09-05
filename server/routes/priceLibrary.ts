// ── Bibliothèque de prix du cabinet ──────────────────────────────────────────
// articles_type existe depuis l'origine mais n'a jamais servi. Elle devient ici
// le catalogue de prix réutilisable d'un projet à l'autre, alimenté depuis les
// BPU et relu pour en amorcer de nouveaux.
//
// Fichier séparé de bpu.ts à dessein : cette ressource est au niveau du
// cabinet et transverse aux projets, elle n'a pas sa place dans un module de
// routes à portée projet.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const MAX_LIMIT = 200;
const MAX_BULK_ITEMS = 500;

/** Clé de dédoublonnage : sans elle la bibliothèque se remplit de quasi-doublons. */
const dedupKey = (designation: string, unite: string) =>
  `${(designation || '').trim().toLowerCase()}|${(unite || '').trim().toLowerCase()}`;

export function registerPriceLibraryRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {

  // Recherche côté serveur : une bibliothèque mûre fait des milliers de lignes,
  // on ne l'envoie pas en entier au client à chaque ouverture du panneau.
  app.get('/api/price-library', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { q, categorie, lot_type, sort } = req.query;
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_LIMIT);

      let query = tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type').select('*');
      if (categorie) query = query.eq('categorie', categorie);
      if (lot_type) query = query.eq('lot_type', lot_type);
      if (q) {
        const term = String(q).replace(/[%,()]/g, ' ').trim();
        if (term) query = query.or(`designation.ilike.%${term}%,code.ilike.%${term}%`);
      }
      // Par usage décroissant par défaut : c'est le seul tri qui rende une
      // bibliothèque utilisable une fois qu'elle a grossi.
      query = sort === 'designation'
        ? query.order('designation', { ascending: true })
        : sort === 'recent'
          ? query.order('date_prix', { ascending: false, nullsFirst: false })
          : query.order('usage_count', { ascending: false }).order('designation', { ascending: true });

      const { data, error } = await query.limit(limit);
      if (error) throw error;
      res.json(data ?? []);
    } catch (e: any) {
      console.error('[GET /api/price-library]', e);
      res.status(500).json({ error: 'Failed to search price library' });
    }
  });

  app.get('/api/price-library/categories', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type')
        .select('categorie, lot_type');
      if (error) throw error;
      const categories = [...new Set((data ?? []).map((r: any) => r.categorie).filter(Boolean))].sort();
      const lotTypes = [...new Set((data ?? []).map((r: any) => r.lot_type).filter(Boolean))].sort();
      res.json({ categories, lotTypes });
    } catch (e: any) {
      console.error('[GET /api/price-library/categories]', e);
      res.status(500).json({ error: 'Failed to fetch categories' });
    }
  });

  // Envoi en lot depuis un BPU : met à jour le prix d'un article déjà connu
  // plutôt que d'en créer une variante de plus.
  app.post('/api/price-library/bulk', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const items = Array.isArray(req.body?.items) ? req.body.items : null;
      if (!items) return res.status(400).json({ error: 'Champ `items` manquant ou invalide' });
      if (items.length > MAX_BULK_ITEMS) {
        return res.status(400).json({ error: `Trop d'articles en une fois (maximum ${MAX_BULK_ITEMS})` });
      }

      const { data: existingRows, error: readErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type')
        .select('id, designation, unite, usage_count');
      if (readErr) throw readErr;
      const byKey = new Map<string, any>();
      for (const row of existingRows ?? []) byKey.set(dedupKey(row.designation, row.unite), row);

      const today = new Date().toISOString().slice(0, 10);
      const toInsert: any[] = [];
      const toUpdate: any[] = [];
      // Deux articles identiques dans le même envoi ne doivent pas produire
      // deux lignes : le premier gagne, la clé est marquée au passage.
      const seen = new Set<string>();

      for (const item of items) {
        const designation = String(item?.designation ?? '').trim();
        if (!designation) continue;
        const unite = String(item?.unite ?? '').trim();
        const key = dedupKey(designation, unite);
        if (seen.has(key)) continue;
        seen.add(key);

        const common = {
          designation, unite,
          prix_unitaire: Number(item?.prix_unitaire) || 0,
          categorie: item?.categorie ?? null,
          code: item?.code ?? null,
          lot_type: item?.lot_type ?? null,
          description: item?.description ?? null,
          notes: item?.notes ?? null,
          source: item?.source ?? null,
          date_prix: item?.date_prix ?? today,
        };

        const hit = byKey.get(key);
        if (hit) toUpdate.push({ id: hit.id, usage_count: (hit.usage_count ?? 0) + 1, ...common });
        else toInsert.push({ id: crypto.randomUUID(), usage_count: 1, ...common });
      }

      if (toInsert.length) {
        const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type').insert(toInsert);
        if (error) throw error;
      }
      for (const row of toUpdate) {
        const { id, ...patch } = row;
        const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type')
          .update(patch).eq('id', id);
        if (error) throw error;
      }

      res.status(201).json({ created: toInsert.length, updated: toUpdate.length });
    } catch (e: any) {
      console.error('[POST /api/price-library/bulk]', e);
      res.status(500).json({ error: 'Failed to save price library items: ' + e.message });
    }
  });

  app.put('/api/price-library/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { designation, unite, prix_unitaire, categorie, code, lot_type, description, notes, date_prix, favori } = req.body;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type')
        .update({ designation, unite, prix_unitaire, categorie, code, lot_type, description, notes, date_prix, favori })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/price-library/:id]', e);
      res.status(500).json({ error: 'Failed to update price library item: ' + e.message });
    }
  });

  app.delete('/api/price-library/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type')
        .delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/price-library/:id]', e);
      res.status(500).json({ error: 'Failed to delete price library item' });
    }
  });

  // Appelé sans attendre la réponse à chaque insertion depuis la bibliothèque :
  // c'est ce compteur qui fait remonter les articles réellement utilisés.
  app.post('/api/price-library/:id/used', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: row, error: readErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type')
        .select('usage_count').eq('id', req.params.id).single();
      if (readErr) throw readErr;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type')
        .update({ usage_count: ((row as any)?.usage_count ?? 0) + 1, last_used_at: new Date().toISOString() })
        .eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[POST /api/price-library/:id/used]', e);
      res.status(500).json({ error: 'Failed to record usage' });
    }
  });
}
