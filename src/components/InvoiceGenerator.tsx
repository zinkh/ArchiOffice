import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { IconX, IconEye, IconEdit, IconDownload, IconPlus, IconTrash, IconDeviceFloppy } from '@tabler/icons-react';
import { motion } from 'motion/react';
import jsPDF from 'jspdf';
import { formatCurrency } from '../lib/utils';
import type { Invoice, Project, InvoiceItem } from '../types';
import { autoSaveDocument } from '../lib/autoSaveDocument';

interface InvoiceGeneratorProps {
  onClose: () => void;
  onSave?: (updatedInvoice: Invoice) => void;
  initialData?: Partial<Invoice>;
  project?: Project;
}

export function InvoiceGenerator({ onClose, onSave, initialData, project }: InvoiceGeneratorProps) {
  const [data, setData] = useState<Partial<Invoice>>({
    invoice_number: `F${new Date().getFullYear()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
    issue_date: new Date().toISOString().split('T')[0],
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    vat_rate: 20,
    seller_name: '',
    seller_address: '',
    seller_siret: '',
    seller_vat_number: '',
    seller_iban: '',
    seller_bic: '',
    currency: 'EUR',
    items: [
      { id: '1', description: initialData?.description || 'Prestations architecturales', quantity: 1, unit_price: initialData?.amount || 0, vat_rate: 20 }
    ],
    ...initialData
  });

  useEffect(() => {
    // Fetch global settings for seller info
    fetch('/api/settings')
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(settings => {
        if (settings && !settings.error) {
          setData(prev => ({
            ...prev,
            seller_name: settings.agencyName || prev.seller_name,
            seller_address: settings.address || prev.seller_address,
            seller_siret: settings.siret || prev.seller_siret,
            seller_vat_number: settings.vatNumber || prev.seller_vat_number,
            seller_iban: settings.seller_iban || prev.seller_iban,
            seller_bic: settings.seller_bic || prev.seller_bic,
            currency: settings.currency || prev.currency
          }));
        }
      })
      .catch(() => {});
  }, []);

  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const calculateTotals = () => {
    const net = data.items?.reduce((acc, item) => acc + (item.quantity * item.unit_price), 0) || 0;
    const vat = data.items?.reduce((acc, item) => acc + (item.quantity * item.unit_price * (item.vat_rate / 100)), 0) || 0;
    return { net, vat, gross: net + vat };
  };

  const { net, vat, gross } = calculateTotals();

  const generateFacturXXML = () => {
    // Basic Factur-X XML (EN 16931 - Basic Profile)
    return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${data.invoice_number}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${data.issue_date?.replace(/-/g, '')}</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTransaction>
    ${data.items?.map((item, idx) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${idx + 1}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${item.description}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${item.unit_price.toFixed(2)}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="HUR">${item.quantity}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>S</ram:CategoryCode>
          <ram:RateApplicablePercent>${item.vat_rate}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${(item.quantity * item.unit_price).toFixed(2)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`).join('')}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${data.seller_name || 'KHALDOUN SEKTAOUI ARCHITECTE'}</ram:Name>
        <ram:SpecifiedLegalOrganization>
          <ram:ID schemeID="0002">${data.seller_siret?.replace(/\s/g, '')}</ram:ID>
        </ram:SpecifiedLegalOrganization>
        <ram:PostalTradeAddress>
          <ram:LineOne>${data.seller_address || ''}</ram:LineOne>
          <ram:CountryID>FR</ram:CountryID>
        </ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${data.seller_vat_number?.replace(/\s/g, '')}</ram:ID>
        </ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${project?.client || 'Client'}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:LineOne>${project?.address || ''}</ram:LineOne>
          <ram:CountryID>FR</ram:CountryID>
        </ram:PostalTradeAddress>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${data.currency || 'EUR'}</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>30</ram:TypeCode>
        <ram:PayeePartyCredential>
          <ram:IBANID>${data.seller_iban?.replace(/\s/g, '')}</ram:IBANID>
        </ram:PayeePartyCredential>
      </ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:ApplicableTradeTax>
        <ram:BasisAmount>${net.toFixed(2)}</ram:BasisAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>${data.vat_rate}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">${data.due_date?.replace(/-/g, '')}</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${net.toFixed(2)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${net.toFixed(2)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${data.currency || 'EUR'}">${vat.toFixed(2)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${gross.toFixed(2)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${gross.toFixed(2)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTransaction>
</rsm:CrossIndustryInvoice>`;
  };

  const handleSave = async () => {
    if (!data.id) return;
    setIsSaving(true);
    try {
      const { net, vat, gross } = calculateTotals();
      const payload = {
        ...data,
        amount: net,
        tax_amount: vat,
        total_amount: gross
      };
      
      const res = await fetch(`/api/invoices/${data.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        const updated = await res.json();
        onSave?.(updated);
        alert('Facture enregistrée avec succès.');
      }
    } catch (err) {
      console.error(err);
      alert('Erreur lors de l\'enregistrement.');
    } finally {
      setIsSaving(false);
    }
  };

  const exportPDF = async () => {
    if (!previewRef.current) return;
    setIsGenerating(true);
    
    // Hide icons before generation to prevent html2canvas errors
    const icons = previewRef.current.querySelectorAll('svg');
    icons.forEach(icon => icon.style.display = 'none');
    
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      
      const page = previewRef.current.querySelector('.pdf-page') as HTMLElement;
      
      await pdf.html(page, {
        x: 0,
        y: 0,
        width: pdfWidth,
        windowWidth: page.scrollWidth,
        margin: [10, 10, 10, 10],
        autoPaging: true
      });
      
      // Note: Full Factur-X PDF/A-3 embedding is complex in browser.
      // We provide the XML as a separate download for now to ensure compliance with structured data requirement.
      const filename = `Facture_${data.invoice_number}.pdf`;
      pdf.save(filename);

      // Auto-save to Documents module
      const pdfBlob = pdf.output('blob');
      autoSaveDocument({
        blob: pdfBlob,
        filename,
        name: `Facture ${data.invoice_number}`,
        projectId: project?.id,
        phase: 'Général',
        category: 'Contract',
      });

      // Also download the XML
      const xml = generateFacturXXML();
      const blob = new Blob([xml], { type: 'text/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `factur-x.xml`;
      a.click();
      URL.revokeObjectURL(url);

    } catch (err) {
      console.error('PDF Generation Error:', err);
      alert('Erreur lors de la génération de la facture.');
    } finally {
      // Restore icons
      icons.forEach(icon => icon.style.display = '');
      setIsGenerating(false);
    }
  };

  const addItem = () => {
    const newItem: InvoiceItem = {
      id: Math.random().toString(36).substr(2, 9),
      description: '',
      quantity: 1,
      unit_price: 0,
      vat_rate: data.vat_rate || 20
    };
    setData({ ...data, items: [...(data.items || []), newItem] });
  };

  const removeItem = (id: string) => {
    setData({ ...data, items: data.items?.filter(i => i.id !== id) });
  };

  const updateItem = (id: string, field: keyof InvoiceItem, value: any) => {
    setData({
      ...data,
      items: data.items?.map(i => i.id === id ? { ...i, [field]: value } : i)
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden border border-zinc-200 dark:border-zinc-800"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Générateur de Facture (Factur-X Ready)</h2>
            <div className="flex bg-zinc-200 dark:bg-zinc-800 p-1 rounded-lg">
              <button 
                onClick={() => setView('edit')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${view === 'edit' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
              >
                <IconEdit size={16} />
                Édition
              </button>
              <button 
                onClick={() => setView('preview')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${view === 'preview' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
              >
                <IconEye size={16} />
                Aperçu
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-bold shadow-lg shadow-blue-500/20 transition-all active:scale-95"
            >
              {isSaving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <IconDeviceFloppy size={18} />
              )}
              {isSaving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
            <button 
              onClick={exportPDF}
              disabled={isGenerating}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-lg text-sm font-bold shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
            >
              {isGenerating ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <IconDownload size={18} />
              )}
              {isGenerating ? 'Génération...' : 'Exporter (Factur-X)'}
            </button>
            <button onClick={onClose} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 rounded-full transition-colors">
              <IconX size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-zinc-100 dark:bg-zinc-950 relative">
          <div className={view === 'preview' ? "flex flex-col items-center py-8 min-h-full" : "fixed -left-[9999px] top-0"}>
            <div ref={previewRef}>
              <div className="pdf-page bg-white text-black w-[210mm] h-[297mm] p-[20mm] shadow-xl font-sans text-[10pt] leading-relaxed flex flex-col" style={{ fontFamily: 'Inter, sans-serif' }}>
                {/* Header */}
                <div className="flex justify-between items-start mb-12">
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight">{data.seller_name || 'KHALDOUN SEKTAOUI'}</h1>
                    <p className="text-sm text-zinc-600">Architecture + Urbanisme</p>
                    <div className="mt-4 text-[8pt] text-zinc-500">
                      <p>{data.seller_address}</p>
                      <p>SIRET : {data.seller_siret}</p>
                      <p>TVA : {data.seller_vat_number}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <h2 className="text-xl font-bold uppercase mb-1">Facture</h2>
                    <p className="text-sm font-bold">N° {data.invoice_number}</p>
                    <p className="text-sm text-zinc-500 mt-2">Date : {new Date(data.issue_date || '').toLocaleDateString('fr-FR')}</p>
                  </div>
                </div>

                {/* Addresses */}
                <div className="grid grid-cols-2 gap-12 mb-12">
                  <div>
                    <h3 className="text-[8pt] font-bold uppercase text-zinc-400 mb-2">Émetteur</h3>
                    <div className="text-[9pt]">
                      <p className="font-bold">{data.seller_name || 'KHALDOUN SEKTAOUI ARCHITECTE'}</p>
                      <p>{data.seller_address}</p>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-[8pt] font-bold uppercase text-zinc-400 mb-2">Destinataire</h3>
                    <div className="text-[9pt]">
                      <p className="font-bold">{project?.client || 'Client'}</p>
                      <p>{project?.address || 'Adresse non renseignée'}</p>
                      {project?.client_siret && <p>SIRET : {project.client_siret}</p>}
                    </div>
                  </div>
                </div>

                {/* Items Table */}
                <div className="flex-1">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b-2 border-black text-[8pt] font-bold uppercase">
                        <th className="py-2">Description</th>
                        <th className="py-2 text-center w-20">Qté</th>
                        <th className="py-2 text-right w-32">Prix Unitaire</th>
                        <th className="py-2 text-right w-32">Total HT</th>
                      </tr>
                    </thead>
                    <tbody className="text-[9pt]">
                      {data.items?.map((item, idx) => (
                        <tr key={idx} className="border-b border-zinc-100">
                          <td className="py-3">{item.description}</td>
                          <td className="py-3 text-center">{item.quantity}</td>
                          <td className="py-3 text-right">{formatCurrency(item.unit_price, data.currency)}</td>
                          <td className="py-3 text-right font-bold">{formatCurrency(item.quantity * item.unit_price, data.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div className="ml-auto w-[250px] mt-8 space-y-2 text-[10pt]">
                  <div className="flex justify-between">
                    <span>Total HT</span>
                    <span>{formatCurrency(net, data.currency)}</span>
                  </div>
                  <div className="flex justify-between text-zinc-500">
                    <span>TVA ({data.vat_rate}%)</span>
                    <span>{formatCurrency(vat, data.currency)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg border-t-2 border-black pt-2">
                    <span>Total TTC</span>
                    <span>{formatCurrency(gross, data.currency)}</span>
                  </div>
                </div>

                {/* Payment Info */}
                <div className="mt-12 p-4 bg-zinc-50 rounded-lg text-[8pt]">
                  <h4 className="font-bold uppercase mb-2">Informations de paiement</h4>
                  <div className="grid grid-cols-[80px_1fr] gap-y-1">
                    <span className="text-zinc-500">IBAN :</span>
                    <span className="font-mono">{data.seller_iban}</span>
                    <span className="text-zinc-500">BIC :</span>
                    <span className="font-mono">{data.seller_bic}</span>
                    <span className="text-zinc-500">Échéance :</span>
                    <span className="font-bold">{new Date(data.due_date || '').toLocaleDateString('fr-FR')}</span>
                  </div>
                </div>

                {/* Legal Footer */}
                <div className="mt-auto pt-8 border-t border-zinc-200 text-[7pt] text-center text-zinc-400">
                  <p>Facture conforme à la norme NF EN 16931 (Factur-X Ready)</p>
                  <p>{data.seller_name} - SIRET {data.seller_siret}</p>
                </div>
              </div>
            </div>
          </div>

          {view === 'edit' && (
            <div className="max-w-4xl mx-auto space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-6">
                  {/* General Info */}
                  <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Informations Générales</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-zinc-500">N° Facture</label>
                        <input 
                          type="text" 
                          value={data.invoice_number || ''}
                          onChange={e => setData({...data, invoice_number: e.target.value})}
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-zinc-500">Date d'émission</label>
                        <input 
                          type="date" 
                          value={data.issue_date || ''}
                          onChange={e => setData({...data, issue_date: e.target.value})}
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-zinc-500">Date d'échéance</label>
                        <input 
                          type="date" 
                          value={data.due_date || ''}
                          onChange={e => setData({...data, due_date: e.target.value})}
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-zinc-500">Taux TVA (%)</label>
                        <input 
                          type="number" 
                          value={data.vat_rate || 0}
                          onChange={e => setData({...data, vat_rate: parseFloat(e.target.value)})}
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Items */}
                  <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Lignes de facture</h3>
                      <button onClick={addItem} className="p-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-lg transition-colors">
                        <IconPlus size={16} />
                      </button>
                    </div>
                    <div className="space-y-3">
                      {data.items?.map((item) => (
                        <div key={item.id} className="flex gap-3 items-start p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-100 dark:border-zinc-800">
                          <div className="flex-1 space-y-3">
                            <input 
                              type="text" 
                              placeholder="Description"
                              value={item.description || ''}
                              onChange={e => updateItem(item.id, 'description', e.target.value)}
                              className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                            />
                            <div className="grid grid-cols-2 gap-3">
                              <input 
                                type="number" 
                                placeholder="Qté"
                                value={item.quantity || 0}
                                onChange={e => updateItem(item.id, 'quantity', parseFloat(e.target.value))}
                                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                              />
                              <input 
                                type="number" 
                                placeholder="Prix Unit. HT"
                                value={item.unit_price || 0}
                                onChange={e => updateItem(item.id, 'unit_price', parseFloat(e.target.value))}
                                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                              />
                            </div>
                          </div>
                          <button onClick={() => removeItem(item.id)} className="p-2 text-zinc-400 hover:text-red-500 transition-colors">
                            <IconTrash size={18} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  {/* Seller Details */}
                  <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Détails Émetteur</h3>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">Nom / Agence</label>
                        <input 
                          type="text" 
                          value={data.seller_name || ''}
                          onChange={e => setData({...data, seller_name: e.target.value})}
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">Adresse</label>
                        <textarea 
                          value={data.seller_address || ''}
                          onChange={e => setData({...data, seller_address: e.target.value})}
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm h-20 resize-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">SIRET</label>
                        <input 
                          type="text" 
                          value={data.seller_siret || ''}
                          onChange={e => setData({...data, seller_siret: e.target.value})}
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">N° TVA</label>
                        <input 
                          type="text" 
                          value={data.seller_vat_number || ''}
                          onChange={e => setData({...data, seller_vat_number: e.target.value})}
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">IBAN</label>
                        <input 
                          type="text" 
                          value={data.seller_iban || ''}
                          onChange={e => setData({...data, seller_iban: e.target.value})}
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">BIC</label>
                        <input 
                          type="text" 
                          value={data.seller_bic || ''}
                          onChange={e => setData({...data, seller_bic: e.target.value})}
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Totals Summary */}
                  <div className="bg-emerald-600 text-white p-6 rounded-xl shadow-lg shadow-emerald-500/20 space-y-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider opacity-80">Récapitulatif</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Total HT</span>
                        <span>{formatCurrency(net, data.currency)}</span>
                      </div>
                      <div className="flex justify-between text-sm opacity-80">
                        <span>TVA ({data.vat_rate}%)</span>
                        <span>{formatCurrency(vat, data.currency)}</span>
                      </div>
                      <div className="flex justify-between text-xl font-bold border-t border-white/20 pt-2">
                        <span>Total TTC</span>
                        <span>{formatCurrency(gross, data.currency)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
