// Fusion de contacts : logique pure, partagée par l'écran (aperçu, détection de
// doublons) et le serveur (calcul des valeurs écrites). Le serveur ne croit jamais un
// correctif envoyé par le client : il reçoit seulement des CHOIX (champ -> fiche) et
// rejoue `resolveMergePatch` sur les fiches lues en base. Voir
// server/routes/contactMerge.ts et supabase/migrate_merge_contacts.sql.

export type MergeContact = Record<string, any> & { id: string };

/** Mot à saisir pour confirmer : la fusion est définitive. */
export const MERGE_CONFIRM_WORD = 'FUSIONNER';
/** Aligné sur merge_contacts : 10 doublons au plus, donc 11 fiches avec la fiche conservée. */
export const MERGE_MAX_CONTACTS = 11;

export function isMergeConfirmed(input: unknown): boolean {
  return typeof input === 'string' && input.trim().toUpperCase() === MERGE_CONFIRM_WORD;
}

/** Colonnes texte dont on choisit la valeur, dans l'ordre d'affichage. */
export const MERGE_CHOICE_FIELDS: readonly string[] = [
  'prefix', 'first_name', 'middle_name', 'last_name', 'suffix', 'nickname',
  'company_name', 'job_title', 'department', 'category',
  'siret', 'vat_number', 'website', 'birthday',
  'email', 'email_work', 'email_home', 'email_other',
  'phone', 'phone_mobile', 'phone_work', 'phone_main', 'phone_home', 'phone_fax_work', 'phone_fax_home', 'phone_pager', 'phone_other',
  'address', 'zip', 'city', 'state', 'country',
  'address_work_street', 'address_work_zip', 'address_work_city', 'address_work_state', 'address_work_country',
  'address_home_street', 'address_home_zip', 'address_home_city', 'address_home_state', 'address_home_country',
  'market_number', 'logo', 'electronic_signature',
];

/** Listes séparées par des virgules : on garde l'union des valeurs. */
export const MERGE_LIST_TEXT_FIELDS: readonly string[] = ['tags', 'affaires', 'candidatures', 'contact_references'];
/** Listes JSON (puces) : union. */
export const MERGE_LIST_JSON_FIELDS: readonly string[] = ['corps_etat', 'specialite'];
/** Texte libre : toutes les notes distinctes sont conservées, l'une sous l'autre. */
export const MERGE_CONCAT_FIELD = 'notes';

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function contactName(c: Partial<MergeContact>): string {
  const company = clean(c.company_name);
  if (company) return company;
  const person = [clean(c.first_name), clean(c.last_name)].filter(Boolean).join(' ');
  return person || clean(c.email) || clean(c.email_work) || 'Sans nom';
}

function splitList(v: unknown): string[] {
  return clean(v).split(/[;,]/).map(s => s.trim()).filter(Boolean);
}

function unionText(values: unknown[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    for (const item of splitList(v)) {
      const key = item.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(item); }
    }
  }
  return out.join(', ');
}

function unionArrays(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!Array.isArray(v)) continue;
    for (const raw of v) {
      const item = clean(raw);
      const key = item.toLowerCase();
      if (item && !seen.has(key)) { seen.add(key); out.push(item); }
    }
  }
  return out;
}

function concatNotes(values: unknown[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const note = clean(v);
    const key = note.toLowerCase();
    if (note && !seen.has(key)) { seen.add(key); out.push(note); }
  }
  return out.join('\n\n');
}

/** Fiche à conserver proposée : la plus renseignée, puis celle qui a le plus de chiffre d'affaires. */
export function suggestPrimary(contacts: MergeContact[]): string {
  const score = (c: MergeContact) =>
    [...MERGE_CHOICE_FIELDS, ...MERGE_LIST_TEXT_FIELDS, MERGE_CONCAT_FIELD].filter(k => clean(c[k])).length;
  return [...contacts].sort((a, b) =>
    score(b) - score(a) || (Number(b.ca_amount) || 0) - (Number(a.ca_amount) || 0))[0].id;
}

