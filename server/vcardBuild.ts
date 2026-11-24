// Fabrication de la vCard (3.0) d'une fiche contact, pour l'envoi vers un carnet CardDAV.
//
// Elle n'écrit que ce que la lecture (`vcardTypedValues`, route CardDAV) sait relire : nom,
// société, fonction, e-mails et téléphones typés. Un aller-retour (envoi puis import) ne doit
// rien inventer ni perdre, comme pour Google Contacts.
import { emailsForGoogle } from './contactSyncMatch';
import { phonesForGoogle } from '../src/lib/contactPhones';

export interface VcardContact {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  job_title?: string | null;
  email?: string | null;
  email_work?: string | null;
  email_home?: string | null;
  email_other?: string | null;
  phone?: string | null;
  phone_mobile?: string | null;
  phone_work?: string | null;
  phone_home?: string | null;
  phone_main?: string | null;
  phone_fax_work?: string | null;
  phone_fax_home?: string | null;
  phone_pager?: string | null;
  phone_other?: string | null;
}

/** Échappement d'une valeur texte vCard : antislash, point-virgule, virgule, retour à la ligne. */
export function escapeVcardText(v?: string | null): string {
  return (v || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const EMAIL_PARAMS: Record<string, string> = { work: 'INTERNET,WORK', home: 'INTERNET,HOME', other: 'INTERNET,OTHER' };
const PHONE_PARAMS: Record<string, string> = {
  mobile: 'CELL', work: 'WORK,VOICE', home: 'HOME,VOICE', main: 'MAIN',
  workFax: 'WORK,FAX', homeFax: 'HOME,FAX', pager: 'PAGER', other: 'OTHER',
};

/** Replie une ligne à 75 caractères (RFC 6350 : la suite commence par une espace). */
function fold(line: string): string {
  const chars = Array.from(line);
  if (chars.length <= 75) return line;
  const parts = [chars.slice(0, 75).join('')];
  for (let i = 75; i < chars.length; i += 74) parts.push(` ${chars.slice(i, i + 74).join('')}`);
  return parts.join('\r\n');
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function buildVcard(contact: VcardContact, now: Date = new Date()): string {
  const first = (contact.first_name || '').trim();
  const last = (contact.last_name || '').trim();
  const company = (contact.company_name || '').trim();
  const fullName = [first, last].filter(Boolean).join(' ') || company;
  const isCompany = !first && !last && !!company;

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'PRODID:-//ArchiOffice//Contacts//FR',
    `UID:${contact.id}`,
    `FN:${escapeVcardText(fullName)}`,
    `N:${escapeVcardText(last)};${escapeVcardText(first)};;;`,
  ];
  if (company) lines.push(`ORG:${escapeVcardText(company)}`);
  if (contact.job_title?.trim()) lines.push(`TITLE:${escapeVcardText(contact.job_title.trim())}`);
  if (isCompany) lines.push('X-ABShowAs:COMPANY');
  for (const e of emailsForGoogle(contact)) {
    lines.push(e.type ? `EMAIL;TYPE=${EMAIL_PARAMS[e.type] ?? 'INTERNET'}:${e.value}` : `EMAIL;TYPE=INTERNET:${e.value}`);
  }
  for (const p of phonesForGoogle(contact)) {
    lines.push(p.type ? `TEL;TYPE=${PHONE_PARAMS[p.type] ?? 'VOICE'}:${p.value}` : `TEL:${p.value}`);
  }
  lines.push(`REV:${stamp(now)}`, 'END:VCARD');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
