-- Miniature d'affichage des photos de réserves (OPR et GPA).
--
-- Une liste d'OPR montre des centaines de cases de 64 px ; chacune téléchargeait la photo de 1600 px.
-- `thumb_url` référence une miniature de 480 px générée par le serveur à l'envoi, rangée à côté de la
-- photo dans le bucket `reserve-photos` (`<cabinet>/<réserve>/<photo>-thumb.jpg`). Elle ne sert qu'à
-- l'affichage : la fiche, l'export PDF et l'impression lisent toujours `file_url`.
--
-- Colonne facultative : NULL pour toutes les photos antérieures (l'écran retombe sur `file_url`) et
-- pour une image déjà plus petite que la miniature. Additive, sans valeur par défaut : rien à
-- reprendre dans les lignes existantes (voir scripts/backfill-reserve-photo-thumbs.ts pour en créer
-- après coup). Une instance qui n'a pas encore joué cette migration fonctionne à l'identique : le
-- serveur enregistre alors la photo sans miniature.

ALTER TABLE reserve_photos ADD COLUMN IF NOT EXISTS thumb_url TEXT;
