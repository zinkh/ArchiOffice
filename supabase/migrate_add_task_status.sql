-- The Task type/UI (Kanban.tsx's 4-column board and overdue badge,
-- Calendar.tsx's completion check) has always assumed `status` and
-- `due_date` columns exist on tasks, but neither was ever added to the
-- real table — POST/PUT /api/tasks silently dropped both, so a task could
-- never actually be marked done nor carry a due date distinct from its
-- end_date.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'todo';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date TEXT;