export interface MergeFieldPlan {
  key: string;
  values: { id: string; value: string }[];
  /** Valeurs distinctes non vides (insensible à la casse et aux espaces autour). */
  distinct: string[];
  /** Au moins deux valeurs différentes : un choix est nécessaire. */
  conflict: boolean;
  /** Fiche dont la valeur est retenue par défaut ; null si le champ est vide partout. */
  pick: string | null;
}

/** Un plan par champ renseigné sur au moins une fiche. La fiche conservée passe en premier. */
export function buildMergePlan(contacts: MergeContact[], primaryId: string): MergeFieldPlan[] {
  const ordered = [...contacts].sort((a, b) => (a.id === primaryId ? -1 : b.id === primaryId ? 1 : 0));
  const plans: MergeFieldPlan[] = [];
  for (const key of MERGE_CHOICE_FIELDS) {
    const values = ordered.map(c => ({ id: c.id, value: clean(c[key]) }));
    if (!values.some(v => v.value)) continue;
    const distinct: string[] = [];
    for (const v of values) {
      if (v.value && !distinct.some(d => d.toLowerCase() === v.value.toLowerCase())) distinct.push(v.value);
    }
    plans.push({ key, values, distinct, conflict: distinct.length > 1, pick: values.find(v => v.value)?.id ?? null });
  }
  return plans;
}

/**
 * Valeurs à écrire sur la fiche conservée. `picks` : champ -> identifiant de la fiche
 * dont la valeur est retenue ; un choix absent ou invalide retombe sur le défaut du plan.
 * Seules les valeurs qui diffèrent de la fiche conservée sont rendues.
 */
export function resolveMergePatch(
  contacts: MergeContact[], primaryId: string, picks: Record<string, string> = {},
): Record<string, any> {
  const primary = contacts.find(c => c.id === primaryId);
  if (!primary) return {};
  const byId = new Map(contacts.map(c => [c.id, c]));
  const patch: Record<string, any> = {};

  for (const plan of buildMergePlan(contacts, primaryId)) {
    const chosen = picks[plan.key];
    const valid = chosen && byId.has(chosen) && clean(byId.get(chosen)![plan.key]);
    const sourceId = valid ? chosen : plan.pick;
    if (!sourceId) continue;
    const value = clean(byId.get(sourceId)![plan.key]);
    if (value !== clean(primary[plan.key])) patch[plan.key] = value;
  }

  const ordered = [primary, ...contacts.filter(c => c.id !== primaryId)];
  for (const key of MERGE_LIST_TEXT_FIELDS) {
    const value = unionText(ordered.map(c => c[key]));
    if (value !== clean(primary[key]) && value) patch[key] = value;
  }
  for (const key of MERGE_LIST_JSON_FIELDS) {
    const value = unionArrays(ordered.map(c => c[key]));
    const current = unionArrays([primary[key]]);
    if (value.length && JSON.stringify(value) !== JSON.stringify(current)) patch[key] = value;
  }
  const notes = concatNotes(ordered.map(c => c[MERGE_CONCAT_FIELD]));
  if (notes && notes !== clean(primary[MERGE_CONCAT_FIELD])) patch[MERGE_CONCAT_FIELD] = notes;
  return patch;
}

// ─── Détection de doublons ───────────────────────────────────────────────────

export type DuplicateReason = 'siret' | 'email' | 'name';
export interface DuplicateGroup { ids: string[]; reasons: DuplicateReason[] }

const LEGAL_TOKENS = new Set(['sarl', 'sas', 'sasu', 'eurl', 'sci', 'sa', 'scp', 'scm', 'ste', 'societe', 'association', 'assoc', 'et', 'and', 'co', 'cie']);

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function normalizeSiret(v: unknown): string {
  const digits = clean(v).replace(/\D/g, '');
  return digits.length === 14 ? digits : '';
}

export function contactEmails(c: Partial<MergeContact>): string[] {
  return [c.email, c.email_work, c.email_home].map(e => clean(e).toLowerCase()).filter(e => e.includes('@'));
}

