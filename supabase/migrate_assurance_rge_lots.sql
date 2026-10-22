-- Attestation d'assurance : une qualification « assurance » de la fiche
-- entreprise (contact_qualifications), qui porte déjà dates de début et de fin.
-- Le CHECK d'origine ne connaît pas cet organisme.
--
-- RGE exigé par un lot : project_lots.rge_required (faux par défaut, donc aucun
-- lot existant ne change de comportement). Lu par les suggestions IA
-- (src/lib/copilotSuggestions.ts) pour signaler une entreprise titulaire sans
-- qualification RGE en cours de validité.
ALTER TABLE contact_qualifications DROP CONSTRAINT IF EXISTS contact_qualifications_organisme_check;
ALTER TABLE contact_qualifications
  ADD CONSTRAINT contact_qualifications_organisme_check
  CHECK (organisme IN ('qualibat', 'qualifelec', 'qualit_enr', 'certibat', 'rge', 'assurance', 'autre'));

ALTER TABLE project_lots ADD COLUMN IF NOT EXISTS rge_required BOOLEAN NOT NULL DEFAULT false;
