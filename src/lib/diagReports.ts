// Rapports de diagnostic d'une opération de rénovation (onglet DIAG) : types et
// prompt de rédaction assistée. Le prompt est construit ici, sans dépendance
// serveur, pour pouvoir être testé : c'est lui qui dit à l'IA ce qu'elle lit
// (fiche de l'affaire, pièces, rapport en cours) et ce qu'elle n'a pas le droit
// d'inventer.
import type { AiMode } from './slashMenu';

export interface DiagReport {
  id: string;
  project_id: string;
  title: string;
  /** HTML de l'éditeur de texte riche. */
  content: string;
  created_at: string;
  updated_at: string;
}

export const DIAG_AI_MODES: readonly AiMode[] = ['write', 'continue', 'rewrite', 'shorten', 'expand', 'fix'];
export const isDiagAiMode = (v: unknown): v is AiMode => (DIAG_AI_MODES as readonly string[]).includes(v as string);

export interface DiagPromptInput {
  mode: AiMode;
  instruction: string;
  selection: string;
  /** Contenu actuel du rapport, en texte brut. */
  document: string;
  reportTitle: string;
  /** Fiche de l'affaire (`projectNoticeFacts`). */
  facts: string;
  /** Extraits des pièces jointes de l'affaire. */
  projectDocs: string;
  /** Autres rapports de la même affaire, en texte brut (titre + contenu abrégé). */
  otherReports: string;
}

const TASKS: Record<AiMode, string> = {
  write: "Rédige le passage demandé par l'architecte, en le raccordant au rapport déjà écrit.",
  continue: "Poursuis le rapport à partir de la fin du texte existant, sans répéter ce qui est déjà écrit.",
  rewrite: "Reformule le PASSAGE À TRAITER (consigne éventuelle de l'architecte) sans changer le sens et sans ajouter aucun fait.",
  shorten: "Raccourcis le PASSAGE À TRAITER en gardant tous les constats, mesures et réserves essentiels.",
  expand: "Développe le PASSAGE À TRAITER en t'appuyant uniquement sur les données fournies ; ne crée aucun fait nouveau.",
  fix: "Corrige l'orthographe, la grammaire et la typographie du PASSAGE À TRAITER sans changer le sens, le ton ni la structure.",
};

const REPLACES: readonly AiMode[] = ['rewrite', 'shorten', 'expand', 'fix'];

export function buildDiagPrompt(i: DiagPromptInput): string {
  const replaces = REPLACES.includes(i.mode);
  return `Tu es l'assistant de rédaction d'un cabinet d'architecture français. Tu aides à rédiger un rapport de diagnostic d'un bâtiment existant (opération de rénovation).
Rapport : « ${i.reportTitle || 'Diagnostic'} ».

TÂCHE : ${TASKS[i.mode]}

DONNÉES FACTUELLES DE L'AFFAIRE :
${i.facts.trim() || "Aucune donnée factuelle n'est encore renseignée sur la fiche de l'affaire."}
${i.projectDocs.trim() ? `\nEXTRAITS DES PIÈCES JOINTES À L'AFFAIRE :\n${i.projectDocs}` : ''}
${i.otherReports.trim() ? `\nAUTRES RAPPORTS DE L'AFFAIRE :\n${i.otherReports}` : ''}
${i.document.trim() ? `\nRAPPORT EN COURS (texte actuel) :\n${i.document}` : '\nLe rapport est encore vide.'}
${replaces ? `\nPASSAGE À TRAITER :\n${i.selection}` : ''}
${i.instruction.trim() ? `\nCONSIGNE DE L'ARCHITECTE :\n${i.instruction}` : ''}

RÈGLES IMPÉRATIVES :
- Rédige en français professionnel, précis et sobre.
- N'invente aucune mesure, quantité, date, désordre, pathologie, matériau, essai, résultat de sondage, norme ni référence réglementaire qui ne figure pas dans les données ci-dessus ou dans la consigne.
- Quand une information nécessaire manque, écris « à préciser », « à vérifier » ou « à confirmer » plutôt que de la deviner.
- Distingue ce qui est constaté de ce qui est supposé ou à vérifier. Ne conclus jamais à la conformité, à la solidité ou à l'absence de risque sans élément fourni.
- Format : paragraphes courts ; titres avec « ## » ou « ### » ; listes avec « - » ; gras avec **texte**. Aucun autre markdown.
- ${replaces ? 'Rends UNIQUEMENT le passage traité, prêt à remplacer l\'original.' : 'Rends UNIQUEMENT le texte à ajouter au rapport.'} Aucun préambule, aucun commentaire sur ton rôle d'IA, ne répète pas le texte existant.`;
}
