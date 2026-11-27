// ── Diffusion d'un compte-rendu de chantier par e-mail ────────────────────────
// Logique pure, partagée par l'écran (liste des destinataires de la fenêtre de
// diffusion) et par le serveur (qui la rejoue pour ne jamais faire confiance à
// une adresse envoyée par le client) : qui reçoit le compte-rendu, quelles
// observations le concernent, et le texte du message qui lui est adressé.
import type { Contact, Observation, ProjectLot, ProjectStakeholder } from '../types';
import { observationTargetsLot, TCE_LABEL } from './observationLots';

/** Personne rattachée à une entreprise sur un lot (onglet DET > Entreprises, table `lot_intervenants`). */
export interface LotIntervenantInput {
  id: string;
  lot_id: string;
  entreprise: string;
  nom: string;
  role?: string | null;
  email?: string | null;
  /** Fiche contact de la personne (celle qu'une observation peut désigner nommément). */
  contact_id?: string | null;
}

/** Vrai si l'observation désigne nommément cette fiche contact (maîtrise d'ouvrage, bureau de contrôle, BET...). */
export const observationNamesContact = (o: Pick<Observation, 'contact_ids'>, contactId: string): boolean =>
  Array.isArray(o.contact_ids) && o.contact_ids.includes(contactId);

/** Préfixe de la clé d'un destinataire qui est un intervenant de lot et non une fiche contact. */
export const INTERVENANT_KEY_PREFIX = 'intervenant:';

export interface DiffusionRecipient {
  /**
   * Clé d'un destinataire : l'identifiant de la fiche contact (une entreprise sur plusieurs lots n'en forme qu'un),
   * ou `intervenant:<id>` pour une personne saisie dans l'onglet Entreprises (une personne sur plusieurs lots n'en forme qu'un).
   */
  contactId: string;
  /** Raison sociale, à défaut le nom de la personne. */
  name: string;
  /** « Lot 02 Gros œuvre », « Architecte »... : pourquoi cette personne reçoit le compte-rendu. */
  roles: string[];
  /** Première adresse valable de la fiche, vide s'il n'y en a aucune. */
  email: string;
  /** Observations du compte-rendu qui la concernent, par numéro. */
  observations: Observation[];
  /** Observations antérieures encore non levées qui la concernent (option « anciennes observations »), par numéro. */
  previousObservations: Observation[];
}

export interface DiffusionMailContext {
  reportNumber: number | string;
  reportDate?: string | null;
  nextMeeting?: string | null;
  projectName: string;
  projectCode?: string | null;
  projectAddress?: string | null;
  /** Nom du cabinet, repli de la signature. */
  agencyName?: string | null;
  /** Signature personnelle de l'expéditeur (profiles.mail_signature). */
  signature?: string | null;
  /** Modèle d'objet du cabinet (settings.cr_mail_subject_template), vide = modèle par défaut. */
  subjectTemplate?: string | null;
  /** Modèle du texte d'introduction du cabinet (settings.cr_mail_body_template), vide = modèle par défaut. */
  bodyTemplate?: string | null;
  /** Objet saisi à l'envoi : remplace le modèle pour cette diffusion (les variables y sont remplacées aussi). */
  subject?: string | null;
  /** Remarque particulière saisie à l'envoi, ajoutée sous l'introduction de chaque message. */
  note?: string | null;
}

/** Objet par défaut : l'opération d'abord, puis l'intitulé du compte-rendu. */
export const DEFAULT_CR_SUBJECT_TEMPLATE = '{operation}, compte rendu de chantier n° {numero} du {date}';
/** Introduction par défaut du message. */
export const DEFAULT_CR_BODY_TEMPLATE = "Veuillez trouver ci-joint le compte rendu de chantier n° {numero} du {date} de l'opération {operation} ({adresse}).";

/** Variables acceptées entre accolades dans l'objet et le texte d'introduction. */
export const CR_TEMPLATE_VARIABLES: { key: string; label: string }[] = [
  { key: 'operation', label: "Code et nom de l'opération" },
  { key: 'code', label: "Code de l'opération" },
  { key: 'projet', label: "Nom de l'opération" },
  { key: 'adresse', label: "Adresse de l'opération" },
  { key: 'numero', label: 'Numéro du compte rendu' },
  { key: 'date', label: 'Date du compte rendu' },
  { key: 'prochaine_reunion', label: 'Prochaine réunion' },
  { key: 'destinataire', label: 'Nom du destinataire' },
  { key: 'cabinet', label: 'Nom du cabinet' },
];

