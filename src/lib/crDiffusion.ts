// ── Diffusion d'un compte-rendu de chantier par e-mail ────────────────────────
// Logique pure, partagée par l'écran (liste des destinataires de la fenêtre de
// diffusion) et par le serveur (qui la rejoue pour ne jamais faire confiance à
// une adresse envoyée par le client) : qui reçoit le compte-rendu, quelles
// observations le concernent, et le texte du message qui lui est adressé.
import type { Contact, Observation, ProjectLot, ProjectStakeholder } from '../types';

export interface DiffusionRecipient {
  /** Identifiant du contact : la clé d'un destinataire (une entreprise sur plusieurs lots n'en forme qu'un). */
  contactId: string;
  /** Raison sociale, à défaut le nom de la personne. */
  name: string;
  /** « Lot 02 Gros œuvre », « Architecte »... : pourquoi cette personne reçoit le compte-rendu. */
  roles: string[];
  /** Première adresse valable de la fiche, vide s'il n'y en a aucune. */
  email: string;
  /** Observations du compte-rendu qui la concernent, par numéro. */
  observations: Observation[];
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

  return [...entries.entries()].map(([contactId, entry]) => {
    const contact = contactById.get(contactId)!;
    return {
      contactId,
      name: contactLabel(contact),
      roles: entry.roles,
      email: contactEmail(contact),
      observations: input.observations
        .filter(o => (o.lot_id && entry.lotIds.has(o.lot_id)) || o.contact_id === contactId)
        .sort(byNumber),
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
  const parts = [`${o.number != null ? `${o.number}. ` : ''}[${TYPE_LABELS[o.type || 'observation']}] ${o.texte}`.trim()];
  const details = [
    `Statut : ${o.statut}`,
    o.urgence && o.urgence !== 'normal' ? `Urgence : ${o.urgence}` : '',
    o.due_date ? `Délai : ${fmtDate(o.due_date)}` : '',
  ].filter(Boolean);
  return `${parts[0]} (${details.join(', ')})`;
}

/** Sujet sur une seule ligne : un retour à la ligne y serait une injection d'en-tête. */
const oneLine = (s: string): string => s.replace(/[\r\n]+/g, ' ').trim();

/** Message adressé à UN destinataire : le compte-rendu en pièce jointe, et SES observations dans le corps. */
export function buildDiffusionMail(recipient: DiffusionRecipient, ctx: DiffusionMailContext): DiffusionMail {
  const operation = [ctx.projectCode, ctx.projectName].filter(Boolean).join(' ');
  const date = fmtDate(ctx.reportDate);
  const subject = oneLine(`Compte rendu de chantier n° ${ctx.reportNumber}${date ? ` du ${date}` : ''}, ${operation}`);

  const intro = `Veuillez trouver ci-joint le compte rendu de chantier n° ${ctx.reportNumber}${date ? ` du ${date}` : ''} de l'opération ${operation}${ctx.projectAddress ? ` (${ctx.projectAddress})` : ''}.`;
  const count = recipient.observations.length;
  const heading = count > 0
    ? `Observations vous concernant (${count}) :`
    : 'Aucune observation ne vous concerne dans ce compte rendu.';
  const lines = recipient.observations.map(observationLine);
  const next = ctx.nextMeeting ? `Prochaine réunion : ${ctx.nextMeeting}` : '';
  const signature = (ctx.signature || '').trim() || (ctx.agencyName || '').trim();

  const text = [
    'Bonjour,',
    '',
    intro,
    '',
    heading,
    ...lines.map(l => `- ${l}`),
    ...(next ? ['', next] : []),
    '',
    'Cordialement,',
    ...(signature ? [signature] : []),
  ].join('\n');

  const html = [
    '<p>Bonjour,</p>',
    `<p>${escapeHtml(intro)}</p>`,
    `<p><strong>${escapeHtml(heading)}</strong></p>`,
    ...(count > 0 ? [`<ul>${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`] : []),
    ...(next ? [`<p>${escapeHtml(next)}</p>`] : []),
    `<p>Cordialement,${signature ? `<br>${escapeHtml(signature).replace(/\r?\n/g, '<br>')}` : ''}</p>`,
  ].join('\n');

  return { subject, text, html };
}
