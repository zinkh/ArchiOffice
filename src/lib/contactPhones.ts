// Numéros de téléphone typés des fiches contact et de Google Contacts.
//
// Google range chaque numéro sous un type (mobile, work, home, main, workFax, homeFax, pager,
// other, ou aucun / personnalisé). La fiche a un champ par type et `phone`, le numéro principal
// (mobile, puis travail, puis domicile) que lisent le tableau et les anciens écrans.
// Même principe que les adresses e-mail (`emailsFromGoogle`, server/contactSyncMatch.ts).

export type PhoneSlot =
  | 'phone_mobile' | 'phone_work' | 'phone_home' | 'phone_main'
  | 'phone_fax_work' | 'phone_fax_home' | 'phone_pager' | 'phone_other';

export type TypedPhones = Record<PhoneSlot, string> & { phone: string };

export const PHONE_SLOTS: PhoneSlot[] = [
  'phone_mobile', 'phone_work', 'phone_home', 'phone_main',
  'phone_fax_work', 'phone_fax_home', 'phone_pager', 'phone_other',
];

/** Type Google attendu pour chaque champ de la fiche. */
const GOOGLE_TYPE: Record<PhoneSlot, string> = {
  phone_mobile: 'mobile', phone_work: 'work', phone_home: 'home', phone_main: 'main',
  phone_fax_work: 'workFax', phone_fax_home: 'homeFax', phone_pager: 'pager', phone_other: 'other',
};

/** Champ de la fiche pour chaque type Google (`workMobile` et `workPager` suivent leur famille). */
const SLOT_FOR_GOOGLE_TYPE: Record<string, PhoneSlot | undefined> = {
  mobile: 'phone_mobile', workmobile: 'phone_mobile',
  work: 'phone_work', home: 'phone_home', main: 'phone_main',
  workfax: 'phone_fax_work', homefax: 'phone_fax_home', otherfax: 'phone_other',
  pager: 'phone_pager', workpager: 'phone_pager',
  other: 'phone_other', googlevoice: 'phone_other',
};

/** Places où un numéro sans type (ou en trop) peut atterrir : les trois que l'écran propose d'abord. */
const OVERFLOW_ORDER: PhoneSlot[] = ['phone_mobile', 'phone_work', 'phone_home', 'phone_other'];

const digitsOf = (v?: string | null): string => (v || '').replace(/\D/g, '');

/** Chiffres du numéro, l'indicatif +33 / 0033 ramené au 0 national : sert à comparer deux écritures. */
function phoneKey(v?: string | null): string {
  let d = digitsOf(v);
  if (d.startsWith('0033')) d = `0${d.slice(4)}`;
  else if (d.startsWith('33') && d.length === 11) d = `0${d.slice(2)}`;
  return d;
}

/** Un numéro français commençant par 06 ou 07 (ou +33 6 / +33 7) est un mobile, sinon un fixe. */
export function legacyPhoneSlot(phone?: string | null): PhoneSlot {
  return /^0[67]/.test(phoneKey(phone)) ? 'phone_mobile' : 'phone_work';
}

/** Numéro principal : mobile, puis travail, puis domicile, puis le reste. */
export function primaryPhone(p: Partial<Record<PhoneSlot, string | null>>): string {
  return p.phone_mobile || p.phone_work || p.phone_home || p.phone_main || p.phone_other || '';
}

/** Reporte les numéros d'une personne Google sur les champs de la fiche, selon leur type. */
export function phonesFromGoogle(list?: Array<{ value?: string; type?: string }> | null): TypedPhones {
  const out = { phone: '' } as TypedPhones;
  for (const s of PHONE_SLOTS) out[s] = '';
  const seen = new Set<string>();
  for (const entry of list || []) {
    const value = (entry?.value || '').trim();
    const key = phoneKey(value) || value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    const type = (entry.type || '').toLowerCase();
    const preferred = SLOT_FOR_GOOGLE_TYPE[type] ?? (type ? undefined : legacyPhoneSlot(value));
    // Type connu et place libre : on le respecte. Sinon (sans type, personnalisé, ou deuxième
    // numéro du même type) : première place libre, sans jamais en écraser une.
    const slot = (preferred && !out[preferred]) ? preferred : OVERFLOW_ORDER.find(s => !out[s]);
    if (slot) out[slot] = value;
  }
  out.phone = primaryPhone(out);
  return out;
}

/** Inverse : les numéros de la fiche, typés, tels que Google les attend. */
export function phonesForGoogle(contact: Partial<Record<PhoneSlot | 'phone', string | null>>): Array<{ value: string; type?: string }> {
  const typed: Array<{ value: string; type?: string }> = [];
  const seen = new Set<string>();
  const push = (value: string | null | undefined, type?: string) => {
    const v = (value || '').trim();
    const key = phoneKey(v) || v.toLowerCase();
    if (!v || seen.has(key)) return;
    seen.add(key);
    typed.push(type ? { value: v, type } : { value: v });
  };
  for (const s of PHONE_SLOTS) push(contact[s], GOOGLE_TYPE[s]);
  // Fiche ancienne (ou importée) dont seul `phone` est renseigné : envoyé tel quel, sans type.
  push(contact.phone);
  return typed;
}
