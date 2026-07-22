// SSRF-hardened fetch for the agent `fetch_url` tool (see tools.ts). This is
// the one tool in the whole agent system that makes a genuine outbound
// request to a destination an LLM chose, instead of calling back into the
// app's own authenticated REST API (see routes.ts baseUrl comment) — so it
// gets its own defense-in-depth module rather than living inline in tools.ts.
//
// Threat model: a manipulated/compromised agent (via a hostile page's
// content, a crafted user message, or the model simply making a mistake)
// tries to reach internal infrastructure — localhost, the Supabase/Postgres
// host, a cloud metadata endpoint (169.254.169.254), another container on
// the private network — by passing it as a "URL to fetch". We block that by
// resolving the hostname ourselves and rejecting private/loopback/link-local/
// reserved addresses, for the initial URL AND for every redirect hop (a
// redirect to an internal address is the same attack one layer removed).
//
// This is DNS-resolution-based validation, not connection-pinning: a
// sufficiently adversarial DNS server could in principle swap the resolved
// address between our check and the actual TCP connect (DNS rebinding).
// That residual risk is accepted here — full pinning would mean threading a
// custom low-level dispatcher through undici — given this tool is off by
// default, opt-in per agent by a tenant admin, and surfaced with an explicit
// security warning in the UI.
import net from 'node:net';
import dns from 'node:dns/promises';
import { htmlToText } from 'html-to-text';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 3_000_000; // 3MB raw body cap
const MAX_TEXT_CHARS = 15_000; // returned to the model, keeps token cost bounded

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return true; // malformed — refuse
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && parts[2] === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast (224+) and reserved (240+)
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local fe80::/10
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4 address instead.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // not a recognizable IP — refuse rather than guess
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (hostname === 'localhost') throw new Error('Hôte non autorisé (localhost).');
  // A literal IP in the URL — check it directly, no DNS involved.
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error(`Adresse IP non autorisée : ${hostname}`);
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error(`Impossible de résoudre le nom d'hôte : ${hostname}`);
  }
  if (addresses.length === 0) throw new Error(`Aucune adresse trouvée pour : ${hostname}`);
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`L'hôte "${hostname}" pointe vers une adresse privée/interne (${address}) — accès refusé.`);
    }
  }
}

export interface WebFetchResult {
  url: string;
  status: number;
  title?: string;
  text: string;
  truncated: boolean;
}

export async function fetchUrlSafely(rawUrl: string): Promise<WebFetchResult> {
  let currentUrl: URL;
  try {
    currentUrl = new URL(rawUrl);
  } catch {
    throw new Error(`URL invalide : ${rawUrl}`);
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (currentUrl.protocol !== 'http:' && currentUrl.protocol !== 'https:') {
      throw new Error(`Protocole non autorisé : ${currentUrl.protocol}`);
    }
    await assertPublicHost(currentUrl.hostname);

    const res = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'ArchiOfficeAgent/1.0 (+outil fetch_url, usage interne)' },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`Redirection ${res.status} sans en-tête Location.`);
      if (hop === MAX_REDIRECTS) throw new Error('Trop de redirections.');
      currentUrl = new URL(location, currentUrl);
      continue;
    }

    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > MAX_RESPONSE_BYTES) {
      throw new Error(`Réponse trop volumineuse (${contentLength} octets).`);
    }

    const contentType = res.headers.get('content-type') || '';
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error(`Réponse trop volumineuse (${buf.byteLength} octets).`);
    }

    const raw = Buffer.from(buf).toString('utf-8');
    const isHtml = contentType.includes('html');
    const fullText = isHtml ? htmlToText(raw, { wordwrap: false }) : raw;
    const truncated = fullText.length > MAX_TEXT_CHARS;
    const titleMatch = isHtml ? raw.match(/<title[^>]*>([^<]*)<\/title>/i) : null;

    return {
      url: currentUrl.toString(),
      status: res.status,
      title: titleMatch?.[1]?.trim(),
      text: truncated ? fullText.slice(0, MAX_TEXT_CHARS) : fullText,
      truncated,
    };
  }

  throw new Error('Trop de redirections.');
}
