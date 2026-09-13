// L'adaptateur Dropbox.
//
// Dropbox est adressé PAR CHEMIN, mais l'identifiant qu'on mémorise est l'id
// renvoyé à l'écriture (`id:xxxxxxx`) : il survit aux déplacements et aux
// renommages faits depuis le Dropbox du cabinet, et tous les points de
// terminaison l'acceptent là où ils attendent un chemin. Un fichier déplacé à
// la main reste donc consultable depuis ArchiOffice, ce qu'un chemin mémorisé
// ne permettrait pas. Le chemin ne sert qu'au cache de dossiers.
import { Readable } from 'stream';
import {
  ExternalFolderMissingError,
  ExternalStorageError,
  type ExternalReadStream,
  type ExternalStorageProvider,
  type ExternalUploadResult,
} from '../provider';
import { registerProviderFactory } from '../providerFactory';
import { getStorageAccessToken } from '../oauthTokens';
import type { ExternalStorageConnection } from '../externalConnection';

export const DROPBOX_TOKEN_URL = 'https://api.dropbox.com/oauth2/token';
export const DROPBOX_AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
export const DROPBOX_SCOPE = 'files.content.write files.content.read files.metadata.read account_info.read';

const UPLOAD_TIMEOUT_MS = 120_000;
const CALL_TIMEOUT_MS = 20_000;

// Tout ce qui sort de l'ASCII imprimable. Exprimé en échappements plutôt qu'en
// caractères littéraux, pour que le fichier reste lisible en texte simple.
const NON_ASCII = new RegExp('[^\\u0000-\\u007f]', 'g');

/**
 * Sérialise un objet pour l'en-tête `Dropbox-API-Arg`.
 *
 * **Le piège numéro un de cette API** : un en-tête HTTP ne peut porter que de
 * l'ASCII, et Dropbox rejette en 400 tout octet au-delà. Or cet en-tête contient
 * le CHEMIN du fichier, donc le nom de l'affaire — « Réhabilitation Château »,
 * « Crèche des Tilleuls »... Avec une clientèle française, la panne est garantie
 * dès le premier dépôt si on se contente de JSON.stringify.
 *
 * Chaque caractère non-ASCII est donc réécrit en échappement \\uXXXX, que le
 * décodeur JSON de Dropbox comprend nativement.
 */
