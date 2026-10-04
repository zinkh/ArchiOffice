-- Délai de paiement par défaut d'une facture, réglable par cabinet.
--
-- Jusqu'ici la date d'échéance était soit fournie par l'appelant (formulaire
-- de création de facture, +14 jours codés en dur côté écran), soit laissée
-- NULL — cas de la facture brouillon générée depuis une note d'honoraires
-- (POST /api/notes_honoraires/:id/facture), que l'écran affichait alors
-- comme "01/01/1970" (new Date(null) → epoch 0) faute de garde côté rendu.
--
-- invoice_payment_terms_days fixe le nombre de jours ajoutés à la date
-- d'émission quand aucune échéance n'est fournie explicitement
-- (server/invoiceDueDate.ts). NULL vaut 30 jours (comportement par défaut
-- déjà en usage ailleurs dans le code) — pas de backfill nécessaire.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS invoice_payment_terms_days SMALLINT;

COMMENT ON COLUMN settings.invoice_payment_terms_days IS
  'Délai de paiement par défaut (en jours) appliqué à la date d''échéance d''une facture quand elle n''est pas saisie explicitement. NULL = 30 jours.';
