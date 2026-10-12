-- Missions agentiques persistantes, cloisonnées par cabinet.
-- Déploiement : appliquer cette migration avant d'activer AGENT_MISSIONS_ENABLED.
CREATE TABLE IF NOT EXISTS public.agent_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  coordinator_agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE RESTRICT,
  delegate_agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'forwarded_email', 'document')),
  source_ref TEXT,
  source_excerpt TEXT NOT NULL CHECK (char_length(source_excerpt) BETWEEN 1 AND 12000),
  instruction TEXT NOT NULL DEFAULT 'Identifier les suites à donner',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'delegated', 'review', 'applying', 'completed', 'failed', 'cancelled')),
  plan JSONB,
  specialist_report TEXT,
  task_proposal JSONB,
  created_task_id UUID,
  result_text TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_missions_source_unique UNIQUE (tenant_id, source_type, source_ref)
);

CREATE INDEX IF NOT EXISTS idx_agent_missions_due
  ON public.agent_missions (status, next_attempt_at, lease_until);
CREATE INDEX IF NOT EXISTS idx_agent_missions_tenant_created
  ON public.agent_missions (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_mission_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  mission_id UUID NOT NULL REFERENCES public.agent_missions(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('created','claimed','planned','handoff','specialist','review','approved','completed','failed','cancelled','retry')),
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_mission_events_mission
  ON public.agent_mission_events (mission_id, created_at ASC);

ALTER TABLE public.agent_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_mission_events ENABLE ROW LEVEL SECURITY;

-- Même isolation que les autres ressources du cabinet, plus visibilité limitée
-- à l'auteur de la mission pour les appels directs en contexte utilisateur.
DROP POLICY IF EXISTS agent_missions_owner ON public.agent_missions;
CREATE POLICY agent_missions_owner ON public.agent_missions
  USING (tenant_id = my_tenant_id() AND created_by = auth.uid())
  WITH CHECK (tenant_id = my_tenant_id() AND created_by = auth.uid());

DROP POLICY IF EXISTS agent_mission_events_owner ON public.agent_mission_events;
CREATE POLICY agent_mission_events_owner ON public.agent_mission_events
  USING (
    tenant_id = my_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.agent_missions m
      WHERE m.id = mission_id AND m.tenant_id = tenant_id AND m.created_by = auth.uid()
    )
  );

-- Les routes API emploient supabaseAdmin et appliquent explicitement tenant_id
-- ET created_by. Ne jamais exposer directement le client service-role au navigateur.
