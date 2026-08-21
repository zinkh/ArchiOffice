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

export const ARTICLES: Article[] = [TIPS_ARTICLE, HELP_DOCS_ARTICLE, VIDEOS_ARTICLE, BUSINESS_GUIDES_ARTICLE];

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
    answer: "Seuls les membres de votre cabinet ont accès à vos projets et documents. L'équipe ArchiOffice n'y accède jamais sans votre demande explicite (ex. via un ticket support nécessitant une assistance sur votre compte).",
  },
  {
    question: 'Comment supprimer définitivement mon compte ?',
    answer: 'Depuis Paramètres > Zone dangereuse, vous pouvez demander la suppression de votre cabinet. Un délai de grâce de 30 jours vous permet d\'annuler la demande avant la suppression effective et définitive des données.',
  },
];
