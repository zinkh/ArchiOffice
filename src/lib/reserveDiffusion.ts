// ── Diffusion et export des réserves (OPR et GPA) ────────────────────────────
// Logique pure, partagée par l'écran (fenêtre « Diffusion et export ») et par le serveur (qui la
// rejoue : le client n'envoie jamais d'adresse, seulement la clé d'un destinataire) :
// classement par lot, périmètre d'un export, qui reçoit quoi et le texte du message.
//
// - Les INTERVENANTS de l'opération reçoivent le rapport complet (tout le périmètre choisi).
// - Chaque ENTREPRISE ne reçoit que SES réserves (celles dont elle est en charge).
import type { Contact } from '../types';
import { contactEmail, contactLabel } from './crDiffusion';
import { parseJsonList } from './jsonList';

export const SANS_LOT = 'Sans lot';

/** Ce qu'il faut d'une réserve ici : ni photos ni plan, que le PDF lit lui-même. */
export interface ReserveDiffusable {
  id: string;
  number?: number | null;
  status: string;
  lots?: unknown;
  entreprises?: unknown;
}

export interface LotRef { lot_number?: string | null; lot_title: string; contact_id?: string | null; contact_name?: string | null }

export interface LotGroup<T> { key: string; label: string; rows: T[] }

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

const byNumber = <T extends { number?: number | null }>(a: T, b: T) => (a.number || 0) - (b.number || 0);

/** Intitulés de lot classés par numéro (« 2 » avant « 10 », « 01A » après « 01 »). */
export function orderedLotTitles(lots: readonly LotRef[]): string[] {
  return [...lots]
    .sort((a, b) => (a.lot_number ?? '').localeCompare(b.lot_number ?? '', 'fr', { numeric: true }))
    .map(l => l.lot_title);
}

export function lotLabel(lot: LotRef): string {
  return lot.lot_number ? `${lot.lot_number} · ${lot.lot_title}` : lot.lot_title;
}

/**
 * Lot sous lequel une réserve est rangée : le premier de ses lots (parmi `allowed` quand un périmètre
 * est choisi), « Sans lot » si elle n'en a aucun. Une réserve n'apparaît donc qu'une fois.
 */
export function primaryLot(reserve: Pick<ReserveDiffusable, 'lots'>, allowed?: ReadonlySet<string> | null): string {
  const lots = parseJsonList(reserve.lots);
  const found = allowed ? lots.find(l => allowed.has(l)) : lots[0];
  return found ?? SANS_LOT;
}

/** Réserves d'un périmètre : `lotTitles` null = toute la liste ; sinon celles qui portent l'un des lots. */
export function selectReserves<T extends ReserveDiffusable>(reserves: readonly T[], lotTitles: readonly string[] | null): T[] {
  if (!lotTitles) return [...reserves];
  const allowed = new Set(lotTitles);
  return reserves.filter(r => {
    const lots = parseJsonList(r.lots);
    return lots.length === 0 ? allowed.has(SANS_LOT) : lots.some(l => allowed.has(l));
  });
}

/** Classement par lot (ordre des numéros de lot, « Sans lot » en dernier), réserves par numéro. */
export function groupReservesByLot<T extends ReserveDiffusable>(
  reserves: readonly T[], lots: readonly LotRef[], allowed?: ReadonlySet<string> | null,
): LotGroup<T>[] {
  const labels = new Map(lots.map(l => [l.lot_title, lotLabel(l)]));
  const order = orderedLotTitles(lots);
  const buckets = new Map<string, T[]>();
  for (const r of reserves) {
    const key = primaryLot(r, allowed);
    const bucket = buckets.get(key) ?? [];
    bucket.push(r);
    buckets.set(key, bucket);
  }
  const known = order.filter(t => buckets.has(t));
  // Un lot porté par une réserve mais absent de la liste des lots du projet : après les lots connus.
  const unknown = [...buckets.keys()].filter(k => k !== SANS_LOT && !order.includes(k)).sort((a, b) => a.localeCompare(b, 'fr'));
  const keys = [...known, ...unknown, ...(buckets.has(SANS_LOT) ? [SANS_LOT] : [])];
  return keys.map(key => ({ key, label: labels.get(key) ?? key, rows: [...buckets.get(key)!].sort(byNumber) }));
}

