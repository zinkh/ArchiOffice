// ── Questions posées par les entreprises depuis la page de dépôt ─────────────
// Règles partagées par la page (aperçu des limites) et le serveur (contrôle réel). Une question
// arrive dans consultation_depot_questions (boîte de réception) ; le cabinet la reprend dans
// consultation.questions, où la réponse est saisie et où elle fait foi.

export const MAX_QUESTION_CARACTERES = 2000;
export const MIN_QUESTION_CARACTERES = 5;
export const MAX_OBJET_CARACTERES = 200;
/** Plafond par entreprise : une boîte de réception qui ne se remplit pas à l'infini. */
export const MAX_QUESTIONS_PAR_ENTREPRISE = 20;

export type ControleQuestion =
  | { ok: true; objet: string | null; question: string }
  | { ok: false; raison: string };

/** Contrôle et nettoie le corps d'une question (jamais d'HTML interprété : le texte reste du texte). */
export function validerQuestion(corps: unknown): ControleQuestion {
  const brut = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>;
  const question = typeof brut.question === 'string' ? brut.question.replace(/\r\n/g, '\n').trim() : '';
  if (question.length < MIN_QUESTION_CARACTERES) return { ok: false, raison: 'Formulez votre question (quelques mots au moins).' };
  if (question.length > MAX_QUESTION_CARACTERES) return { ok: false, raison: `La question ne peut pas dépasser ${MAX_QUESTION_CARACTERES} caractères.` };
  const objet = typeof brut.objet === 'string' ? brut.objet.replace(/\s+/g, ' ').trim() : '';
  if (objet.length > MAX_OBJET_CARACTERES) return { ok: false, raison: `L'objet ne peut pas dépasser ${MAX_OBJET_CARACTERES} caractères.` };
  return { ok: true, objet: objet || null, question };
}

/**
 * Les questions sont ouvertes tant que la date limite n'est pas atteinte ; sans date limite, elles
 * le restent. Une date illisible ne ferme rien : on ne bloque jamais une entreprise sur une saisie douteuse.
 */
export function questionsOuvertes(dateLimite: unknown, maintenant: Date = new Date()): boolean {
  if (typeof dateLimite !== 'string' || !dateLimite) return true;
  const limite = new Date(dateLimite).getTime();
  return Number.isNaN(limite) ? true : maintenant.getTime() <= limite;
}

/** Une question reçue, telle que la rend GET /api/projects/:id/depot/questions. */
export interface QuestionRecue {
  id: string; entreprise_id: string; entreprise_nom: string; lot_id: string | null;
  objet: string | null; question: string; created_at: string;
}

/** Question de la consultation (jsonb) issue de la page de dépôt. */
export interface QuestionDepotConsultation {
  id: string; entreprise_id: string; entreprise_nom: string; question: string; date_question: string;
  publique: boolean; objet?: string; lot_id?: string; source: 'depot';
}

/**
 * Les questions de la boîte de réception qui ne sont pas encore dans la consultation, comparées par
 * identifiant (rejouable à volonté, sans doublon). Reprise non publique : c'est l'architecte qui décide
 * de rendre une réponse publique.
 */
export function questionsAReprendre(deja: Array<{ id: string }>, recues: QuestionRecue[]): QuestionDepotConsultation[] {
  const connues = new Set(deja.map(q => q.id));
  return recues.filter(r => !connues.has(r.id)).map(r => ({
    id: r.id, entreprise_id: r.entreprise_id, entreprise_nom: r.entreprise_nom, question: r.question,
    date_question: r.created_at.slice(0, 10), publique: false, source: 'depot' as const,
    ...(r.objet ? { objet: r.objet } : {}), ...(r.lot_id ? { lot_id: r.lot_id } : {}),
  }));
}

/** Ce qu'il faut savoir d'une question de la consultation pour en diffuser la réponse. */
export interface QuestionDiffusable {
  id: string; question: string; objet?: string; lot_id?: string; reponse?: string; publique: boolean;
  /** Entreprises déjà destinataires de la diffusion de cette réponse, et date du dernier envoi. */
  diffusee_a?: string[]; diffusee_le?: string;
}

/** Seule une réponse rendue publique et réellement saisie peut être diffusée. */
export function reponseDiffusable(q: Pick<QuestionDiffusable, 'publique' | 'reponse'>): boolean {
  return q.publique === true && !!q.reponse?.trim();
}

/**
 * Entreprises qui reçoivent la réponse : celles du lot visé, ou toutes les entreprises consultées pour une
 * question générale. L'entreprise qui avait posé la question en fait partie (elle reçoit la même réponse).
 */
export function entreprisesDeLaReponse<E extends { lots_ids: string[] }>(
  entreprises: E[], q: Pick<QuestionDiffusable, 'lot_id'>,
): E[] {
  return q.lot_id ? entreprises.filter(e => e.lots_ids.includes(q.lot_id as string)) : entreprises;
}

/** Marque l'entreprise comme destinataire de la réponse, sans doublon ; garde la date du dernier envoi. */
export function marquerDiffusee<Q extends QuestionDiffusable>(q: Q, entrepriseId: string, aujourdhui: string): Q {
  const deja = q.diffusee_a ?? [];
  return { ...q, diffusee_a: deja.includes(entrepriseId) ? deja : [...deja, entrepriseId], diffusee_le: aujourdhui };
}
