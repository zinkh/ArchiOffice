// Fiche réduite d'un contact, pour un confrère invité : nom, identifiants et coordonnées de TRAVAIL, jamais la fiche complète.
//
// La fiche contact du cabinet porte des commentaires personnels à l'agence (`notes`), des étiquettes, la catégorie, le suivi
// de la relation, des montants de marché, des coordonnées privées. La vue est donc construite CHAMP PAR CHAMP à partir d'une
// liste blanche : une colonne ajoutée demain à `contacts` ne sort jamais d'elle-même. Un contact personnel d'un collaborateur
// (`is_personal`) n'est jamais montré. Les coordonnées sont des données personnelles : la route qui les rend n'a le droit de le
// faire qu'avec le détail de l'atelier et en trace la consultation (RGPD).

export interface GuestContactCard {
  /** Identifiant du contact dans le cabinet : sert à rapprocher un lot, un marché et une consultation, rien d'autre. */
  contact_id: string;
  /** Raison sociale de l'entreprise, à défaut le nom de la personne. */
  nom: string;
  personne: string | null;
  fonction: string | null;
  email: string | null;
  telephones: string[];
  adresse: string | null;
  siret: string | null;
  tva: string | null;
}

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function address(c: Record<string, unknown>): string | null {
  // L'adresse de travail d'abord ; l'adresse générale en repli ; jamais l'adresse personnelle (`address_home_*`).
  const work = [str(c.address_work_street), [str(c.address_work_zip, 20), str(c.address_work_city, 100)].filter(Boolean).join(' ') || null, str(c.address_work_country, 60)];
  const general = [str(c.address), [str(c.zip, 20), str(c.city, 100)].filter(Boolean).join(' ') || null, str(c.country, 60)];
  const pick = work.some(Boolean) ? work : general;
  return pick.filter(Boolean).join(', ') || null;
}

/** La fiche réduite d'un contact, ou null pour un contact personnel ou illisible. */
export function guestContactCard(row: unknown): GuestContactCard | null {
  if (typeof row !== 'object' || row === null) return null;
  const c = row as Record<string, unknown>;
  if (typeof c.id !== 'string' || !c.id || c.is_personal === true) return null;
  const personne = [str(c.first_name, 100), str(c.last_name, 100)].filter(Boolean).join(' ') || null;
  const nom = str(c.company_name) ?? personne;
  if (!nom) return null;
  const phones = [c.phone_mobile, c.phone_work, c.phone_main, c.phone].map(v => str(v, 40)).filter((v): v is string => !!v);
  return {
    contact_id: c.id,
    nom,
    personne: str(c.company_name) ? personne : null,
    fonction: str(c.job_title, 120),
    email: str(c.email_work) ?? str(c.email),
    telephones: [...new Set(phones)],
    adresse: address(c),
    siret: str(c.siret, 30),
    tva: str(c.vat_number, 40),
  };
}

/** Les fiches réduites des contacts demandés, de CE cabinet seulement, par identifiant. Table illisible : aucune fiche. */
export async function loadContactCards(supabaseAdmin: any, tenantId: string, contactIds: Iterable<string>): Promise<Map<string, GuestContactCard>> {
  const ids = [...new Set([...contactIds].filter(id => typeof id === 'string' && id))].slice(0, 500);
  const cards = new Map<string, GuestContactCard>();
  if (!ids.length) return cards;
  const { data, error } = await supabaseAdmin.from('contacts').select('*').eq('tenant_id', tenantId).in('id', ids);
  if (error) return cards;
  for (const row of data || []) {
    const card = guestContactCard(row);
    if (card) cards.set(card.contact_id, card);
  }
  return cards;
}
