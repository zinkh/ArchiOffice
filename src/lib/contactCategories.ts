// Les catégories de contacts sont libres : chaque cabinet crée les siennes
// depuis /contacts, et rien n'impose leur orthographe. Les sélecteurs de
// contacts filtraient pourtant sur des chaînes exactes ("Client",
// "Maitre d'ouvrage" sans accent), si bien qu'un contact catégorisé
// "Maître d'ouvrage" ou "Clients" restait invisible dans le modal de projet.
// Tout passe désormais par ces prédicats, qui comparent sur une forme
// normalisée (minuscules, sans accents ni ponctuation).

/** Catégories proposées par défaut selon le champ depuis lequel on crée un contact. */
export const CONTACT_CATEGORY_CLIENT = 'Client';
export const CONTACT_CATEGORY_ENTREPRISE = 'Entreprise';
export const CONTACT_CATEGORY_COTRAITANT = 'Cotraitant';

/** Minuscules, sans accents, ponctuation et espaces réduits — pour comparer deux libellés saisis à la main. */
export function normalizeCategory(value?: string | null): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function sameCategory(a?: string | null, b?: string | null): boolean {
  const na = normalizeCategory(a);
  return na.length > 0 && na === normalizeCategory(b);
}

/**
 * Retrouve le libellé exact d'une catégorie existante à partir d'un libellé
 * approchant, pour ne pas créer un doublon "Client" / "client" / "Clients".
 */
export function resolveCategoryName(wanted: string | undefined, existing: { name: string }[]): string {
  if (!wanted) return '';
  const match = existing.find(c => sameCategory(c.name, wanted));
  return match ? match.name : wanted;
}

type CategorizedContact = { category?: string | null };

/** Un contact sans catégorie reste visible partout : il a pu être créé avant que le champ existe. */
const isUncategorized = (c: CategorizedContact) => normalizeCategory(c.category).length === 0;

/** Maîtres d'ouvrage / clients — accepte "Client", "Clients", "Maître d'ouvrage", "MOA". */
export function isClientContact(c: CategorizedContact): boolean {
  const n = normalizeCategory(c.category);
  return isUncategorized(c) || n.includes('client') || n.includes('ouvrage') || n === 'moa';
}

/** Entreprises de travaux — accepte "Entreprise", "Entreprises", "Entreprise de travaux". */
export function isEntrepriseContact(c: CategorizedContact): boolean {
  const n = normalizeCategory(c.category);
  return isUncategorized(c) || n.includes('entreprise');
}

/**
 * Crée la catégorie si le cabinet ne l'a pas encore, pour qu'elle apparaisse
 * dans les filtres de la page Contacts. Un échec (doublon créé entre-temps
 * dans un autre onglet) ne doit jamais empêcher l'enregistrement du contact.
 */
export async function ensureContactCategory(name: string | undefined, existing: { name: string }[]): Promise<boolean> {
  const clean = (name || '').trim();
  if (!clean || existing.some(c => sameCategory(c.name, clean))) return false;
  try {
    const { apiFetch } = await import('./api');
    await apiFetch('/api/contact-categories', {
      method: 'POST',
      body: JSON.stringify({ id: crypto.randomUUID(), name: clean }),
    });
    return true;
  } catch (err) {
    console.error('Failed to create contact category:', err);
    return false;
  }
}
