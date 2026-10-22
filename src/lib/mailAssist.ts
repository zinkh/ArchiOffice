// Assistant de messagerie : logique pure partagée entre l'écran (composeur,
// panneau IA) et le serveur (server/routes/mailAi.ts, qui valide la sortie du
// modèle avec `sanitizeAssist`).
//
// Règle : l'IA PROPOSE, jamais n'applique. Tout identifiant que le modèle
// renvoie (affaire, lot, contact, collaborateur) est revérifié contre la liste
// fournie au prompt ; un identifiant inconnu devient `null`, jamais une
// invention présentée comme un fait.

export const MAIL_CATEGORIES = [
  'devis', 'ordre_de_service', 'situation_travaux', 'courrier_moa',
  'administratif', 'facture', 'reunion', 'information', 'autre',
] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

export const MAIL_URGENCIES = ['faible', 'normale', 'haute'] as const;
export type MailUrgency = (typeof MAIL_URGENCIES)[number];

export const MAIL_TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type MailTaskPriority = (typeof MAIL_TASK_PRIORITIES)[number];

export const MAIL_CATEGORY_LABELS: Record<MailCategory, string> = {
  devis: 'Devis',
  ordre_de_service: 'Ordre de service',
  situation_travaux: 'Situation de travaux',
  courrier_moa: 'Courrier du maître d’ouvrage',
  administratif: 'Administratif',
  facture: 'Facture',
  reunion: 'Réunion',
  information: 'Information',
  autre: 'Autre',
};

export const MAIL_URGENCY_LABELS: Record<MailUrgency, string> = {
  faible: 'Faible',
  normale: 'Normale',
  haute: 'Haute',
};

/** Ce que le serveur donne au modèle pour classer : seules ces entrées peuvent être choisies. */
export interface MailAssistContext {
  projects: { id: string; code: string; name: string; client?: string; lots: { id: string; number: string; title: string; company?: string; contactId?: string }[] }[];
  /** Contacts proposables comme destinataires d'un transfert : id -> nom et adresse. */
  contacts: Record<string, { name: string; email: string }>;
  team: { id: string; name: string }[];
}

export interface MailAssistSuggestion {
  summary: string;
  actions: string[];
  category: MailCategory;
  urgency: MailUrgency;
  project: { id: string; code: string; name: string } | null;
  lot: { id: string; label: string } | null;
  reasoning: string;
  reply: { subject: string; body: string };
  forward: { body: string; recipients: { contactId: string; name: string; email: string }[] };
  task: { title: string; description: string; dueInDays: number | null; priority: MailTaskPriority; assigneeId: string | null; assigneeName: string | null };
}

const clip = (value: unknown, max: number): string => (typeof value === 'string' ? value : '').trim().slice(0, max);

