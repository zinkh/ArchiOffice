-- CR de chantier — suivi par lot (page 2 du modèle classique de CR de
-- réunion de chantier) : statut de présence P/R/AE/ANE, effectif, retard
-- d'exécution, retard de remise de documents, intempéries, convocation à la
-- réunion suivante, lieu. Un tableau par rapport, une entrée par lot du
-- projet — même principe additif que `attendance`/`decisions` déjà en place
-- sur cette table, aucune donnée existante n'est touchée.
ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS lot_tracking JSONB DEFAULT '[]';
