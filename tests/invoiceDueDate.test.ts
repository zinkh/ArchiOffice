import { describe, expect, it } from 'vitest';
import { computeInvoiceDueDate, resolveInvoicePaymentTermsDays, DEFAULT_INVOICE_PAYMENT_TERMS_DAYS } from '../server/invoiceDueDate';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';

describe('computeInvoiceDueDate', () => {
  it('adds the given number of days to the issue date', () => {
    expect(computeInvoiceDueDate('2026-01-01', 30)).toBe('2026-01-31');
    expect(computeInvoiceDueDate('2026-01-01', 14)).toBe('2026-01-15');
    expect(computeInvoiceDueDate('2026-01-01', 0)).toBe('2026-01-01');
  });

  it('falls back to the 30-day default when no term is given', () => {
    expect(computeInvoiceDueDate('2026-01-01', undefined)).toBe('2026-01-31');
    expect(computeInvoiceDueDate('2026-01-01', null)).toBe('2026-01-31');
    expect(computeInvoiceDueDate('2026-01-01', -5)).toBe('2026-01-31');
  });

  it('never returns the 1970 epoch for a missing/invalid issue date', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(computeInvoiceDueDate(null, 30)).not.toBe('1970-01-31');
    expect(computeInvoiceDueDate(undefined, 0)).toBe(today);
    expect(computeInvoiceDueDate('not-a-date', 0)).toBe(today);
  });
});

describe('resolveInvoicePaymentTermsDays', () => {
  it('reads the tenant-configured term from settings', async () => {
    const db = new FakeSupabaseAdmin();
    db.seed('settings', [{ id: 's1', tenant_id: 'tenant-a', invoice_payment_terms_days: 45 }]);
    await expect(resolveInvoicePaymentTermsDays(db, 'tenant-a')).resolves.toBe(45);
  });

  it('falls back to the default when unset', async () => {
    const db = new FakeSupabaseAdmin();
    db.seed('settings', [{ id: 's1', tenant_id: 'tenant-a', invoice_payment_terms_days: null }]);
    await expect(resolveInvoicePaymentTermsDays(db, 'tenant-a')).resolves.toBe(DEFAULT_INVOICE_PAYMENT_TERMS_DAYS);
  });

  it('falls back to the default when the tenant has no settings row at all', async () => {
    const db = new FakeSupabaseAdmin();
    await expect(resolveInvoicePaymentTermsDays(db, 'tenant-none')).resolves.toBe(DEFAULT_INVOICE_PAYMENT_TERMS_DAYS);
  });
});
