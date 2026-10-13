-- Indice de révision et date de diffusion de l'étude de faisabilité d'une
-- proposition. Imprimés sur la page de garde et dans l'en-tête des exports
-- PDF et Word (src/lib/feasibilityExport.ts), saisis dans le volet « Étude de
-- faisabilité » (PUT /api/proposals/:id/feasibility-meta).
-- NULL : l'export retombe sur l'indice « A » et la date du jour.

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS feasibility_indice TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS feasibility_issue_date DATE;