export type DestinataireRole = 'intervenant' | 'entreprise';

export interface ReserveRecipient {
  /** `int:<contact>` ou `ent:<contact ou nom>` : clé stable d'un destinataire. */
  key: string;
  role: DestinataireRole;
  name: string;
  /** Rôle ou lots : pourquoi cette personne reçoit le rapport. */
  detail: string;
  contactId: string | null;
  email: string;
  reserveIds: string[];
}

export interface RecipientInput<T extends ReserveDiffusable> {
  /** Réserves du périmètre choisi (déjà filtrées). */
  reserves: readonly T[];
  lots: readonly LotRef[];
  marches: readonly { entreprise_nom?: string | null; contact_id?: string | null }[];
  stakeholders: readonly { name?: string | null; role?: string | null; contact_id?: string | null }[];
  contacts: readonly Contact[];
}

/** Contact d'une entreprise nommée dans une réserve : marché, fiche du lot, puis raison sociale. */
function contactOfEntreprise(nom: string, input: Pick<RecipientInput<ReserveDiffusable>, 'marches' | 'lots' | 'contacts'>): string | null {
  const cle = norm(nom);
  const viaMarche = input.marches.find(m => m.contact_id && norm(m.entreprise_nom) === cle);
  if (viaMarche?.contact_id) return viaMarche.contact_id;
  const viaLot = input.lots.find(l => l.contact_id && norm(l.contact_name) === cle);
  if (viaLot?.contact_id) return viaLot.contact_id;
  const viaFiche = input.contacts.find(c => norm(contactLabel(c)) === cle || norm(c.company_name) === cle);
  return viaFiche?.id ?? null;
}

/**
 * Destinataires d'un envoi. Un destinataire sans fiche ou sans adresse valable reste listé (`email` vide) :
 * l'écran le signale au lieu de le faire disparaître.
 */
export function buildReserveRecipients<T extends ReserveDiffusable>(input: RecipientInput<T>): { intervenants: ReserveRecipient[]; entreprises: ReserveRecipient[] } {
  const contactById = new Map(input.contacts.map(c => [c.id, c]));
  const emailOf = (id: string | null) => {
    const c = id ? contactById.get(id) : null;
    return c ? contactEmail(c) : '';
  };
  const tous = input.reserves.map(r => r.id);

  const intervenants: ReserveRecipient[] = [];
  const vus = new Set<string>();
  for (const s of input.stakeholders) {
    if (!s.contact_id || vus.has(s.contact_id)) continue;
    vus.add(s.contact_id);
    const c = contactById.get(s.contact_id);
    intervenants.push({
      key: `int:${s.contact_id}`, role: 'intervenant', name: (c ? contactLabel(c) : '') || s.name || '',
      detail: s.role || 'Intervenant', contactId: s.contact_id, email: emailOf(s.contact_id), reserveIds: tous,
    });
  }

  const parEntreprise = new Map<string, { nom: string; ids: string[]; lots: Set<string> }>();
  for (const r of input.reserves) {
    for (const nom of parseJsonList(r.entreprises)) {
      const cle = norm(nom);
      if (!cle) continue;
      const entry = parEntreprise.get(cle) ?? { nom: nom.trim(), ids: [], lots: new Set<string>() };
      entry.ids.push(r.id);
      parseJsonList(r.lots).forEach(l => entry.lots.add(l));
      parEntreprise.set(cle, entry);
    }
  }
  // Une entreprise qui a déjà reçu le rapport complet comme intervenant ne le reçoit pas deux fois.
  const entreprises: ReserveRecipient[] = [];
  for (const { nom, ids, lots } of parEntreprise.values()) {
    const contactId = contactOfEntreprise(nom, input);
    if (contactId && vus.has(contactId)) continue;
    entreprises.push({
      key: `ent:${contactId ?? norm(nom)}`, role: 'entreprise', name: nom, detail: [...lots].join(', ') || 'Entreprise',
      contactId, email: emailOf(contactId), reserveIds: ids,
    });
  }
  entreprises.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return { intervenants, entreprises };
}

