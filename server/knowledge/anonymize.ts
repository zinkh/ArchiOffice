/**
 * Anonymisation d'un extrait technique avant mutualisation.
 *
 * Trois couches, de la plus sûre à la moins sûre :
 *  1. les valeurs EXACTES connues du cabinet (contacts, clients, affaires,
 *     adresses, équipe...) : `buildKnownMatchers` / `maskKnownValues` ;
 *  2. des règles (e-mails, téléphones, adresses, parcelles, permis, montants,
 *     « M. Dupont », « X SAS », lignes étiquetées « Maître d'ouvrage : ... ») ;
 *  3. un contrôle des noms propres qui subsisteraient : `findResidualProperNouns`.
 *
 * Aucune de ces couches ne garantit l'anonymat. Elles servent à retirer le plus
 * possible et à REPÉRER ce qui reste douteux, pour que cela ne soit pas envoyé.
 */
export const MAX_SHARED_EXCERPT_CHARS = 25000;

export interface AnonymizationPreview {
  text: string;
  replacements: number;
  warnings: string[];
  /** Nombre de remplacements par catégorie, pour le rapport montré au cabinet. */
  byCategory: Record<string, number>;
}

/** Valeur connue du cabinet à retirer d'un texte, avec la catégorie affichée. */
export interface KnownValue { value: string; category: string }

export interface KnownMatcher { pattern: RegExp; category: string }

const LEGAL_FORMS = '(?:SARL|SAS|SASU|SCI|SA|EURL|SCP|SCPA|SELARL|SNC|SCOP|GIE|EI|SEM|OPH|ESH)';
const ci1 = (word: string) => '[' + word[0].toUpperCase() + word[0].toLowerCase() + ']' + word.slice(1);
const STREET_TYPES = '(?:' + ['rue', 'avenue', 'av\\.?', 'boulevard', 'bd\\.?', 'bvd', 'allée', 'allee', 'impasse', 'chemin', 'place',
  'route', 'rte\\.?', 'quai', 'passage', 'square', 'sentier', 'ruelle', 'faubourg', 'fbg', 'lotissement', 'lieu-dit']
  .map(ci1).join('|') + ')';
// Casse exacte et point obligatoire pour « M. » : « m » seul désigne des mètres.
const HONORIFIC = '(?:[Mm]onsieur|[Mm]adame|[Mm]ademoiselle|Mme|Mlle|M\\.|Mr|Me|Maître|Dr\\.?|Pr\\.?)';
const NAME_WORD = "[A-ZÀ-ÝŒ][\\p{L}'’-]+";
const LABELS = [
  "maître d['’]ouvrage", "maîtrise d['’]ouvrage", 'moa', "maître d['’]œuvre", "maître d['’]oeuvre", 'moe',
  'architecte', 'entreprise', 'titulaire', 'société', 'sous-traitant', 'cotraitant', 'client', 'propriétaire',
  'opération', 'operation', 'projet', 'chantier', 'affaire', 'dossier', 'référence', 'réf', 'ref', 'adresse',
  'localisation', 'commune', 'contact', 'interlocuteur', 'représentant', 'représenté par', 'signataire',
  'bureau de contrôle', "bureau d['’]études", 'bet', 'coordonnateur', 'coordinateur', 'cspS', 'sps',
  'permis de construire', 'parcelle', 'cadastre', 'n° de marché', 'marché', 'lot attribué à',
];

const normalize = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Prépare les valeurs connues : insensibles à la casse, aux accents et aux
 * espaces multiples. Les valeurs trop courtes (moins de 4 caractères) sont
 * ignorées : « Le », « SA » ou « Paul » masqueraient des mots courants.
 * Les plus longues passent d'abord, pour qu'« Atelier Zoméno Sektaoui » ne soit
 * pas entamé par « Sektaoui ».
 */
