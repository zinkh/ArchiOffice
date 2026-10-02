-- ============================================================
-- ArchiOffice — Migration : documents joints persistants sur une
-- conversation d'agent
-- ============================================================
--
-- Un document joint au chat n'était exploité (texte extrait, image en
-- vision) que pour LE tour où il est envoyé : POST /api/agents/:id/chat
-- reconstruit le contexte à chaque appel depuis le seul `document_ids` de
-- CE message, jamais depuis l'historique. Au tour suivant, sans le
-- rejoindre, l'agent ne voit plus que son nom (déjà présent dans
-- `recentDocuments`, une liste de métadonnées) — pas son contenu.
--
-- `agent_conversations.attached_document_ids` fait vivre cette liste au
-- niveau de la conversation plutôt que du seul message : un document joint
-- une fois y reste tant que la conversation n'est pas remise à zéro
-- (DELETE /api/agents/:id/conversation, « Nouvelle conversation »), qui la
-- vide avec le reste.
ALTER TABLE agent_conversations
  ADD COLUMN IF NOT EXISTS attached_document_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
