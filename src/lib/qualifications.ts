// ── Qualifications et certifications des entreprises ────────────────────────
// Logique pure, partagée par le serveur (validation des écritures, alertes) et
// l'écran (pastilles, fiche contact). Une qualification n'est jamais un
// verdict : elle dit ce qu'une entreprise déclare ou a fait enregistrer, et
// jusqu'à quand. La contrôler reste un geste de l'architecte (`verified_at`).
import { todayIso } from './actEntreprises';

export type OrganismeQualification =
  | 'qualibat' | 'qualifelec' | 'qualit_enr' | 'certibat' | 'rge' | 'autre';

export const ORGANISMES: { value: OrganismeQualification; label: string }[] = [
  { value: 'qualibat', label: 'Qualibat' },
  { value: 'qualifelec', label: 'Qualifelec' },
  { value: 'qualit_enr', label: "Qualit'EnR" },
  { value: 'certibat', label: 'Certibat' },
  { value: 'rge', label: 'RGE (autre organisme)' },
  { value: 'autre', label: 'Autre' },
];

export const ORGANISME_LABELS: Record<OrganismeQualification, string> =
  Object.fromEntries(ORGANISMES.map(o => [o.value, o.label])) as Record<OrganismeQualification, string>;

export type SourceQualification = 'saisie' | 'ademe' | 'api_entreprise';

export const SOURCE_LABELS: Record<SourceQualification, string> = {
  saisie: 'Saisie manuelle',
  ademe: 'Base RGE (ADEME)',
  api_entreprise: 'API Entreprise',
};

export interface Qualification {
  id: string;
  contact_id: string;
  organisme: OrganismeQualification;
  reference: string;
  libelle?: string | null;
  domaines?: string | null;
  date_debut?: string | null;
  date_fin?: string | null;
  source: SourceQualification;
  verified_at?: string | null;
  verified_by?: string | null;
  notes?: string | null;
}

/** Qualification telle qu'une source externe la fournit, avant rattachement à une fiche. */
export interface QualificationImportee {
  organisme: OrganismeQualification;
  reference: string;
  libelle: string | null;
  domaines: string | null;
  date_debut: string | null;
  date_fin: string | null;
}

export type StatutQualification = 'valide' | 'bientot' | 'expiree' | 'sans_date';

/** En deçà, le certificat arrive à échéance : le temps de demander son renouvellement. */
export const SEUIL_EXPIRATION_JOURS = 60;

export const STATUT_QUALIFICATION_LABELS: Record<StatutQualification, string> = {
  valide: 'Valide',
  bientot: 'Expire bientôt',
  expiree: 'Expirée',
  sans_date: "Sans date d'échéance",
};

/**
 * Page d'accueil de Qualibat, faute d'un lien direct vers son annuaire que je
 * n'ai pas pu confirmer. Le bouton « Vérifier sur Qualibat » copie le SIRET et
 * ouvre cette adresse : à remplacer par l'annuaire une fois l'adresse exacte
 * confirmée (voir ROADMAP.md).
 */
export const QUALIBAT_ANNUAIRE_URL = 'https://www.qualibat.com/';

const DAY_MS = 86_400_000;

/** AAAA-MM-JJ -> JJ/MM/AAAA, sans passer par `Date` (pas de décalage de fuseau). */
export function formaterDate(iso: string | null | undefined): string {
  const d = parseDateIso(iso ?? '');
  return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
}

/** Accepte AAAA-MM-JJ, un horodatage ISO ou JJ/MM/AAAA ; rend AAAA-MM-JJ ou null. */
export function parseDateIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : fr ? [fr[3], fr[2], fr[1]] : [];
  if (!y) return null;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  const valid = date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d);
  return valid ? `${y}-${m}-${d}` : null;
}