/** Extrait le premier objet JSON d'une réponse de modèle (avec ou sans bloc de code). */
export function parseModelJson(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/gi, '');
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Valide et borne la proposition du modèle ; jamais d'identifiant hors de `ctx`. */
export function sanitizeAssist(raw: unknown, ctx: MailAssistContext): MailAssistSuggestion {
  const r: any = raw && typeof raw === 'object' ? raw : {};
  const project = ctx.projects.find(p => p.id === r.project_id) || null;
  const lot = project?.lots.find(l => l.id === r.lot_id) || null;

  const category = (MAIL_CATEGORIES as readonly string[]).includes(r.category) ? (r.category as MailCategory) : 'autre';
  const urgency = (MAIL_URGENCIES as readonly string[]).includes(r.urgency) ? (r.urgency as MailUrgency) : 'normale';

  const recipients: MailAssistSuggestion['forward']['recipients'] = [];
  for (const id of Array.isArray(r.forward?.contact_ids) ? r.forward.contact_ids : []) {
    const contact = typeof id === 'string' ? ctx.contacts[id] : undefined;
    if (contact?.email && !recipients.some(x => x.contactId === id)) recipients.push({ contactId: id, name: contact.name, email: contact.email });
    if (recipients.length >= 5) break;
  }

  const assignee = ctx.team.find(m => m.id === r.task?.assignee_id) || null;
  const dueRaw = Number(r.task?.due_in_days);
  const priority = (MAIL_TASK_PRIORITIES as readonly string[]).includes(r.task?.priority) ? (r.task.priority as MailTaskPriority) : 'normal';

  return {
    summary: clip(r.summary, 900),
    actions: (Array.isArray(r.actions) ? r.actions : []).map((a: unknown) => clip(a, 220)).filter(Boolean).slice(0, 6),
    category,
    urgency,
    project: project ? { id: project.id, code: project.code, name: project.name } : null,
    lot: lot ? { id: lot.id, label: `${lot.number ? `${lot.number} ` : ''}${lot.title}`.trim() } : null,
    reasoning: clip(r.reasoning, 400),
    reply: { subject: clip(r.reply?.subject, 200), body: clip(r.reply?.body, 6000) },
    forward: { body: clip(r.forward?.body, 3000), recipients },
    task: {
      title: clip(r.task?.title, 160),
      description: clip(r.task?.description, 1500),
      dueInDays: Number.isFinite(dueRaw) && dueRaw >= 0 && dueRaw <= 365 ? Math.round(dueRaw) : null,
      priority,
      assigneeId: assignee?.id || null,
      assigneeName: assignee?.name || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Composeur : destinataires, objets et citations

const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Toutes les adresses d'un en-tête (« Nom <a@b.fr>, c@d.fr »), sans doublon, en minuscules. */
export function extractAddresses(raw: string | null | undefined): string[] {
  const found = (raw || '').match(EMAIL_IN_TEXT) || [];
  return [...new Set(found.map(a => a.toLowerCase()))];
}

/** « Répondre à tous » : l'expéditeur en À, les autres destinataires en Cc, sans soi-même. */
export function replyAllRecipients(
  message: { from: string; to: string; cc: string },
  mine: string[],
): { to: string; cc: string } {
  const own = new Set(mine.map(a => a.toLowerCase()));
  const to = extractAddresses(message.from).filter(a => !own.has(a));
  const cc = [...extractAddresses(message.to), ...extractAddresses(message.cc)]
    .filter(a => !own.has(a) && !to.includes(a));
  return { to: to.join(', '), cc: [...new Set(cc)].join(', ') };
}

export function replySubject(subject: string): string {
  return /^re\s*:/i.test(subject) ? subject : `Re: ${subject}`;
}

export function forwardSubject(subject: string): string {
  return /^(tr|fwd?|fw)\s*:/i.test(subject) ? subject : `Tr: ${subject}`;
}

const formatDate = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR');
};

const quoteLines = (text: string): string => text.split('\n').map(l => `> ${l}`).join('\n');

/** Citation sous une réponse. */
export function quotedReply(message: { from: string; date: string | null }, bodyText: string): string {
  const when = formatDate(message.date);
  return `\n\nLe ${when || 'jour du message'}, ${message.from} a écrit :\n${quoteLines(bodyText.trim())}`;
}

/** Corps d'un transfert : l'en-tête du message d'origine puis son texte. */
export function forwardedBody(message: { from: string; to: string; cc: string; date: string | null; subject: string }, bodyText: string): string {
  const lines = [
    '---------- Message transféré ----------',
    `De : ${message.from}`,
    `Date : ${formatDate(message.date)}`,
    `Objet : ${message.subject}`,
    `À : ${message.to}`,
    ...(message.cc ? [`Cc : ${message.cc}`] : []),
    '',
    bodyText.trim(),
  ];
  return `\n\n${lines.join('\n')}`;
}

/** Texte brut d'un message : le texte s'il existe, sinon le HTML dépouillé de ses balises. */
export function messageText(message: { bodyText: string | null; bodyHtml: string | null }): string {
  if (message.bodyText?.trim()) return message.bodyText;
  if (!message.bodyHtml) return '';
  if (typeof DOMParser === 'undefined') return message.bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const doc = new DOMParser().parseFromString(message.bodyHtml, 'text/html');
  doc.querySelectorAll('style, script, head').forEach(n => n.remove());
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
}

/** Date AAAA-MM-JJ à `days` jours d'aujourd'hui (calculée en UTC, comme les autres échéances). */
export function isoDateInDays(days: number, from: Date = new Date()): string {
  const d = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate() + days));
  return d.toISOString().slice(0, 10);
}
