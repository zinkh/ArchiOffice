// Ce qu'un contrat MOE reprend de l'affaire qu'on lui associe. Logique pure,
// partagée par la modale de contrat (`Contrats.tsx`) et testée.
import type { Contact, ContratCotraitant, ContratMOE, Project } from '../types';

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Nombre positif lu dans un champ saisi (« 120 », « 120,5 m² ») ; `undefined` sinon. */
export function positiveNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : undefined;
  const match = text(v).replace(/\s/g, '').replace(',', '.').match(/\d+(\.\d+)?/);
  const n = match ? parseFloat(match[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Date ISO (YYYY-MM-DD) d'un champ date de l'affaire, vide ou illisible → `undefined`. */
function isoDate(v: unknown): string | undefined {
  const s = text(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
}

/** Adresse des travaux : l'adresse de l'affaire, à défaut celle du terrain. */
export function projectWorksAddress(p: Pick<Project, 'address' | 'adresse_terrain' | 'cp_ville_terrain'>): string | undefined {
  const address = text(p.address);
  if (address) return address;
  const terrain = [text(p.adresse_terrain), text(p.cp_ville_terrain)].filter(Boolean).join(', ');
  return terrain || undefined;
}

/**
 * Les champs du contrat que l'affaire renseigne, à fusionner dans le formulaire.
 *
 * - Identité, lieu, surface, dates, type de maître d'ouvrage : une valeur
 *   non vide de l'affaire remplace celle du formulaire (choisir une autre
 *   affaire doit changer de dossier, pas panacher les deux).
 * - Montants (honoraires, budget travaux) et équipe : repris seulement si le
 *   contrat n'en porte pas encore. Le contrat est la pièce qui fait foi pour
 *   les montants de l'affaire (voir CLAUDE.md), un choix d'affaire ne doit
 *   pas écraser ce qui y a été saisi.
 * - Ce que l'affaire ne porte pas n'est jamais vidé.
 */
export function contratFieldsFromProject(
  project: Project,
  current: Partial<ContratMOE>,
  contacts: Pick<Contact, 'id' | 'first_name' | 'last_name' | 'company_name'>[] = [],
): Partial<ContratMOE> {
  const out: Partial<ContratMOE> = { project_id: project.id, project_name: project.name };

  if (project.client_id) out.client_id = project.client_id;
  if (text(project.name)) out.intitule_projet = text(project.name);

  const address = projectWorksAddress(project);
  if (address) out.adresse_travaux = address;

  const surface = positiveNumber(project.surface_plancher) ?? positiveNumber(project.surface);
  if (surface) out.surface_plancher = surface;

  const start = isoDate(project.start_date);
  if (start) out.date_debut = start;
  const end = isoDate(project.end_date);
  if (end) out.date_fin = end;

  if (project.is_public_client) out.type_moa = 'public';

  const budget = positiveNumber(project.construction_cost);
  if (budget && !current.budget_previsionnel) out.budget_previsionnel = budget;

  const honoraires = positiveNumber(project.remuneration);
  if (honoraires && !current.montant_honoraires) {
    out.montant_honoraires = honoraires;
    out.mode_honoraires = 'forfait';
  }

  if (!(current.cotraitants?.length) && project.cotraitants_list?.length) {
    const nameOf = (id?: string) => {
      const c = id ? contacts.find(x => x.id === id) : undefined;
      if (!c) return undefined;
      return text(c.company_name) || [text(c.first_name), text(c.last_name)].filter(Boolean).join(' ') || undefined;
    };
    out.cotraitants = project.cotraitants_list.map((c): ContratCotraitant => ({
      id: crypto.randomUUID(),
      contact_id: c.contact_id,
      contact_name: text(c.contact_name) || nameOf(c.contact_id) || '',
      specialty: c.specialty,
      fee_pct: 0,
      montant_honoraires: 0,
    }));
  }

  return out;
}
