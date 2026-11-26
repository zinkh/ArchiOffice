import { PDFDocument, StandardFonts } from 'pdf-lib';
import { fetchWithTimeout } from './fetchWithTimeout';
import { encryptSecret, decryptSecretMaybe } from './secretsCrypto';

export type SignatureProvider = 'firma' | 'docuseal' | 'zoho';
const FIRMA = 'https://api.firma.dev/functions/v1/signing-request-api';
export function resolveSignatureProvider(enabled: boolean, settings: any): SignatureProvider | null {
  if (enabled) return 'firma';
  if (settings?.signature_provider === 'docuseal' && settings.docuseal_api_key) return 'docuseal';
  if (settings?.signature_provider === 'zoho' && settings.zoho_sign_refresh_token) return 'zoho';
  if (settings?.docuseal_api_key) return 'docuseal';
  if (settings?.zoho_sign_refresh_token) return 'zoho';
  return null;
}
export function normalizeSignatureStatus(provider: SignatureProvider, status: string): string {
  if (provider === 'firma') return status === 'finished' ? 'completed' : ['sent', 'in_progress'].includes(status) ? 'inprogress' : status;
  if (provider === 'docuseal') return ['pending', 'sent', 'opened', 'awaiting'].includes(status) ? 'inprogress' : status;
  return status;
}
export async function firmaEnabled(db: any): Promise<boolean> {
  const { data, error } = await db.from('platform_settings').select('value').eq('key', 'firma_signature').maybeSingle();
  if (error) throw new Error('Configuration de signature indisponible.');
  return data?.value?.enabled === true;
}
export function zohoSignDc(value: unknown): string {
  const dc = value || 'eu';
  if (typeof dc !== 'string' || !['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa', 'com.cn'].includes(dc)) throw new Error('Centre de données Zoho invalide.');
  return dc;
}
export async function zohoSignToken(s: any): Promise<string> {
  if (!s?.zoho_sign_refresh_token || !s.zoho_client_id || !s.zoho_client_secret) throw new Error('Connectez Zoho Sign dans les paramètres.');
  const response = await fetchWithTimeout('https://accounts.zoho.' + zohoSignDc(s.zoho_data_center) + '/oauth/v2/token', {
    method: 'POST', body: new URLSearchParams({ refresh_token: decryptSecretMaybe(s.zoho_sign_refresh_token), client_id: s.zoho_client_id,
      client_secret: decryptSecretMaybe(s.zoho_client_secret), grant_type: 'refresh_token' }),
  }, 30000);
  const body = await response.json() as any;
  if (!response.ok || !body.access_token) throw new Error('Connexion Zoho Sign expirée. Reconnectez le service.');
  return body.access_token;
}
async function jsonRequest(url: string, key: string, method = 'GET', payload?: any, header = 'Authorization'): Promise<any> {
  const response = await fetchWithTimeout(url, {
    method, headers: { [header]: key, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  }, 30000);
  const body = await response.json() as any;
  if (!response.ok) {
    const error: any = new Error('Le fournisseur de signature a refusé la demande (' + response.status + ').');
    error.externalId = typeof body.signing_request_id === 'string' ? body.signing_request_id : undefined;
    throw error;
  }
  return body;
}
async function zohoJson(dc: string, token: string, path: string, options: RequestInit = {}): Promise<any> {
  const response = await fetchWithTimeout('https://sign.zoho.' + zohoSignDc(dc) + '/api/v1' + path, {
    ...options, headers: { ...options.headers, Authorization: 'Zoho-oauthtoken ' + token },
  }, 30000);
  const body = await response.json() as any;
  if (!response.ok || body.code !== 0 || body.status !== 'success') throw new Error('Zoho Sign a refusé la demande. Vérifiez le document et votre accès API.');
  return body;
}
export async function firmaWorkspaceKey(db: any, tenantId: string, s: any): Promise<string> {
  if (s?.firma_workspace_api_key) return decryptSecretMaybe(s.firma_workspace_api_key);
  if (!process.env.FIRMA_API_KEY) throw new Error('FIRMA_API_KEY doit être configurée par le superadmin.');
  if (!s) throw new Error('Enregistrez les paramètres du cabinet avant son premier envoi.');
  encryptSecret('preflight'); // Do not create an upstream workspace if encryption is unavailable.
  const { data: lock, error } = await db.from('settings').update({ firma_workspace_state: 'creating' })
    .eq('tenant_id', tenantId).is('firma_workspace_state', null).is('firma_workspace_api_key', null).select('tenant_id').maybeSingle();
  if (error) throw error;
  if (!lock) throw new Error('Création de l’espace Firma en cours ou à vérifier par le superadmin.');
  try {
    const workspace = await jsonRequest(FIRMA + '/workspaces', process.env.FIRMA_API_KEY, 'POST', { name: 'ArchiOffice ' + tenantId });
    const key = process.env.FIRMA_API_KEY.startsWith('firma_test_') ? workspace.test_api_key : workspace.api_key;
    if (!workspace.id || !key) throw new Error('Espace Firma incomplet.');
    const { error: saveError } = await db.from('settings').update({
      firma_workspace_id: workspace.id, firma_workspace_api_key: encryptSecret(key), firma_workspace_state: 'ready',
    }).eq('tenant_id', tenantId);
    if (saveError) throw saveError;
    return key;
  } catch (e) {
    await db.from('settings').update({ firma_workspace_state: 'unknown' }).eq('tenant_id', tenantId);
    throw e;
  }
}
export interface SignatureContext { provider: SignatureProvider; key: string; base: string }
export async function signatureContext(db: any, tenantId: string, s: any, provider: SignatureProvider): Promise<SignatureContext> {
  if (provider === 'firma') return { provider, key: await firmaWorkspaceKey(db, tenantId, s), base: FIRMA };
  if (provider === 'docuseal') {
    if (!s?.docuseal_api_key) throw new Error('DocuSeal n’est pas connecté.');
    if (!['eu', 'com'].includes(s.docuseal_region || 'eu')) throw new Error('Région DocuSeal invalide.');
    return { provider, key: decryptSecretMaybe(s.docuseal_api_key), base: 'https://api.docuseal.' + (s.docuseal_region || 'eu') };
  }
  return { provider, key: await zohoSignToken(s), base: zohoSignDc(s.zoho_data_center) };
}
export async function withSignaturePage(bytes: Uint8Array, reference: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes);
  if (pdf.getPageCount() < 1 || pdf.getPageCount() > 200) throw new Error('Le PDF doit comporter entre 1 et 200 pages.');
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('Signature de la proposition', { x: 60, y: 750, size: 18, font });
  page.drawText(reference.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').slice(0, 80), { x: 60, y: 715, size: 12, font });
  page.drawText('La signature porte sur la proposition et ses pages precedentes.', { x: 60, y: 675, size: 11, font });
  page.drawText('Accord et signature du client', { x: 60, y: 645, size: 11, font });
  return pdf.save();
}
export function zohoSignSubmitData(request: any): any {
  const action = request?.actions?.find((a: any) => a.action_type === 'SIGN');
  const document = request?.document_ids?.[0];
  if (!action?.action_id || !document?.document_id || !(document.total_pages > 0)) throw new Error('Document Zoho Sign incomplet.');
  return { requests: { actions: [{ action_id: action.action_id, action_type: 'SIGN', recipient_name: action.recipient_name,
    recipient_email: action.recipient_email, fields: [{ field_type_name: 'Signature', field_name: 'Signature client', field_label: 'Signature',
      is_mandatory: true, document_id: document.document_id, action_id: action.action_id,
      page_no: document.total_pages - 1, x_coord: 60, y_coord: 220, abs_width: 240, abs_height: 80 }] }] } };
}
export async function sendSignature(ctx: SignatureContext, input: {
  bytes: Uint8Array; name: string; email: string; title: string;
}, remember: (id: string) => Promise<void>): Promise<string> {
  const pages = (await PDFDocument.load(input.bytes)).getPageCount();
  if (ctx.provider === 'firma') {
    const names = input.name.split(/\s+/);
    const body = await jsonRequest(ctx.base + '/signing-requests/create-and-send', ctx.key, 'POST', {
      name: input.title, document: Buffer.from(input.bytes).toString('base64'), expiration_hours: 720, email_language: 'fr',
      recipients: [{ id: 'temp_client', first_name: names[0], last_name: names.slice(1).join(' '), email: input.email, designation: 'Signer', order: 1 }],
      fields: [{ recipient_id: 'temp_client', type: 'signature', page: pages, x: 60, y: 220, width: 240, height: 80, required: true }],
      settings: { send_signing_email: true, send_finish_email: true, allow_download: true },
    });
    if (!body.id) throw new Error('Identifiant Firma absent.');
    await remember(String(body.id));
    return normalizeSignatureStatus('firma', body.status || 'sent');
  }
  if (ctx.provider === 'docuseal') {
    const body = await jsonRequest(ctx.base + '/submissions/pdf', ctx.key, 'POST', {
      name: input.title, send_email: true,
      documents: [{ name: 'Proposition', file: Buffer.from(input.bytes).toString('base64'),
        fields: [{ name: 'Signature client', type: 'signature', role: 'Client', required: true,
          areas: [{ page: pages, x: 60 / 595.28, y: 220 / 841.89, w: 240 / 595.28, h: 80 / 841.89 }] }] }],
      submitters: [{ role: 'Client', email: input.email, name: input.name }],
    }, 'X-Auth-Token');
    const id = Array.isArray(body) ? body[0]?.submission_id : body.id;
    if (!id) throw new Error('Identifiant DocuSeal absent.');
    await remember(String(id));
    return 'inprogress';
  }
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(input.bytes)], { type: 'application/pdf' }), 'proposition.pdf');
  form.append('data', JSON.stringify({ requests: { request_name: input.title, is_sequential: true, expiration_days: 30, email_reminders: false,
    actions: [{ action_type: 'SIGN', recipient_email: input.email, recipient_name: input.name, signing_order: 0, verify_recipient: true, verification_type: 'EMAIL' }] } }));
  const created = await zohoJson(ctx.base, ctx.key, '/requests', { method: 'POST', body: form });
  const id = String(created.requests?.request_id || '');
  if (!id) throw new Error('Identifiant Zoho Sign absent.');
  await remember(id);
  await zohoJson(ctx.base, ctx.key, '/requests/' + encodeURIComponent(id) + '/submit', { method: 'POST',
    body: new URLSearchParams({ data: JSON.stringify(zohoSignSubmitData(created.requests)) }) });
  return 'inprogress';
}
export async function syncSignature(ctx: SignatureContext, id: string): Promise<string> {
  let raw: string;
  if (ctx.provider === 'firma') raw = (await jsonRequest(ctx.base + '/signing-requests/' + encodeURIComponent(id), ctx.key)).status;
  else if (ctx.provider === 'docuseal') raw = (await jsonRequest(ctx.base + '/submissions/' + encodeURIComponent(id), ctx.key, 'GET', undefined, 'X-Auth-Token')).status;
  else raw = (await zohoJson(ctx.base, ctx.key, '/requests/' + encodeURIComponent(id))).requests?.request_status;
  if (typeof raw !== 'string') throw new Error('État de signature absent.');
  return normalizeSignatureStatus(ctx.provider, raw);
}
export async function signatureDownload(ctx: SignatureContext, id: string): Promise<{ url: string; direct?: boolean }> {
  if (ctx.provider === 'zoho') return { url: 'https://sign.zoho.' + ctx.base + '/api/v1/requests/' + encodeURIComponent(id) + '/pdf', direct: true };
  if (ctx.provider === 'firma') {
    const body = await jsonRequest(ctx.base + '/signing-requests/' + encodeURIComponent(id) + '/download', ctx.key);
    if (body.is_partial || body.status !== 'finished') throw new Error('La signature n’est pas encore terminée.');
    return { url: body.download_url };
  }
  const body = await jsonRequest(ctx.base + '/submissions/' + encodeURIComponent(id) + '/documents', ctx.key, 'GET', undefined, 'X-Auth-Token');
  return { url: body.documents?.[0]?.url || body[0]?.url };
}