export type ExportStatus = 'exporte' | 'en_cours' | 'envoye' | 'partiel' | 'echec';

export interface ExportSend {
  key: string;
  role: DestinataireRole;
  name: string;
  email: string;
  reserve_count: number;
  status: 'envoye' | 'echec';
  sent_at: string;
  error?: string;
}

/** État d'une diffusion déduit de ses envois : jamais saisi. */
export function statutDiffusion(sends: readonly Pick<ExportSend, 'status'>[]): ExportStatus {
  if (sends.length === 0) return 'en_cours';
  const ok = sends.filter(s => s.status === 'envoye').length;
  if (ok === sends.length) return 'envoye';
  return ok === 0 ? 'echec' : 'partiel';
}

export const LIBELLE_STATUT: Record<ExportStatus, string> = {
  exporte: 'Exporté', en_cours: 'En cours', envoye: 'Envoyé', partiel: 'Envoi partiel', echec: 'Échec',
};

export interface ReserveMailContext {
  role: DestinataireRole;
  recipientName: string;
  title: string; // « Réserves » ou « Réserves GPA »
  projectName: string;
  projectCode?: string | null;
  projectAddress?: string | null;
  agencyName?: string | null;
  signature?: string | null;
  note?: string | null;
  count: number;
  open: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const noBreak = (s: unknown) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

export function buildReserveMail(ctx: ReserveMailContext): { subject: string; text: string; html: string } {
  const project = [ctx.projectCode, ctx.projectName].filter(Boolean).map(noBreak).join(' - ');
  const subject = noBreak(`${ctx.title} - ${project}${ctx.role === 'entreprise' ? ' - vos réserves' : ''}`);
  const non = `${ctx.open} non levée${ctx.open > 1 ? 's' : ''}`;
  const portee = ctx.role === 'entreprise'
    ? `la liste des réserves dont vous avez la charge (${ctx.count}, dont ${non})`
    : `la liste complète des réserves (${ctx.count}, dont ${non})`;
  const lines = [
    `Bonjour ${noBreak(ctx.recipientName)},`,
    '',
    `Veuillez trouver ci-joint ${portee} de l'opération ${project}${ctx.projectAddress ? ` (${noBreak(ctx.projectAddress)})` : ''}.`,
    ...(ctx.note?.trim() ? ['', ctx.note.trim()] : []),
    ...(ctx.role === 'entreprise' ? ['', 'Merci de lever ces réserves dans les délais indiqués et de nous en informer.'] : []),
    '',
    'Cordialement,',
    (ctx.signature?.trim() || ctx.agencyName || '').trim(),
  ];
  const text = lines.join('\n').trim();
  const html = lines.map(l => (l ? `<p style="margin:0 0 8px">${esc(l)}</p>` : '')).join('');
  return { subject, text, html: html || esc(text) };
}

// ── Rappel hebdomadaire des réserves non levées ──────────────────────────────

export const STATUTS_LEVES: ReadonlySet<string> = new Set(['Levée', 'Quitus Transmis']);

export const estNonLevee = (r: Pick<ReserveDiffusable, 'status'>): boolean => !STATUTS_LEVES.has(r.status);

export interface ReserveRappelLigne {
  number?: number | null;
  title?: string | null;
  batiment?: string | null;
  local?: string | null;
  due_date?: string | null;
  status: string;
}

/** Jours de retard à `today` (0 si l'échéance n'est pas dépassée, absente ou illisible). */
export function joursDeRetard(due: string | null | undefined, today: Date = new Date()): number {
  if (!due) return 0;
  const d = new Date(String(due).split('T')[0] + 'T00:00:00');
  if (isNaN(d.getTime())) return 0;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return d < t ? Math.round((t.getTime() - d.getTime()) / 86400000) : 0;
}

const MAX_LIGNES_RAPPEL = 60;
const fmtJour = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(String(iso).split('T')[0] + 'T00:00:00');
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR');
};

export interface ReserveRappelContext {
  recipientName: string;
  title: string;
  projectName: string;
  projectCode?: string | null;
  agencyName?: string | null;
  reserves: readonly ReserveRappelLigne[];
  today?: Date;
}