/**
 * Remplace les variables `{nom}` d'un modèle. Une variable inconnue reste telle quelle ; une valeur vide
 * ne laisse ni « du » orphelin (date absente) ni parenthèses vides (adresse absente).
 */
export function applyCrTemplate(template: string, values: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key] : whole))
    .replace(/\s+du\s*(?=[,.;)]|$)/gi, '')
    .replace(/[ \t]*\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ');
}

/** Valeurs des variables d'un modèle pour un destinataire. */
export function crTemplateValues(ctx: DiffusionMailContext, recipientName = ''): Record<string, string> {
  const code = (ctx.projectCode || '').trim();
  const projet = (ctx.projectName || '').trim();
  return {
    operation: [code, projet].filter(Boolean).join(' '),
    code,
    projet,
    adresse: (ctx.projectAddress || '').trim(),
    numero: String(ctx.reportNumber ?? ''),
    date: fmtDate(ctx.reportDate),
    prochaine_reunion: (ctx.nextMeeting || '').trim(),
    destinataire: recipientName,
    cabinet: (ctx.agencyName || '').trim(),
  };
}

export interface DiffusionMail {
  subject: string;
  text: string;
  html: string;
}

/** Plafond de destinataires d'une diffusion : un compte-rendu n'a pas des centaines d'intervenants. */
export const MAX_DIFFUSION_RECIPIENTS = 60;

const EMAIL_RE = /^[^\s@,;<>()"']+@[^\s@,;<>()"']+\.[^\s@,;<>()"']{2,}$/;

/** Adresse seule, sans espace, virgule ni retour à la ligne (un en-tête ne doit jamais s'injecter). */
export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value.trim());
}

/** Première adresse valable de la fiche : principale, professionnelle, autre, personnelle. */
export function contactEmail(c: Pick<Contact, 'email' | 'email_work' | 'email_other' | 'email_home'>): string {
  for (const candidate of [c.email, c.email_work, c.email_other, c.email_home]) {
    if (isValidEmail(candidate)) return candidate.trim();
  }
  return '';
}

/** Raison sociale, à défaut « Prénom Nom ». */
export function contactLabel(c: Pick<Contact, 'company_name' | 'first_name' | 'last_name'> & { name?: string }): string {
  const person = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return (c.company_name || '').trim() || person || (c.name || '').trim();
}

const TYPE_LABELS: Record<NonNullable<Observation['type']>, string> = {
  observation: 'Remarque',
  reserve: 'À lever',
  a_faire: 'Travail à faire',
};

const byNumber = (a: Observation, b: Observation) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER);

/**
 * Destinataires d'un compte-rendu : les entreprises titulaires d'un lot et les
 * intervenants de l'opération, chacun une seule fois. Une observation revient à
 * l'entreprise de son lot, ou à la personne qui lui est expressément désignée
 * (`contact_id`). Un lot ou un intervenant sans fiche contact n'a personne à
 * qui écrire : il n'apparaît pas.
 */
