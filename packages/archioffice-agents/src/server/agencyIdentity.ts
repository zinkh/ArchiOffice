// ── Identité du cabinet pour les documents générés ──────────────────────────
// Un document sorti par un agent part chez un client, une entreprise ou une
// administration : il doit porter la même en-tête et le même pied de page que
// ceux produits depuis l'interface (src/lib/templateExport.ts), pas une page
// blanche anonyme. Les valeurs viennent de la table settings du cabinet,
// c'est-à-dire exactement de ce qui est saisi dans Paramètres > Cabinet.
const LOGO_MAX_BYTES = 2_000_000;

export interface AgencyLogo {
  data: Buffer;
  /** 'png' ou 'jpg' — seuls formats acceptés par docx et jsPDF sans conversion. */
  format: 'png' | 'jpg';
  width: number;
  height: number;
}

export interface AgencyIdentity {
  name: string;
  address: string;
  phone: string;
  email: string;
  siret: string;
  vatNumber: string;
  ape: string;
  logo: AgencyLogo | null;
}

export const EMPTY_AGENCY: AgencyIdentity = {
  name: '', address: '', phone: '', email: '', siret: '', vatNumber: '', ape: '', logo: null,
};

/** Ligne de pied de page : tout ce qui est renseigné, séparé par des points médians. */
export function agencyFooterLine(agency: AgencyIdentity): string {
  return [
    agency.name,
    agency.address,
    agency.phone ? `Tél : ${agency.phone}` : '',
    agency.email,
    agency.siret ? `SIRET ${agency.siret}` : '',
    agency.vatNumber ? `TVA ${agency.vatNumber}` : '',
  ].filter(Boolean).join('  ·  ');
}

// Dimensions lues directement dans l'en-tête du fichier : le rapport
// largeur/hauteur est indispensable pour ne pas déformer le logo, et ajouter
// une dépendance de traitement d'image (sharp, jimp) pour deux entiers ne se
// justifie pas — d'autant que sharp est un binaire natif, ce que l'image
// node:22-slim de ce dépôt ne porte pas.
export function readImageSize(buffer: Buffer): { format: 'png' | 'jpg'; width: number; height: number } | null {
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      // SOF0..SOF15, hors marqueurs non dimensionnels (DHT/JPG/DAC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: 'jpg', height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  }
  return null;
}

function parseStorageRef(fileUrl: string): { bucket: string; path: string } | null {
  const marker = '/object/public/';
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return null;
  const rest = fileUrl.slice(idx + marker.length);
  const slash = rest.indexOf('/');
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const path = decodeURIComponent(rest.slice(slash + 1));
  return bucket && path ? { bucket, path } : null;
}

async function loadLogo(supabaseAdmin: any, logoUrl: string): Promise<AgencyLogo | null> {
  if (!logoUrl) return null;
  try {
    let buffer: Buffer | null = null;
    const ref = parseStorageRef(logoUrl);
    if (ref) {
      const { data, error } = await supabaseAdmin.storage.from(ref.bucket).download(ref.path);
      if (error || !data) return null;
      buffer = Buffer.from(await data.arrayBuffer());
    } else if (logoUrl.startsWith('data:')) {
      const comma = logoUrl.indexOf(',');
      if (comma === -1) return null;
      buffer = Buffer.from(logoUrl.slice(comma + 1), 'base64');
    } else if (/^https?:\/\//.test(logoUrl)) {
      const res = await fetch(logoUrl);
      if (!res.ok) return null;
      buffer = Buffer.from(await res.arrayBuffer());
    }
    if (!buffer || buffer.length === 0 || buffer.length > LOGO_MAX_BYTES) return null;
    const size = readImageSize(buffer);
    // Un SVG (ou tout format non reconnu) est ignoré plutôt que de faire
    // échouer la génération : le document sort alors avec l'en-tête texte.
    if (!size) return null;
    return { data: buffer, format: size.format, width: size.width, height: size.height };
  } catch {
    return null;
  }
}

export async function loadAgencyIdentity(supabaseAdmin: any, tenantId: string): Promise<AgencyIdentity> {
  try {
    const { data } = await supabaseAdmin
      .from('settings')
      .select('agency_name, address, phone, email, siret, vat_number, ape, logo_url')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!data) return EMPTY_AGENCY;
    const row = data as any;
    return {
      name: row.agency_name || '',
      address: row.address || '',
      phone: row.phone || '',
      email: row.email || '',
      siret: row.siret || '',
      vatNumber: row.vat_number || '',
      ape: row.ape || '',
      logo: await loadLogo(supabaseAdmin, row.logo_url || ''),
    };
  } catch {
    return EMPTY_AGENCY;
  }
}
