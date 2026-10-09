// ── Espace public de dépôt des offres : règles partagées écran / serveur ─────
// Fonctions pures. Le portail (src/pages/DepotOffres.tsx), le panneau du
// cabinet (src/components/act/) et les routes (server/routes/consultationDepot*.ts)
// lisent les mêmes formats, plafonds et règles de date : une seule source.
//
// Principe directeur : un dépôt n'écrase jamais l'offre. Il arrive dans une zone
// d'attente et l'architecte l'intègre explicitement (voir consultationDepotApply.ts).

export type DepotKind = 'fichier' | 'bordereau' | 'acte' | 'saisie';
export type DepotStatut = 'recu' | 'integre' | 'rejete' | 'retire';

export const DEPOT_KINDS_FICHIER: DepotKind[] = ['fichier', 'bordereau', 'acte'];

export const DEPOT_KIND_LABELS: Record<DepotKind, string> = {
  fichier: 'Pièce jointe',
  bordereau: 'Bordereau chiffré',
  acte: "Acte d'engagement",
  saisie: 'Saisie en ligne',
};

export const DEPOT_STATUT_LABELS: Record<DepotStatut, string> = {
  recu: 'Reçu',
  integre: 'Intégré',
  rejete: 'Rejeté',
  retire: 'Retiré',
};

// ── Formats acceptés ─────────────────────────────────────────────────────────
// PDF, Word, Excel, ODS et ODT. Les plans (DWG, DXF) sont volontairement
// refusés, comme les formats à macros (docm, xlsm) et les anciens binaires
// (doc, xls) : seuls des formats dont on peut vérifier le contenu sont admis.

export const DEPOT_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'ods', 'odt'] as const;
export type DepotExtension = (typeof DEPOT_EXTENSIONS)[number];

export const DEPOT_FORMAT_LABELS: Record<DepotExtension, string> = {
  pdf: 'PDF',
  docx: 'Word (.docx)',
  xlsx: 'Excel (.xlsx)',
  ods: 'LibreOffice Calc (.ods)',
  odt: 'LibreOffice Writer (.odt)',
};

/** Valeur de l'attribut `accept` d'un champ de fichier. */
export const DEPOT_ACCEPT = DEPOT_EXTENSIONS.map(e => `.${e}`).join(',');

/** Tableur lisible par le rapprochement du bordereau (SheetJS lit les deux). */
export const DEPOT_TABLEURS: DepotExtension[] = ['xlsx', 'ods'];

const MIO = 1024 * 1024;
export const MAX_FICHIER_OCTETS = 25 * MIO;
export const MAX_DEPOT_OCTETS = 100 * MIO;
export const MAX_FICHIERS_PAR_DEPOT = 10;

/** Marge laissée au lien après la date limite : un dépôt tardif est signalé, pas refusé. */
export const DEPOT_MARGE_JOURS = 14;
/** Durée de vie d'un lien quand aucune date limite n'est fixée. */
export const DEPOT_LIEN_SANS_ECHEANCE_JOURS = 90;

export function extensionDe(nom: string): string {
  const point = nom.lastIndexOf('.');
  return point < 0 ? '' : nom.slice(point + 1).trim().toLowerCase();
}

export function formatAutorise(nom: string): boolean {
  return (DEPOT_EXTENSIONS as readonly string[]).includes(extensionDe(nom));
}

