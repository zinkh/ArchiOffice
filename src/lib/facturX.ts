// Shared Factur-X / EN 16931 invoice mapping — the single source of truth for
// turning ArchiOffice's invoice model into the two representations the app
// actually needs:
//   - buildFacturXCiiXml(): a self-contained CII XML string, downloaded
//     alongside the PDF export (InvoiceGenerator.tsx) so a tenant always has
//     a structured-data copy on hand, independent of any e-invoicing platform.
//   - buildEnInvoiceData(): an EN16931 JSON object fed to SuperPDP's
//     `/v1.beta/invoices/convert?from=en16931&to=cii` endpoint when actually
//     transmitting an invoice (server.ts's /api/superpdp/send/:invoiceId).
// These used to be two independent, hand-rolled implementations (one in
// InvoiceGenerator.tsx, one in server.ts) that could silently drift apart —
// e.g. a VAT-rate rounding tweak made in one and forgotten in the other,
// invisible until a client or SuperPDP itself rejects an invoice. Both now
// derive from the same FacturXInvoiceData shape and the same computeTotals()
// helper, so a change to invoice math only has one place to go wrong.
//
// Caveat (see the engineering-maturity plan, Phase 3): this module is
// unit-tested for structural/mapping correctness (tests/facturX.test.ts), but
// has NOT been validated against the real EN16931/Factur-X XSD or a
// PDP-accepted sample — this sandbox has no network access to fetch the
// schema. Treat the XML/JSON shape as "matches the pre-existing
// implementations' intent," not as a certified-compliant guarantee.

export interface FacturXLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
}

export interface FacturXParty {
  name: string;
  address?: string;
  siret?: string;
  vatNumber?: string;
  email?: string;
}

export interface FacturXInvoiceData {
  invoiceNumber: string;
  /** 'acompte' → CII TypeCode 386 (deposit invoice); anything else → 380 (standard). */
  invoiceType?: 'standard' | 'acompte';
  issueDate: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD
  currency?: string; // default EUR
  /** Header-level VAT rate (ApplicableTradeTax / vat_break_down) — the app currently supports one rate per invoice. */
  vatRate: number;
  items: FacturXLineItem[];
  /** Used as the single line's name when items is empty — buildEnInvoiceData() only. */
  description?: string;
  seller: FacturXParty & { iban?: string; bic?: string };
  buyer: FacturXParty;
  /**
   * Overrides computeFacturXTotals(items) when given. The server passes the
   * invoice's own stored amount/tax_amount/total_amount here (its source of
   * truth — e.g. an acompte invoice bills a percentage of a mission, not
   * necessarily the sum of its display line items), while the client leaves
   * this unset so totals stay live-computed from the items being edited.
   */
  totals?: FacturXTotals;
}

export interface FacturXTotals {
  net: number;
  vat: number;
  gross: number;
}

