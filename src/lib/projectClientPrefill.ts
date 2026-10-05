import type { Contact, Project } from '../types';

const blank = (v: unknown) => v == null || String(v).trim() === '';
const first = (...vals: Array<string | undefined | null>) => vals.find(v => !blank(v))?.trim();

/**
 * Champs « client » de la fiche que la fiche contact choisie sait déjà fournir.
 * Ne remplit que ce qui est vide : une valeur saisie à la main n'est jamais écrasée.
 */
export function clientFieldsFromContact(contact: Contact, current: Partial<Project>): Partial<Project> {
  const person = [contact.first_name, contact.last_name].filter(n => !blank(n)).join(' ');
  const candidates: Partial<Project> = {
    nom_societe: first(contact.company_name),
    representant: first(contact.company_name) ? first(person) : undefined,
    qualite: first(contact.company_name) ? first(contact.job_title) : undefined,
    client_siret: first(contact.siret),
    client_vat_number: first(contact.vat_number),
    adresse_client: first(contact.address_work_street, contact.address),
    cp_client: first(contact.address_work_zip, contact.zip),
    ville_client: first(contact.address_work_city, contact.city),
    telephone: first(contact.phone_work, contact.phone_main, contact.phone),
    portable: first(contact.phone_mobile),
    email_client: first(contact.email_work, contact.email),
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidates)) {
    if (value && blank((current as Record<string, unknown>)[key])) out[key] = value;
  }
  if (out.nom_societe && current.is_entreprise == null) out.is_entreprise = true;
  return out as Partial<Project>;
}

/**
 * L'adresse du terrain existe à deux endroits (Localisation et section Projet).
 * Une adresse saisie dans l'un se reporte dans l'autre tant que celui-ci est vide
 * ou identique à l'ancienne valeur ; une adresse volontairement différente reste.
 */
export function mirroredAddress(previousThis: string | undefined, other: string | undefined, next: string): string | undefined {
  if (blank(other) || other === previousThis) return next;
  return undefined;
}
