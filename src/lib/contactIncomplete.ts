import type { Contact } from '../types';

/** Fiche à compléter : sans nom, sans téléphone ou sans adresse e-mail. */
export function isContactIncomplete(c: Pick<Contact, 'first_name' | 'last_name' | 'phone_mobile' | 'phone_work' | 'phone' | 'email' | 'email_work' | 'email_home'>): boolean {
  const hasName = !!(c.first_name?.trim() || c.last_name?.trim());
  const hasPhone = !!(c.phone_mobile?.trim() || c.phone_work?.trim() || c.phone?.trim());
  const hasEmail = !!(c.email?.trim() || c.email_work?.trim() || c.email_home?.trim());
  return !hasName || !hasPhone || !hasEmail;
}
