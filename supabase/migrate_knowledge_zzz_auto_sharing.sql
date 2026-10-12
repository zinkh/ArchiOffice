-- Partage automatique des extraits techniques : réglage du cabinet et suivi du
-- traitement. Ajouts seuls, sans effet sur l'existant ; le code reste
-- compatible avec une instance où cette migration n'est pas encore passée.

-- Réglage du cabinet : un consentement DISTINCT de celui de la contribution
-- manuelle, car il couvre l'analyse du texte par une IA (Mistral) avant toute
-- relecture humaine, puis l'envoi sans validation.
ALTER TABLE public.knowledge_sharing_preferences
  ADD COLUMN IF NOT EXISTS auto_share_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_share_categories text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS auto_share_consented_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_share_consented_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Suivi du traitement d'un document : origine, mode de relecture, rapport
-- d'analyse et paragraphes retenus.
ALTER TABLE public.knowledge_contributions
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS review_mode text,
  ADD COLUMN IF NOT EXISTS withheld jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS analysis jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_contributions_origin_check') THEN
    ALTER TABLE public.knowledge_contributions
      ADD CONSTRAINT knowledge_contributions_origin_check CHECK (origin IN ('manual','auto'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_contributions_review_mode_check') THEN
    ALTER TABLE public.knowledge_contributions
      ADD CONSTRAINT knowledge_contributions_review_mode_check CHECK (review_mode IS NULL OR review_mode IN ('human','auto'));
  END IF;
END $$;

-- Nouveaux états : 'queued' (en attente d'analyse), 'analyzing' (pris en charge),
-- 'held' (rien de partageable, ou analyse impossible : retenu).
ALTER TABLE public.knowledge_contributions DROP CONSTRAINT IF EXISTS knowledge_contributions_status_check;
ALTER TABLE public.knowledge_contributions
  ADD CONSTRAINT knowledge_contributions_status_check
  CHECK (status IN ('draft','queued','analyzing','held','reviewed'));

CREATE INDEX IF NOT EXISTS idx_knowledge_contributions_auto_queue
  ON public.knowledge_contributions (status, updated_at)
  WHERE origin = 'auto' AND status IN ('queued','analyzing');