export function formatOctets(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < MIO) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / MIO).toFixed(1).replace('.', ',')} Mo`;
}

export type ControleFichier = { ok: true } | { ok: false; raison: string };

/** Contrôle sur ce que le navigateur sait avant l'envoi (nom et taille). Le serveur refait tout, octets compris. */
export function controlerFichierMeta(nom: string, taille: number): ControleFichier {
  if (!formatAutorise(nom)) {
    return { ok: false, raison: `« ${nom} » : format non accepté. Formats admis : PDF, Word, Excel, ODS, ODT.` };
  }
  if (taille <= 0) return { ok: false, raison: `« ${nom} » est vide.` };
  if (taille > MAX_FICHIER_OCTETS) {
    return { ok: false, raison: `« ${nom} » dépasse ${formatOctets(MAX_FICHIER_OCTETS)} (${formatOctets(taille)}).` };
  }
  return { ok: true };
}

export function controlerLot(fichiers: Array<{ name: string; size: number }>): ControleFichier {
  if (fichiers.length === 0) return { ok: false, raison: 'Aucun fichier sélectionné.' };
  if (fichiers.length > MAX_FICHIERS_PAR_DEPOT) {
    return { ok: false, raison: `${MAX_FICHIERS_PAR_DEPOT} fichiers au plus par dépôt.` };
  }
  for (const f of fichiers) {
    const c = controlerFichierMeta(f.name, f.size);
    if (!c.ok) return c;
  }
  const total = fichiers.reduce((s, f) => s + f.size, 0);
  if (total > MAX_DEPOT_OCTETS) {
    return { ok: false, raison: `Ce dépôt dépasse ${formatOctets(MAX_DEPOT_OCTETS)} au total (${formatOctets(total)}).` };
  }
  return { ok: true };
}

// ── Dates : délai, scellement, validité du lien ──────────────────────────────

export interface ReglagesDepot {
  deadline_at?: string | null;
  sealed?: boolean;
  instructions?: string | null;
  published_document_ids?: string[];
}

function dateValide(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Vrai si la remise est faite après la date limite. Sans date limite, jamais hors délai. */
export function estHorsDelai(recuLe: string | Date, deadlineAt?: string | null): boolean {
  const limite = dateValide(deadlineAt);
  if (!limite) return false;
  const recu = recuLe instanceof Date ? recuLe : new Date(recuLe);
  return recu.getTime() > limite.getTime();
}

/**
 * Plis scellés actifs : l'option est cochée ET la date limite est dans le futur.
 * Un scellement sans date limite ne scelle rien (il ne pourrait jamais s'ouvrir) :
 * la route d'enregistrement le refuse, et cette garde le rend inoffensif si une
 * ligne l'a quand même.
 */
export function plisScelles(reglages: ReglagesDepot | null | undefined, now: Date = new Date()): boolean {
  if (!reglages?.sealed) return false;
  const limite = dateValide(reglages.deadline_at);
  return !!limite && now.getTime() < limite.getTime();
}

/** Échéance d'un lien : date limite + marge, ou 90 jours sans date limite. */
export function expirationLien(deadlineAt: string | null | undefined, now: Date = new Date()): Date {
  const limite = dateValide(deadlineAt);
  const jour = 24 * 3600 * 1000;
  if (!limite) return new Date(now.getTime() + DEPOT_LIEN_SANS_ECHEANCE_JOURS * jour);
  // Une date limite déjà dépassée ne raccourcit pas un lien qu'on vient d'émettre :
  // l'entreprise doit encore pouvoir remettre (en retard, signalé).
  const base = Math.max(limite.getTime(), now.getTime());
  return new Date(base + DEPOT_MARGE_JOURS * jour);
}

// ── Saisie en ligne ──────────────────────────────────────────────────────────

export interface LigneSaisie {
  kind: 'option' | 'variante';
  libelle: string;
  montant: number;
}

export interface SaisieOffre {
  montant_base: number;
  lignes: LigneSaisie[];
  delai_semaines?: number;
  observations?: string;
}

const MONTANT_MAX = 1_000_000_000;
export const MAX_LIGNES_SAISIE = 30;

function montantValide(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/\s/g, '').replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MONTANT_MAX) return null;
  return Math.round(n * 100) / 100;
}

export type ControleSaisie = { ok: true; saisie: SaisieOffre } | { ok: false; raison: string };

/** Valide et normalise une saisie en ligne. Jamais de confiance dans le corps reçu. */
export function validerSaisie(brut: unknown): ControleSaisie {
  if (!brut || typeof brut !== 'object') return { ok: false, raison: 'Saisie vide.' };
  const b = brut as Record<string, unknown>;

  const base = montantValide(b.montant_base);
  if (base === null || base <= 0) return { ok: false, raison: 'Indiquez le montant de base HT de votre offre.' };

  const lignesBrutes = Array.isArray(b.lignes) ? b.lignes : [];
  if (lignesBrutes.length > MAX_LIGNES_SAISIE) {
    return { ok: false, raison: `${MAX_LIGNES_SAISIE} options ou variantes au plus.` };
  }
  const lignes: LigneSaisie[] = [];
  for (const l of lignesBrutes) {
    if (!l || typeof l !== 'object') return { ok: false, raison: 'Option ou variante illisible.' };
    const r = l as Record<string, unknown>;
    const kind = r.kind === 'variante' ? 'variante' : r.kind === 'option' ? 'option' : null;
    const libelle = typeof r.libelle === 'string' ? r.libelle.trim().slice(0, 200) : '';
    const montant = montantValide(r.montant);
    if (!kind || !libelle || montant === null) {
      return { ok: false, raison: 'Chaque option ou variante demande un intitulé et un montant HT.' };
    }
    lignes.push({ kind, libelle, montant });
  }

  const saisie: SaisieOffre = { montant_base: base, lignes };
  if (b.delai_semaines !== undefined && b.delai_semaines !== null && b.delai_semaines !== '') {
    const d = Number(b.delai_semaines);
    if (!Number.isFinite(d) || d < 0 || d > 520) return { ok: false, raison: "Délai d'exécution invalide." };
    saisie.delai_semaines = Math.round(d);
  }
  if (typeof b.observations === 'string' && b.observations.trim()) {
    saisie.observations = b.observations.trim().slice(0, 2000);
  }
  return { ok: true, saisie };
}

// ── Accusé de réception ──────────────────────────────────────────────────────

export interface ElementAccuse {
  nom: string;
  kind: DepotKind;
  tailleOctets?: number;
  sha256?: string;
  lotLibelle?: string;
}

export interface ParametresAccuse {
  cabinet: string;
  operation: string;
  entreprise: string;
  recuLe: Date;
  horsDelai: boolean;
  deadlineAt?: string | null;
  elements: ElementAccuse[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dateFr = (d: Date) =>
  d.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' });

/** Objet et corps HTML de l'accusé de réception, qui vaut preuve de la remise. */
export function construireAccuse(p: ParametresAccuse): { subject: string; html: string } {
  const lignes = p.elements.map(e => {
    const detail = [
      DEPOT_KIND_LABELS[e.kind],
      e.lotLibelle,
      e.tailleOctets ? formatOctets(e.tailleOctets) : '',
    ].filter(Boolean).join(' · ');
    const empreinte = e.sha256 ? `<br><span style="color:#666;font-size:12px">Empreinte SHA-256 : ${esc(e.sha256)}</span>` : '';
    return `<li><strong>${esc(e.nom)}</strong> <span style="color:#444">(${esc(detail)})</span>${empreinte}</li>`;
  }).join('');

  const retard = p.horsDelai
    ? `<p style="color:#8a1c1c"><strong>Cette remise est parvenue après la date limite${
        p.deadlineAt ? ` (${esc(dateFr(new Date(p.deadlineAt)))})` : ''
      }.</strong> Elle est enregistrée et signalée « hors délai » au maître d'œuvre, qui décidera de la suite à lui donner.</p>`
    : '';

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<p>Bonjour,</p>
<p>${esc(p.cabinet)} accuse réception de la remise de <strong>${esc(p.entreprise)}</strong> pour l'opération <strong>${esc(p.operation)}</strong>, enregistrée le ${esc(dateFr(p.recuLe))}.</p>
<ul>${lignes}</ul>
${retard}
<p style="color:#555;font-size:12px">Conservez ce message : il atteste de la date, de l'heure et du contenu de votre remise. Vous pouvez remplacer un dépôt par un nouveau tant que le lien reste actif.</p>
</div>`;

  return { subject: `Accusé de réception : ${p.operation}`, html };
}