/** Rappel d'une entreprise : ses réserves non levées, en retard d'abord. Sans réserve non levée : null. */
export function buildReminderMail(ctx: ReserveRappelContext): { subject: string; text: string; html: string } | null {
  const today = ctx.today ?? new Date();
  const ouvertes = ctx.reserves.filter(estNonLevee)
    .map(r => ({ ...r, retard: joursDeRetard(r.due_date, today) }))
    .sort((a, b) => (b.retard > 0 ? 1 : 0) - (a.retard > 0 ? 1 : 0) || (a.number || 0) - (b.number || 0));
  if (ouvertes.length === 0) return null;
  const enRetard = ouvertes.filter(r => r.retard > 0).length;
  const project = [ctx.projectCode, ctx.projectName].filter(Boolean).map(noBreak).join(' - ');
  const subject = noBreak(`Rappel : ${ouvertes.length} réserve${ouvertes.length > 1 ? 's' : ''} à lever - ${project}`);
  const affichees = ouvertes.slice(0, MAX_LIGNES_RAPPEL);
  const reste = ouvertes.length - affichees.length;
  const ligneTexte = (r: (typeof ouvertes)[number]) => {
    const lieu = [r.batiment, r.local].filter(Boolean).join(' / ');
    const echeance = r.due_date ? ` - échéance ${fmtJour(r.due_date)}${r.retard ? ` (en retard de ${r.retard} j)` : ''}` : '';
    return `- n° ${r.number ?? '?'} : ${noBreak(r.title) || '(sans titre)'}${lieu ? ` (${noBreak(lieu)})` : ''}${echeance}`;
  };
  const intro = `Il reste ${ouvertes.length} réserve${ouvertes.length > 1 ? 's' : ''} non levée${ouvertes.length > 1 ? 's' : ''} sous votre responsabilité sur l'opération ${project}${enRetard ? `, dont ${enRetard} en retard` : ''}.`;
  const text = [
    `Bonjour ${noBreak(ctx.recipientName)},`, '', intro, '', ...affichees.map(ligneTexte),
    ...(reste > 0 ? [`… et ${reste} autre${reste > 1 ? 's' : ''}.`] : []), '',
    'Merci de les lever dans les meilleurs délais et de nous en informer.', '',
    "Ce message est un rappel automatique hebdomadaire, envoyé tant que des réserves ne sont pas levées.", '',
    'Cordialement,', (ctx.agencyName || '').trim(),
  ].join('\n').trim();
  const cell = 'padding:4px 8px;border-bottom:1px solid #d1d5db;text-align:left;font-size:13px';
  const rows = affichees.map(r => {
    const lieu = [r.batiment, r.local].filter(Boolean).join(' / ');
    return `<tr><td style="${cell}">${esc(String(r.number ?? ''))}</td><td style="${cell}">${esc(noBreak(r.title) || '(sans titre)')}</td>`
      + `<td style="${cell}">${esc(noBreak(lieu))}</td><td style="${cell}">${esc(fmtJour(r.due_date))}${r.retard ? ` <strong>(+${r.retard} j)</strong>` : ''}</td></tr>`;
  }).join('');
  const html = `<p style="margin:0 0 8px">Bonjour ${esc(noBreak(ctx.recipientName))},</p><p style="margin:0 0 8px">${esc(intro)}</p>`
    + `<table style="border-collapse:collapse;margin:8px 0"><thead><tr><th style="${cell}">N°</th><th style="${cell}">Réserve</th><th style="${cell}">Localisation</th><th style="${cell}">Échéance</th></tr></thead><tbody>${rows}</tbody></table>`
    + (reste > 0 ? `<p style="margin:0 0 8px">… et ${reste} autre${reste > 1 ? 's' : ''}.</p>` : '')
    + `<p style="margin:0 0 8px">Merci de les lever dans les meilleurs délais et de nous en informer.</p>`
    + `<p style="margin:0 0 8px;color:#6b7280;font-size:12px">Ce message est un rappel automatique hebdomadaire, envoyé tant que des réserves ne sont pas levées.</p>`
    + `<p style="margin:0">Cordialement,<br>${esc((ctx.agencyName || '').trim())}</p>`;
  return { subject, text, html };
}
