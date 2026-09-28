// Catalogue fermé des évènements pouvant déclencher un webhook sortant.
// Ajouter un évènement : une entrée ici + un appel à dispatchWebhookEvent()
// au point de code concerné (server/webhookDispatch.ts) — aucune migration
// SQL requise, event_types est un TEXT[] libre.
export interface WebhookEventType {
  code: string;
  category: 'facturation' | 'projets' | 'chantier' | 'ao_devis';
  label: string;
}

export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  { code: 'invoice.created', category: 'facturation', label: 'Facture créée' },
  { code: 'invoice.paid', category: 'facturation', label: 'Facture payée' },
  { code: 'invoice.overdue', category: 'facturation', label: 'Facture échue' },
  { code: 'project.created', category: 'projets', label: 'Nouveau projet créé' },
  { code: 'project.phase_changed', category: 'projets', label: 'Changement de phase' },
  { code: 'meeting.created', category: 'chantier', label: 'Réunion de chantier créée' },
  { code: 'reserve.resolved', category: 'chantier', label: 'Réserve levée' },
  { code: 'ordre_service.created', category: 'chantier', label: 'Ordre de service émis' },
  { code: 'proposal.accepted', category: 'ao_devis', label: 'Devis accepté' },
  { code: 'proposal.declined', category: 'ao_devis', label: 'Devis refusé' },
  { code: 'tender.created', category: 'ao_devis', label: "Nouvel appel d'offres" },
];

export const WEBHOOK_EVENT_CODES = new Set(WEBHOOK_EVENT_TYPES.map(e => e.code));
