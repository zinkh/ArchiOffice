// Textes réglementaires du panneau d'affichage d'une autorisation d'urbanisme.
//
// ⚠ À VÉRIFIER SUR LÉGIFRANCE avant tout usage officiel : ces textes ont été
// rédigés sans accès au site officiel (hôte injoignable depuis l'environnement
// de développement). Références : Code de l'urbanisme, articles R424-15,
// A424-15 à A424-19, R600-1 et R600-2, arrêté du 30 mars 2017 (mentions du
// panneau). `tests/panneauxPermis.test.ts` verrouille ces textes : toute
// modification doit être relue contre le texte officiel en vigueur.
export const MENTIONS_VERIFIEES_LE: string | null = null; // à renseigner après relecture (AAAA-MM-JJ)

export const MENTIONS_REFERENCES = 'Code de l’urbanisme, art. R424-15, A424-15 à A424-19, R600-1, R600-2';

export const DROIT_DE_RECOURS_TITRE = 'Droit de recours';

export const DROIT_DE_RECOURS_TEXTE =
  'Le délai de recours contentieux est de deux mois à compter du premier jour d’une période continue de deux mois d’affichage sur le terrain du présent panneau (art. R. 600-2 du code de l’urbanisme). ' +
  'Le recours administratif ou contentieux doit être notifié à l’auteur de la décision et au titulaire de l’autorisation. ' +
  'Cette notification doit être adressée par lettre recommandée avec accusé de réception ou remise contre décharge, dans un délai de quinze jours francs à compter du dépôt du recours (art. R. 600-1 du code de l’urbanisme).';

export const AFFICHAGE_LISIBLE =
  'Panneau à installer de manière à rester lisible depuis la voie publique ou les espaces ouverts au public pendant toute la durée du chantier.';

export const TITRES_PERMIS: Record<'PC' | 'DP', string> = {
  PC: 'PERMIS DE CONSTRUIRE',
  DP: 'DÉCLARATION PRÉALABLE',
};

export const MENTION_A_VERIFIER =
  'Mentions à vérifier par l’architecte avant impression et affichage : le contenu exact dépend du type d’autorisation.';
