// ── Notifications poussées ──────────────────────────────────────────────────
// Le pendant « hors application » du flux d'activité : une alerte de facture
// échue n'a d'intérêt que si elle atteint la personne quand ArchiOffice est
// fermé. Le mail le faisait déjà (server/mailer.ts) mais avec la latence et le
// bruit d'une boîte de réception ; ce module ajoute la notification système.
//
// Une seule source, deux transports, parce qu'aucun des deux ne couvre tous
// les postes :
//
//  * Web Push (VAPID) — la PWA installée. Fonctionne application fermée, y
//    compris sur iOS 16.4+ à condition que l'app soit sur l'écran d'accueil.
//    Aucun service de push n'est joignable sans les clés VAPID : sans elles
//    ce transport se tait, il ne casse rien.
//
//  * L'outbox `notification_outbox` — le client Electron. Chromium embarqué
//    n'est enregistré auprès d'aucun service de push (FCM et consorts sont
//    liés au navigateur, pas à l'application), donc le poste de travail vient
//    chercher ses notifications par /api/notifications/pending et les affiche
//    avec l'API native d'Electron. Les deux colonnes de livraison sont
//    distinctes : le même événement peut légitimement sonner sur le téléphone
//    par Web Push et sur le poste par l'outbox.
//
// Écrire dans l'outbox est donc inconditionnel ; l'envoi Web Push est le
// meilleur effort par-dessus.
import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tenantScopedFrom } from './tenantScopedFrom';

export interface NotificationPayload {
  title: string;
  body?: string;
  /** Route in-app ouverte au clic. Toujours relative (ex. "/notifications"). */
  url?: string;
  /** Une des catégories du flux — sert au filtrage par préférence. */
  category?: string;
  /** Deux notifications de même tag se remplacent au lieu de s'empiler. */
  tag?: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

let vapidConfigured: boolean | null = null;

/**
 * Les clés VAPID restent dans l'environnement, jamais en base : c'est la même
 * ligne que pour les clés de fournisseur IA. Générables par
 * `node scripts/generate-vapid-keys.mjs`.
 */
export function isWebPushConfigured(): boolean {
  if (vapidConfigured !== null) return vapidConfigured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    vapidConfigured = false;
    return false;
  }
  // Le « subject » est l'adresse de contact que le service de push utilise
  // pour joindre l'éditeur en cas d'abus. Une URL https ou un mailto:.
  const subject = process.env.VAPID_SUBJECT || process.env.APP_URL || 'mailto:contact@aazs.fr';
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  } catch (err: any) {
    console.error('[push] Clés VAPID invalides, Web Push désactivé :', err.message);
    vapidConfigured = false;
  }
  return vapidConfigured;
}

export function webPushPublicKey(): string | null {
  return isWebPushConfigured() ? process.env.VAPID_PUBLIC_KEY! : null;
}

/** Catégories que cette personne a explicitement coupées. */
function mutedCategories(prefs: any): Set<string> {
  const muted = prefs && Array.isArray(prefs.muted) ? prefs.muted : [];
  return new Set(muted.map((c: unknown) => String(c)));
}

/**
 * Envoie une charge utile à tous les abonnements d'une personne. Un endpoint
 * que le service de push déclare mort (404/410) est supprimé sur-le-champ :
 * un navigateur désinstallé ou un abonnement révoqué produirait sinon un
 * échec à chaque notification, indéfiniment.
 */
async function pushToUser(
  supabaseAdmin: SupabaseClient,
  tenantId: string,
  userId: string,
  payload: NotificationPayload & { id: string },
): Promise<number> {
  const { data: subs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  const rows = (subs || []) as unknown as SubscriptionRow[];
  if (!rows.length) return 0;

  const body = JSON.stringify(payload);
  let delivered = 0;

  for (const sub of rows) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      );
      delivered++;
      await supabaseAdmin
        .from('push_subscriptions')
        .update({ last_success_at: new Date().toISOString() })
        .eq('id', sub.id);
    } catch (err: any) {
      const status = err?.statusCode;
      if (status === 404 || status === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
      } else {
        console.error(`[push] Envoi échoué (${status ?? 'sans code'}) :`, err?.message);
      }
    }
  }
  return delivered;
}

/**
 * Point d'entrée unique : dépose la notification dans l'outbox pour chaque
 * destinataire non muet sur cette catégorie, puis tente le Web Push.
 * Ne lève jamais — une notification ratée ne doit pas faire échouer l'action
 * métier qui l'a déclenchée.
 */
export async function notifyUsers(
  supabaseAdmin: SupabaseClient,
  tenantId: string,
  userIds: string[],
  payload: NotificationPayload,
): Promise<void> {
  try {
    const recipients = [...new Set(userIds.filter(Boolean))];
    if (!recipients.length) return;

    const { data: profiles } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles')
      .select('id, notification_prefs')
      .in('id', recipients);

    const prefsById = new Map(
      ((profiles || []) as any[]).map(p => [String(p.id), p.notification_prefs]),
    );

    const targets = recipients.filter(id => {
      if (!payload.category) return true;
      return !mutedCategories(prefsById.get(id)).has(payload.category);
    });
    if (!targets.length) return;

    const createdAt = new Date().toISOString();
    const rows = targets.map(userId => ({
      id: crypto.randomUUID(),
      user_id: userId,
      title: payload.title,
      body: payload.body ?? null,
      url: payload.url ?? null,
      category: payload.category ?? null,
      tag: payload.tag ?? null,
      created_at: createdAt,
    }));

    const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'notification_outbox').insert(rows);
    if (error) {
      console.error('[push] Écriture dans notification_outbox impossible :', error.message);
      return;
    }

    if (!isWebPushConfigured()) return;

    for (const row of rows) {
      const delivered = await pushToUser(supabaseAdmin, tenantId, row.user_id, {
        id: row.id,
        title: payload.title,
        body: payload.body,
        url: payload.url,
        category: payload.category,
        tag: payload.tag,
      });
      if (delivered > 0) {
        await supabaseAdmin
          .from('notification_outbox')
          .update({ web_push_at: new Date().toISOString() })
          .eq('id', row.id);
      }
    }
  } catch (err: any) {
    console.error('[push] notifyUsers en échec :', err?.message);
  }
}

/** Les administrateurs du cabinet — même destinataire que notifyTenantAdmins. */
export async function notifyTenantAdminsPush(
  supabaseAdmin: SupabaseClient,
  tenantId: string,
  payload: NotificationPayload,
): Promise<void> {
  try {
    const { data: admins } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles')
      .select('id')
      .eq('system_role', 'admin');
    await notifyUsers(supabaseAdmin, tenantId, ((admins || []) as any[]).map(a => String(a.id)), payload);
  } catch (err: any) {
    console.error('[push] notifyTenantAdminsPush en échec :', err?.message);
  }
}
