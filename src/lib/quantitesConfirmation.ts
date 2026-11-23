// ── Quantités à confirmer : la réponse de l'entreprise ───────────────────────
// Quand l'architecte demande à une entreprise de confirmer ses quantités (message « quantités à confirmer »),
// elle répond poste par poste depuis sa page de dépôt : elle reprend la quantité du dossier, maintient la sienne,
// ou en propose une autre. La réponse est ENREGISTRÉE à part (consultation_quantites_reponses) : elle ne change
// jamais l'offre d'elle-même. L'architecte l'applique explicitement (`quantitesApresReponses`).
import { quantitesDifferent } from './quantitesOffre';

export type ChoixQuantite = 'moe' | 'maintenue' | 'autre';

export const LIBELLE_CHOIX: Record<ChoixQuantite, string> = {
  moe: 'Reprend la quantité du dossier',
  maintenue: 'Maintient sa quantité',
  autre: 'Propose une autre quantité',
};

export interface ReponseQuantite { ligneId: string; choix: ChoixQuantite; quantite?: number }

export const MAX_REPONSES_QUANTITES = 300;
const MAX_QUANTITE = 1e9;

export type ControleReponses = { ok: true; reponses: ReponseQuantite[] } | { ok: false; raison: string };

/**
 * Contrôle le corps d'une réponse : des postes que l'entreprise a bien à confirmer (aucun autre), un choix
 * connu, une quantité positive ou nulle pour « autre », jamais deux fois le même poste.
 */
export function validerReponsesQuantites(corps: unknown, ligneIdsAutorises: ReadonlySet<string>): ControleReponses {
  const liste = (corps && typeof corps === 'object' ? (corps as Record<string, unknown>).reponses : undefined);
  if (!Array.isArray(liste) || liste.length === 0) return { ok: false, raison: 'Indiquez votre réponse pour au moins un poste.' };
  if (liste.length > MAX_REPONSES_QUANTITES) return { ok: false, raison: `${MAX_REPONSES_QUANTITES} postes au plus par réponse.` };
  const vus = new Set<string>();
  const reponses: ReponseQuantite[] = [];
  for (const r of liste) {
    const brut = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const ligneId = typeof brut.ligne_id === 'string' ? brut.ligne_id : '';
    if (!ligneIdsAutorises.has(ligneId)) return { ok: false, raison: 'Un poste ne fait pas partie des quantités à confirmer.' };
    if (vus.has(ligneId)) return { ok: false, raison: 'Un poste est indiqué deux fois.' };
    vus.add(ligneId);
    const choix = brut.choix;
    if (choix !== 'moe' && choix !== 'maintenue' && choix !== 'autre') return { ok: false, raison: 'Choisissez, pour chaque poste, la quantité retenue.' };
    if (choix !== 'autre') { reponses.push({ ligneId, choix }); continue; }
    const texte = typeof brut.quantite === 'string' ? brut.quantite.trim().replace(',', '.') : '';
    const q = typeof brut.quantite === 'number' ? brut.quantite : texte === '' ? NaN : Number(texte);
    if (!Number.isFinite(q) || q < 0 || q > MAX_QUANTITE) return { ok: false, raison: 'La quantité proposée doit être un nombre positif ou nul.' };
    reponses.push({ ligneId, choix, quantite: q });
  }
  return { ok: true, reponses };
}

/**
 * Les quantités de l'entreprise une fois ses réponses appliquées (article -> quantité ; undefined : elle reprend
 * celle du dossier, donc rien n'est gardé). « Maintient » ne change rien, « autre » pose la quantité proposée
 * (ou rien si elle est celle du dossier).
 */
export function quantitesApresReponses(
  actuelles: Record<string, number>, reponses: ReponseQuantite[], quantiteDossier: ReadonlyMap<string, number>,
): Record<string, number | undefined> {
  const suite: Record<string, number | undefined> = { ...actuelles };
  for (const r of reponses) {
    const dossier = quantiteDossier.get(r.ligneId);
    if (dossier == null) continue;
    if (r.choix === 'moe') suite[r.ligneId] = undefined;
    else if (r.choix === 'autre' && typeof r.quantite === 'number') suite[r.ligneId] = quantitesDifferent(r.quantite, dossier) ? r.quantite : undefined;
  }
  return suite;
}

/** Une réponse a-t-elle déjà été appliquée à l'offre ? (la quantité actuelle est celle qu'elle décrit) */
export function reponseAppliquee(r: ReponseQuantite, quantiteActuelle: number | undefined, quantiteDossier: number): boolean {
  if (r.choix === 'maintenue') return true; // rien à appliquer : l'offre garde sa quantité
  if (r.choix === 'moe') return quantiteActuelle === undefined || !quantitesDifferent(quantiteActuelle, quantiteDossier);
  if (typeof r.quantite !== 'number') return false;
  return quantiteActuelle !== undefined ? !quantitesDifferent(quantiteActuelle, r.quantite) : !quantitesDifferent(r.quantite, quantiteDossier);
}

/** Un poste dont la quantité est à confirmer, tel que le message et la page le disent. */
export interface LigneQuantiteAConfirmer {
  ligneId: string;
  code: string;
  titre: string;
  unite: string;
  quantiteDossier: number;
  quantiteEntreprise: number;
}

export interface LotQuantitesAConfirmer { lot: string; lignes: LigneQuantiteAConfirmer[] }

const nombreFr = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 6 });

/** Le bloc « quantités à confirmer » d'un message, groupé par lot. */
export function blocQuantitesAConfirmer(lots: LotQuantitesAConfirmer[]): string {
  const utiles = lots.filter(l => l.lignes.length > 0);
  if (utiles.length === 0) return '';
  return ['Quantités à confirmer :', ...utiles.flatMap(l => [
    '', l.lot,
    ...l.lignes.map(x => `- ${x.code ? `${x.code} ` : ''}${x.titre} : ${nombreFr(x.quantiteEntreprise)} ${x.unite} dans votre offre, ${nombreFr(x.quantiteDossier)} ${x.unite} au dossier`),
  ])].join('\n');
}
