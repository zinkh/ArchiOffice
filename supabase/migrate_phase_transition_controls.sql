-- Configuration par projet ; réponses historisées sur la phase entrante.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS phase_control_config JSONB;
ALTER TABLE project_phase_history ADD COLUMN IF NOT EXISTS control_audit JSONB;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS phase_transition_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS phase_control_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_phase_control_unique
  ON tasks(tenant_id, phase_transition_id, phase_control_id)
  WHERE phase_transition_id IS NOT NULL;

-- Appel serveur uniquement : le moteur valide les règles et les réponses.
-- Le verrou de projet sérialise les doubles clics / deux navigateurs.
CREATE OR REPLACE FUNCTION commit_phase_transition(
  p_tenant_id UUID, p_project_id TEXT, p_expected_id TEXT,
  p_expected_config JSONB, p_phase TEXT, p_id TEXT, p_audit JSONB, p_tasks JSONB
) RETURNS JSONB LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  project_row projects%ROWTYPE;
  current_row project_phase_history%ROWTYPE;
  result_row project_phase_history%ROWTYPE;
  task JSONB;
  control JSONB;
  stamp TEXT := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  SELECT * INTO project_row FROM projects
    WHERE id = p_project_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found'; END IF;
  IF project_row.phase_control_config IS DISTINCT FROM p_expected_config THEN
    RAISE EXCEPTION 'Configuration changed' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO current_row FROM project_phase_history
    WHERE project_id = p_project_id AND tenant_id = p_tenant_id AND exited_at IS NULL
    ORDER BY entered_at DESC LIMIT 1;
  IF current_row.id IS DISTINCT FROM p_expected_id THEN
    RAISE EXCEPTION 'Phase changed' USING ERRCODE = '40001';
  END IF;
  IF p_phase NOT IN ('DIAG','ESQ','APS','APD','PC','PRO','DCE','ACT','VISA','DET','AOR') THEN
    RAISE EXCEPTION 'Invalid phase';
  END IF;
  FOR control IN SELECT value FROM jsonb_array_elements(p_audit->'controls') LOOP
    IF control->'answer'->>'documentId' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM documents WHERE id = control->'answer'->>'documentId'
        AND project_id = p_project_id AND tenant_id = p_tenant_id
    ) THEN RAISE EXCEPTION 'Evidence changed' USING ERRCODE = '40001'; END IF;
  END LOOP;
  UPDATE project_phase_history SET exited_at = stamp
    WHERE project_id = p_project_id AND tenant_id = p_tenant_id AND exited_at IS NULL;
  INSERT INTO project_phase_history(id, tenant_id, project_id, phase, entered_at, control_audit)
    VALUES (p_id, p_tenant_id, p_project_id, p_phase, stamp,
      p_audit || jsonb_build_object('task_ids', (SELECT coalesce(jsonb_agg(value->>'id'), '[]'::jsonb) FROM jsonb_array_elements(p_tasks))))
    RETURNING * INTO result_row;
  FOR task IN SELECT value FROM jsonb_array_elements(p_tasks) LOOP
    INSERT INTO tasks(id, tenant_id, project_id, title, description, start_date, end_date,
      due_date, status, priority, assignee_id, created_by, progress, dependencies, phase_transition_id, phase_control_id)
    VALUES (task->>'id', p_tenant_id, p_project_id, task->>'title', task->>'description',
      task->>'start_date', task->>'end_date', task->>'due_date', 'todo', task->>'priority',
      task->>'assignee_id', task->>'created_by', 0, '[]', p_id, task->>'phase_control_id');
  END LOOP;
  RETURN to_jsonb(result_row);
END;
$$;
REVOKE ALL ON FUNCTION commit_phase_transition(UUID,TEXT,TEXT,JSONB,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION commit_phase_transition(UUID,TEXT,TEXT,JSONB,TEXT,TEXT,JSONB,JSONB) TO service_role;
  END IF;
END $$;
