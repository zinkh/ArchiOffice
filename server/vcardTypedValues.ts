// Lecture des e-mails et téléphones typés d'une vCard (CardDAV).
//
// L'ancien lecteur de la route CardDAV ne gardait que la première ligne EMAIL et la première
// ligne TEL, sans leur type : une fiche avec un numéro mobile et un fixe, ou une adresse de
// travail et une personnelle, n'en gardait qu'une, rangée sans type. Ici chaque ligne est lue
// avec ses paramètres (TYPE=WORK, TYPE=CELL, TYPE=HOME,FAX, ou la forme vCard 2.1 `TEL;WORK;FAX:`)
// puis ramenée aux types de Google Contacts, pour que `emailsFromGoogle` et `phonesFromGoogle`
// rangent les valeurs dans les mêmes champs de la fiche, que la source soit Google ou CardDAV.

export interface TypedValue {
  value: string;
  type?: string;
}

type VcardProperty = 'EMAIL' | 'TEL';

/** Paramètres d'une ligne (`;TYPE=WORK,VOICE;PREF`) en mots minuscules, sans `TYPE=` ni guillemets. */
function paramWords(params: string): string[] {
  return params
    .split(';')
    .flatMap(p => p.replace(/^\s*type\s*=/i, '').replace(/["']/g, '').split(','))
    .map(w => w.trim().toLowerCase())
    .filter(Boolean);
}

function emailType(words: string[]): string | undefined {
  if (words.includes('work')) return 'work';
  if (words.includes('home')) return 'home';
  if (words.includes('other')) return 'other';
  return undefined;
}

function phoneType(words: string[]): string | undefined {
  if (words.includes('fax')) return words.includes('work') ? 'workFax' : words.includes('home') ? 'homeFax' : 'otherFax';
  if (words.includes('cell') || words.includes('mobile')) return 'mobile';
  if (words.includes('pager')) return 'pager';
  if (words.includes('work')) return 'work';
  if (words.includes('home')) return 'home';
  if (words.includes('other')) return 'other';
  return undefined;
}

/**
 * Toutes les lignes `EMAIL` ou `TEL` d'une vCard, dans l'ordre, avec leur type Google.
 * Gère les lignes repliées (suite commençant par une espace), le préfixe de groupe d'Apple
 * (`item1.EMAIL`) et le schéma `tel:` des vCard 4.
 */
export function vcardTypedValues(vcard: string, property: VcardProperty): TypedValue[] {
  const lines = vcard.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const pattern = new RegExp(`^(?:[A-Za-z0-9-]+\\.)?${property}((?:;[^:]*)?):(.*)$`, 'i');
  const out: TypedValue[] = [];
  for (const line of lines) {
    const m = line.match(pattern);
    if (!m) continue;
    let value = m[2].trim().replace(/\\([,;])/g, '$1');
    if (property === 'TEL') value = value.replace(/^tel:/i, '').trim();
    if (!value) continue;
    const words = paramWords(m[1] || '');
    const type = property === 'EMAIL' ? emailType(words) : phoneType(words);
    out.push(type ? { value, type } : { value });
  }
  return out;
}
