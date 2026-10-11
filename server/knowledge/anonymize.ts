/**
 * Préparation LOCAL ONLY d'un extrait technique pour une éventuelle mutualisation.
 * Les regex ne constituent PAS une garantie d'anonymat. Une revue humaine est
 * obligatoire et aucun envoi vers un fournisseur IA n'est réalisé ici.
 */
export const MAX_SHARED_EXCERPT_CHARS = 25000;

export interface AnonymizationPreview {
  text: string;
  replacements: number;
  warnings: string[];
}

export function anonymizeTechnicalText(source: string): AnonymizationPreview {
  if (typeof source !== 'string' || !source.trim()) {
    return { text: '', replacements: 0, warnings: ['Contenu vide.'] };
  }
  const warnings: string[] = [];
  if (source.length > MAX_SHARED_EXCERPT_CHARS) {
    warnings.push('Extrait tronqué : vérifier que les prescriptions ne sont pas sorties de leur contexte.');
  }
  let text = source.slice(0, MAX_SHARED_EXCERPT_CHARS);
  let replacements = 0;
  const replace = (pattern: RegExp, label: string) => {
    text = text.replace(pattern, () => { replacements++; return '[' + label + ']'; });
  };
  replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'EMAIL');
  replace(/\b(?:https?:\/\/|www\.)[^\s<>]+/gi, 'LIEN');
  replace(/\b(?:FR\d{2}[\s-]?(?:\d[\s-]?){23}|[A-Z]{2}\d{2}[A-Z0-9 ]{11,30})\b/gi, 'IBAN');
  replace(/\b(?:SIRET\s*[:\-]?\s*)?\d{3}[ .]?\d{3}[ .]?\d{3}[ .]?\d{5}\b/gi, 'SIRET');
  replace(/\b(?:\+33[ .-]?[1-9]|0[1-9])(?:[ .-]?\d{2}){4}\b/g, 'TELEPHONE');
  replace(/\b\d{1,4}\s+(?:rue|avenue|boulevard|allée|impasse|chemin|place|route|quai|passage)\s+[^,\n;.]{3,80}/gi, 'ADRESSE');
  replace(/\b\d{5}\s+[\p{L}][\p{L}'’ -]{2,60}(?=[,.;\n]|$)/gu, 'LOCALISATION');
  replace(/\b(?:\d{1,3}[\s\u00a0]?){1,4}\d{3}(?:[,.]\d{2})?\s?(?:€|EUR|euros)\b/gi, 'MONTANT');
  replace(/\b(?:\d{1,3}[,.]\d{4,})\s?[,;]?\s?(?:N|E|°)\b/gi, 'COORDONNEES');

  // Détection prudente d'indices impossibles à anonymiser sûrement par regex.
  if (/\b(?:SARL|SAS|SCI|SA|EURL|SIREN|RCS|maître d'ouvrage|MOA|parcelle|cadastre|architecte|signataire)\b/i.test(text)) {
    warnings.push('Des noms de sociétés, acteurs ou références foncières peuvent subsister.');
  }
  if (/\b(?:monsieur|madame|m\.|mme|entreprise|société|chantier|projet)\s+[A-ZÀ-Ý]/.test(text)) {
    warnings.push('Des personnes, entreprises ou projets peuvent encore être identifiables.');
  }
  warnings.push('Contrôle humain obligatoire : les noms, plans, tableaux et recoupements indirects ne sont pas fiabilisés automatiquement.');
  return { text: text.trim(), replacements, warnings };
}