export function computeFacturXTotals(items: FacturXLineItem[]): FacturXTotals {
  const net = items.reduce((acc, item) => acc + item.quantity * item.unitPrice, 0);
  const vat = items.reduce((acc, item) => acc + item.quantity * item.unitPrice * (item.vatRate / 100), 0);
  return { net, vat, gross: net + vat };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Self-contained Cross Industry Invoice XML (EN 16931 — Factur-X Basic profile). */
export function buildFacturXCiiXml(data: FacturXInvoiceData): string {
  const { net, vat, gross } = data.totals ?? computeFacturXTotals(data.items);
  const currency = data.currency || 'EUR';
  const sellerName = data.seller.name || 'Architecte';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${escapeXml(data.invoiceNumber)}</ram:ID>
    <ram:TypeCode>${data.invoiceType === 'acompte' ? '386' : '380'}</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${data.issueDate.replace(/-/g, '')}</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTransaction>
    ${data.items.map((item, idx) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${idx + 1}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${escapeXml(item.description)}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${item.unitPrice.toFixed(2)}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="HUR">${item.quantity}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>S</ram:CategoryCode>
          <ram:RateApplicablePercent>${item.vatRate}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${(item.quantity * item.unitPrice).toFixed(2)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`).join('')}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${escapeXml(sellerName)}</ram:Name>
        <ram:SpecifiedLegalOrganization>
          <ram:ID schemeID="0002">${escapeXml((data.seller.siret || '').replace(/\s/g, ''))}</ram:ID>
        </ram:SpecifiedLegalOrganization>
        <ram:PostalTradeAddress>
          <ram:LineOne>${escapeXml(data.seller.address || '')}</ram:LineOne>
          <ram:CountryID>FR</ram:CountryID>
        </ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${escapeXml((data.seller.vatNumber || '').replace(/\s/g, ''))}</ram:ID>
        </ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${escapeXml(data.buyer.name || 'Client')}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:LineOne>${escapeXml(data.buyer.address || '')}</ram:LineOne>
          <ram:CountryID>FR</ram:CountryID>
        </ram:PostalTradeAddress>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${currency}</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>30</ram:TypeCode>
        <ram:PayeePartyCredential>
          <ram:IBANID>${escapeXml((data.seller.iban || '').replace(/\s/g, ''))}</ram:IBANID>
        </ram:PayeePartyCredential>
      </ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:ApplicableTradeTax>
        <ram:BasisAmount>${net.toFixed(2)}</ram:BasisAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>${data.vatRate}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">${(data.dueDate || '').replace(/-/g, '')}</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${net.toFixed(2)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${net.toFixed(2)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${currency}">${vat.toFixed(2)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${gross.toFixed(2)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${gross.toFixed(2)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTransaction>
</rsm:CrossIndustryInvoice>`;
}

export interface EnInvoiceJson {
  number: string;
  issue_date: string;
  type_code: string;
  currency_code: string;
  process_control: { specification_identifier: string };
  payment_due_date?: string;
  seller: {
    name: string;
    electronic_address: { value: string; scheme: string };
    postal_address: { address_line1: string; country_code: string };
    vat_identifier?: string;
    legal_registration_identifier?: { value: string; scheme: string };
  };
  buyer: { name: string; postal_address: { country_code: string } };
  totals: {
    sum_invoice_lines_amount: string;
    total_without_vat: string;
    total_vat_amount: { value: string };
    total_with_vat: string;
    amount_due_for_payment: string;
  };
  vat_break_down: Array<{
    vat_category_code: string;
    vat_category_rate: string;
    vat_category_taxable_amount: string;
    vat_category_tax_amount: string;
  }>;
  lines: Array<{
    identifier: string;
    invoiced_quantity: string;
    invoiced_quantity_code: string;
    net_amount: string;
    item_information: { name: string };
    price_details: { item_net_price: string };
    vat_information: { vat_category_code: string; vat_category_rate: string };
  }>;
}

/** EN16931 JSON payload for SuperPDP's `from=en16931&to=cii` conversion endpoint. */
export function buildEnInvoiceData(data: FacturXInvoiceData): EnInvoiceJson {
  const { net, vat, gross } = data.totals ?? computeFacturXTotals(data.items);
  const sellerName = data.seller.name || 'Architecte';
  const sellerEmail = data.seller.email || '';

  const lines = data.items.length > 0 ? data.items.map((item, idx) => ({
    identifier: String(idx + 1),
    invoiced_quantity: String(item.quantity),
    invoiced_quantity_code: 'C62',
    net_amount: (item.quantity * item.unitPrice).toFixed(2),
    item_information: { name: item.description || 'Prestation' },
    price_details: { item_net_price: item.unitPrice.toFixed(2) },
    vat_information: { vat_category_code: 'S', vat_category_rate: String(item.vatRate) },
  })) : [{
    identifier: '1',
    invoiced_quantity: '1',
    invoiced_quantity_code: 'C62',
    net_amount: net.toFixed(2),
    item_information: { name: data.description || 'Honoraires d\'architecture' },
    price_details: { item_net_price: net.toFixed(2) },
    vat_information: { vat_category_code: 'S', vat_category_rate: String(data.vatRate) },
  }];

  return {
    number: data.invoiceNumber,
    issue_date: data.issueDate,
    type_code: data.invoiceType === 'acompte' ? '386' : '380',
    currency_code: data.currency || 'EUR',
    process_control: { specification_identifier: 'urn:cen.eu:en16931:2017' },
    payment_due_date: data.dueDate || undefined,
    seller: {
      name: sellerName,
      electronic_address: { value: sellerEmail || 'contact@cabinet.fr', scheme: 'EM' },
      postal_address: { address_line1: data.seller.address || '', country_code: 'FR' },
      ...(data.seller.vatNumber ? { vat_identifier: data.seller.vatNumber } : {}),
      ...(data.seller.siret ? { legal_registration_identifier: { value: data.seller.siret, scheme: '0002' } } : {}),
    },
    buyer: {
      name: data.buyer.name || 'Client',
      postal_address: { country_code: 'FR' },
    },
    totals: {
      sum_invoice_lines_amount: net.toFixed(2),
      total_without_vat: net.toFixed(2),
      total_vat_amount: { value: vat.toFixed(2) },
      total_with_vat: gross.toFixed(2),
      amount_due_for_payment: gross.toFixed(2),
    },
    vat_break_down: [{
      vat_category_code: 'S',
      vat_category_rate: String(data.vatRate),
      vat_category_taxable_amount: net.toFixed(2),
      vat_category_tax_amount: vat.toFixed(2),
    }],
    lines,
  };
}
