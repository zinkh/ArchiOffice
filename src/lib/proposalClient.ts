// Coordonnées du client d'une proposition : la fiche contact est la source, la proposition la complète.
// - à l'ouverture, les champs vides de la proposition se remplissent depuis le contact ;
// - à l'enregistrement, ce qui est saisi dans la proposition complète les champs VIDES du contact
//   (jamais d'écrasement d'une valeur déjà présente sur la fiche).

type Row = Record<string, any>;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Champ de la proposition -> colonnes du contact, la première non vide fait foi. */
const MAPPING: { proposal: string; read: string[]; write: string }[] = [
  { proposal: 'adresse_client', read: ['address', 'address_work_street'], write: 'address' },
  { proposal: 'cp_client', read: ['zip', 'address_work_zip'], write: 'zip' },
  { proposal: 'ville_client', read: ['city', 'address_work_city'], write: 'city' },
  { proposal: 'telephone', read: ['phone', 'phone_work'], write: 'phone' },
  { proposal: 'portable', read: ['phone_mobile'], write: 'phone_mobile' },
  { proposal: 'email_client', read: ['email', 'email_work'], write: 'email' },
];

const firstOf = (contact: Row, columns: string[]): string => {
  for (const c of columns) { const v = text(contact[c]); if (v) return v; }
  return '';
};

/** Valeurs de la proposition pour les champs que le contact renseigne et qu'elle laisse vides. */
export function fillMissingClientFields(proposal: Row, contact: Row | undefined): Row {
  if (!contact) return proposal;
  const filled: Row = {};
  for (const m of MAPPING) {
    if (text(proposal[m.proposal])) continue;
    const value = firstOf(contact, m.read);
    if (value) filled[m.proposal] = value;
  }
  return Object.keys(filled).length ? { ...proposal, ...filled } : proposal;
}

/** Colonnes du contact à compléter : saisies dans la proposition, absentes de la fiche. */
export function contactPatchFromProposal(proposal: Row, contact: Row | undefined): Row {
  if (!contact) return {};
  const patch: Row = {};
  for (const m of MAPPING) {
    const value = text(proposal[m.proposal]);
    if (value && !firstOf(contact, m.read)) patch[m.write] = value;
  }
  return patch;
}
