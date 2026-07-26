// Starter templates inserted into a tenant's `document_templates` table the first
// time they call GET /api/document_templates (see server.ts). Each is a simple
// markdown skeleton with {{placeholder}} tokens and an opening disclaimer — these
// are working drafts, not certified legal documents.

export interface SeedTemplateVariable {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'number';
  required?: boolean;
  default_value?: string;
}

export interface SeedDocumentTemplate {
  name: string;
  category: 'Contrat MOE' | 'CCTP' | 'DPGF' | 'Candidature' | 'Courrier' | 'OS' | 'Autre';
  description: string;
  content: string;
  variables: SeedTemplateVariable[];
}

const DISCLAIMER = "> Modèle de base à adapter et à faire valider par un juriste — ne constitue pas un document juridique certifié.\n\n";

export const SEED_DOCUMENT_TEMPLATES: SeedDocumentTemplate[] = [
  {
    name: "Contrat de maîtrise d'œuvre (type)",
    category: 'Contrat MOE',
    description: "Squelette de contrat MOE : parties, missions, rémunération, résiliation.",
    content: DISCLAIMER + `# CONTRAT DE MAÎTRISE D'ŒUVRE

## Entre les soussignés

**Le maître de l'ouvrage (MOA)** : {{client_nom}}, domicilié(e) {{client_adresse}}, ci-après désigné "le Maître de l'Ouvrage".

**Le maître d'œuvre (MOE)** : {{agence_nom}}, dont le siège est situé {{agence_adresse}}, ci-après désigné "le Maître d'Œuvre".

## Article 1 — Objet du contrat

Le présent contrat a pour objet de définir les conditions dans lesquelles le Maître d'Œuvre assurera sa mission pour l'opération suivante :

- Opération : {{nom_operation}}
- Adresse de l'opération : {{adresse_operation}}
- Type de contrat : {{type_contrat}}

## Article 2 — Étendue de la mission

La mission confiée au Maître d'Œuvre comprend les éléments suivants (à cocher/adapter) : Esquisse (ESQ), Avant-Projet Sommaire (APS), Avant-Projet Détaillé (APD), Projet (PRO), Assistance aux Contrats de Travaux (ACT), Direction de l'Exécution des Contrats de Travaux (DET), Assistance aux Opérations de Réception (AOR).

{{description_mission}}

## Article 3 — Rémunération

Le montant des honoraires du Maître d'Œuvre est fixé à {{honoraires}} € HT, décomposé par élément de mission selon l'échéancier joint en annexe.

## Article 4 — Délais

{{delais}}

## Article 5 — Résiliation

Chaque partie peut résilier le présent contrat dans les conditions prévues par la loi et les usages de la profession, moyennant un préavis écrit et le règlement des prestations déjà exécutées.

## Fait à {{lieu_signature}}, le {{date_signature}}

Le Maître de l'Ouvrage                Le Maître d'Œuvre
`,
    variables: [
      { key: 'client_nom', label: 'Nom du client (MOA)', type: 'text', required: true },
      { key: 'client_adresse', label: 'Adresse du client', type: 'textarea' },
      { key: 'agence_nom', label: "Nom de l'agence (MOE)", type: 'text', required: true },
      { key: 'agence_adresse', label: "Adresse de l'agence", type: 'textarea' },
      { key: 'nom_operation', label: "Nom de l'opération", type: 'text', required: true },
      { key: 'adresse_operation', label: "Adresse de l'opération", type: 'textarea' },
      { key: 'type_contrat', label: 'Type de contrat', type: 'text', default_value: 'Marché privé de maîtrise d\'œuvre' },
      { key: 'description_mission', label: 'Détail de la mission', type: 'textarea' },
      { key: 'honoraires', label: 'Montant des honoraires (€ HT)', type: 'number' },
      { key: 'delais', label: 'Délais contractuels', type: 'textarea' },
      { key: 'lieu_signature', label: 'Lieu de signature', type: 'text' },
      { key: 'date_signature', label: 'Date de signature', type: 'date' },
    ],
  },
  {
    name: 'CCTP — squelette type',
    category: 'CCTP',
    description: 'Structure standard d\'un Cahier des Clauses Techniques Particulières.',
    content: DISCLAIMER + `# CAHIER DES CLAUSES TECHNIQUES PARTICULIÈRES (CCTP)

## Opération : {{nom_operation}}

## 1. Objet du CCTP

Le présent document a pour objet de définir les spécifications techniques applicables aux travaux de l'opération {{nom_operation}}, sise {{adresse_operation}}.

## 2. Prescriptions générales

{{prescriptions_generales}}

## 3. Décomposition par lots

{{liste_lots}}

## 4. Prescriptions particulières par lot

(Une section détaillée par lot — matériaux, mise en œuvre, tolérances, normes applicables — à développer ci-dessous pour chaque lot listé en section 3.)

## 5. Annexes

- Plans de référence
- Notices techniques des équipements prescrits
- Documents normatifs (DTU, normes NF/EN applicables)
`,
    variables: [
      { key: 'nom_operation', label: "Nom de l'opération", type: 'text', required: true },
      { key: 'adresse_operation', label: "Adresse de l'opération", type: 'textarea' },
      { key: 'prescriptions_generales', label: 'Prescriptions générales', type: 'textarea' },
      { key: 'liste_lots', label: 'Liste des lots', type: 'textarea' },
    ],
  },
  {
    name: 'DPGF — squelette type',
    category: 'DPGF',
    description: 'Structure standard d\'une Décomposition du Prix Global et Forfaitaire.',
    content: DISCLAIMER + `# DÉCOMPOSITION DU PRIX GLOBAL ET FORFAITAIRE (DPGF)

## Opération : {{nom_operation}}

## Lot : {{numero_lot}} — {{intitule_lot}}

| N° | Désignation des ouvrages | Unité | Quantité | Prix unitaire HT | Montant HT |
|---|---|---|---|---|---|
| 1 | {{poste_1}} |  |  |  |  |
| 2 | {{poste_2}} |  |  |  |  |
| 3 | {{poste_3}} |  |  |  |  |

**Total HT du lot : {{montant_total_lot}} €**

## Récapitulatif général

{{recapitulatif}}
`,
    variables: [
      { key: 'nom_operation', label: "Nom de l'opération", type: 'text', required: true },
      { key: 'numero_lot', label: 'Numéro du lot', type: 'text' },
      { key: 'intitule_lot', label: 'Intitulé du lot', type: 'text' },
      { key: 'poste_1', label: 'Poste 1', type: 'text' },
      { key: 'poste_2', label: 'Poste 2', type: 'text' },
      { key: 'poste_3', label: 'Poste 3', type: 'text' },
      { key: 'montant_total_lot', label: 'Montant total du lot (€ HT)', type: 'number' },
      { key: 'recapitulatif', label: 'Récapitulatif général', type: 'textarea' },
    ],
  },
  {
    name: 'Lettre de candidature (réponse à appel d\'offres)',
    category: 'Candidature',
    description: 'Lettre type de candidature à un appel d\'offres / consultation.',
    content: DISCLAIMER + `{{agence_nom}}
{{agence_adresse}}

{{lieu_signature}}, le {{date_signature}}

**Objet : Candidature — {{objet_marche}}**
**Référence de la consultation : {{reference_ao}}**

Madame, Monsieur,

Nous avons l'honneur de vous présenter notre candidature pour la consultation citée en objet, en qualité de {{qualite_mandataire}}.

## Présentation de l'équipe

{{presentation_equipe}}

## Références

{{references}}

## Moyens humains et matériels

{{moyens}}

Nous restons à votre disposition pour tout complément d'information et vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées.

{{signataire}}
`,
    variables: [
      { key: 'agence_nom', label: "Nom de l'agence", type: 'text', required: true },
      { key: 'agence_adresse', label: "Adresse de l'agence", type: 'textarea' },
      { key: 'objet_marche', label: 'Objet du marché', type: 'text', required: true },
      { key: 'reference_ao', label: "Référence de l'appel d'offres", type: 'text' },
      { key: 'qualite_mandataire', label: 'Qualité (mandataire, cotraitant...)', type: 'text', default_value: 'mandataire du groupement' },
      { key: 'presentation_equipe', label: "Présentation de l'équipe", type: 'textarea' },
      { key: 'references', label: 'Références', type: 'textarea' },
      { key: 'moyens', label: 'Moyens humains et matériels', type: 'textarea' },
      { key: 'signataire', label: 'Signataire', type: 'text' },
      { key: 'lieu_signature', label: 'Lieu', type: 'text' },
      { key: 'date_signature', label: 'Date', type: 'date' },
    ],
  },
  {
    name: 'Ordre de service — type',
    category: 'OS',
    description: "Modèle standard d'ordre de service (démarrage, arrêt, prolongation de délai...).",
    content: DISCLAIMER + `# ORDRE DE SERVICE N° {{numero_os}}

**Marché n° :** {{numero_marche}}
**Opération :** {{nom_operation}}
**Entreprise destinataire :** {{entreprise}}
**Lot :** {{lot}}

## Objet

{{objet}}

## Description

{{description}}

## Incidences sur les délais

{{incidences_delais}}

## Incidences sur le prix du marché

{{incidences_couts}}

Fait à {{lieu_signature}}, le {{date_signature}}

Le Maître d'Œuvre
`,
    variables: [
      { key: 'numero_os', label: "N° de l'ordre de service", type: 'text', required: true },
      { key: 'numero_marche', label: 'N° du marché', type: 'text' },
      { key: 'nom_operation', label: "Nom de l'opération", type: 'text', required: true },
      { key: 'entreprise', label: 'Entreprise destinataire', type: 'text', required: true },
      { key: 'lot', label: 'Lot', type: 'text' },
      { key: 'objet', label: "Objet de l'ordre de service", type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'incidences_delais', label: 'Incidences sur les délais', type: 'textarea', default_value: 'Sans incidence sur les délais contractuels.' },
      { key: 'incidences_couts', label: 'Incidences sur le prix du marché', type: 'textarea', default_value: 'Sans incidence sur le prix du marché.' },
      { key: 'lieu_signature', label: 'Lieu', type: 'text' },
      { key: 'date_signature', label: 'Date', type: 'date' },
    ],
  },
  {
    name: 'Courrier type',
    category: 'Courrier',
    description: 'Modèle générique de correspondance (en-tête, objet, corps, signature).',
    content: DISCLAIMER + `{{agence_nom}}
{{agence_adresse}}

À l'attention de {{destinataire}}
{{adresse_destinataire}}

{{lieu_signature}}, le {{date_signature}}

**Objet : {{objet_courrier}}**

Madame, Monsieur,

{{corps_courrier}}

Nous vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées.

{{signataire}}
`,
    variables: [
      { key: 'agence_nom', label: "Nom de l'agence", type: 'text', required: true },
      { key: 'agence_adresse', label: "Adresse de l'agence", type: 'textarea' },
      { key: 'destinataire', label: 'Destinataire', type: 'text' },
      { key: 'adresse_destinataire', label: 'Adresse du destinataire', type: 'textarea' },
      { key: 'objet_courrier', label: 'Objet du courrier', type: 'text', required: true },
      { key: 'corps_courrier', label: 'Corps du courrier', type: 'textarea', required: true },
      { key: 'signataire', label: 'Signataire', type: 'text' },
      { key: 'lieu_signature', label: 'Lieu', type: 'text' },
      { key: 'date_signature', label: 'Date', type: 'date' },
    ],
  },
];
