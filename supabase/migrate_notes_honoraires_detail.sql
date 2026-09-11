-- Migration: ventilation par mission des notes d'honoraires, suivi du
-- pourcentage de facturation, lien vers la facture brouillon générée
--
-- Jusqu'ici, cotraitants_facturation/sous_traitants_facturation ne portaient
-- qu'un montant global par intervenant, sans détail par mission (ESQ, APS,
-- APD...) — contrairement à la ventilation agence (phases jsonb), qui elle
-- était déjà par mission. server/routes/notesHonoraires.ts persiste ces
-- colonnes jsonb telles quelles sans validation de forme, donc le nouveau
-- détail par mission (phases: [{phase_id, phase_name, avancement_pct,
-- montant_phase}] à l'intérieur de chaque entrée cotraitant/sous-traitant)
-- ne nécessite aucune migration de schéma — seules les colonnes suivantes,
-- non-JSON, sont réellement nouvelles.

-- Suivi du pourcentage de facturation : chaque note enregistre l'instantané
-- du cumul au moment de sa création, exactement comme "Montant à l'Acompte
-- Précédent HT" / "Montant des Honoraires Cumulés HT" sur le modèle de note
-- d'honoraires papier du cabinet — un recalcul a posteriori serait faux si
-- une note antérieure est ensuite modifiée ou supprimée.
ALTER TABLE notes_honoraires ADD COLUMN IF NOT EXISTS montant_cumule_precedent_ht numeric(12,2) DEFAULT 0;
ALTER TABLE notes_honoraires ADD COLUMN IF NOT EXISTS montant_cumule_ht numeric(12,2) DEFAULT 0;
ALTER TABLE notes_honoraires ADD COLUMN IF NOT EXISTS pct_facturation_cumule numeric(5,2) DEFAULT 0;

-- Chaque note d'honoraires peut générer au plus une facture brouillon
-- (agence uniquement, cf. POST /api/notes_honoraires/:id/facture) — ce lien
-- rend l'opération idempotente : rappeler la route sur une note déjà
-- facturée renvoie la facture existante au lieu d'en recréer une.
ALTER TABLE notes_honoraires ADD COLUMN IF NOT EXISTS invoice_id text REFERENCES invoices(id) ON DELETE SET NULL;
