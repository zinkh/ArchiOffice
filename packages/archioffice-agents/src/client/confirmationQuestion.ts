// Détecte qu'un message d'agent se termine par une question à laquelle on
// répond par oui ou non (« Voulez-vous que je supprime… ? », « Je confirme ? »).
// Sert à proposer un bouton « Oui » (et « Non ») au lieu de faire taper la réponse.
// Volontairement prudent : une question ouverte (« Quel lot ? ») n'en reçoit pas.

const CONFIRMATION_CUES = [
  /\bou non\b/i,
  /\boui\s*\/\s*non\b/i,
  /\(\s*oui\b/i,
  /\bvoulez[- ]vous\b/i,
  /\bsouhaitez[- ]vous\b/i,
  /\bdésirez[- ]vous\b/i,
  /\bdois[- ]je\b/i,
  /\bpuis[- ]je\b/i,
  /\bpeux[- ]je\b/i,
  /\best[- ]ce que (?:je|j')\b/i,
  /\bje (?:procède|lance|crée|supprime|continue|valide|enregistre|envoie|génère|modifie|mets? à jour)\b/i,
  /\bconfirm/i,
  /\bvalid(?:e|ez|er|ons)\b/i,
  /\bd'accord\b/i,
  /\bon y va\b/i,
  /\bc'est bon\b/i,
  /\bça vous convient\b/i,
  /\bprocéder\b/i,
  /\bgo\b/i,
];

// Une question ouverte (qui/quel/combien…) attend une valeur, pas un oui.
const OPEN_QUESTION = /^\s*(?:quel(?:le)?s?|qui|combien|où|quand|comment|pourquoi|lequel|laquelle|lesquel(?:le)?s)\b/i;

export function isYesNoQuestion(content: string | undefined | null): boolean {
  if (!content) return false;
  // Retire la mise en forme Markdown et les emojis de fin avant de regarder la ponctuation.
  const text = content
    .replace(/[*_`>]/g, '')
    .replace(/[\p{Extended_Pictographic}️\s]+$/u, '')
    .trim();
  // « Je crée la tâche ? (oui ou non) » : la parenthèse finale n'empêche pas la question.
  const withoutHint = text.replace(/\s*\([^()]*\)\s*$/, '');
  const hint = text.slice(withoutHint.length);
  if (!withoutHint.endsWith('?')) return false;
  // La dernière question : de la phrase précédente (. ! ? saut de ligne) à la fin.
  const body = withoutHint.slice(0, -1);
  const start = Math.max(body.lastIndexOf('\n'), body.lastIndexOf('. '), body.lastIndexOf('! '), body.lastIndexOf('? '), body.lastIndexOf(': '));
  const lastQuestion = body.slice(start + 1).trim();
  if (!lastQuestion || OPEN_QUESTION.test(lastQuestion)) return false;
  const scanned = `${lastQuestion} ${hint}`;
  return CONFIRMATION_CUES.some(cue => cue.test(scanned));
}
