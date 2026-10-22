// ── Garde-fou général : pas de création sans source ─────────────────────────
// Incident du 12 octobre 2026 : un agent a créé cinq tâches à partir d'un
// fichier dont il n'avait reçu aucun contenu. Le prompt seul ne suffit pas à
// l'empêcher (un modèle qui hallucine ignore aussi la règle qui le lui
// interdit) : le contrôle est donc fait par le SERVEUR, avant l'écriture.
//
// Toute création porte `source: { type, citation }`. La citation doit se
// retrouver, mot pour mot (hors casse, accents et ponctuation), dans ce que
// l'agent a RÉELLEMENT reçu pendant ce tour :
//   - les messages de la personne (historique compris) ;
//   - le contenu des documents joints effectivement lus ;
//   - les résultats des outils de LECTURE (messagerie, documents, base du
//     cabinet, web, cartographie).
// Sont volontairement exclus : les messages de l'agent lui-même (une
// invention de la veille ne se cite pas) et les résultats des outils
// d'ÉCRITURE ou de consultation d'un autre agent (ils reprennent ce que le
// modèle a lui-même écrit ou dit).
//
// Limites assumées : une image jointe ne peut pas être vérifiée par du texte,
// le type `image_jointe` est donc accepté tant qu'une image est jointe à ce
// message ; et une citation exacte prouve que la source existe, pas que
// l'enregistrement la reprend fidèlement. La liaison MCP (client externe,
// conversation hors de ce serveur) n'est pas contrôlée.

export const SOURCE_TYPES = [
  'demande_utilisateur',
  'document_joint',
  'email',
  'base_cabinet',
  'web',
  'image_jointe',
] as const;
export type SourceType = typeof SOURCE_TYPES[number];

/** Outils qui créent des données et exigent une source. */
export const SOURCE_REQUIRED_TOOLS = [
  'create_record',
  'create_site_report',
  'add_site_report_observation',
  'import_site_report_notes',
] as const;

/** Résultats d'outils qui ne comptent JAMAIS comme source. */
const NON_SOURCE_TOOLS = new Set([
  'create_record', 'update_record', 'delete_record', 'create_site_report',
  'add_site_report_observation', 'import_site_report_notes', 'send_email',
  'publier_flux_activite', 'consulter_agent', 'suggerer_amelioration',
]);

/** Une citation plus courte que ça ne prouve rien (« Gros œuvre »). */
export const MIN_CITATION_CHARS = 12;

export const SOURCE_PARAMETER_SCHEMA = {
  type: 'object',
  description:
    "OBLIGATOIRE. D'où vient cette création. Le serveur vérifie que `citation` figure mot pour mot dans ce que tu as réellement reçu " +
    "(message de l'utilisateur, document joint lu, résultat d'un outil de lecture) et refuse la création sinon. " +
    "Cite le passage précis qui justifie CET enregistrement, pas un titre ou un en-tête générique.",
  properties: {
    type: { 
      type: 'string', 
      enum: [...SOURCE_TYPES], 
      description: 'Nature de la source (demande_utilisateur, document_joint, email, base_cabinet, web, image_jointe).' 
    },
    citation: {
      type: 'string',
      description: `Facultatif pour demande_utilisateur (ce que la personne demande ou donne fait foi). Pour un document, un mail ou le web : extrait exact (entre ${MIN_CITATION_CHARS} et 500 caractères) copié depuis la source, qui justifie cet enregistrement. ` +
        "Si l'information vient de plusieurs endroits (page lue + message de l'utilisateur), sépare les passages par « … » : chacun est vérifié séparément.",
      maxLength: 500,
    },
    location: {
      type: 'string',
      description: 'Facultatif. Où se trouve le passage (ex : « ligne 42 du PDF », « message du 10/10 »), pour aider la relecture. Jamais vérifié par le serveur.',
      maxLength: 200,
    },
  },
  required: ['type'],
} as const;

/** Minuscules, sans accents, ponctuation et espaces réduits à un seul espace. */
export function normalizeForMatch(text: string): string {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Toutes les valeurs textuelles et numériques d'un résultat d'outil, à plat. */
function collectStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12 || value === null || value === undefined) return out;
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'number' || typeof value === 'boolean') out.push(String(value));
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out, depth + 1);
  else if (typeof value === 'object') for (const v of Object.values(value as object)) collectStrings(v, out, depth + 1);
  return out;
}

/** Une citation peut réunir plusieurs passages (site + message) séparés par « … ». */
const PASSAGE_SEPARATOR = /\s*(?:…|\.{3}|\[…\])\s*/;