/** Jours entiers entre deux dates AAAA-MM-JJ (négatif si `date` est passée). */
export function joursAvant(date: string, today: string = todayIso()): number {
  const a = Date.parse(`${date}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Math.round((a - b) / DAY_MS);
}

export function statutQualification(
  q: Pick<Qualification, 'date_fin'>,
  today: string = todayIso(),
): StatutQualification {
  const fin = parseDateIso(q.date_fin);
  if (!fin) return 'sans_date';
  const reste = joursAvant(fin, today);
  if (reste < 0) return 'expiree';
  return reste <= SEUIL_EXPIRATION_JOURS ? 'bientot' : 'valide';
}

const RANG: Record<StatutQualification, number> = { valide: 3, bientot: 2, sans_date: 1, expiree: 0 };

export interface ResumeQualifications {
  /** `aucune` quand l'entreprise n'a rien d'enregistré. */
  statut: StatutQualification | 'aucune';
  /** La qualification qui porte le statut affiché (la meilleure). */
  principale?: Qualification;
  total: number;
  /** Au moins une des qualifications a été contrôlée par un humain. */
  verifiee: boolean;
}

/**
 * Résume les qualifications d'une entreprise en un seul statut, celui de la
 * meilleure : pour attribuer un lot, il suffit d'une qualification en cours de
 * validité, pas de toutes. À statut égal, Qualibat passe avant les autres puis
 * l'échéance la plus lointaine.
 */
export function resumeQualifications(
  liste: Qualification[],
  today: string = todayIso(),
): ResumeQualifications {
  if (liste.length === 0) return { statut: 'aucune', total: 0, verifiee: false };
  const classees = liste
    .map(q => ({ q, statut: statutQualification(q, today) }))
    .sort((a, b) =>
      RANG[b.statut] - RANG[a.statut]
      || Number(b.q.organisme === 'qualibat') - Number(a.q.organisme === 'qualibat')
      || String(b.q.date_fin || '').localeCompare(String(a.q.date_fin || '')));
  return {
    statut: classees[0].statut,
    principale: classees[0].q,
    total: liste.length,
    verifiee: liste.some(q => !!q.verified_at),
  };
}

/** Regroupe une liste plate par contact. */
export function parContact(liste: Qualification[]): Record<string, Qualification[]> {
  const out: Record<string, Qualification[]> = {};
  for (const q of liste) (out[q.contact_id] ||= []).push(q);
  return out;
}

// ── SIRET ────────────────────────────────────────────────────────────────────

export function normaliserSiret(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Clé de Luhn d'un SIRET (14 chiffres). La Poste (SIREN 356 000 000) déroge :
 * la somme des chiffres doit y être un multiple de 5.
 */
export function siretValide(value: unknown): boolean {
  const siret = normaliserSiret(value);
  if (siret.length !== 14) return false;
  if (siret.startsWith('356000000')) {
    return [...siret].reduce((s, c) => s + Number(c), 0) % 5 === 0;
  }
  let somme = 0;
  for (let i = 0; i < 14; i++) {
    let n = Number(siret[siret.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    somme += n;
  }
  return somme % 10 === 0;
}

// ── Validation d'une écriture ────────────────────────────────────────────────

export interface QualificationInput {
  organisme: OrganismeQualification;
  reference: string;
  libelle: string | null;
  domaines: string | null;
  date_debut: string | null;
  date_fin: string | null;
  notes: string | null;
}

const MAX_TEXTE = 500;

const texteOuNull = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, MAX_TEXTE) : null;
};

/**
 * Valide le corps d'une création ou d'une modification. `partiel` laisse
 * absents les champs non envoyés (modification) au lieu de les remettre à vide.
 */
export function validerQualification(
  body: any,
  { partiel = false }: { partiel?: boolean } = {},
): { ok: true; value: Partial<QualificationInput> } | { ok: false; error: string } {
  const value: Partial<QualificationInput> = {};
  const a = (k: string) => body && Object.prototype.hasOwnProperty.call(body, k);

  if (a('organisme') || !partiel) {
    if (!ORGANISMES.some(o => o.value === body?.organisme)) return { ok: false, error: 'Organisme de certification invalide.' };
    value.organisme = body.organisme;
  }
  if (a('reference') || !partiel) value.reference = (texteOuNull(body?.reference) ?? '').slice(0, 100);
  if (a('libelle') || !partiel) value.libelle = texteOuNull(body?.libelle);
  if (a('domaines') || !partiel) value.domaines = texteOuNull(body?.domaines);
  if (a('notes') || !partiel) value.notes = texteOuNull(body?.notes);
  for (const champ of ['date_debut', 'date_fin'] as const) {
    if (!a(champ) && partiel) continue;
    const brut = body?.[champ];
    if (brut === undefined || brut === null || brut === '') { value[champ] = null; continue; }
    const iso = parseDateIso(brut);
    if (!iso) return { ok: false, error: `Date invalide pour « ${champ} ».` };
    value[champ] = iso;
  }
  const debut = value.date_debut, fin = value.date_fin;
  if (debut && fin && fin < debut) return { ok: false, error: "La date de fin précède la date de début." };
  return { ok: true, value };
}
