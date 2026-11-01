// ── Marqueur de rédaction : incomplet / en cours d'édition ────────────────────
// Posé sur un lot, un chapitre ou un article du CCTP (jsonb du DPGF, sans
// migration). Il sert à deux lecteurs : l'équipe (pastille dans l'arbre, compteur
// « à finir ») et les agents (`read_cctp` le rapporte, `manage_dpgf` refuse de
// toucher une ligne « en cours d'édition » par quelqu'un d'autre). Le marqueur
// n'est jamais déduit du texte : une personne ou un agent le pose et le lève.
import type { Lot, MarqueurRedaction, StatutRedaction } from '../types/dpgf';

export const STATUTS_REDACTION: readonly StatutRedaction[] = ['incomplet', 'en_cours'];
/** Nom sous lequel un agent signe ses marqueurs. */
export const PAR_AGENT = 'Agent IA';
const MAX_PAR = 80;
const MAX_NOTE = 300;

/** Un marqueur est « de l'agent » quand son auteur commence par « Agent ». */
export const estParAgent = (par: string | undefined | null): boolean => /^agent\b/i.test((par ?? '').trim());

/** Lecture sûre d'un marqueur venu d'un JSON : statut valide, textes bornés, date ISO ou rien. */
export function normaliserMarqueur(v: unknown): MarqueurRedaction | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const m = v as Record<string, unknown>;
  if (!STATUTS_REDACTION.includes(m.statut as StatutRedaction)) return undefined;
  const texte = (x: unknown, max: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined);
  const le = typeof m.le === 'string' && !Number.isNaN(Date.parse(m.le)) ? m.le : undefined;
  const out: MarqueurRedaction = { statut: m.statut as StatutRedaction };
  const par = texte(m.par, MAX_PAR);
  const note = texte(m.note, MAX_NOTE);
  if (par) out.par = par;
  if (le) out.le = le;
  if (note) out.note = note;
  return out;
}

export function creerMarqueur(statut: StatutRedaction, par: string, note?: string, maintenant: Date = new Date()): MarqueurRedaction {
  return normaliserMarqueur({ statut, par, le: maintenant.toISOString(), note }) as MarqueurRedaction;
}

/** Même état et même précision : la personne qui l'a posé et la date ne comptent pas. */
export function memeMarqueur(a: MarqueurRedaction | undefined, b: MarqueurRedaction | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.statut === b.statut && (a.note ?? '') === (b.note ?? '');
}

export interface NoeudMarque {
  /** Clé de sélection positionnelle (`lot-0`, `chap-0-1`, `ligne-0-1-2`). */
  cle: string;
  id: string;
  kind: 'lot' | 'chapitre' | 'article';
  numero: string;
  titre: string;
  marqueur: MarqueurRedaction;
}

/** Tous les éléments marqués, dans l'ordre du document, sous-articles compris. */
export function noeudsMarques(lots: Lot[]): NoeudMarque[] {
  const out: NoeudMarque[] = [];
  lots.forEach((lot, li) => {
    const ml = normaliserMarqueur(lot.marqueur);
    if (ml) out.push({ cle: `lot-${li}`, id: lot.id, kind: 'lot', numero: lot.numero, titre: lot.titre, marqueur: ml });
    lot.chapitres.forEach((chap, ci) => {
      const mc = normaliserMarqueur(chap.marqueur);
      if (mc) out.push({ cle: `chap-${li}-${ci}`, id: chap.id, kind: 'chapitre', numero: chap.numero, titre: chap.titre, marqueur: mc });
      const lignes = (liste: Lot['chapitres'][number]['lignes'], chemin: number[]) => liste.forEach((l, i) => {
        const p = [...chemin, i];
        const m = normaliserMarqueur(l.marqueur);
        if (m) out.push({ cle: `ligne-${li}-${ci}-${p.join('-')}`, id: l.id, kind: 'article', numero: l.numero, titre: l.designation, marqueur: m });
        if (l.children?.length) lignes(l.children, p);
      });
      lignes(chap.lignes, []);
    });
  });
  return out;
}

export function compterMarqueurs(lots: Lot[]): { incomplet: number; en_cours: number; total: number } {
  const n = noeudsMarques(lots);
  const incomplet = n.filter(x => x.marqueur.statut === 'incomplet').length;
  return { incomplet, en_cours: n.length - incomplet, total: n.length };
}

/** Un « en cours d'édition » vieux de plus de `heures` heures est probablement oublié. */
export function ancienMarqueur(m: MarqueurRedaction | undefined, maintenant: Date = new Date(), heures = 24): boolean {
  if (!m || m.statut !== 'en_cours' || !m.le) return false;
  const t = Date.parse(m.le);
  return !Number.isNaN(t) && maintenant.getTime() - t > heures * 3_600_000;
}

/**
 * Vrai quand l'élément est « en cours d'édition » par quelqu'un d'autre que
 * `moi` : un agent n'y touche pas (sauf demande explicite), et la personne qui
 * l'a posé garde la main. `moi` est le nom de l'appelant ou, pour un agent,
 * `PAR_AGENT` : tous les marqueurs d'agent sont alors les siens.
 */
export function enCoursParAutre(m: MarqueurRedaction | undefined, moi: string): boolean {
  if (!m || m.statut !== 'en_cours') return false;
  if (estParAgent(moi)) return !estParAgent(m.par);
  return (m.par ?? '').trim().toLowerCase() !== moi.trim().toLowerCase();
}

/** Phrase pour l'écran et pour les agents : « en cours d'édition par Sophie depuis le 01/11/2026 ». */
export function libelleMarqueur(m: MarqueurRedaction): string {
  const etat = m.statut === 'en_cours' ? "en cours d'édition" : 'incomplet';
  const qui = m.par ? ` par ${m.par}` : '';
  const date = m.le && !Number.isNaN(Date.parse(m.le)) ? ` depuis le ${new Date(m.le).toLocaleDateString('fr-FR')}` : '';
  const note = m.note ? ` : ${m.note}` : '';
  return `${etat}${qui}${date}${note}`;
}
