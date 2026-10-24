// Requête HTTPS vers un hôte FOURNI PAR LE CABINET (WebDAV), avec les trois
// protections que `fetch` ne donne pas :
//
//  1. HTTPS obligatoire, à chaque saut : le mot de passe d'application part en
//     Basic Auth, il ne doit jamais circuler en clair.
//  2. Connexion ÉPINGLÉE sur l'adresse validée par le garde SSRF. Le garde résout
//     le nom, vérifie que toutes les adresses sont publiques, puis la connexion
//     s'ouvre sur CETTE adresse et non sur une seconde résolution : un DNS
//     hostile ne peut plus répondre « public » au contrôle et « 127.0.0.1 » à la
//     connexion (rebinding). Le certificat reste vérifié contre le NOM d'hôte.
//  3. Redirections suivies à la main : même origine uniquement (donc ni changement
//     d'hôte, ni retour en http, ni envoi de l'en-tête Authorization ailleurs), et
//     chaque saut repasse par le garde.
//
// Volontairement sans dépendance : `https.request` et son option `lookup` suffisent.
import https from 'https';
import type { IncomingHttpHeaders, IncomingMessage } from 'http';
import net from 'net';
import { resolvePublicUrl } from '../ssrfGuard';
import { ExternalStorageError } from './provider';

export interface PinnedResponse {
  status: number;
  headers: IncomingHttpHeaders;
  /** À consommer ou à `resume()` : une réponse laissée telle quelle garde sa connexion. */
  stream: IncomingMessage;
}

export interface PinnedRequestInit {
  method: string;
  headers?: Record<string, string>;
  body?: Buffer;
  /** Délai jusqu'aux en-têtes de la réponse (le corps d'un téléchargement n'est pas borné). */
  timeoutMs: number;
}

const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);
// Erreurs de connexion pour lesquelles une autre adresse du même hôte peut réussir
// (typiquement une adresse IPv6 sans route).
const RETRY_NEXT_ADDRESS = new Set(['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT']);

const agent = new https.Agent({ keepAlive: true, maxSockets: 8 });

/** Cible d'une redirection, ou une erreur si elle quitte l'origine d'origine. */
export function resolveRedirect(current: URL, location: string): URL {
  let next: URL;
  try {
    next = new URL(location, current);
  } catch {
    throw new ExternalStorageError('Redirection invalide renvoyée par le serveur de stockage.', 'unknown', 502);
  }
  // `origin` compare schéma, hôte et port : une redirection vers un autre hôte ou
  // vers http est refusée, et l'en-tête Authorization ne suit donc jamais.
  if (next.origin !== current.origin) {
    throw new ExternalStorageError(
      'Le serveur de stockage a redirigé vers une autre adresse : refusé par sécurité.',
      'unknown',
      502,
    );
  }
  return next;
}

function requestOnce(url: URL, address: string, init: PinnedRequestInit): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const family = net.isIPv6(address) ? 6 : 4;
    const headers: Record<string, string> = { ...(init.headers || {}) };
    if (init.body) headers['Content-Length'] = String(init.body.length);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs);

    const req = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname.replace(/^\[(.*)\]$/, '$1'),
        port: url.port || 443,
        path: url.pathname + url.search,
        method: init.method,
        headers,
        agent,
        signal: controller.signal,
        // Toute résolution du nom (y compris celle que fait TLS pour le SNI) aboutit
        // à l'adresse déjà validée.
        lookup: (_hostname, options, callback) => {
          if ((options as any)?.all) (callback as any)(null, [{ address, family }]);
          else callback(null, address, family);
        },
      },
      (res) => {
        clearTimeout(timer);
        resolve({ status: res.statusCode || 0, headers: res.headers, stream: res });
      },
    );
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end(init.body);
  });
}

/**
 * Envoie la requête en ne parlant qu'à une adresse publique validée. Lève une
 * erreur portant `.status` (garde SSRF, HTTPS manquant, redirection refusée) ou
 * l'erreur réseau brute (à traduire par l'appelant).
 */
export async function pinnedRequest(rawUrl: string, init: PinnedRequestInit): Promise<PinnedResponse> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const { url, addresses } = await resolvePublicUrl(current, { requireHttps: true });

    let res: PinnedResponse | null = null;
    let lastError: unknown = null;
    for (const address of addresses) {
      try {
        res = await requestOnce(url, address, init);
        break;
      } catch (err: any) {
        lastError = err;
        const code = err?.code || err?.cause?.code;
        if (!RETRY_NEXT_ADDRESS.has(code)) throw err;
      }
    }
    if (!res) throw lastError;

    const location = res.headers.location;
    if (REDIRECT_STATUSES.has(res.status) && location) {
      res.stream.resume();
      current = resolveRedirect(url, location).toString();
      continue;
    }
    return res;
  }
  throw new ExternalStorageError('Trop de redirections renvoyées par le serveur de stockage.', 'unknown', 502);
}

/** Lit au plus `maxBytes` d'une réponse (le reste est abandonné) : une réponse
 *  de PROPFIND est de l'XML court, jamais un flux à garder en mémoire. */
export async function readTextCapped(stream: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      stream.destroy();
      break;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}
