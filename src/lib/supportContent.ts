// Static content for the "Aide" screen (src/pages/Support.tsx), shown before
// the ticket list — Conseils/Documents/FAQ/Vidéos/Guides. Not DB-backed by
// design (no content-management back-office yet); editing this file is the
// only way to update it for now.

export interface ArticleSection {
  heading?: string;
  items: string[];
}

export interface Article {
  key: string;
  title: string;
  intro: string;
  sections: ArticleSection[];
}

export interface FaqItem {
  question: string;
  answer: string;
}

export const TIPS_ARTICLE: Article = {
  key: 'tips',
  title: 'Conseils et astuces',
  intro: "Quelques pratiques qui font gagner du temps aux cabinets qui utilisent ArchiOffice au quotidien.",
  sections: [
    {
      heading: 'Documents et indices',
      items: [
        "Utilisez la numérotation par indices (A, B, C…) pour tracer les révisions d'un même document plutôt que de renommer les fichiers.",
        "Diffusez vos documents aux bons contacts depuis la fiche document — l'historique de diffusion sert de preuve en cas de litige.",
      ],
    },
    {
      heading: 'CCTP, DPGF et devis',
      items: [
        "Partez d'un modèle existant pour un CCTP ou une DPGF plutôt que de repartir de zéro — vous gagnez un temps considérable sur les lots récurrents.",
        "Convertissez un devis accepté directement en facture pour éviter les ressaisies et les écarts entre les deux documents.",
      ],
    },
    {
      heading: 'Planning et chantier',
      items: [
        "Posez les jalons clés dans le Gantt avant le démarrage du chantier — ils servent ensuite de repères pour les réunions de suivi.",
        "Rédigez vos comptes-rendus de réunion de chantier juste après la visite, pendant que les observations sont encore fraîches.",
      ],
    },
    {
      heading: 'Crédits IA',
      items: [
        "Surveillez votre solde de crédits IA depuis Facturation pour anticiper une recharge avant qu'une génération échoue faute de crédit.",
      ],
    },
  ],
};

export const HELP_DOCS_ARTICLE: Article = {
  key: 'docs',
  title: "Documents d'aide",
  intro: "Les principales prises en main, étape par étape.",
  sections: [
    {
      heading: 'Démarrage',
      items: [
        "Créer votre premier projet : renseignez le nom, l'adresse et la phase de mission, puis invitez les intervenants concernés.",
        "Inviter les membres de votre équipe : depuis Équipe, ajoutez chaque collaborateur avec le rôle adapté (admin, chef de projet, utilisateur).",
      ],
    },
    {
      heading: 'Production',
      items: [
        "Générer un CCTP ou une DPGF à partir d'un modèle : choisissez un modèle existant, puis adaptez les lots à votre opération.",
        "Établir un devis et le transformer en facture une fois accepté par le client.",
      ],
    },
    {
      heading: 'Suivi de chantier',
      items: [
        "Exporter un rapport de réunion de chantier en PDF ou DOCX directement depuis la fiche de réunion.",
        "Suivre les réserves et observations levées lors des visites de chantier.",
      ],
    },
  ],
};

export const BUSINESS_GUIDES_ARTICLE: Article = {
  key: 'guides',
  title: 'Guides pour les entreprises',
  intro: "Repères administratifs et juridiques utiles à un cabinet d'architecture — à titre informatif, sans valeur de conseil juridique ou comptable.",
  sections: [
    {
      heading: 'Assurances professionnelles',
      items: [
        "L'assurance décennale couvre les dommages compromettant la solidité de l'ouvrage ou le rendant impropre à sa destination, pendant 10 ans après réception.",
        "La responsabilité civile professionnelle (RC Pro) couvre les autres dommages causés dans l'exercice de votre mission, indépendamment de la garantie décennale.",
      ],
    },
    {
      heading: 'Devis et factures',
      items: [
        "Un devis ou une facture BTP doit mentionner votre SIRET, votre numéro de TVA intracommunautaire (si assujetti), et les coordonnées de votre assurance décennale.",
        "La facturation électronique (Factur-X) devient progressivement obligatoire pour les échanges B2B — ArchiOffice génère vos factures dans ce format.",
      ],
    },
    {
      heading: 'Données personnelles',
      items: [
        "Le RGPD s'applique aux données de vos clients et prospects conservées dans ArchiOffice — pensez à documenter vos durées de conservation.",
      ],
    },
  ],
};

export const VIDEOS_ARTICLE: Article = {
  key: 'videos',
  title: "Vidéos d'aide",
  intro: "Aucune vidéo n'est disponible pour le moment — cette section sera complétée prochainement. Voici les sujets envisagés :",
  sections: [
    {
      items: [
        "Édition des plans de calepinage",
        "Relevé cadastral en direct dans ArchiOffice",
        "Prise en main du planning Gantt",
        "Génération d'un CCTP à partir d'un modèle",
      ],
    },
  ],
};