export function buildKnownMatchers(values: KnownValue[]): KnownMatcher[] {
  const seen = new Set<string>();
  const unique = values
    .map(v => ({ value: v.value?.trim() ?? '', category: v.category }))
    .filter(v => v.value.length >= 4)
    // Un mot seul du métier (« Bois », « Façade ») ne doit pas être masqué partout.
    .filter(v => /\s/.test(v.value) || (v.value.length >= 5 && !TECHNICAL_WORDS.has(normalize(v.value)) && !COMMON_CAPITALISED.has(normalize(v.value))))
    .filter(v => { const key = normalize(v.value); if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => b.value.length - a.value.length)
    .slice(0, 2000);
  return unique.map(({ value, category }) => {
    const folded = [...value.normalize('NFD')].map(ch => /[\u0300-\u036f]/.test(ch) ? '' : ch).join('');
    const body = escapeRegExp(folded.trim()).replace(/\s+/g, '\\s+').replace(/[aeiouyc]/gi, c => accentClass(c));
    return { pattern: new RegExp('(?<![\\p{L}\\p{N}])' + body + '(?![\\p{L}\\p{N}])', 'giu'), category };
  });
}

function accentClass(letter: string): string {
  const classes: Record<string, string> = {
    a: 'aàâä', e: 'eéèêë', i: 'iîï', o: 'oôö', u: 'uùûü', y: 'yÿ', c: 'cç',
  };
  const lower = letter.toLowerCase();
  const set = classes[lower];
  return set ? '[' + set + set.toUpperCase() + ']' : letter;
}

export function maskKnownValues(source: string, matchers: KnownMatcher[]): { text: string; byCategory: Record<string, number> } {
  const byCategory: Record<string, number> = {};
  let text = source;
  for (const { pattern, category } of matchers) {
    text = text.replace(pattern, () => {
      byCategory[category] = (byCategory[category] || 0) + 1;
      return '[' + category + ']';
    });
  }
  return { text, byCategory };
}

export interface AnonymizeOptions {
  known?: KnownMatcher[];
}

export function anonymizeTechnicalText(source: string, options: AnonymizeOptions = {}): AnonymizationPreview {
  if (typeof source !== 'string' || !source.trim()) {
    return { text: '', replacements: 0, warnings: ['Contenu vide.'], byCategory: {} };
  }
  const warnings: string[] = [];
  if (source.length > MAX_SHARED_EXCERPT_CHARS) {
    warnings.push('Extrait tronqué : vérifier que les prescriptions ne sont pas sorties de leur contexte.');
  }
  let text = source.slice(0, MAX_SHARED_EXCERPT_CHARS);
  let replacements = 0;
  const byCategory: Record<string, number> = {};
  const count = (label: string) => { replacements++; byCategory[label] = (byCategory[label] || 0) + 1; return '[' + label + ']'; };
  const replace = (pattern: RegExp, label: string) => { text = text.replace(pattern, () => count(label)); };

  // 1. Valeurs exactes du cabinet.
  if (options.known?.length) {
    const masked = maskKnownValues(text, options.known);
    text = masked.text;
    for (const [label, n] of Object.entries(masked.byCategory)) {
      replacements += n; byCategory[label] = (byCategory[label] || 0) + n;
    }
  }

  // 2. Lignes étiquetées : « Maître d'ouvrage : SCI Bellevue... » -> la valeur disparaît.
  text = text.replace(new RegExp("^([ \\t]*(?:" + LABELS.join('|') + ")(?:[ \\t]+[\\p{L}'’-]+){0,3}[ \\t]*:[ \\t]*)(.+?)(?=\\.[ \\t]+[A-ZÀ-ÝŒ]|$)", 'gimu'), (_m, label: string, value: string) => {
    if (/^\[[A-ZÉ_ ]+\]\.?$/.test(value.trim())) return _m;
    return label + count('MENTION');
  });

  // 3. Coordonnées et identifiants.
  replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'EMAIL');
  replace(/\b(?:https?:\/\/|www\.)[^\s<>]+/gi, 'LIEN');
  replace(/\b(?:FR\d{2}[\s-]?(?:\d[\s-]?){23}|[A-Z]{2}\d{2}[A-Z0-9 ]{11,30})\b/gi, 'IBAN');
  replace(/\b(?:SIRET\s*[:\-]?\s*)?\d{3}[ .]?\d{3}[ .]?\d{3}[ .]?\d{5}\b/gi, 'SIRET');
  replace(/\b(?:SIREN\s*[:\-]?\s*)?\d{3}[ .]\d{3}[ .]\d{3}\b/gi, 'SIREN');
  replace(/(?<![\d])(?:\+33[ .-]?[1-9]|0[1-9])(?:[ .-]?\d{2}){4}(?!\d)/g, 'TELEPHONE');
  // Permis, déclarations, dossiers : PC 054 305 24 C0012, DP 05430524C0001.
  replace(/\b(?:PC|PA|DP|PD|AT|CU[ab]?)[\s-]?(?:n°\s*)?\d{3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?[A-Z]?\d{3,5}\b/g, 'PERMIS');
  // Parcelles cadastrales : « parcelle AB 0123 », « section AB n° 123 », « cadastrée AB 123 ».
  replace(/\b(?:parcelles?(?:\s+(?:cadastrale?s?|cadastr[ée]e?s?))?|cadastr[ée]e?s?|section)\s+(?:n°\s*)?[A-Z]{1,2}\s?(?:n°\s*)?\d{1,4}\b/gi, 'PARCELLE');
  replace(/\b(?:parcelles?|cadastr[ée]e?s?)\s+[A-Z]{1,2}\s?\d{1,4}\b/g, 'PARCELLE');
  // Coordonnées GPS.
  replace(/-?\b\d{1,3}[.,]\d{3,}\s?[°,;]?\s*[NSEO]?\s*[,;]\s*-?\d{1,3}[.,]\d{3,}\s?°?\s*[NSEO]?\b/g, 'COORDONNEES');
  replace(/\b(?:\d{1,3}[,.]\d{4,})\s?[,;]?\s?(?:N|E|°)\b/gi, 'COORDONNEES');

  // 4. Montants : « 125 000,00 € HT », « 150 000 € », « 12,5 k€ », « 1.200 euros ».
  replace(/(?<![\p{L}\d])\d{1,3}(?:[\s\u00a0\u202f.]\d{3})*(?:,\d{1,2})?\s?(?:k€|K€|€|EUR|euros?)(?![\p{L}])/giu, 'MONTANT');
  replace(/(?<![\p{L}\d])\d+(?:,\d{1,2})?\s?(?:k€|K€|€|EUR|euros?)(?![\p{L}])/giu, 'MONTANT');

  // 5. Adresses : « 23 Bd de l'Europe », « 12 bis rue Saint-Dizier », « rue Saint-Dizier ».
  replace(new RegExp('(?<![\\p{L}\\d])\\d{1,4}\\s*(?:bis|ter|quater)?\\s+' + STREET_TYPES + "\\s+[^,\\n;]{2,70}", 'gu'), 'ADRESSE');
  replace(new RegExp('(?<![\\p{L}\\d])' + STREET_TYPES + "\\s+(?:(?:de|du|des|d['’]|la|le|l['’]|saint|sainte|st|ste)\\s*)*" + NAME_WORD + "(?:[ -]" + NAME_WORD + '){0,3}', 'gu'), 'ADRESSE');
  // Code postal + commune : « 54500 Vandœuvre-lès-Nancy ».
  replace(/(?<![\d])\d{5}\s+[\p{L}][\p{L}'’ -]{2,60}(?=[,.;\n]|$)/gu, 'LOCALISATION');
  replace(/(?<!\d|\d[.,])\d{5}(?!\d|[.,]\d)/g, 'REFERENCE');
  // Communes citées : « commune de Laxou », « à Nancy », « ville de Metz ».
  replace(new RegExp("\\b(?:commune|ville|village|agglomération|métropole|département|canton)\\s+(?:de\\s+|d['’]|du\\s+|des\\s+)?(?:la\\s+|le\\s+|l['’])?" + NAME_WORD + "(?:[ -]" + NAME_WORD + '){0,3}', 'gu'), 'COMMUNE');

  // 6. Personnes et sociétés repérables par leur forme.
  replace(new RegExp('\\b' + HONORIFIC + '\\s+(?:' + NAME_WORD + '(?:[ -]' + NAME_WORD + '){0,3})', 'gu'), 'PERSONNE');
  replace(new RegExp('\\b(?:' + NAME_WORD + '[ ,]+){1,4}' + LEGAL_FORMS + '\\b', 'gu'), 'ENTREPRISE');
  replace(new RegExp('\\b' + LEGAL_FORMS + '\\s+' + NAME_WORD + '(?:[ -]' + NAME_WORD + '){0,3}', 'gu'), 'ENTREPRISE');
  replace(new RegExp("\\b(?:entreprises?|sociétés?|etablissements?|établissements?|ets|groupe|cabinet|atelier|bureau)\\s+" + NAME_WORD + "(?:[ -]" + NAME_WORD + '){0,3}', 'gu'), 'ENTREPRISE');
  replace(new RegExp("\\b(?:résidence|residence|domaine|villa|clos|hameau|parc|les jardins|le clos)\\s+(?:de\\s+|du\\s+|des\\s+|d['’]|la\\s+|le\\s+|les\\s+)?" + NAME_WORD + "(?:[ -]" + NAME_WORD + '){0,3}', 'giu'), 'OPERATION');

  // 7. Ce qui ne peut pas être garanti.
  if (/\b(?:SARL|SAS|SCI|SA|EURL|SIREN|RCS|maître d'ouvrage|MOA|parcelle|cadastre|architecte|signataire)\b/i.test(text)) {
    warnings.push('Des noms de sociétés, acteurs ou références foncières peuvent subsister.');
  }
  if (/\b(?:monsieur|madame|m\.|mme|entreprise|société|chantier|projet)\s+[A-ZÀ-Ý]/i.test(text) || /\bentreprise\s+[\p{L}]/iu.test(text)) {
    warnings.push('Des personnes, entreprises ou projets peuvent encore être identifiables.');
  }
  warnings.push('Contrôle humain obligatoire : les noms, plans, tableaux et recoupements indirects ne sont pas fiabilisés automatiquement.');
  return { text: text.trim(), replacements, warnings, byCategory };
}

const TECHNICAL_WORDS = new Set([
  'bois', 'beton', 'acier', 'verre', 'platre', 'isolation', 'facade', 'facades', 'toiture', 'couverture', 'menuiserie',
  'charpente', 'plomberie', 'electricite', 'peinture', 'carrelage', 'maconnerie', 'terrassement', 'etancheite', 'chauffage',
  'ventilation', 'sanitaire', 'serrurerie', 'metallerie', 'cloison', 'cloisons', 'plafond', 'dalle', 'poteau', 'poutre',
  'bardage', 'isolant', 'enduit', 'ossature', 'fondation', 'fondations', 'garde-corps', 'escalier', 'ascenseur',
  'batiment', 'logement', 'logements', 'chantier', 'projet', 'operation', 'travaux', 'ouvrage', 'ouvrages', 'general',
]);

/** Mots d'usage courant en construction qui prennent une majuscule sans être des noms propres. */
const COMMON_CAPITALISED = new Set([
  'dtu', 'nf', 'en', 'iso', 'eurocode', 'eurocodes', 'cctp', 'dpgf', 'bpu', 'dqe', 'dce', 'doe', 'rt', 're', 'ph', 'abf',
  'france', 'français', 'française', 'européen', 'européenne', 'article', 'articles', 'chapitre', 'lot', 'lots', 'titre',
  'classe', 'catégorie', 'type', 'niveau', 'zone', 'norme', 'normes', 'décret', 'arrêté', 'code', 'loi', 'règlement',
  'fourniture', 'pose', 'mise', 'compris', 'y', 'prestations', 'localisation', 'description', 'caractéristiques',
  'mise en œuvre', 'exécution', 'ouvrage', 'ouvrages', 'matériaux', 'préparation', 'finition', 'nota', 'attention',
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche', 'inox', 'pvc', 'osb', 'led', 'vmc', 'ecs',
  'bois', 'béton', 'acier', 'zinc', 'cuivre', 'aluminium', 'ht', 'ttc', 'tva', 'm2', 'm3', 'ml', 'ens', 'u', 'ff', 'pm',
]);

export interface ResidualFinding { text: string; reason: string }

/**
 * Noms propres probables restés dans un texte déjà anonymisé : un mot ou une
 * suite de mots à majuscule initiale qui ne commence pas une phrase, n'est pas
 * une balise `[...]`, un sigle ou un terme courant du bâtiment. Volontairement
 * large : un faux positif retient un paragraphe, un faux négatif en publie un.
 */
export function findResidualProperNouns(text: string): ResidualFinding[] {
  const findings: ResidualFinding[] = [];
  const stripped = text.replace(/\[[A-ZÉ_ ]+\]/g, ' ');
  const pattern = new RegExp("(?<![.!?:;]\\s)(?<!^)(?<=[\\p{L}\\d,;)]\\s)(" + NAME_WORD + "(?:[ -]" + NAME_WORD + "){0,3})", 'gmu');
  for (const match of stripped.matchAll(pattern)) {
    const phrase = match[1].trim();
    const words = phrase.split(/[ -]/).filter(Boolean);
    if (words.every(w => w.length <= 2 || COMMON_CAPITALISED.has(normalize(w)) || /^[A-ZÀ-Ý0-9]{2,}$/.test(w))) continue;
    findings.push({ text: phrase, reason: 'nom propre probable' });
  }
  // Longues suites de chiffres (références, numéros de marché, matricules).
  for (const match of stripped.matchAll(/(?<![\d,.])\d{5,}(?![\d,.])/g)) {
    findings.push({ text: match[0], reason: 'numéro long' });
  }
  return findings;
}