/** Ce que l'agent a réellement reçu pendant ce tour. */
export class SourceCorpus {
  private parts: string[] = [];
  private cache: string | null = null;
  hasImages = false;

  hasUserText = false;
  addUserText(text: string): void {
    if (String(text || '').trim()) this.hasUserText = true;
    this.add(text);
  }
  addDocumentText(text: string): void { this.add(text); }

  /** Résultat d'un outil : ignoré s'il vient d'un outil d'écriture ou d'une erreur. */
  addToolResult(toolName: string, response: unknown): void {
    if (NON_SOURCE_TOOLS.has(toolName)) return;
    if (response && typeof (response as any).error === 'string') return;
    // Les chaînes sont ajoutées telles quelles, jamais via JSON.stringify : un
    // retour à la ligne y devient « \n » littéral, que la normalisation lit comme
    // un « n » collé au mot suivant, et une citation multiligne copiée depuis la
    // page ne correspondait plus jamais (cas SIBE, octobre 2026).
    this.add(collectStrings(response).join('\n'));
  }

  private add(text: string): void {
    if (!text) return;
    this.parts.push(String(text));
    this.cache = null;
  }

  private normalized(): string {
    if (this.cache === null) this.cache = normalizeForMatch(this.parts.join('\n'));
    return this.cache;
  }

  /** Chaque passage (séparés par « … ») doit figurer tel quel dans le corpus. */
  contains(citation: string): boolean {
    const passages = citation.split(PASSAGE_SEPARATOR).map(normalizeForMatch).filter(Boolean);
    if (passages.join(' ').length < MIN_CITATION_CHARS) return false;
    const haystack = this.normalized();
    return passages.every(p => haystack.includes(p));
  }
}

export interface SourceCheck {
  ok: boolean;
  response?: Record<string, unknown>;
}

const refusal = (error: string, instruction: string): SourceCheck => ({
  ok: false,
  response: { error, code: 'SOURCE_NON_VERIFIEE', instruction },
});

const COMMON_INSTRUCTION =
  "Si l'information vient d'un fichier ou d'un mail, relis-le (read_document, read_email_attachment...) puis cite un passage réel ; " +
  "si elle vient de la demande de l'utilisateur, utilise le type demande_utilisateur ; " +
  "sinon n'écris pas cet enregistrement et dis-lui ce qui manque.";

/** Vérifie la source d'une création. Sans corpus (liaison MCP), aucun contrôle. */
export function checkSource(args: Record<string, unknown>, corpus: SourceCorpus | undefined): SourceCheck {
  if (!corpus) return { ok: true };
  const source = args.source as { type?: unknown; citation?: unknown } | undefined;
  if (!source || typeof source !== 'object') {
    return refusal(
      'Création refusée : aucune source indiquée.',
      `Rappelle l'outil avec source: { type, citation }. ${COMMON_INSTRUCTION}`,
    );
  }
  const type = String(source.type || '');
  const citation = String(source.citation || '').trim();

  if (!(SOURCE_TYPES as readonly string[]).includes(type)) {
    return refusal(`Création refusée : type de source inconnu « ${type} ».`, `Types acceptés : ${SOURCE_TYPES.join(', ')}.`);
  }
  // Ce que la personne demande ou donne fait foi : pas de citation exacte exigée
  // (dictée approximative, nom ou heure donnés en langage naturel). Le contrôle
  // mot pour mot reste pour les documents, mails et pages web.
  if (type === 'demande_utilisateur') {
    return corpus.hasUserText
      ? { ok: true }
      : refusal('Création refusée : aucun message de la personne dans cette conversation.', COMMON_INSTRUCTION);
  }
  if (type === 'image_jointe') {
    return corpus.hasImages
      ? { ok: true }
      : refusal('Création refusée : aucune image n\'est jointe à ce message.', COMMON_INSTRUCTION);
  }
  if (normalizeForMatch(citation).length < MIN_CITATION_CHARS) {
    return refusal(
      `Création refusée : citation trop courte (minimum ${MIN_CITATION_CHARS} caractères utiles).`,
      `Cite un passage précis qui justifie cet enregistrement. ${COMMON_INSTRUCTION}`,
    );
  }
  if (!corpus.contains(citation)) {
    return refusal(
      'Création refusée : la citation ne figure dans aucune source que tu as reçue (message, document lu, résultat de lecture).',
      `Ne reformule pas, copie le passage exact. ${COMMON_INSTRUCTION}`,
    );
  }
  return { ok: true };
}
