-- Meetings ("réunions de chantier") — table was missing entirely in production
-- despite a full CRUD API in server.ts and a documented Meeting type in
-- src/types.ts. Every /api/meetings* call was failing (404 from PostgREST).

CREATE TABLE IF NOT EXISTS meetings (
  id          TEXT PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
  proposal_id TEXT REFERENCES proposals(id) ON DELETE CASCADE,
  tender_id   TEXT REFERENCES tenders(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'projet' CHECK (type IN ('projet', 'visite_candidature', 'visite_proposition')),
  title       TEXT NOT NULL,
  date        TIMESTAMPTZ NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS meeting_photos (
  id          TEXT PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  meeting_id  TEXT REFERENCES meetings(id) ON DELETE CASCADE NOT NULL,
  file_url    TEXT NOT NULL,
  caption     TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meeting_attendees (
  id          TEXT PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  meeting_id  TEXT REFERENCES meetings(id) ON DELETE CASCADE NOT NULL,
  contact_id  TEXT REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
  role        TEXT,
  UNIQUE (meeting_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_meetings_tenant_project  ON meetings(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_meetings_tenant_date      ON meetings(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_meeting_photos_meeting     ON meeting_photos(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_attendees_meeting  ON meeting_attendees(meeting_id);

ALTER TABLE meetings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_photos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_attendees  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON meetings
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON meeting_photos
  USING (tenant_id = my_tenant_id());
CREATE POLICY "tenant_isolation" ON meeting_attendees
  USING (tenant_id = my_tenant_id());
