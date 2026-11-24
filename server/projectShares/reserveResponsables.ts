// Lot et entreprise en charge d'une réserve, choisis par un confrère (issue : « le confrère doit pouvoir choisir le lot et
// l'entreprise »). Une réserve les range comme le cabinet : `lots` et `entreprises` sont des TEXTES JSON (liste de chaînes),
// le lot par son intitulé, l'entreprise par son nom.
//
// Le confrère ne tape pas de texte libre : il choisit parmi les lots de l'affaire et les entreprises de ses lots et de ses
// marchés (les mêmes propositions que la fiche du cabinet, `useReserveOptions`). Le serveur revalide chaque valeur contre
// cette liste, calculée pour l'affaire PARTAGÉE ; une valeur déjà portée par la réserve reste acceptée (une saisie libre
// ancienne ne bloque pas une autre modification). Ne sortent que des noms : jamais l'identifiant ni la fiche d'un contact.

export interface ResponsableOptions {
  lots: Array<{ title: string; number: string | null }>;
  /** Noms d'entreprises, triés, sans doublon. */
  entreprises: string[];
  /** Entreprise de la fiche du lot, par intitulé de lot : sert à préremplir le choix à l'écran. */
  lotEntreprise: Record<string, string>;
}

const MAX_ITEMS = 20;
const MAX_LENGTH = 200;
const norm = (s: string) => s.trim().toLowerCase();

/** Liste de chaînes d'une colonne texte JSON (ou, à l'ancienne, séparée par des virgules). */
export function parseResponsableList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [String(parsed)];
  } catch {
    return value.split(',').map(s => s.trim()).filter(Boolean);
  }
}

const missingColumn = (error: any) => !!error && (error.code === '42703' || error.code === 'PGRST204' || /contact_name/i.test(String(error.message || '')));

export async function loadResponsableOptions(supabaseAdmin: any, tenantId: string, projectId: string): Promise<ResponsableOptions> {
  let lotRows: any[] = [];
  let result = await supabaseAdmin.from('project_lots').select('lot_number, lot_title, contact_name').eq('project_id', projectId).eq('tenant_id', tenantId);
  // Instance sans la colonne `contact_name` : les lots restent proposés, sans entreprise de fiche.
  if (missingColumn(result.error)) result = await supabaseAdmin.from('project_lots').select('lot_number, lot_title').eq('project_id', projectId).eq('tenant_id', tenantId);
  if (!result.error) lotRows = result.data || [];

  const marches = await supabaseAdmin.from('marches_entreprises').select('entreprise_nom, type_marche, statut').eq('project_id', projectId).eq('tenant_id', tenantId);
  // Table absente (instance non migrée) : les entreprises des lots suffisent.
  const marcheNames: string[] = marches.error ? [] : (marches.data || [])
    .filter((m: any) => m.entreprise_nom && m.type_marche !== 'subsequent' && m.statut !== 'resilie').map((m: any) => String(m.entreprise_nom));

  const lots = lotRows
    .filter(l => l.lot_title)
    .map(l => ({ title: String(l.lot_title), number: l.lot_number ? String(l.lot_number) : null }))
    .sort((a, b) => (a.number ?? '').localeCompare(b.number ?? '', 'fr', { numeric: true }));
  const lotEntreprise: Record<string, string> = {};
  for (const l of lotRows) if (l.lot_title && l.contact_name?.trim()) lotEntreprise[String(l.lot_title)] = String(l.contact_name).trim();

  const seen = new Set<string>();
  const entreprises = [...Object.values(lotEntreprise), ...marcheNames]
    .filter(nom => !seen.has(norm(nom)) && !!seen.add(norm(nom)))
    .sort((a, b) => a.localeCompare(b, 'fr'));
  return { lots, entreprises, lotEntreprise };
}

function readList(body: any, key: 'lots' | 'entreprises', allowed: string[], current: string[]): { value?: string[] } | { error: string } {
  if (body?.[key] === undefined) return {};
  const raw = body[key];
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS || raw.some(v => typeof v !== 'string' || !v.trim() || v.length > MAX_LENGTH)) {
    return { error: `${key} invalide (liste de ${MAX_ITEMS} noms au plus).` };
  }
  const known = new Map([...allowed, ...current].map(v => [norm(v), v]));
  const out: string[] = [];
  for (const v of raw as string[]) {
    const match = known.get(norm(v));
    if (!match) return { error: key === 'lots' ? `Lot inconnu : ${v}.` : `Entreprise inconnue : ${v}.` };
    if (!out.some(o => norm(o) === norm(match))) out.push(match);
  }
  return { value: out };
}

export const hasResponsableKeys = (body: any) => body?.lots !== undefined || body?.entreprises !== undefined;

/**
 * Colonnes `lots` et `entreprises` à écrire (textes JSON, comme le cabinet), ou une erreur de saisie. `current` : valeurs
 * actuelles de la réserve, restent acceptées même hors liste.
 */
export function readResponsables(
  body: any, options: ResponsableOptions, current: { lots?: unknown; entreprises?: unknown } = {},
): { fields: Record<string, string> } | { error: string } {
  const fields: Record<string, string> = {};
  const lots = readList(body, 'lots', options.lots.map(l => l.title), parseResponsableList(current.lots));
  if ('error' in lots) return lots;
  if (lots.value) fields.lots = JSON.stringify(lots.value);
  const entreprises = readList(body, 'entreprises', options.entreprises, parseResponsableList(current.entreprises));
  if ('error' in entreprises) return entreprises;
  if (entreprises.value) fields.entreprises = JSON.stringify(entreprises.value);
  return { fields };
}
