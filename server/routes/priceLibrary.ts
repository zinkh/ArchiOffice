// ── Bibliothèque d'ouvrages du cabinet ───────────────────────────────────────
// articles_type existe depuis l'origine mais n'a jamais servi. Elle est devenue
// le catalogue réutilisable d'un projet à l'autre, alimenté depuis les BPU et
// relu pour en amorcer de nouveaux ; elle porte désormais aussi le classement
// sur les trois référentiels (SfB, NF DTU, NAF — voir routes/referentiels.ts),
// la provenance de chaque article et son historique de prix.
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

/** Colonnes de classement, toutes facultatives et toutes des clés étrangères. */
const CLASSEMENT = ['sfb_code', 'dtu_code', 'corps_etat_code', 'naf_code'] as const;

/** Provenances acceptées, en regard du CHECK posé sur la colonne `origine`. */
const ORIGINES = ['reference', 'saisie', 'bpu', 'offre', 'import'];

/** Clé de dédoublonnage : sans elle la bibliothèque se remplit de quasi-doublons. */
const dedupKey = (designation: string, unite: string) =>
  `${(designation || '').trim().toLowerCase()}|${(unite || '').trim().toLowerCase()}`;

/** Une chaîne vide venue d'un <select> vide doit poser NULL, pas casser la FK. */
const nullIfBlank = (v: any) => {
  const s = typeof v === 'string' ? v.trim() : v;
  return s === '' || s === undefined ? null : s;
};

