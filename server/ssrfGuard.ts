// Shared SSRF guard for routes that fetch a user- or tenant-supplied URL
// server-side (CardDAV sync, Odoo RPC). Without this, an authenticated caller
// can point the server at internal-only services or the cloud metadata
// endpoint (169.254.169.254) and use it as a request proxy.
//
// The guard resolves the hostname and rejects the request if ANY resolved
// address falls in a private / loopback / link-local / reserved range, and
// rejects non-http(s) schemes outright. Residual caveat: this validates at
// check time, so a hostile DNS server could still rebind to a private IP
// between this lookup and the actual fetch (classic DNS-rebinding TOCTOU).
// Pinning the connection to the validated IP would close that gap; it's
// deliberately out of scope here — this still removes the trivial
// "just pass an internal URL" attack, which is the exploitable case today.
import dns from 'dns/promises';
import net from 'net';

function ipv4ToInt(ip: string): number {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function inV4Cidr(ipInt: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base);
  const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

// IPv4 ranges that must never be reachable via a server-side fetch:
// this host, private LANs, CGNAT, link-local (incl. cloud metadata),
// benchmarking, multicast and reserved space.
const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function isBlockedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return V4_BLOCKED.some(([b, bits]) => inV4Cidr(n, b, bits));
}

function isBlockedV6(ip: string): boolean {
  const a = ip.toLowerCase();
  // IPv4-mapped (::ffff:169.254.169.254) — validate the embedded v4 address.
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedV4(mapped[1]);
  if (a === '::1' || a === '::') return true;         // loopback / unspecified
  if (/^f[cd]/.test(a)) return true;                  // fc00::/7 unique-local
  if (/^fe[89ab]/.test(a)) return true;               // fe80::/10 link-local
  return false;
}

function isBlockedAddress(ip: string): boolean {
  return net.isIPv4(ip) ? isBlockedV4(ip)
       : net.isIPv6(ip) ? isBlockedV6(ip)
       : true; // unparseable — fail closed
}

function reject(status: number, message: string): never {
  const err: any = new Error(message);
  err.status = status;
  throw err;
}

/**
 * Validates that `rawUrl` is an http(s) URL whose host resolves only to public
 * addresses. Throws an Error with `.status` (400 for a malformed URL/scheme or
 * unresolvable host, 403 for a private/reserved target) otherwise. Returns the
 * parsed URL on success.
 */
export async function assertPublicHttpUrl(rawUrl: unknown): Promise<URL> {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) reject(400, 'URL requise');
  let u: URL;
  try {
    u = new URL(rawUrl as string);
  } catch {
    reject(400, 'URL invalide');
  }
  if (u!.protocol !== 'http:' && u!.protocol !== 'https:') {
    reject(400, 'Seuls les schémas http et https sont autorisés');
  }

  // WHATWG URL keeps the brackets on an IPv6 literal host (e.g. "[::1]") —
  // strip them so net.isIP / the range checks see a bare address.
  const host = u!.hostname.replace(/^\[(.*)\]$/, '$1');
  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      const resolved = await dns.lookup(host, { all: true });
      addresses = resolved.map((r) => r.address);
    } catch {
      reject(400, 'Hôte introuvable');
    }
  }

  if (!addresses!.length) reject(400, 'Hôte introuvable');
  if (addresses!.some(isBlockedAddress)) {
    reject(403, 'Cette adresse (réseau interne/privé) n\'est pas autorisée');
  }
  return u!;
}
