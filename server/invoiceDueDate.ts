// Délai de paiement par défaut d'une facture — centralisé ici pour que
// POST /api/invoices et POST /api/notes_honoraires/:id/facture (les deux
// points de création qui peuvent laisser due_date vide) calculent la même
// échéance à partir du même réglage cabinet, plutôt que de tomber sur
// due_date: null (affiché comme "01/01/1970" faute de garde côté écran).
export const DEFAULT_INVOICE_PAYMENT_TERMS_DAYS = 30;

export function computeInvoiceDueDate(issueDate: string | null | undefined, paymentTermsDays: number | null | undefined): string {
  const days = Number.isFinite(paymentTermsDays) && (paymentTermsDays as number) >= 0
    ? (paymentTermsDays as number)
    : DEFAULT_INVOICE_PAYMENT_TERMS_DAYS;
  const base = issueDate ? new Date(issueDate) : new Date();
  if (Number.isNaN(base.getTime())) return computeInvoiceDueDate(null, days);
  base.setDate(base.getDate() + days);
  return base.toISOString().split('T')[0];
}

export async function resolveInvoicePaymentTermsDays(supabaseAdmin: any, tenantId: string): Promise<number> {
  const { data } = await supabaseAdmin.from('settings').select('invoice_payment_terms_days').eq('tenant_id', tenantId).maybeSingle();
  const v = (data as any)?.invoice_payment_terms_days;
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_INVOICE_PAYMENT_TERMS_DAYS;
}
