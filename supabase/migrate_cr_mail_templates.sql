-- Diffusion des comptes-rendus de chantier par e-mail : modèles personnalisables et
-- attribution d'une observation à d'autres intervenants que les entreprises de lot.
--
--   settings.cr_mail_subject_template : objet du message (variables entre accolades), vide = modèle par défaut ;
--   settings.cr_mail_body_template    : texte d'introduction du message, vide = modèle par défaut ;
--   observations.contact_ids          : fiches contact (maîtrise d'ouvrage, bureau de contrôle, BET...) qui
--                                       reçoivent l'observation en plus des entreprises des lots visés.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS cr_mail_subject_template TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS cr_mail_body_template TEXT;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS contact_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