export function buildDiffusionRecipients(input: {
  lots: ProjectLot[];
  stakeholders: ProjectStakeholder[];
  contacts: Contact[];
  observations: Observation[];
  /** Observations des comptes-rendus précédents, non levées : jointes au message seulement si fournies. */
  previousObservations?: Observation[];
  /** Intervenants des entreprises par lot : chacun avec une adresse reçoit le compte-rendu et les observations de son lot. */
  intervenants?: LotIntervenantInput[];
}): DiffusionRecipient[] {
  const contactById = new Map(input.contacts.map(c => [c.id, c]));
  const entries = new Map<string, { roles: string[]; lotIds: Set<string> }>();

  const entryFor = (contactId: string) => {
    let entry = entries.get(contactId);
    if (!entry) { entry = { roles: [], lotIds: new Set() }; entries.set(contactId, entry); }
    return entry;
  };

  const lots = [...input.lots].sort((a, b) =>
    String(a.lot_number ?? '').localeCompare(String(b.lot_number ?? ''), 'fr', { numeric: true }));
  for (const lot of lots) {
    if (!lot.contact_id || !contactById.has(lot.contact_id)) continue;
    const entry = entryFor(lot.contact_id);
    entry.lotIds.add(lot.id);
    const role = `Lot ${lot.lot_number} ${lot.lot_title}`.trim();
    if (!entry.roles.includes(role)) entry.roles.push(role);
  }
  for (const s of input.stakeholders) {
    if (!s.contact_id || !contactById.has(s.contact_id)) continue;
    const entry = entryFor(s.contact_id);
    const role = (s.role || '').trim();
    if (role && !entry.roles.includes(role)) entry.roles.push(role);
  }

  const alreadyListed = new Set(input.observations.map(o => o.id));
  const contactRecipients = [...entries.entries()].map(([contactId, entry]) => {
    const contact = contactById.get(contactId)!;
    // Une observation revient à l'entreprise d'un des lots visés (un seul, plusieurs, ou tous : TCE,
    // auquel cas toutes les entreprises titulaires d'un lot la reçoivent), ou à la personne désignée.
    const concerns = (o: Observation) =>
      [...entry.lotIds].some(lotId => observationTargetsLot(o, lotId)) || o.contact_id === contactId || observationNamesContact(o, contactId);
    return {
      contactId,
      name: contactLabel(contact),
      roles: entry.roles,
      email: contactEmail(contact),
      observations: input.observations.filter(concerns).sort(byNumber),
      previousObservations: (input.previousObservations ?? [])
        .filter(o => !alreadyListed.has(o.id) && concerns(o))
        .sort(byNumber),
    };
  });
  return [...contactRecipients, ...intervenantRecipients(input, contactRecipients, alreadyListed)];
}

/**
 * Intervenants saisis dans l'onglet Entreprises. Une personne qui figure sur plusieurs lots (même adresse)
 * n'écrit qu'un message, avec les observations de tous ses lots. Une adresse déjà celle d'un destinataire
 * issu d'une fiche contact n'est pas doublée : cette personne reçoit déjà le compte-rendu.
 * Un lot inconnu (supprimé) est ignoré ; une personne sans adresse reste listée, non joignable.
 */
function intervenantRecipients(
  input: { lots: ProjectLot[]; observations: Observation[]; previousObservations?: Observation[]; intervenants?: LotIntervenantInput[] },
  contactRecipients: DiffusionRecipient[],
  alreadyListed: Set<string>,
): DiffusionRecipient[] {
  const lotById = new Map(input.lots.map(l => [l.id, l]));
  const taken = new Set(contactRecipients.map(r => r.email.toLowerCase()).filter(Boolean));
  const groups = new Map<string, { people: LotIntervenantInput[]; email: string }>();
  const lotRank = (id: string) => String(lotById.get(id)?.lot_number ?? '');
  const ordered = [...(input.intervenants ?? [])]
    .filter(i => i && typeof i.id === 'string' && lotById.has(i.lot_id) && (i.nom || '').trim())
    .sort((a, b) => lotRank(a.lot_id).localeCompare(lotRank(b.lot_id), 'fr', { numeric: true }));
  for (const i of ordered) {
    const email = isValidEmail(i.email) ? i.email.trim() : '';
    if (email && taken.has(email.toLowerCase())) continue;
    const key = email ? `${INTERVENANT_KEY_PREFIX}${email.toLowerCase()}` : `${INTERVENANT_KEY_PREFIX}${i.id}`;
    const group = groups.get(key) ?? { people: [], email };
    group.people.push(i);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ people, email }) => {
    const first = people[0];
    const lotIds = new Set(people.map(p => p.lot_id));
    const contactIds = new Set(people.map(p => p.contact_id).filter((v): v is string => !!v));
    const concerns = (o: Observation) =>
      [...lotIds].some(lotId => observationTargetsLot(o, lotId)) || [...contactIds].some(id => observationNamesContact(o, id));
    const roles: string[] = [];
    for (const p of people) {
      const lot = lotById.get(p.lot_id)!;
      for (const role of [(p.role || '').trim(), (p.entreprise || '').trim(), `Lot ${lot.lot_number} ${lot.lot_title}`.trim()]) {
        if (role && !roles.includes(role)) roles.push(role);
      }
    }
    return {
      // Un seul identifiant par personne : celui de sa première ligne (un UUID : le serveur refuse les clés de plus de 64 caractères).
      contactId: `${INTERVENANT_KEY_PREFIX}${first.id}`,
      name: first.nom.trim(),
      roles,
      email,
      observations: input.observations.filter(concerns).sort(byNumber),
      previousObservations: (input.previousObservations ?? []).filter(o => !alreadyListed.has(o.id) && concerns(o)).sort(byNumber),
    };
  });
}