/** Clé de nom : personne (prénom + nom, ordre indifférent) ou société sans formes juridiques. */
export function nameKey(c: Partial<MergeContact>): string {
  const person = [clean(c.first_name), clean(c.last_name)].filter(Boolean).join(' ');
  if (person) {
    const tokens = fold(person).split(/[^a-z0-9]+/).filter(Boolean).sort();
    return tokens.join('').length >= 3 ? `p:${tokens.join(' ')}` : '';
  }
  const tokens = fold(clean(c.company_name)).split(/[^a-z0-9]+/).filter(t => t && !LEGAL_TOKENS.has(t));
  return tokens.join('').length >= 3 ? `c:${tokens.join(' ')}` : '';
}

/**
 * Groupes de fiches qui semblent désigner la même personne ou société : même SIRET,
 * même adresse e-mail ou même nom. Des suggestions, jamais une fusion automatique.
 * Les contacts personnels sont ignorés (ils n'appartiennent qu'à leur créateur).
 */
export function findDuplicateGroups(contacts: MergeContact[]): DuplicateGroup[] {
  const list = contacts.filter(c => !c.is_personal);
  const parent = new Map<string, string>(list.map(c => [c.id, c.id]));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  const reasonsByPair: { a: string; b: string; reason: DuplicateReason }[] = [];
  const bucket = (reason: DuplicateReason, keysOf: (c: MergeContact) => string[]) => {
    const seen = new Map<string, string>();
    for (const c of list) {
      for (const key of new Set(keysOf(c))) {
        if (!key) continue;
        const other = seen.get(key);
        if (other && other !== c.id) {
          reasonsByPair.push({ a: other, b: c.id, reason });
          parent.set(find(c.id), find(other));
        } else if (!other) {
          seen.set(key, c.id);
        }
      }
    }
  };
  bucket('siret', c => [normalizeSiret(c.siret)]);
  bucket('email', contactEmails);
  bucket('name', c => [nameKey(c)]);

  const groups = new Map<string, { ids: string[]; reasons: Set<DuplicateReason> }>();
  for (const c of list) {
    const root = find(c.id);
    const g = groups.get(root) || { ids: [], reasons: new Set<DuplicateReason>() };
    g.ids.push(c.id);
    groups.set(root, g);
  }
  for (const pair of reasonsByPair) groups.get(find(pair.a))?.reasons.add(pair.reason);
  return [...groups.values()]
    .filter(g => g.ids.length > 1)
    .map(g => ({ ids: g.ids.slice(0, MERGE_MAX_CONTACTS), reasons: [...g.reasons] }));
}

// ─── Fusion automatique des doublons sûrs ────────────────────────────────────

export interface SafeMergeGroup {
  primaryId: string;
  duplicateIds: string[];
}

/**
 * Un groupe est « sûr » quand rien n'est à arbitrer : toutes les fiches portent la même clé
 * de nom ET aucune colonne à choix n'a deux valeurs différentes (hors casse et espaces).
 * Les valeurs vides se complètent, les listes se cumulent : la fusion ne perd donc rien.
 * Un groupe réuni par e-mail ou SIRET mais de noms différents n'est jamais sûr.
 */
export function isSafeDuplicateGroup(contacts: MergeContact[]): boolean {
  if (contacts.length < 2 || contacts.length > MERGE_MAX_CONTACTS) return false;
  if (contacts.some(c => c.is_personal)) return false;
  const keys = new Set(contacts.map(c => nameKey(c)));
  if (keys.size !== 1 || keys.has('')) return false;
  return !buildMergePlan(contacts, contacts[0].id).some(p => p.conflict);
}

/** Groupes sûrs à fusionner, la fiche conservée étant celle de `suggestPrimary`. */
export function planSafeMerges(contacts: MergeContact[]): { safe: SafeMergeGroup[]; skipped: number } {
  const byId = new Map(contacts.map(c => [c.id, c]));
  const safe: SafeMergeGroup[] = [];
  let skipped = 0;
  for (const group of findDuplicateGroups(contacts)) {
    const members = group.ids.map(id => byId.get(id)).filter((c): c is MergeContact => !!c);
    if (!isSafeDuplicateGroup(members)) { skipped += 1; continue; }
    const primaryId = suggestPrimary(members);
    safe.push({ primaryId, duplicateIds: members.map(c => c.id).filter(id => id !== primaryId) });
  }
  return { safe, skipped };
}
