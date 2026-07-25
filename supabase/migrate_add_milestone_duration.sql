-- The Milestone type/UI (MilestoneGantt.tsx's "Durée"/"Après" inputs)
-- already read/write duration_days and dependencies, but these columns
-- never existed, so nothing ever persisted.
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS duration_days INTEGER;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS dependencies TEXT;
