import type { Express } from 'express';
import { createOAuthState, consumeOAuthState, oauthErrorParam } from '../oauthState';
import { encryptSecret, decryptSecretMaybe } from '../secretsCrypto';
import { fetchWithTimeout } from '../fetchWithTimeout';
import { zohoSignDc } from '../signatures';
interface Deps { supabaseAdmin: any; getTenantId: (id: string) => Promise<string>; requireTenantAdmin: (id: string) => Promise<string> }
export function registerZohoSignRoutes(app: Express, { supabaseAdmin: db, getTenantId, requireTenantAdmin }: Deps) {
  const callbackUrl = () => {
    if (!process.env.APP_URL) throw new Error('APP_URL doit être configuré.');
    return process.env.ZOHO_SIGN_REDIRECT_URI || process.env.APP_URL.replace(/\/$/, '') + '/api/zoho-sign/callback';
  };
  const settingsFor = async (tenantId: string) => {
    const { data, error } = await db.from('settings').select('*').eq('tenant_id', tenantId).maybeSingle();
    if (error) throw error; return data;
  };
  app.get('/api/zoho-sign/status', async (req: any, res: any) => {
    try {
      const s = await settingsFor(await getTenantId(req.user.id));
      res.json({ connected: !!s?.zoho_sign_refresh_token, has_credentials: !!(s?.zoho_client_id && s?.zoho_client_secret), callback_url: callbackUrl() });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/zoho-sign/auth', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id); const s = await settingsFor(tenantId);
      if (!s?.zoho_client_id || !s?.zoho_client_secret) return res.status(400).json({ error: 'Renseignez les identifiants de l’application Zoho.' });
      const url = new URL('https://accounts.zoho.' + zohoSignDc(s.zoho_data_center) + '/oauth/v2/auth');
      url.search = new URLSearchParams({ client_id: s.zoho_client_id, response_type: 'code', redirect_uri: callbackUrl(),
        scope: 'ZohoSign.documents.CREATE,ZohoSign.documents.READ,ZohoSign.documents.UPDATE', access_type: 'offline', prompt: 'consent',
        state: await createOAuthState(tenantId, req.user.id, 'zoho-sign') }).toString();
      res.json({ url: url.toString() });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.message }); }
  });
  app.get('/api/zoho-sign/callback', async (req: any, res: any) => {
    try {
      const state = await consumeOAuthState(typeof req.query.state === 'string' ? req.query.state : undefined);
      if (!state || state.returnTo !== 'zoho-sign' || !state.userId || typeof req.query.code !== 'string' || req.query.error) return res.redirect('/settings?zoho_sign_error=' + oauthErrorParam(req.query.error || 'invalid_state'));
      const { data: member, error: memberError } = await db.from('tenant_memberships').select('system_role').eq('user_id', state.userId).eq('tenant_id', state.tenantId).maybeSingle();
      const { data: tenant } = await db.from('tenants').select('suspended_at').eq('id', state.tenantId).maybeSingle();
      if (memberError || member?.system_role !== 'admin' || !tenant || tenant.suspended_at) return res.redirect('/settings?zoho_sign_error=access_denied');
      const s = await settingsFor(state.tenantId);
      const response = await fetchWithTimeout('https://accounts.zoho.' + zohoSignDc(s.zoho_data_center) + '/oauth/v2/token', { method: 'POST', body: new URLSearchParams({
        code: req.query.code, client_id: s.zoho_client_id, client_secret: decryptSecretMaybe(s.zoho_client_secret), redirect_uri: callbackUrl(), grant_type: 'authorization_code',
      }) }, 30000);
      const body = await response.json() as any;
      if (!response.ok || !body.refresh_token) return res.redirect('/settings?zoho_sign_error=token_exchange_failed');
      const { error } = await db.from('settings').update({ zoho_sign_refresh_token: encryptSecret(body.refresh_token) }).eq('tenant_id', state.tenantId);
      if (error) throw error;
      res.redirect('/settings?zoho_sign_connected=1');
    } catch { res.redirect('/settings?zoho_sign_error=connection_failed'); }
  });
  app.delete('/api/zoho-sign/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { error } = await db.from('settings').update({ zoho_sign_refresh_token: null }).eq('tenant_id', tenantId);
      if (error) throw error; res.json({ success: true });
    } catch (e: any) { res.status(e.status || 500).json({ error: e.message }); }
  });
}
