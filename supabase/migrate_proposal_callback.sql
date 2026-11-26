-- Migration : rappel téléphonique d'une proposition sans réponse après un mois
--
-- Une proposition envoyée depuis plus de 30 jours, sans réponse ni signature, déclenche
-- (server/proposalCallbacks.ts) un appel sortant « à traiter » dans le journal des appels
-- et une tâche liée. Ces deux colonnes gardent le lien : elles servent aussi à ne déclencher
-- le rappel qu'une seule fois par proposition.
--
-- Additive et rejouable. Une instance non migrée n'a simplement pas de rappel automatique.

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS callback_call_id TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS callback_created_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS proposals_callback_due_idx ON proposals (tenant_id, sent_at)
  WHERE status = 'Sent' AND archived_at IS NULL AND callback_call_id IS NULL;

-- Une proposition acceptée est convertie en affaire : elle est désormais rangée d'office
-- (voir PUT /api/proposals/:id). Rattrapage des propositions déjà acceptées ; « Restaurer »
-- depuis le suivi client les rouvre.
UPDATE proposals
   SET archived_at = now(), archive_reason = 'converted', next_follow_up_at = NULL
 WHERE status = 'Accepted' AND archived_at IS NULL;
