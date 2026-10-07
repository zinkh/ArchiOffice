// Réception des fichiers du serveur MCP : PUT /mcp-upload/:ticket reçoit les
// octets bruts d'une URL émise par l'outil create_upload_url et les dépose sur
// la fiche visée, avec les droits de la personne qui l'a demandée.
//
// Hors du préfixe /api (donc hors du middleware d'authentification JWT) : le
// jeton signé de l'URL est la seule autorisation, comme pour la lecture d'un
// fichier externe (server/externalStorage/externalTicket.ts). Le dépôt lui-même
// repasse par POST /api/documents, avec un jeton de relais à usage unique
// (server/agentMailRelayTokens.ts) : même validation, même quota, même journal
// d'activité qu'un dépôt depuis l'écran.
import express from 'express';
import type { Express } from 'express';
import { MCP_UPLOAD_TICKET_TTL_SECONDS, signMcpUploadTicket, verifyMcpUploadTicket } from '../mcpUploadTicket';
import { issueMailRelayToken } from '../agentMailRelayTokens';

/** Même plafond que upload_document (MAX_MCP_FILE_BYTES). */
export const MCP_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

// `getSupabaseAdmin` plutôt que le client : la route doit être enregistrée avant
// les analyseurs de corps de server.ts, donc avant que le client n'existe.
export function registerMcpUploadRoute(app: Express, getSupabaseAdmin: () => any, localBaseUrl: string) {
  app.put('/mcp-upload/:ticket', express.raw({ type: () => true, limit: MCP_UPLOAD_MAX_BYTES }), async (req: any, res: any) => {
    res.set('Cache-Control', 'no-store');
    const payload = verifyMcpUploadTicket(req.params.ticket);
    if (!payload) return res.status(401).json({ error: "URL d'envoi invalide ou expirée : demande-en une nouvelle avec create_upload_url." });
    const buffer: Buffer | undefined = Buffer.isBuffer(req.body) ? req.body : undefined;
    if (!buffer || buffer.length === 0) return res.status(400).json({ error: 'Corps vide : envoie les octets du fichier en PUT.' });

    try {
      const token = await issueMailRelayToken(getSupabaseAdmin(), payload.t, payload.u);
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: payload.m }), payload.n);
      form.append('resource_type', payload.r);
      form.append('resource_id', payload.i);
      form.append('name', payload.n);
      form.append('category', payload.c || 'Autre');
      if (payload.d) form.append('description', payload.d);
      const response = await fetch(`${localBaseUrl}/api/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Id': payload.t },
        body: form as any,
      });
      const data: any = await response.json().catch(() => null);
      if (!response.ok) return res.status(response.status).json({ error: data?.error || `Échec du dépôt (${response.status}).` });
      res.status(201).json({ id: data.id, file_name: payload.n, mime_type: payload.m, size: data.size_bytes ?? buffer.length, uploaded_at: data.uploaded_at });
    } catch (e: any) {
      console.error('[PUT /mcp-upload]', e?.message);
      res.status(500).json({ error: 'Dépôt impossible.' });
    }
  });
}

export { signMcpUploadTicket, MCP_UPLOAD_TICKET_TTL_SECONDS };
