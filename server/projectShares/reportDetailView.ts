// Détail d'un compte rendu de chantier pour un confrère à qui le cabinet a coché le détail de l'atelier `reports`
// (issue #688) : présences, suivi par lot (retards, intempéries, pénalités). Même principe que actView.ts et
// documentView.ts : la vue est construite CHAMP PAR CHAMP à partir de listes blanches, jamais en copiant la colonne
// ni en retirant des champs d'une copie. Un champ ajouté demain au JSON n'apparaît que s'il est ajouté ici.
//
// Jamais : `contact_id` d'un intervenant (la fiche reste au cabinet), la liste de diffusion (`diffusion`), les
// bâtiments concernés, ni aucune coordonnée.

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Une colonne jsonb arrive en liste, ou parfois en chaîne JSON : on la lit sans jamais lever. */
function readList(raw: unknown): Rec[] {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? value.filter(isRec) : [];
}

const PRESENCE_STATUSES = ['P', 'R', 'AE', 'ANE', 'NC'] as const;
const PENALTY_TYPES = ['retard_execution', 'absence_reunion', 'retard_documents', 'retard_reserves', 'proprete_securite', 'autre'] as const;
const WEATHER_TYPES = ['pluie', 'gel', 'neige', 'vent', 'canicule', 'autre'] as const;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (allowed.includes(v as T) ? (v as T) : null);

export interface GuestAttendee { name: string | null; role: string | null; status: string | null; present: boolean; excused: boolean }

/** Présences : nom, fonction et statut P/R/AE/ANE/NC. Une ligne ancienne sans statut se déduit de present/excused. */
export function guestAttendance(raw: unknown): GuestAttendee[] {
  return readList(raw).slice(0, 200).map(a => {
    const present = a.present === true;
    const excused = a.excused === true;
    return {
      name: text(a.name, 200), role: text(a.role, 200),
      status: oneOf(a.status, PRESENCE_STATUSES) ?? (present ? 'P' : excused ? 'AE' : 'ANE'),
      present, excused,
    };
  });
}

export interface GuestPenalty { id: string; type: string; motif: string | null; jours: number; montant_jour: number; montant: number }
export interface GuestLotTracking {
  lot_id: string; lot_label: string | null; status: string | null; effectif: number | null;
  retard_semaine: number | null; retard_cumule: number | null; retard_docs_jours: number | null; intemperies_jours: number | null;
  intemperies: Array<{ type: string; date: string | null; jours: number }>;
  penalites: GuestPenalty[]; convoque_reunion_suivante: boolean; lieu: string | null; heure: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Suivi par lot d'un compte rendu, pénalités comprises (le cabinet l'a décidé en cochant le détail). Le montant d'une
 * pénalité est recalculé (jours x montant par jour) plutôt que lu : l'écran ne contredit jamais ses propres lignes.
 * `labels` donne « 01 Gros œuvre » par identifiant de lot du projet (numéro et intitulé seulement, jamais l'entreprise).
 */
export function guestLotTracking(raw: unknown, labels: ReadonlyMap<string, string>): GuestLotTracking[] {
  return readList(raw).slice(0, 200).map(l => {
    const lotId = String(l.lot_id ?? '');
    return {
      lot_id: lotId,
      lot_label: labels.get(lotId) ?? null,
      status: oneOf(l.status, PRESENCE_STATUSES),
      effectif: num(l.effectif),
      retard_semaine: num(l.retard_semaine),
      retard_cumule: num(l.retard_cumule),
      retard_docs_jours: num(l.retard_docs_jours),
      intemperies_jours: num(l.intemperies_jours),
      intemperies: readList(l.intemperies_list).slice(0, 100).flatMap(i => {
        const jours = num(i.jours);
        return jours === null ? [] : [{ type: oneOf(i.type, WEATHER_TYPES) ?? 'autre', date: text(i.date, 30), jours }];
      }),
      penalites: readList(l.penalites).slice(0, 100).flatMap(p => {
        const jours = num(p.jours);
        const montantJour = num(p.montant_jour);
        if (jours === null || montantJour === null) return [];
        return [{
          id: String(p.id ?? ''), type: oneOf(p.type, PENALTY_TYPES) ?? 'autre', motif: text(p.motif, 300),
          jours, montant_jour: montantJour, montant: round2(jours * montantJour),
        }];
      }),
      convoque_reunion_suivante: l.convoque_reunion_suivante === true,
      lieu: text(l.lieu, 200), heure: text(l.heure, 10),
    };
  }).filter(l => l.lot_id);
}
