-- Corrects the Chorus Pro workflow for situations: as MOE, ArchiOffice does not
-- submit a new facture — it links to the entreprise's facture already deposited
-- on Chorus Pro (chorus_pro_id/chorus_pro_status, added in
-- migrate_chorus_pro_situations.sql) and deposits its état d'acompte as a
-- pièce jointe complémentaire on that facture. Track when that attachment was
-- deposited.
ALTER TABLE situations ADD COLUMN IF NOT EXISTS etat_acompte_joint_at TIMESTAMPTZ;