export function toAsciiJsonHeader(value: unknown): string {
  return JSON.stringify(value).replace(NON_ASCII, (ch) =>
    '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

/** Le chemin d'une ressource sous la racine Dropbox, toujours absolu. */
function asPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function statusError(status: number, detail: string, action: string): ExternalStorageError {
  if (status === 401) {
    return new ExternalStorageError(
      `Accès refusé par Dropbox (${action}). Reconnectez cet espace de stockage.`,
      'needs_reauth',
      502,
    );
  }
  if (/insufficient_space/.test(detail)) {
    return new ExternalStorageError('Votre Dropbox est plein.', 'quota_exceeded', 502);
  }
  // Dropbox renvoie 409 avec un corps typé pour ses erreurs métier ; un chemin
  // absent en fait partie et vaut « le dossier mémorisé a disparu ».
  if (/not_found/.test(detail) || status === 404) return new ExternalFolderMissingError();
  if (status === 429 || status >= 500) {
    return new ExternalStorageError('Dropbox est momentanément indisponible.', 'rate_limited', 502);
  }
  return new ExternalStorageError(`Dropbox a répondu ${status} (${action}). ${detail}`.trim(), 'unknown', 502);
}

class DropboxProvider implements ExternalStorageProvider {
  readonly kind = 'dropbox' as const;

  constructor(
    private readonly connection: ExternalStorageConnection,
    private readonly supabaseAdmin: any,
  ) {}

  private token(): Promise<string> {
    return getStorageAccessToken(this.connection, {
      tokenUrl: DROPBOX_TOKEN_URL,
      clientId: process.env.DROPBOX_CLIENT_ID,
      clientSecret: process.env.DROPBOX_CLIENT_SECRET,
      label: 'Dropbox',
      supabaseAdmin: this.supabaseAdmin,
    });
  }

  private async call(url: string, init: RequestInit, timeoutMs = CALL_TIMEOUT_MS): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${await this.token()}`, ...(init.headers || {}) },
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err instanceof ExternalStorageError) throw err;
      throw new ExternalStorageError(`Dropbox injoignable : ${err?.message || err}`, 'unreachable', 502);
    } finally {
      clearTimeout(timer);
    }
  }

  private async rpc(endpoint: string, body: unknown, action: string): Promise<any> {
    const res = await this.call(`https://api.dropboxapi.com/2/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw statusError(res.status, text, action);
    return text ? JSON.parse(text) : {};
  }

  async resolveRoot(): Promise<string> {
    const root = asPath(this.connection.root_folder_path);
    return (await this.findFolderByPath(root)) ?? this.createFolderAtPath(root);
  }

  private async findFolderByPath(path: string): Promise<string | null> {
    const res = await this.call('https://api.dropboxapi.com/2/files/get_metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const text = await res.text();
    if (res.status === 409 && /not_found/.test(text)) return null;
    if (!res.ok) throw statusError(res.status, text, 'recherche de dossier');
    return JSON.parse(text)['.tag'] === 'folder' ? path : null;
  }

  private async createFolderAtPath(path: string): Promise<string> {
    const res = await this.call('https://api.dropboxapi.com/2/files/create_folder_v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, autorename: false }),
    });
    const text = await res.text();
    // Un conflit signifie que le dossier existe déjà : c'est un succès, on ne
    // le crée que pour être sûr qu'il soit là.
    if (res.status === 409 && /conflict/.test(text)) return path;
    if (!res.ok) throw statusError(res.status, text, 'création de dossier');
    return JSON.parse(text)?.metadata?.path_display || path;
  }

  async findChildFolder(parentExternalId: string, name: string): Promise<string | null> {
    return this.findFolderByPath(`${asPath(parentExternalId)}/${name}`);
  }

  async createChildFolder(parentExternalId: string, name: string): Promise<string> {
    return this.createFolderAtPath(`${asPath(parentExternalId)}/${name}`);
  }

  async uploadFile(
    parentExternalId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<ExternalUploadResult> {
    // autorename plutot qu'ecrasement : deux pieces homonymes deposees dans la
    // meme phase ne doivent pas se remplacer en silence. Dropbox renvoie alors
    // le chemin reellement ecrit, different de celui demande — sans incidence
    // ici, puisque c'est l'id qu'on retient, pas le chemin.
    const arg = {
      path: `${asPath(parentExternalId)}/${fileName}`,
      mode: 'add',
      autorename: true,
      mute: true,
    };
    const res = await this.call(
      'https://content.dropboxapi.com/2/files/upload',
      {
        method: 'POST',
        headers: {
          'Dropbox-API-Arg': toAsciiJsonHeader(arg),
          'Content-Type': 'application/octet-stream',
        },
        body: buffer as any,
      },
      UPLOAD_TIMEOUT_MS,
    );
    const text = await res.text();
    if (!res.ok) throw statusError(res.status, text, 'dépôt du fichier');
    const data = JSON.parse(text);
    return { externalId: data.id, sizeBytes: data.size ?? buffer.length, webUrl: null };
  }

  /** Corbeille Dropbox, récupérable — pas une destruction. */
  async deleteFile(externalId: string): Promise<void> {
    const res = await this.call('https://api.dropboxapi.com/2/files/delete_v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: externalId }),
    });
    const text = await res.text();
    if (res.status === 409 && /not_found/.test(text)) return; // déjà supprimé
    if (!res.ok) throw statusError(res.status, text, 'suppression');
  }

  /**
   * Dropbox sait produire un lien de téléchargement direct valable quatre
   * heures. Il est propre au porteur et expire de lui-même : il n'élargit PAS
   * le partage du fichier dans l'espace du cabinet, contrairement à un lien
   * public. La route de lecture redirige donc dessus, et aucun octet ne
   * transite par le serveur.
   */
  async getTemporaryLink(externalId: string): Promise<string | null> {
    try {
      return (await this.rpc('files/get_temporary_link', { path: externalId }, 'lien de lecture'))?.link ?? null;
    } catch {
      // Meilleur effort : en cas d'échec, openReadStream prend le relais plutôt
      // que de faire échouer la lecture.
      return null;
    }
  }

  async openReadStream(externalId: string, rangeHeader?: string): Promise<ExternalReadStream> {
    const res = await this.call('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        'Dropbox-API-Arg': toAsciiJsonHeader({ path: externalId }),
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      },
    });
    if (res.status !== 200 && res.status !== 206) {
      throw statusError(res.status, await res.text().catch(() => ''), 'lecture');
    }
    if (!res.body) throw new ExternalStorageError('Réponse vide de Dropbox.', 'unknown', 502);

    const length = res.headers.get('content-length');
    return {
      body: Readable.fromWeb(res.body as any),
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      contentLength: length ? Number(length) : null,
      status: res.status === 206 ? 206 : 200,
      contentRange: res.headers.get('content-range'),
    };
  }

  async probe(): Promise<void> {
    // `null` est bien le corps attendu par ce point de terminaison, pas un oubli.
    await this.rpc('users/get_current_account', null, 'test de connexion');
  }
}

export function registerDropboxProvider(supabaseAdmin: any): void {
  registerProviderFactory('dropbox', (connection) => new DropboxProvider(connection, supabaseAdmin));
}