export function registerPriceLibraryRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {

  // Recherche côté serveur : une bibliothèque mûre fait des milliers de lignes,
  // on ne l'envoie pas en entier au client à chaque ouverture du panneau.
  app.get('/api/price-library', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { q, categorie, lot_type, sort, origine } = req.query;
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_LIMIT);

      let query = tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type').select('*');
      if (categorie) query = query.eq('categorie', categorie);
      if (lot_type) query = query.eq('lot_type', lot_type);
      if (origine) query = query.eq('origine', origine);
      // Filtres de classement. Le corps d'état est le plus large des trois et
      // celui par lequel un architecte entre dans la bibliothèque ; le DTU et
      // l'élément SfB affinent à l'intérieur.
      for (const col of CLASSEMENT) {
        const value = req.query[col];
        if (value) query = query.eq(col, value);
      }
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

  // Combien d'articles par corps d'état : la page en a besoin pour afficher
  // l'arbre de la nomenclature FFB avec ses effectifs, avant même qu'on ait
  // cliqué sur un métier.
  app.get('/api/price-library/repartition', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type')
        .select('corps_etat_code, dtu_code, origine');
      if (error) throw error;
      const compte = (key: string) => {
        const out: Record<string, number> = {};
        for (const row of (data ?? []) as any[]) {
          const v = row[key];
          if (v) out[v] = (out[v] ?? 0) + 1;
        }
        return out;
      };
      res.json({
        total: (data ?? []).length,
        parCorpsEtat: compte('corps_etat_code'),
        parDtu: compte('dtu_code'),
        parOrigine: compte('origine'),
      });
    } catch (e: any) {
      console.error('[GET /api/price-library/repartition]', e);
      res.status(500).json({ error: 'Failed to fetch repartition' });
    }
  });

  // Création à l'unité depuis la bibliothèque. Jusqu'ici seul l'envoi en lot
  // depuis un BPU alimentait la table : un article ne pouvait pas naître d'une
  // saisie directe, alors que c'est ainsi que le fonds propre du cabinet se
  // constitue. `origine` vaut 'saisie' par défaut, c'est ce qui repère ces
  // articles-là dans les CCTP et DPGF.
  app.post('/api/price-library', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const designation = String(req.body?.designation ?? '').trim();
      if (!designation) return res.status(400).json({ error: 'La désignation est obligatoire' });

      const origine = ORIGINES.includes(req.body?.origine) ? req.body.origine : 'saisie';
      const prix = Number(req.body?.prix_unitaire) || 0;
      const today = new Date().toISOString().slice(0, 10);
      const row: Record<string, any> = {
        id: crypto.randomUUID(),
        designation,
        unite: String(req.body?.unite ?? '').trim(),
        prix_unitaire: prix,
        categorie: nullIfBlank(req.body?.categorie),
        code: nullIfBlank(req.body?.code),
        lot_type: nullIfBlank(req.body?.lot_type),
        description: nullIfBlank(req.body?.description),
        notes: nullIfBlank(req.body?.notes),
        source: nullIfBlank(req.body?.source),
        date_prix: nullIfBlank(req.body?.date_prix) ?? today,
        origine,
        created_by: req.user.id,
        usage_count: 0,
      };
      for (const col of CLASSEMENT) row[col] = nullIfBlank(req.body?.[col]);

      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type')
        .insert(row).select().single();
      if (error) throw error;

      // Le prix de création est la première observation : sans elle, un article
      // saisi à la main n'aurait pas d'historique tant qu'aucune offre n'est
      // arrivée, et sa fiche prix s'afficherait vide alors qu'un prix est là.
      if (prix > 0) {
        await tenantScopedFrom(supabaseAdmin, tenantId, 'article_prix_observations').insert({
          article_id: row.id, prix_ht: prix, unite: row.unite,
          date_observation: row.date_prix, origine: origine === 'reference' ? 'import' : 'saisie',
          created_by: req.user.id,
        });
      }
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/price-library]', e);
      res.status(500).json({ error: 'Failed to create price library item: ' + e.message });
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
        // `origine` n'est posée qu'à la création : un article saisi à la main
        // puis re-remonté par un BPU garde sa provenance d'origine, sinon le
        // repère « créé par le cabinet » s'effacerait au premier import.
        if (hit) toUpdate.push({ id: hit.id, usage_count: (hit.usage_count ?? 0) + 1, ...common });
        else toInsert.push({
          id: crypto.randomUUID(), usage_count: 1, origine: 'bpu',
          created_by: req.user.id, ...common,
        });
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
      const patch: Record<string, any> = {
        designation, unite, prix_unitaire,
        categorie: nullIfBlank(categorie), code: nullIfBlank(code), lot_type: nullIfBlank(lot_type),
        description: nullIfBlank(description), notes: nullIfBlank(notes),
        date_prix: nullIfBlank(date_prix), favori,
      };
      // Le classement n'est modifié que si le client l'envoie : un PUT partiel
      // venu d'un écran qui ne montre pas ces champs ne doit pas les effacer.
      for (const col of CLASSEMENT) {
        if (col in req.body) patch[col] = nullIfBlank(req.body[col]);
      }
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type')
        .update(patch).eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/price-library/:id]', e);
      res.status(500).json({ error: 'Failed to update price library item: ' + e.message });
    }
  });

  // ── Historique de prix ─────────────────────────────────────────────────────
  // `prix_unitaire` porte le prix courant, celui qu'on injecte dans un DPGF.
  // Les observations gardent chaque prix constaté sans l'écraser : c'est ce qui
  // permet de lire une fourchette, et c'est là que viendront se déverser les
  // réponses des entreprises aux appels d'offres.
  app.get('/api/price-library/:id/prix', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'article_prix_observations')
        .select('*').eq('article_id', req.params.id)
        .order('date_observation', { ascending: false });
      if (error) throw error;

      const prix = (data ?? []).map((o: any) => Number(o.prix_ht)).filter((n: number) => Number.isFinite(n));
      const tri = [...prix].sort((a, b) => a - b);
      // Médiane plutôt que moyenne : une offre anormalement basse fausse la
      // moyenne, alors que c'est justement ce qu'on cherche à repérer.
      const mediane = tri.length === 0 ? null
        : tri.length % 2 ? tri[(tri.length - 1) / 2]
          : (tri[tri.length / 2 - 1] + tri[tri.length / 2]) / 2;

      res.json({
        observations: data ?? [],
        stats: tri.length
          ? { nombre: tri.length, min: tri[0], max: tri[tri.length - 1], mediane }
          : { nombre: 0, min: null, max: null, mediane: null },
      });
    } catch (e: any) {
      console.error('[GET /api/price-library/:id/prix]', e);
      res.status(500).json({ error: 'Failed to fetch price observations' });
    }
  });

  app.post('/api/price-library/:id/prix', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const prix = Number(req.body?.prix_ht);
      if (!Number.isFinite(prix)) return res.status(400).json({ error: 'Prix HT invalide' });

      const { data: article, error: readErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type')
        .select('id, unite').eq('id', req.params.id).maybeSingle();
      if (readErr) throw readErr;
      if (!article) return res.status(404).json({ error: 'Article introuvable' });

      const origine = ['saisie', 'bpu', 'offre', 'marche', 'import'].includes(req.body?.origine)
        ? req.body.origine : 'saisie';
      const dateObs = nullIfBlank(req.body?.date_observation) ?? new Date().toISOString().slice(0, 10);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'article_prix_observations')
        .insert({
          article_id: req.params.id,
          prix_ht: prix,
          unite: nullIfBlank(req.body?.unite) ?? (article as any).unite,
          date_observation: dateObs,
          origine,
          entreprise: nullIfBlank(req.body?.entreprise),
          project_id: nullIfBlank(req.body?.project_id),
          tender_id: nullIfBlank(req.body?.tender_id),
          notes: nullIfBlank(req.body?.notes),
          created_by: req.user.id,
        }).select().single();
      if (error) throw error;

      // Reprendre l'observation comme prix courant reste un choix explicite :
      // une offre isolée ne doit pas redéfinir d'office le prix que le cabinet
      // met dans ses DPGF.
      if (req.body?.definir_comme_courant) {
        const { error: updErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'articles_type')
          .update({ prix_unitaire: prix, date_prix: dateObs }).eq('id', req.params.id);
        if (updErr) throw updErr;
      }
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/price-library/:id/prix]', e);
      res.status(500).json({ error: 'Failed to add price observation: ' + e.message });
    }
  });

  app.delete('/api/price-library/prix/:observationId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'article_prix_observations')
        .delete().eq('id', req.params.observationId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/price-library/prix/:observationId]', e);
      res.status(500).json({ error: 'Failed to delete price observation' });
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
