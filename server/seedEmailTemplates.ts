// Starter texts inserted into a tenant's `email_templates` table the first
// time it calls GET /api/email_templates for a `kind` it doesn't have a row
// for yet (see server/routes/emailTemplates.ts). Each `kind` matches one real
// email sent from the app (`src/pages/Invoices.tsx`, `src/pages/TenderDetail.tsx`)
// and reproduces the text that used to be hardcoded there, turned into
// {{placeholder}} tokens the app fills in automatically before sending —
// what's left around them is what the cabinet can personalize.

export interface SeedEmailTemplate {
  kind: 'invoice' | 'tender_solicitation' | 'tender_relance';
  subject: string;
  body: string;
}

export const SEED_EMAIL_TEMPLATES: SeedEmailTemplate[] = [
  {
    kind: 'invoice',
    subject: '{{type_facture}} N° {{numero}}{{reference_affaire}} – {{projet}}',
    body: `Bonjour,

Veuillez trouver ci-joint {{type_facture_minuscule}} N° {{numero}}{{reference_affaire}}.

{{missions}}Montant HT : {{montant_ht}}
Montant TTC : {{montant_ttc}}
Date d'échéance : {{echeance}}

Cordialement`,
  },
  {
    kind: 'tender_solicitation',
    subject: 'Consultation {{specialite}} — {{titre_ao}}',
    body: `Bonjour,

Nous sollicitons votre structure pour une mission de "{{specialite}}" dans le cadre de notre réponse à l'appel d'offres "{{titre_ao}}" ({{client_ao}}){{date_limite_clause}}.

Merci de nous indiquer votre disponibilité pour nous rejoindre sur ce groupement.

Cordialement,`,
  },
  {
    kind: 'tender_relance',
    subject: 'Relance — Consultation {{specialite}} — {{titre_ao}}',
    body: `Bonjour,

Nous revenons vers vous suite à notre sollicitation concernant la mission "{{specialite}}" dans le cadre de notre réponse à l'appel d'offres "{{titre_ao}}" ({{client_ao}}).

Merci de nous indiquer si vous êtes disponible pour nous rejoindre sur ce groupement.

Cordialement,`,
  },
];