const fmtDate = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('fr-FR');
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Une observation sur une ligne : « 3. [À lever] Texte. Statut : À faire. Délai : 12/03/2026. ». */
function observationLine(o: Observation): string {
  const scope = o.tce ? `[${TCE_LABEL}] ` : '';
  const parts = [`${o.number != null ? `${o.number}. ` : ''}${scope}[${TYPE_LABELS[o.type || 'observation']}] ${o.texte}`.trim()];
  const details = [
    `Statut : ${o.statut}`,
    o.urgence && o.urgence !== 'normal' ? `Urgence : ${o.urgence}` : '',
    o.due_date ? `Délai : ${fmtDate(o.due_date)}` : '',
  ].filter(Boolean);
  return `${parts[0]} (${details.join(', ')})`;
}

/** Texte libre en paragraphes HTML : ligne vide = nouveau paragraphe, retour à la ligne = `<br>`. */
const paragraphsHtml = (text: string): string[] =>
  text.split(/\r?\n\s*\r?\n/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p>${escapeHtml(p).replace(/\r?\n/g, '<br>')}</p>`);

/** Sujet sur une seule ligne : un retour à la ligne y serait une injection d'en-tête. */
const oneLine = (s: string): string => s.replace(/[\r\n]+/g, ' ').trim();

/** Message adressé à UN destinataire : le compte-rendu en pièce jointe, et SES observations dans le corps. */
export function buildDiffusionMail(recipient: DiffusionRecipient, ctx: DiffusionMailContext): DiffusionMail {
  const values = crTemplateValues(ctx, recipient.name);
  const subjectSource = (ctx.subject || '').trim() || (ctx.subjectTemplate || '').trim() || DEFAULT_CR_SUBJECT_TEMPLATE;
  const subject = oneLine(applyCrTemplate(subjectSource, values));

  const intro = applyCrTemplate((ctx.bodyTemplate || '').trim() || DEFAULT_CR_BODY_TEMPLATE, values).trim();
  const note = (ctx.note || '').trim();
  const count = recipient.observations.length;
  const heading = count > 0
    ? `Observations vous concernant (${count}) :`
    : 'Aucune observation ne vous concerne dans ce compte rendu.';
  const lines = recipient.observations.map(observationLine);
  // Anciennes observations non levées (option de la diffusion) : une seconde liste, sous la première.
  const previousCount = recipient.previousObservations.length;
  const previousHeading = previousCount > 0 ? `Observations antérieures non levées vous concernant (${previousCount}) :` : '';
  const previousLines = recipient.previousObservations.map(observationLine);
  const next = ctx.nextMeeting ? `Prochaine réunion : ${ctx.nextMeeting}` : '';
  const signature = (ctx.signature || '').trim() || (ctx.agencyName || '').trim();

  const text = [
    'Bonjour,',
    '',
    intro,
    ...(note ? ['', note] : []),
    '',
    heading,
    ...lines.map(l => `- ${l}`),
    ...(previousCount > 0 ? ['', previousHeading, ...previousLines.map(l => `- ${l}`)] : []),
    ...(next ? ['', next] : []),
    '',
    'Cordialement,',
    ...(signature ? [signature] : []),
  ].join('\n');

  const html = [
    '<p>Bonjour,</p>',
    ...paragraphsHtml(intro),
    ...(note ? paragraphsHtml(note) : []),
    `<p><strong>${escapeHtml(heading)}</strong></p>`,
    ...(count > 0 ? [`<ul>${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`] : []),
    ...(previousCount > 0 ? [`<p><strong>${escapeHtml(previousHeading)}</strong></p>`, `<ul>${previousLines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`] : []),
    ...(next ? [`<p>${escapeHtml(next)}</p>`] : []),
    `<p>Cordialement,${signature ? `<br>${escapeHtml(signature).replace(/\r?\n/g, '<br>')}` : ''}</p>`,
  ].join('\n');

  return { subject, text, html };
}