export const WORKFLOW_ARTICLE: Article = {
  key: 'workflow', title: 'De l’affaire au chantier',
  intro: "Un parcours pratique, fondé sur les écrans et les routes actuellement implémentés.",
  sections: [
    { heading: '1. Choisir le cabinet et ouvrir l’affaire', items: [
      "Vérifiez le cabinet actif dans le sélecteur avant de créer une affaire ou un contact. Un même compte peut appartenir à plusieurs cabinets ; les données et les rôles dépendent du cabinet choisi.",
      "Dans Affaires, créez l’opération puis complétez sa fiche : intervenants, lots, cotraitants et membres du projet. Ouvrez la fiche pour retrouver les ateliers et documents de cette opération.",
    ] },
    { heading: '2. Préparer les études et les pièces écrites', items: [
      "Dans les ateliers du projet, complétez les notices et les pièces de votre phase. Le CCTP et la DPGF reposent sur une arborescence de lots, chapitres et articles : contrôlez les textes, unités, quantités et prix avant export.",
      "Lors d’un passage de phase, examinez les contrôles et les pièces demandées avant de confirmer. Consultez l’historique des phases pour retracer les décisions.",
    ] },
    { heading: '3. Rédiger un compte-rendu de chantier', items: [
      "Ouvrez l’atelier DET de l’affaire et créez le compte-rendu à la date de visite. Ajoutez les observations dans les lots concernés, avec leurs photos si nécessaire.",
      "Une réunion classique et un compte-rendu DET sont deux objets distincts. Avec l’assistant, précisez « compte-rendu de chantier dans le DET » et le nom de l’opération.",
      "Relisez le brouillon, vérifiez les destinataires puis utilisez les commandes de diffusion du compte-rendu. La création par le MCP ne diffuse pas automatiquement le document.",
    ] },
    { heading: '4. Réception et suivi', items: [
      "Renseignez la réception puis suivez les réserves, leurs photos et leur levée. Distinguez les réserves de réception des signalements en GPA.",
      "Si une commande est absente ou refusée, vérifiez le cabinet, votre rôle et les accès au projet ; une invitation ne donne pas automatiquement tous les droits.",
    ] },
  ],
};

export const MCP_ARTICLE: Article = {
  key: 'mcp', title: 'Connecter un assistant avec le MCP',
  intro: "Le connecteur MCP permet à un assistant compatible de consulter et de modifier les données autorisées de votre cabinet.",
  sections: [
    { heading: 'Connexion et révocation', items: [
      "Dans Paramètres, retrouvez la carte des connexions MCP et copiez l’adresse affichée, terminée par /mcp. Ajoutez-la dans votre assistant compatible, puis suivez la connexion et le consentement ArchiOffice.",
      "La liste des connexions permet de révoquer une liaison. Une session expirée ou révoquée doit être reconnectée depuis l’assistant.",
    ] },
    { heading: 'Choisir la bonne agence', items: [
      "Demandez « Quelle agence utilises-tu ? » avant une écriture. Le cabinet affiché dans le navigateur et celui de la connexion MCP sont indépendants.",
      "Demandez « Travaille sur AACZ ». L’assistant doit vérifier la réponse du changement d’agence ; si plusieurs cabinets correspondent, précisez lequel. Après une bascule, il doit rechercher à nouveau les affaires et les contacts.",
    ] },
    { heading: 'Exemples de demandes', items: [
      "« Dans AACZ, cherche l’affaire VIP-TC puis liste ses documents. »",
      "« Lis le PDF joint à cette affaire et relève les coordonnées du maître d’ouvrage en citant la source. »",
      "« Crée un brouillon de compte-rendu de chantier pour cette opération à la date indiquée, puis ajoute cette observation au lot concerné. »",
      "« Prépare un brouillon de mail. » Le connecteur peut préparer un brouillon, mais n’expose pas l’envoi réel des emails.",
    ] },
    { heading: 'Documents et limites', items: [
      "Pour un fichier local, l’assistant peut demander une URL de dépôt valable 15 minutes puis envoyer le fichier directement. La limite MCP est de 25 Mio ; un dépôt réussi attache immédiatement le fichier à la fiche.",
      "La suppression d’une pièce jointe demande une confirmation explicite portant sur le fichier précis. La suppression générique d’une fiche n’est pas exposée par le MCP.",
      "Les possibilités exactes et les champs requis sont annoncés par les outils du connecteur. Un échec doit être corrigé avant d’annoncer l’action comme réalisée.",
    ] },
  ],
};

