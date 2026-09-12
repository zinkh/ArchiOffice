-- Visibilité des contacts personnels : les contacts "pro" restent partagés
-- par tout le cabinet, mais un contact marqué `is_personal` (déjà présent —
-- voir migrate_contacts_is_personal.sql) doit n'être visible que par la
-- personne qui l'a créé. `contacts.created_by` ne peut pas servir de repère
-- fiable : c'est un champ texte libre, déjà utilisé pour des valeurs comme
-- 'odoo' ou 'ragic' (source d'import) plutôt qu'un identifiant d'utilisateur.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_owner_user_id ON contacts(owner_user_id) WHERE is_personal;

-- Préférence personnelle (pas par cabinet, comme profiles.notification_prefs) :
-- afficher ou non ses propres contacts personnels dans la liste. Un contact
-- personnel appartenant à quelqu'un d'autre n'est de toute façon jamais
-- visible, quel que soit ce réglage — il ne joue que sur les SIENS.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS show_personal_contacts BOOLEAN NOT NULL DEFAULT true;
