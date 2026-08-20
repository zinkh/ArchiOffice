// Subscription invoices for a tenant's own ArchiOffice payments
// (billing_events — plan subscriptions and AI credit top-ups), generated
// client-side following the same jsPDF/autoTable convention as
// src/lib/hrExport.ts. Distinct from src/components/InvoiceGenerator.tsx,
// which builds a tenant's OWN client-facing (Factur-X) invoices — this one
// is ArchiOffice-the-vendor billing the tenant, the mirror-image direction.
import { PLANS, formatPrice } from './billing';
import type { PlanId } from './billing';

// Placeholder — ArchiOffice's real registered company details (SIRET, VAT
// number, address) aren't recorded anywhere in this codebase yet (see
// axis-4 investigation). Replace before these are relied on as legally
// compliant invoices; have the exact mandatory mentions confirmed by an
// accountant (VAT treatment in particular depends on ArchiOffice's own
// registration status, which isn't something this code can know).
export const ARCHIOFFICE_ISSUER = {
  name: 'ArchiOffice SAS',
  address: '[Adresse à compléter], France',
  siret: '[SIRET à compléter]',
  vat: '[N° TVA à compléter]',
  email: 'contact@archioffice.fr',
};

export interface SubscriptionInvoiceEvent {
  id: string;
  event_type: string;
  plan_id: string | null;
  amount: number; // EUR cents
  created_at: string;
}

function invoiceNumber(evt: SubscriptionInvoiceEvent): string {
  const month = evt.created_at.slice(0, 7).replace('-', '');
  return `FA-${month}-${evt.id.slice(0, 8).toUpperCase()}`;
}

function describeEvent(evt: SubscriptionInvoiceEvent): string {
  if (evt.event_type.startsWith('credit_topup')) return 'Recharge de crédits IA';
  const plan = evt.plan_id ? PLANS[evt.plan_id as PlanId] : undefined;
  return plan ? `Abonnement ArchiOffice ${plan.name} — 1 mois` : (evt.plan_id || 'Abonnement ArchiOffice');
}

export async function exportSubscriptionInvoicePdf(evt: SubscriptionInvoiceEvent, tenantName: string): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const number = invoiceNumber(evt);
  const dateStr = new Date(evt.created_at).toLocaleDateString('fr-FR');

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(ARCHIOFFICE_ISSUER.name, 14, 16);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(107, 114, 128);
  doc.text(ARCHIOFFICE_ISSUER.address, 14, 21);
  doc.text(`SIRET ${ARCHIOFFICE_ISSUER.siret} — TVA ${ARCHIOFFICE_ISSUER.vat}`, 14, 25);
  doc.setTextColor(0, 0, 0);

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Facture', 196, 16, { align: 'right' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(107, 114, 128);
  doc.text(`N° ${number}`, 196, 22, { align: 'right' });
  doc.text(`Date : ${dateStr}`, 196, 26, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Facturé à', 14, 40);
  doc.setFont('helvetica', 'normal');
  doc.text(tenantName, 14, 45);

  autoTable(doc, {
    startY: 55,
    head: [['Description', 'Montant TTC']],
    body: [[describeEvent(evt), formatPrice(evt.amount)]],
    headStyles: { fillColor: [30, 80, 140], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    foot: [['Total', formatPrice(evt.amount)]],
    footStyles: { fillColor: [30, 80, 140], textColor: 255, fontStyle: 'bold' },
  });

  const finalY = (doc as any).lastAutoTable?.finalY ?? 70;
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.text(`Réglé par carte bancaire via Stancer le ${dateStr}.`, 14, finalY + 10);

  doc.save(`${number}.pdf`);
}
