-- ============================================================
-- MIGRATION : Notifications push (PWA Web Push + client Electron)
-- À exécuter dans le SQL Editor Supabase.
--
-- Deux tables, une par rôle :
--
--  * push_subscriptions — les abonnements Web Push d'un utilisateur, un par
--    navigateur/appareil. L'endpoint est la clé naturelle donnée par le
--    service de push (FCM, Mozilla, WNS) : il est unique, et c'est lui qui
--    revient en 404/410 quand l'abonnement est mort, auquel cas le serveur
--    supprime la ligne (server/push.ts).
--
--  * notification_outbox — une ligne par notification destinée à une
--    personne. C'est la source unique des deux transports : le Web Push la
--    pousse tout de suite quand un abonnement existe, et le client Electron
--    (qui n'a pas de service de push) vient la chercher en interrogeant
--    /api/notifications/pending. Les colonnes de livraison sont donc
--    distinctes : un même événement peut partir par les deux canaux sur deux
--    appareils différents sans que l'un annule l'autre.
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_success_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(tenant_id, user_id);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  -- Route in-app ouverte au clic sur la notification (ex. /projects/xxx).
  -- Toujours un chemin relatif : le service worker et le client Electron la
  -- résolvent contre leur propre origine, jamais contre un domaine reçu.
  url TEXT,
  category TEXT,
  -- Regroupement côté système : une notification qui porte le même tag
  -- remplace la précédente au lieu de s'empiler.
  tag TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  web_push_at TIMESTAMPTZ,
  desktop_delivered_at TIMESTAMPTZ
);

-- Sert la requête du client Electron : « mes lignes non encore remises au
-- bureau, les plus récentes d'abord ».
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
  ON notification_outbox(tenant_id, user_id, desktop_delivered_at, created_at DESC);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON push_subscriptions;
CREATE POLICY tenant_isolation ON push_subscriptions USING (tenant_id = my_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON notification_outbox;
CREATE POLICY tenant_isolation ON notification_outbox USING (tenant_id = my_tenant_id());

-- Préférences par personne, pas par cabinet : { "muted": ["Messages", ...] }.
-- Absent ou vide = toutes les catégories sont notifiées.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{}'::jsonb;

-- Rattrapage pour un projet où les deux tables ont déjà été créées sans la
-- clé étrangère : sans elle, supprimer une personne laisserait derrière elle
-- ses abonnements et ses notifications non lues.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_user_id_fkey') THEN
    ALTER TABLE push_subscriptions
      ADD CONSTRAINT push_subscriptions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_outbox_user_id_fkey') THEN
    ALTER TABLE notification_outbox
      ADD CONSTRAINT notification_outbox_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;
