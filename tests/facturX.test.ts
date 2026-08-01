// Golden-file / structural tests for src/lib/facturX.ts — the module that
// replaced two independent Factur-X/EN16931 implementations (one in
// InvoiceGenerator.tsx, one in server.ts) that could silently drift apart.
//
// Caveat carried over from the plan (Phase 3): these fixtures were NOT
// validated against the real EN16931/Factur-X XSD or a PDP-accepted sample —
// this sandbox has no network access to fetch either. They pin the *current*
// mapping behavior (useful for catching accidental regressions) but are not
// proof of legal compliance. A human should validate at least one fixture
// against the real schema or a SuperPDP sandbox response before relying on
// this for production invoicing.
import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import {
  buildFacturXCiiXml,
  buildEnInvoiceData,
  computeFacturXTotals,
  type FacturXInvoiceData,
} from '../src/lib/facturX';

const baseSeller = {
  name: 'Atelier Test Architecture',
  address: '12 rue de la Paix, 75002 Paris',
  siret: '123 456 789 00012',
  vatNumber: 'FR12345678900',
  email: 'contact@atelier-test.fr',
  iban: 'FR76 3000 6000 0112 3456 7890 189',
  bic: 'AGRIFRPP',
};

const baseBuyer = { name: 'Client Dupont', address: '5 avenue Foch, 75116 Paris' };

function standardInvoice(overrides: Partial<FacturXInvoiceData> = {}): FacturXInvoiceData {
  return {
    invoiceNumber: 'FAC-2026-001',
    invoiceType: 'standard',
    issueDate: '2026-02-01',
    dueDate: '2026-03-03',
    currency: 'EUR',
    vatRate: 20,
    items: [{ description: 'Honoraires de maîtrise d\'œuvre — phase APS', quantity: 1, unitPrice: 5000, vatRate: 20 }],
    seller: baseSeller,
    buyer: baseBuyer,
    ...overrides,
  };
}

describe('computeFacturXTotals', () => {
  it('sums net/vat/gross across multiple lines with different VAT rates', () => {
    const totals = computeFacturXTotals([
      { description: 'A', quantity: 2, unitPrice: 100, vatRate: 20 },
      { description: 'B', quantity: 1, unitPrice: 50, vatRate: 10 },
    ]);
    expect(totals.net).toBe(250);
    expect(totals.vat).toBeCloseTo(45, 5); // 200*0.20 + 50*0.10
    expect(totals.gross).toBeCloseTo(295, 5);
  });
});

describe('buildFacturXCiiXml', () => {
  it('standard invoice — matches the golden fixture', async () => {
    const xml = buildFacturXCiiXml(standardInvoice());
    await expect(xml).toMatchFileSnapshot('fixtures/facturx/standard.xml');
  });

  it('acompte invoice uses CII TypeCode 386, not 380', async () => {
    const xml = buildFacturXCiiXml(standardInvoice({
      invoiceNumber: 'ACO-2026-001',
      invoiceType: 'acompte',
      items: [{ description: 'Acompte 30% — mission complète', quantity: 1, unitPrice: 3000, vatRate: 20 }],
    }));
    expect(xml).toContain('<ram:TypeCode>386</ram:TypeCode>');
    await expect(xml).toMatchFileSnapshot('fixtures/facturx/acompte.xml');
  });

  it('multi-line invoice with mixed VAT rates — matches the golden fixture', async () => {
    const xml = buildFacturXCiiXml(standardInvoice({
      invoiceNumber: 'FAC-2026-002',
      items: [
        { description: 'Mission de base', quantity: 1, unitPrice: 8000, vatRate: 20 },
        { description: 'Étude géotechnique (exonérée)', quantity: 1, unitPrice: 1500, vatRate: 0 },
        { description: 'Déplacements', quantity: 4, unitPrice: 50, vatRate: 10 },
      ],
    }));
    await expect(xml).toMatchFileSnapshot('fixtures/facturx/multi-line-mixed-vat.xml');
  });

  it('produces well-formed XML that round-trips through a parser', () => {
    const xml = buildFacturXCiiXml(standardInvoice());
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml);
    expect(parsed['rsm:CrossIndustryInvoice']).toBeDefined();
    expect(parsed['rsm:CrossIndustryInvoice']['rsm:ExchangedDocument']['ram:ID']).toBe('FAC-2026-001');
  });

  it('escapes XML-special characters in free-text fields instead of producing invalid XML', () => {
    const xml = buildFacturXCiiXml(standardInvoice({
      items: [{ description: 'Études & relevés <site> "confidentiel"', quantity: 1, unitPrice: 100, vatRate: 20 }],
    }));
    expect(xml).toContain('Études &amp; relevés &lt;site&gt; &quot;confidentiel&quot;');
    // Must still parse cleanly — an unescaped `&` or `<` here would break the document.
    const parser = new XMLParser({ ignoreAttributes: false });
    expect(() => parser.parse(xml)).not.toThrow();
  });
});

describe('buildEnInvoiceData', () => {
  it('standard invoice — matches the golden fixture', () => {
    const json = buildEnInvoiceData(standardInvoice());
    expect(json).toMatchSnapshot();
  });

  it('uses the invoice-level totals override instead of recomputing from items (acompte billing)', () => {
    // An acompte invoice bills 30% of a mission — its line items describe the
    // full mission for context, but the invoice's own amount/tax/total are
    // authoritative. This is the exact divergence server.ts's original
    // buildEnInvoice() relied on; the merge must not silently start
    // recomputing totals from the (larger) item list instead.
    const json = buildEnInvoiceData(standardInvoice({
      items: [{ description: 'Mission complète (référence)', quantity: 1, unitPrice: 10000, vatRate: 20 }],
      totals: { net: 3000, vat: 600, gross: 3600 },
    }));
    expect(json.totals.total_without_vat).toBe('3000.00');
    expect(json.totals.total_vat_amount.value).toBe('600.00');
    expect(json.totals.total_with_vat).toBe('3600.00');
    expect(json.vat_break_down[0].vat_category_taxable_amount).toBe('3000.00');
  });

  it('falls back to the invoice description for the single line when items is empty', () => {
    const json = buildEnInvoiceData(standardInvoice({ items: [], description: 'Honoraires — solde de mission' }));
    expect(json.lines).toHaveLength(1);
    expect(json.lines[0].item_information.name).toBe('Honoraires — solde de mission');
  });

  it('falls back to a generic line name when items is empty and no description is given', () => {
    const json = buildEnInvoiceData(standardInvoice({ items: [] }));
    expect(json.lines[0].item_information.name).toBe('Honoraires d\'architecture');
  });

  it('omits seller VAT/SIRET identifiers when not provided, rather than emitting empty ones', () => {
    const json = buildEnInvoiceData(standardInvoice({ seller: { name: 'Atelier Sans SIRET' } }));
    expect(json.seller.vat_identifier).toBeUndefined();
    expect(json.seller.legal_registration_identifier).toBeUndefined();
  });
});
