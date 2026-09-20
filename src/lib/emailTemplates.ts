// Client-side helpers for the customizable email templates (Réglages >
// Communication). The {{key}} substitution reuses fillTemplate() from
// templateExport.ts — same engine as document_templates, so a cabinet only
// ever learns one placeholder syntax across the app.
import { apiFetch } from './api';
import { fillTemplate } from './templateExport';
import type { EmailTemplate, EmailTemplateKind } from '../types';

export { fillTemplate };

export interface EmailTemplatePlaceholder {
  key: string;
  label: string;
}

export interface EmailTemplateKindInfo {
  kind: EmailTemplateKind;
  label: string;
  description: string;
  placeholders: EmailTemplatePlaceholder[];
}

// Kept in sync by hand with SEED_EMAIL_TEMPLATES (server/seedEmailTemplates.ts)
// and with each kind's real call site — same rationale as DOCUMENT_RESOURCE_TYPES's
// duplication documented in CLAUDE.md: no shared module between src/ and server/.
export const EMAIL_TEMPLATE_KIND_INFO: EmailTemplateKindInfo[] = [
  {
    kind: 'invoice',
    label: 'Envoi d\'une facture',
    description: "Utilisé quand une facture est envoyée par e-mail au client depuis la page Factures.",
    placeholders: [
      { key: 'type_facture', label: 'Type de facture (« Facture » ou « Facture d\'acompte »)' },
      { key: 'type_facture_minuscule', label: 'Type de facture en minuscules (« la facture » ou « la facture d\'acompte »)' },
      { key: 'numero', label: 'Numéro de la facture' },
      { key: 'reference_affaire', label: 'Référence affaire (déjà formatée, ou vide)' },
      { key: 'projet', label: "Nom de l'affaire" },
      { key: 'missions', label: 'Phases facturées avec leur avancement (déjà formatées, ou vide)' },
      { key: 'montant_ht', label: 'Montant HT' },
      { key: 'montant_ttc', label: 'Montant TTC' },
      { key: 'echeance', label: "Date d'échéance" },
    ],
  },
  {
    kind: 'tender_solicitation',
    label: "Sollicitation d'un co-traitant (appel d'offres)",
    description: "Utilisé pour solliciter une entreprise ou un co-traitant sur un appel d'offres, depuis la fiche de l'appel d'offres.",
    placeholders: [
      { key: 'specialite', label: 'Spécialité recherchée' },
      { key: 'titre_ao', label: "Titre de l'appel d'offres" },
      { key: 'client_ao', label: "Maître d'ouvrage de l'appel d'offres" },
      { key: 'date_limite_clause', label: 'Membre de phrase avec la date limite de remise (déjà formaté, ou vide)' },
    ],
  },
  {
    kind: 'tender_relance',
    label: "Relance d'une sollicitation (appel d'offres)",
    description: "Utilisé pour relancer une entreprise ou un co-traitant n'ayant pas répondu à une sollicitation.",
    placeholders: [
      { key: 'specialite', label: 'Spécialité recherchée' },
      { key: 'titre_ao', label: "Titre de l'appel d'offres" },
      { key: 'client_ao', label: "Maître d'ouvrage de l'appel d'offres" },
    ],
  },
];

export async function fetchEmailTemplates(): Promise<EmailTemplate[]> {
  return apiFetch<EmailTemplate[]>('/api/email_templates');
}

// Used by each real sending flow (Invoices.tsx, TenderDetail.tsx) to prefill
// subject/body before the user reviews and sends — best-effort: a cabinet
// that hasn't loaded Settings yet still gets its seeded template via the
// same GET, which auto-seeds server-side.
export async function fetchEmailTemplate(kind: EmailTemplateKind): Promise<EmailTemplate | null> {
  const all = await fetchEmailTemplates();
  return all.find(t => t.kind === kind) || null;
}
