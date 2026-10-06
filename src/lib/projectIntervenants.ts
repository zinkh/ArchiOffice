// Les intervenants d'une affaire tels que l'aperçu les présente : trois
// sources distinctes (intervenants, cotraitants de la maîtrise d'œuvre,
// entreprises par lot), rapprochées de la fiche contact pour le téléphone et
// l'e-mail. Logique pure, testée.
import type { Contact, Project } from '../types';

export interface IntervenantLine {
  key: string;
  /** Rôle, spécialité ou « Lot 02 · Gros œuvre ». */
  label: string;
  /** Personne ou société, vide si rien n'est renseigné. */
  name: string;
  phone?: string;
  email?: string;
  contactId?: string;
}

export interface IntervenantGroups {
  stakeholders: IntervenantLine[];
  cotraitants: IntervenantLine[];
  entreprises: IntervenantLine[];
  total: number;
}

type ContactLike = Partial<Pick<Contact, 'id' | 'first_name' | 'last_name' | 'company_name' | 'phone_mobile' | 'phone_work' | 'phone_main' | 'phone' | 'email' | 'email_work'>>;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Société, à défaut prénom et nom. */
export function contactDisplayName(c?: ContactLike): string {
  if (!c) return '';
  return text(c.company_name) || [text(c.first_name), text(c.last_name)].filter(Boolean).join(' ');
}

/** Le mobile d'abord, c'est le numéro qu'on appelle sur un chantier. */
function contactPhone(c?: ContactLike): string | undefined {
  return text(c?.phone_mobile) || text(c?.phone_work) || text(c?.phone_main) || text(c?.phone) || undefined;
}

function contactEmail(c?: ContactLike): string | undefined {
  return text(c?.email) || text(c?.email_work) || undefined;
}

export function projectIntervenants(
  project: Pick<Project, 'stakeholders_list' | 'cotraitants_list' | 'lots_list'>,
  contacts: ContactLike[] = [],
): IntervenantGroups {
  const byId = new Map(contacts.filter(c => c.id).map(c => [c.id as string, c]));
  const line = (key: string, label: string, ownName: string, contactId?: string): IntervenantLine => {
    const contact = contactId ? byId.get(contactId) : undefined;
    return {
      key, label,
      name: text(ownName) || contactDisplayName(contact),
      phone: contactPhone(contact), email: contactEmail(contact), contactId: contactId || undefined,
    };
  };

  const stakeholders = (project.stakeholders_list ?? []).map(s => line(`s-${s.id}`, text(s.role), s.name, s.contact_id));
  const cotraitants = (project.cotraitants_list ?? []).map(c => line(`c-${c.id}`, text(c.specialty), text(c.contact_name), c.contact_id));
  // Un lot sans entreprise désignée n'est pas un intervenant : il n'apparaît pas.
  const entreprises = (project.lots_list ?? [])
    .filter(l => l.contact_id || text(l.contact_name))
    .map(l => line(`l-${l.id}`, [text(l.lot_number) && `Lot ${text(l.lot_number)}`, text(l.lot_title)].filter(Boolean).join(' · '), text(l.contact_name), l.contact_id))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true }));

  return { stakeholders, cotraitants, entreprises, total: stakeholders.length + cotraitants.length + entreprises.length };
}
