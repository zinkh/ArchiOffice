// Best-effort extraction of structured BOAMP-style fields (ville d'exécution,
// pouvoir adjudicateur, montant des travaux, date limite de réponse) out of a
// tender RSS item's plain-text description.
//
// There is no single canonical format here: tenderRssPoller.ts already notes
// that sources range from BOAMP mirrors to marchesonline.com and others, each
// with its own labeling conventions. This is a heuristic label-matching
// parser, not a real BOAMP field-by-field API integration — it tries several
// known label synonyms per field and returns undefined for anything it can't
// confidently find, so a miss just leaves the field blank rather than
// producing wrong data. Extend the label lists below if a specific source's
// wording isn't being picked up.

export interface ExtractedTenderFields {
  ville_execution?: string;
  pouvoir_adjudicateur?: string;
  montant_travaux?: number;
  date_limite_reponse?: string; // ISO yyyy-mm-dd
}

// Label synonyms per field, tried in order (first match wins). Longer /
// more specific phrasings are listed before generic ones to avoid, e.g.,
// "ville" matching inside an unrelated sentence.
const LABELS = {
  ville_execution: [
    "lieu d['’]ex[ée]cution des travaux",
    "lieu d['’]ex[ée]cution",
    "commune d['’]ex[ée]cution",
    'ville d[’\']ex[ée]cution',
    'lieu de livraison',
    'ville',
  ],
  pouvoir_adjudicateur: [
    'pouvoir adjudicateur',
    'ma[iî]tre de l[’\']ouvrage',
    'ma[iî]tre d[’\']ouvrage',
    'acheteur public',
    'organisme acheteur',
    'acheteur',
  ],
  montant_travaux: [
    'montant des travaux',
    'montant estim[ée] des travaux',
    'montant du march[ée]',
    'montant estim[ée]',
    'valeur estim[ée]e',
    'valeur du march[ée]',
    'estimation',
    'montant',
  ],
  date_limite_reponse: [
    'date limite de r[ée]ception des offres',
    'date limite de remise des offres',
    'date limite de r[ée]ponse',
    'date limite de candidature',
    'date limite de r[ée]ception des candidatures',
    'date limite',
  ],
} as const;

type FieldKey = keyof typeof LABELS;

// All label phrases across all fields, used as a stop-boundary so one
// field's capture doesn't swallow the next field's label + value.
const ALL_LABEL_ALTERNATION = Object.values(LABELS)
  .flat()
  .sort((a, b) => b.length - a.length) // longest first so sub-phrases don't shadow fuller ones
  .join('|');

function buildFieldPattern(label: string): RegExp {
  // Value = everything after "Label :" up to the next known label, a
  // newline, a pipe separator, or end of string.
  return new RegExp(
    `${label}\\s*:\\s*([\\s\\S]*?)(?=\\s*(?:${ALL_LABEL_ALTERNATION})\\s*:|\\n|\\r|\\|| - [A-ZÀ-Ý]|$)`,
    'i'
  );
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ');
}

function extractLabeledValue(text: string, field: FieldKey): string | undefined {
  for (const label of LABELS[field]) {
    const match = buildFieldPattern(label).exec(text);
    const raw = match?.[1]?.trim().replace(/\s+/g, ' ').replace(/^[:\-–—\s]+|[.\s]+$/g, '');
    if (raw) return raw.slice(0, 200);
  }
  return undefined;
}

/** Parses a French-formatted amount ("1 250 000,50 €", "2.500.000 EUR", "850000") into a number, or null. */
function parseFrenchAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned) return null;

  let normalized: string;
  if (cleaned.includes(',')) {
    // Comma is the decimal separator; every dot is a thousands separator.
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    const dotCount = (cleaned.match(/\./g) || []).length;
    const lastDotDigits = cleaned.split('.').pop()?.length ?? 0;
    // Multiple dots, or a single dot followed by exactly 3 digits (a
    // thousands group, e.g. "2.500"), means the dots are thousands
    // separators rather than a decimal point (money rarely has a 3-digit
    // fractional part).
    normalized = dotCount > 0 && (dotCount > 1 || lastDotDigits === 3)
      ? cleaned.replace(/\./g, '')
      : cleaned;
  }

  const value = parseFloat(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Parses a dd/mm/yyyy, dd-mm-yyyy, or yyyy-mm-dd date into an ISO yyyy-mm-dd string, or null. */
function parseFrenchDate(raw: string): string | null {
  const isoMatch = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const frMatch = raw.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (frMatch) {
    const [, d, m, yRaw] = frMatch;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    const day = d.padStart(2, '0');
    const month = m.padStart(2, '0');
    if (Number(month) <= 12 && Number(day) <= 31) return `${y}-${month}-${day}`;
  }
  return null;
}

export function extractTenderFields(description: string | null | undefined): ExtractedTenderFields {
  if (!description) return {};
  const text = stripHtml(description);

  const result: ExtractedTenderFields = {};

  const ville = extractLabeledValue(text, 'ville_execution');
  if (ville) result.ville_execution = ville;

  const pouvoir = extractLabeledValue(text, 'pouvoir_adjudicateur');
  if (pouvoir) result.pouvoir_adjudicateur = pouvoir;

  const montantRaw = extractLabeledValue(text, 'montant_travaux');
  if (montantRaw) {
    const montant = parseFrenchAmount(montantRaw);
    if (montant !== null) result.montant_travaux = montant;
  }

  const dateRaw = extractLabeledValue(text, 'date_limite_reponse');
  if (dateRaw) {
    const date = parseFrenchDate(dateRaw);
    if (date) result.date_limite_reponse = date;
  }

  return result;
}