export const API_ARTICLE: Article = {
  key: 'api', title: 'API et automatisations',
  intro: "Repères pour connecter un outil métier, n8n ou une intégration HTTP à ArchiOffice.",
  sections: [
    { heading: 'Créer une clé d’automatisation', items: [
      "Un administrateur peut créer une clé nommée dans la carte des automatisations des Paramètres. Copiez-la dès sa création : elle ne sera plus affichée ensuite. Enregistrez-la dans le gestionnaire de secrets de votre outil.",
      "Envoyez la clé dans l’en-tête Authorization: Bearer. Elle est rattachée au cabinet de sa création et aux droits de son émetteur. Révoquez les clés qui ne servent plus.",
    ] },
    { heading: 'REST et MCP', items: [
      "L’API REST utilise les routes /api ; le MCP utilise /mcp avec son propre consentement OAuth. Ne remplacez pas un jeton MCP par une clé d’automatisation dans la configuration du connecteur.",
      "La référence technique du dépôt est répartie entre API.md (REST) et MCP.md (connexion, outils et exemples). docs/api-routes.md répertorie les déclarations de routes et leurs fichiers sources.",
    ] },
    { heading: 'Comprendre un refus', items: [
      "401 : vérifiez ou renouvelez l’authentification. 403 : contrôlez les droits et le cabinet. 400 : consultez le message de validation avant de modifier les champs envoyés.",
      "Pour une réponse 429, attendez le délai indiqué avant de réessayer. Pour un échec après une création, relisez la liste avant de renvoyer la demande afin d’éviter un doublon.",
    ] },
  ],
};

export const TROUBLESHOOTING_ARTICLE: Article = {
  key: 'troubleshooting', title: 'Résoudre un problème',
  intro: "Quelques vérifications ciblées avant de transmettre une demande au support.",
  sections: [
    { heading: 'Donnée ou action introuvable', items: [
      "Vérifiez le cabinet actif, le projet ouvert et les filtres. Pour le MCP, demandez aussi l’agence active de la connexion : changer de cabinet dans le navigateur ne la modifie pas.",
      "Une affaire archivée ou un accès invité peut limiter les modifications. Relevez le message exact affiché plutôt que de recréer la fiche.",
    ] },
    { heading: 'Synchronisation et documents', items: [
      "En cas de Bad Request pendant une synchronisation, relevez le service concerné, l’heure et le message détaillé. Ce libellé seul ne permet pas de déterminer la cause ; vérifiez la connexion du compte concerné dans les Paramètres.",
      "Si un document ne s’ouvre pas, revenez à sa fiche et relancez l’ouverture pour obtenir un nouveau lien signé. Une référence de stockage ou un ancien lien expiré ne constitue pas un lien permanent de téléchargement.",
    ] },
    { heading: 'Transmettre un ticket utile', items: [
      "Indiquez le cabinet, l’affaire, l’action réalisée, le résultat attendu et le message exact. Ajoutez une capture et l’heure du problème pour faciliter le diagnostic.",
      "Ne joignez ni mot de passe, ni jeton d’accès, ni clé API. Depuis Aide, créez un ticket puis suivez les réponses dans « Voir mes tickets ».",
    ] },
  ],
};

export const ARTICLES: Article[] = [WORKFLOW_ARTICLE, MCP_ARTICLE, API_ARTICLE, TROUBLESHOOTING_ARTICLE, TIPS_ARTICLE, HELP_DOCS_ARTICLE, VIDEOS_ARTICLE, BUSINESS_GUIDES_ARTICLE];

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Comment fonctionne la période d'essai ?",
    answer: "Chaque nouveau cabinet dispose de 14 jours d'essai gratuit avec un accès complet aux fonctionnalités, dans la limite des quotas du plan d'essai. Vous pouvez souscrire à un abonnement à tout moment depuis Facturation.",
  },
  {
    question: 'Comment changer de plan ou résilier mon abonnement ?',
    answer: "Depuis Facturation, vous pouvez passer à un plan supérieur immédiatement, ou programmer une rétrogradation/résiliation qui prendra effet à la fin de votre période déjà payée — vous ne perdez jamais l'accès en cours de période.",
  },
  {
    question: 'Comment sont calculés les crédits IA ?',
    answer: "Les crédits IA sont consommés à l'usage lors des appels à l'assistant IA (agents, suggestions), au prorata des tokens échangés. Votre solde et votre consommation sont visibles depuis Facturation.",
  },
  {
    question: 'Qui peut voir les documents de mon cabinet ?',
    answer: "Les accès dépendent du cabinet, du rôle et des partages du projet. Des invités ou des destinataires de liens de partage peuvent accéder aux éléments qui leur sont autorisés. Vérifiez les membres et les partages de l’affaire avant de diffuser un document.",
  },
  {
    question: 'Comment supprimer définitivement mon compte ?',
    answer: 'Depuis Paramètres > Zone dangereuse, vous pouvez demander la suppression de votre cabinet. Un délai de grâce de 30 jours vous permet d\'annuler la demande avant la suppression effective et définitive des données.',
  },
];
