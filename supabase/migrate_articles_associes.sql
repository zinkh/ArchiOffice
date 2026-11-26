-- Postes associés d'un article de la bibliothèque : suggérés à l'insertion
-- (menuiserie et volets roulants, doublage et peinture).
-- Forme : [{"articleId": "<articles_type.id>", "coefficient": 1}]. Aucune clé étrangère : un article
-- supprimé laisse une référence morte, ignorée à la lecture (src/lib/postesAssocies.ts).
ALTER TABLE articles_type ADD COLUMN IF NOT EXISTS associes JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN articles_type.associes IS 'Postes associés suggérés à l''insertion : [{"articleId": text, "coefficient": number}]';
