// ── Qualifications et certifications des entreprises ────────────────────────
// Ce qu'une entreprise détient comme qualification (Qualibat, Qualifelec, RGE...)
// et jusqu'à quand : voir supabase/migrate_contact_qualifications.sql et
// src/lib/qualifications.ts, qui porte la logique pure (statuts, validation).
//
// Rien ici n'interroge Qualibat : son API (API Entreprise) est réservée aux
// administrations. Les lignes viennent de la saisie, ou de l'import des
// qualifications RGE de l'ADEME (server/rgeLookup.ts), et un humain atteste
// de leur contrôle (`verified_at`).
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';
import { qualificationsRgeParSiret, RgeUnavailableError } from '../rgeLookup';
import { normaliserSiret, siretValide, validerQualification } from '../../src/lib/qualifications';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
}

const MAX_LIGNES = 5000;
/** Une modification de l'un de ces champs change ce que le contrôle attestait. */
const CHAMPS_ATTESTES = ['organisme', 'reference', 'date_debut', 'date_fin'];

const COLONNES = 'id, contact_id, organisme, reference, libelle, domaines, date_debut, date_fin, source, verified_at, verified_by, notes';

export function registerQualificationRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName }: RouteDeps) {
  app.get('/api/qualifications', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      let query = tenantScopedFrom(supabaseAdmin, tenantId, 'contact_qualifications').select(COLONNES);
      if (typeof req.query.contact_id === 'string' && req.query.contact_id) query = query.eq('contact_id', req.query.contact_id);
      const { data, error } = await query.order('date_fin', { ascending: true }).limit(MAX_LIGNES);
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      console.error('[GET /api/qualifications]', e?.message);
      res.status(500).json({ error: 'Impossible de lire les qualifications.' });
    }
  });

  app.post('/api/contacts/:contactId/qualifications', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { contactId } = req.params;
      if (!(await assertTenantEntity(supabaseAdmin, 'contacts', contactId, tenantId))) {
        return res.status(404).json({ error: 'Contact introuvable.' });
      }
      const parsed = validerQualification(req.body);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contact_qualifications')
        .insert({
          ...parsed.value,
          contact_id: contactId,
          source: 'saisie',
          created_by: req.user.id,
        })
        .select(COLONNES).single();
      if (error) {
        // 23505 : la même qualification (organisme + référence) existe déjà pour cette entreprise.
        if (error.code === '23505') return res.status(409).json({ error: 'Cette qualification existe déjà pour cette entreprise.' });
        throw error;
      }
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/contacts/:contactId/qualifications]', e?.message);
      res.status(500).json({ error: "Impossible d'enregistrer la qualification." });
    }
  });

  app.put('/api/qualifications/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const parsed = validerQualification(req.body, { partiel: true });
      if (!parsed.ok) return res.status(400).json({ error: parsed.error });
      const { data: existante } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contact_qualifications')
        .select(COLONNES).eq('id', req.params.id).maybeSingle();
      if (!existante) return res.status(404).json({ error: 'Qualification introuvable.' });

      const modifs: Record<string, unknown> = { ...parsed.value, updated_at: new Date().toISOString() };
      // Modifier ce que le contrôle attestait l'invalide : rien ne dit que le
      // nouveau libellé, la nouvelle échéance ont été revus contre le certificat.
      const touche = CHAMPS_ATTESTES.some(c => c in parsed.value && (parsed.value as any)[c] !== (existante as any)[c]);
      if (touche) { modifs.verified_at = null; modifs.verified_by = null; }

      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contact_qualifications')
        .update(modifs).eq('id', req.params.id).select(COLONNES).single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Cette qualification existe déjà pour cette entreprise.' });
        throw error;
      }
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/qualifications/:id]', e?.message);
      res.status(500).json({ error: 'Impossible de modifier la qualification.' });
    }
  });

  app.delete('/api/qualifications/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contact_qualifications').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/qualifications/:id]', e?.message);
      res.status(500).json({ error: 'Impossible de supprimer la qualification.' });
    }
  });

  // Atteste qu'un humain a contrôlé le certificat (sur le site de l'organisme
  // ou sur le document remis). `verified: false` retire l'attestation.
  app.post('/api/qualifications/:id/verify', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const verifiee = req.body?.verified !== false;
      const nom = verifiee ? await getUserName(tenantId, req.user.id, req.user.email) : null;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contact_qualifications')
        .update({
          verified_at: verifiee ? new Date().toISOString() : null,
          verified_by: nom,
          updated_at: new Date().toISOString(),
        })
        .eq('id', req.params.id).select(COLONNES).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Qualification introuvable.' });
      res.json(data);
    } catch (e: any) {
      console.error('[POST /api/qualifications/:id/verify]', e?.message);
      res.status(500).json({ error: 'Impossible de mettre à jour la vérification.' });
    }
  });

  // Importe les qualifications RGE de l'entreprise depuis la base ouverte de
  // l'ADEME, à partir du SIRET de sa fiche. Rejouable : l'unicité (contact,
  // organisme, référence) évite les doublons, et une ligne saisie à la main
  // n'est jamais écrasée par une donnée importée.
  app.post('/api/contacts/:contactId/qualifications/rge-sync', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { contactId } = req.params;
      const { data: contact } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
        .select('id, siret').eq('id', contactId).maybeSingle();
      if (!contact) return res.status(404).json({ error: 'Contact introuvable.' });
      const siret = normaliserSiret((contact as any).siret);
      if (!siretValide(siret)) {
        return res.status(400).json({ error: "Le SIRET de la fiche est absent ou invalide : renseignez-le pour importer les qualifications." });
      }

      let trouvees;
      try {
        trouvees = (await qualificationsRgeParSiret([siret])).get(siret) || [];
      } catch (e) {
        if (e instanceof RgeUnavailableError) return res.status(502).json({ error: `${e.message} Réessayez plus tard.` });
        throw e;
      }

      const { data: existantes } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contact_qualifications')
        .select('id, organisme, reference, source').eq('contact_id', contactId);
      const parCle = new Map((existantes || []).map((q: any) => [`${q.organisme}|${q.reference}`, q]));

      let created = 0, updated = 0, skipped = 0;
      for (const q of trouvees) {
        const deja: any = parCle.get(`${q.organisme}|${q.reference}`);
        if (!deja) {
          const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contact_qualifications')
            .insert({ ...q, contact_id: contactId, source: 'ademe', created_by: req.user.id });
          if (error) throw error;
          created++;
        } else if (deja.source === 'ademe') {
          const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contact_qualifications')
            .update({ libelle: q.libelle, domaines: q.domaines, date_debut: q.date_debut, date_fin: q.date_fin, updated_at: new Date().toISOString() })
            .eq('id', deja.id);
          if (error) throw error;
          updated++;
        } else {
          skipped++;
        }
      }

      const { data: liste } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contact_qualifications')
        .select(COLONNES).eq('contact_id', contactId).order('date_fin', { ascending: true });
      res.json({ found: trouvees.length, created, updated, skipped, qualifications: liste || [] });
    } catch (e: any) {
      console.error('[POST /api/contacts/:contactId/qualifications/rge-sync]', e?.message);
      res.status(500).json({ error: "Impossible d'importer les qualifications." });
    }
  });
}
