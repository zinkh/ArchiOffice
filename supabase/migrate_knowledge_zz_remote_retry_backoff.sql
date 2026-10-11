-- Suppressions distantes Mistral : compteur d'échecs et prochaine tentative.
-- Sans elles, une suppression qui échoue de façon durable (ex. plusieurs copies
-- distantes) était retentée chaque minute, sans fin et sans alerte.
-- Ajout seul, sans effet sur les lignes existantes ; le code reste compatible
-- avec une instance où cette migration n'est pas encore passée.
ALTER TABLE public.knowledge_remote_documents
  ADD COLUMN IF NOT EXISTS delete_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_knowledge_remote_next_attempt
  ON public.knowledge_remote_documents (next_attempt_at)
  WHERE state <> 'deleted' AND deletion_requested_at IS NOT NULL;
