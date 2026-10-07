// Dépôt de fichier en deux temps pour le serveur MCP : create_upload_url rend
// une URL signée vers laquelle le client envoie les octets bruts (PUT), sans
// jamais les faire passer en base64 par le modèle.
//
// La signature (HMAC, voir server/mcpUploadTicket.ts) et la route de réception
// vivent côté serveur hôte : ce paquet n'importe rien de server/ (même raison
// que setExternalFileReader), donc l'émission passe par un hook posé au
// démarrage par server.ts.
export interface UploadUrlRequest {
  /** L'en-tête Authorization de l'appel MCP : l'émetteur en déduit la personne. */
  authorization: string;
  tenantId?: string | null;
  resource: string;
  resourceId: string;
  fileName: string;
  mimeType: string;
  category?: string;
  description?: string;
}

export type UploadUrlResult =
  | { url: string; expiresInSeconds: number; maxBytes: number }
  | { error: string };

export type UploadUrlIssuer = (request: UploadUrlRequest) => Promise<UploadUrlResult>;

let issuer: UploadUrlIssuer | null = null;

export function setMcpUploadUrlIssuer(fn: UploadUrlIssuer | null): void {
  issuer = fn;
}

export async function issueUploadUrl(request: UploadUrlRequest): Promise<UploadUrlResult> {
  if (!issuer) return { error: "L'envoi par URL signée n'est pas disponible sur cette instance : utilise file_url (lien https public ou signé) à la place." };
  return issuer(request);
}
