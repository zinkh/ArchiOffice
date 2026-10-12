-- Autonomie des missions configurable par cabinet, sans variable d'environnement globale.
-- Les emails restent strictement opt-in ; les missions ne déclenchent aucune action métier.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS agent_missions_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS agent_missions_capture_mail BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS agent_missions_capture_mail_review BOOLEAN NOT NULL DEFAULT FALSE;
