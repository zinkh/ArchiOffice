// Trésorerie d'un ensemble de factures (une équipe, ou les affaires d'un chef
// de projet). Même lecture que le tableau de bord administrateur : tout se
// calcule sur les factures ÉMISES, jamais sur les brouillons.

import { invoiceTotal, isIssued, isOverdue, isPaid, monthlyRevenue, type InvoiceLike } from './dashboardMetrics';

export interface Treasury {
  paid: number;
  receivable: number;
  unpaidCount: number;
  overdueCount: number;
  overdueAmount: number;
  paidThisMonth: number;
}

export function computeTreasury(invoices: InvoiceLike[], now = new Date()): Treasury {
  const issued = invoices.filter(isIssued);
  const paid = issued.filter(isPaid).reduce((sum, inv) => sum + invoiceTotal(inv), 0);
  const invoiced = issued.reduce((sum, inv) => sum + invoiceTotal(inv), 0);
  const overdue = issued.filter(isOverdue);
  const series = monthlyRevenue(invoices, now);
  return {
    paid,
    receivable: invoiced - paid,
    unpaidCount: issued.filter(inv => !isPaid(inv)).length,
    overdueCount: overdue.length,
    overdueAmount: overdue.reduce((sum, inv) => sum + invoiceTotal(inv), 0),
    paidThisMonth: series[series.length - 1]?.paid ?? 0,
  };
}
