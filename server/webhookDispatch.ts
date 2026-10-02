// Dispatch des webhooks sortants (n8n, IFTTT Webhooks/Maker, ou tout
// destinataire HTTP). Même posture que notifyUsers() (server/push.ts) :
// un échec d'envoi ne doit jamais faire échouer l'action métier qui l'a
// déclenché — cette fonction n'est donc jamais awaited dans un chemin qui
// pourrait la faire remonter en erreur au client, et n'expose aucune
// exception à l'appelant.
import crypto from 'crypto';
import { assertPublicHttpUrl } from './ssrfGuard';
import { fetchWithTimeout } from './fetchWithTimeout';
import { decryptSecretMaybe } from './secretsCrypto';

const WEBHOOK_TIMEOUT_MS = 10000;

export async function dispatchWebhookEvent(
  supabaseAdmin: any,
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: hooks } = await supabaseAdmin
      .from('webhooks')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('enabled', true)
      .contains('event_types', [eventType]);
    if (!hooks || !hooks.length) return;
    await Promise.all(hooks.map((hook: any) => deliverOne(supabaseAdmin, tenantId, hook, eventType, payload)));
  } catch (err) {
    console.error('[webhookDispatch]', eventType, err);
  }
}

async function deliverOne(supabaseAdmin: any, tenantId: string, hook: any, eventType: string, payload: Record<string, unknown>) {
  const deliveryId = crypto.randomUUID();
  const body = JSON.stringify({ event: eventType, deliveryId, occurredAt: new Date().toISOString(), tenantId, data: payload });

  const { status, httpStatus, lastError } = await attemptDelivery(hook, body, eventType, deliveryId);

  await supabaseAdmin.from('webhook_deliveries').insert({
    id: deliveryId,
    webhook_id: hook.id,
    tenant_id: tenantId,
    event_type: eventType,
    payload,
    status,
    http_status: httpStatus,
    last_error: lastError,
    delivered_at: status === 'success' ? new Date().toISOString() : null,
  });
  await supabaseAdmin.from('webhooks').update({
    last_triggered_at: new Date().toISOString(),
    last_status: status,
  }).eq('id', hook.id);
}

async function attemptDelivery(hook: any, body: string, eventType: string, deliveryId: string): Promise<{ status: 'success' | 'error'; httpStatus: number | null; lastError: string | null }> {
  try {
    const url = await assertPublicHttpUrl(hook.target_url);
    const secret = decryptSecretMaybe(hook.secret_encrypted);
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const response = await fetchWithTimeout(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ArchiOffice-Event': eventType,
        'X-ArchiOffice-Delivery': deliveryId,
        'X-ArchiOffice-Signature': `sha256=${signature}`,
      },
      body,
    }, WEBHOOK_TIMEOUT_MS);
    return {
      status: response.ok ? 'success' : 'error',
      httpStatus: response.status,
      lastError: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (err: any) {
    return { status: 'error', httpStatus: null, lastError: err?.message || String(err) };
  }
}

/** POST /api/webhooks/:id/test — un "ping" ciblé sur CE webhook, sans passer
 *  par le filtre event_types de dispatchWebhookEvent (un webhook abonné à
 *  "invoice.created" seul doit quand même pouvoir être testé). */
export async function sendTestPing(supabaseAdmin: any, tenantId: string, webhookId: string): Promise<{ status: 'success' | 'error' } | null> {
  const { data: hook } = await supabaseAdmin.from('webhooks').select('*').eq('id', webhookId).eq('tenant_id', tenantId).maybeSingle();
  if (!hook) return null;
  const deliveryId = crypto.randomUUID();
  const payload = { message: 'Test depuis ArchiOffice' };
  const body = JSON.stringify({ event: 'ping', deliveryId, occurredAt: new Date().toISOString(), tenantId, data: payload });
  const { status, httpStatus, lastError } = await attemptDelivery(hook, body, 'ping', deliveryId);
  await supabaseAdmin.from('webhook_deliveries').insert({
    id: deliveryId, webhook_id: hook.id, tenant_id: tenantId, event_type: 'ping', payload,
    status, http_status: httpStatus, last_error: lastError,
    delivered_at: status === 'success' ? new Date().toISOString() : null,
  });
  await supabaseAdmin.from('webhooks').update({ last_triggered_at: new Date().toISOString(), last_status: status }).eq('id', hook.id);
  return { status };
}

/** Rejoue une livraison déjà journalisée (POST /api/webhooks/:id/deliveries/:deliveryId/retry). */
export async function retryWebhookDelivery(supabaseAdmin: any, tenantId: string, deliveryId: string): Promise<{ status: 'success' | 'error' } | null> {
  const { data: delivery } = await supabaseAdmin
    .from('webhook_deliveries')
    .select('*')
    .eq('id', deliveryId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!delivery) return null;
  const { data: hook } = await supabaseAdmin.from('webhooks').select('*').eq('id', delivery.webhook_id).eq('tenant_id', tenantId).maybeSingle();
  if (!hook) return null;

  const body = JSON.stringify({ event: delivery.event_type, deliveryId: delivery.id, occurredAt: new Date().toISOString(), tenantId, data: delivery.payload });
  const { status, httpStatus, lastError } = await attemptDelivery(hook, body, delivery.event_type, delivery.id);

  await supabaseAdmin.from('webhook_deliveries').update({
    status,
    http_status: httpStatus,
    last_error: lastError,
    attempt_count: (delivery.attempt_count || 1) + 1,
    delivered_at: status === 'success' ? new Date().toISOString() : null,
  }).eq('id', deliveryId);
  await supabaseAdmin.from('webhooks').update({ last_triggered_at: new Date().toISOString(), last_status: status }).eq('id', hook.id);

  return { status };
}
