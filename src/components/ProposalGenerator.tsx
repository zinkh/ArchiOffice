import React, { useState, useRef } from 'react';
import { IconFileExport, IconDownload, IconX, IconPlus, IconTrash, IconEye, IconEdit } from '@tabler/icons-react';
import jsPDF from 'jspdf';
import { autoSaveDocument } from '../lib/autoSaveDocument';

interface Stakeholder {
  name: string;
  role: string;
}

interface Company {
  name: string;
  trade: string;
}

interface ProposalData {
  client: {
    name: string;
    address: string;
    rcs: string;
    phone: string;
    mail: string;
  };
  project: {
    title: string;
    cadastralRef: string;
    siteAddress: string;
    siteSurface: string;
    existingSurface: string;
    existingFootprint: string;
    projectedFootprint: string;
    totalSurfaceWithExtension: string;
    estimatedWorksCost: string;
    estimatedTax: string;
  };
  program: {
    frontExtension: string;
    backExtension: string;
  };
  pluAnalysis: {
    rnu: boolean;
    implantation: string;
    height: string;
    parking: string;
    greenSpaces: string;
    networks: string;
    risks: string;
  };
  missions: string[];
  financials: {
    preliminaryStudies: number;
    urbanPlanningMission: number;
    commercialDiscountPercent: number;
    tvaPercent: number;
  };
  schedule: {
    sketchStart: string;
    preliminaryProject: string;
    urbanPlanningElaboration: string;
    instructionDelay: string;
  };
  pageFormat: 'portrait' | 'landscape';
  stakeholders: Stakeholder[];
  companies: Company[];
  fieldCompanies: Company[];
  meetingNotes: string;
  isCotraitance: boolean;
  cotraitants: { name: string; percent: number }[];
}

interface ProposalGeneratorProps {
  initialData?: {
    client?: Partial<ProposalData['client']>;
    project?: Partial<ProposalData['project']>;
    program?: Partial<ProposalData['program']>;
    pluAnalysis?: Partial<ProposalData['pluAnalysis']>;
    missions?: string[];
    financials?: Partial<ProposalData['financials']>;
    schedule?: Partial<ProposalData['schedule']>;
  };
  onClose: () => void;
}

export function ProposalGenerator({ initialData, onClose }: ProposalGeneratorProps) {
  const [data, setData] = useState<ProposalData>({
    client: {
      name: initialData?.client?.name || '',
      address: initialData?.client?.address || '',
      rcs: initialData?.client?.rcs || 'Non',
      phone: initialData?.client?.phone || '',
      mail: initialData?.client?.mail || '',
    },
    project: {
      title: initialData?.project?.title || "Extension d'une maison individuelle à l'avant et à l'arrière",
      cadastralRef: initialData?.project?.cadastralRef || '',
      siteAddress: initialData?.project?.siteAddress || '',
      siteSurface: initialData?.project?.siteSurface || '',
      existingSurface: initialData?.project?.existingSurface || '',
      existingFootprint: initialData?.project?.existingFootprint || '',
      projectedFootprint: initialData?.project?.projectedFootprint || '',
      totalSurfaceWithExtension: initialData?.project?.totalSurfaceWithExtension || '',
      estimatedWorksCost: initialData?.project?.estimatedWorksCost || '0.00',
      estimatedTax: initialData?.project?.estimatedTax || '0.00',
    },
    program: {
      frontExtension: initialData?.program?.frontExtension || "Création d'une surface d'environ 60 m², implantée sur la façade donnant sur la route, correspondant à la largeur de la maison et sur environ 10 m de profondeur.",
      backExtension: initialData?.program?.backExtension || "Ajout d'une avancée sur toute la largeur de la maison, d'environ 2 à 2,50 m de profondeur, destinée à accueillir la cuisine.",
    },
    pluAnalysis: {
      rnu: initialData?.pluAnalysis?.rnu ?? true,
      implantation: initialData?.pluAnalysis?.implantation || "Extension à l'avant, un recul est à observer par rapport à la limite parcellaire. A l'arrière Implantation en limite ou retrait ≥ 3 m",
      height: initialData?.pluAnalysis?.height || "Extension de plain-pied.",
      parking: initialData?.pluAnalysis?.parking || "Pas d'éxigences, prévoir néanmoins une place par logements",
      greenSpaces: initialData?.pluAnalysis?.greenSpaces || "Pas d'éxigences.",
      networks: initialData?.pluAnalysis?.networks || "Raccordements eau potable / EU existants conservés.",
      risks: initialData?.pluAnalysis?.risks || "Parcelle en zone d’aléa mouvements de terrain modéré : mission géotechnique G2 éxigée",
    },
    missions: initialData?.missions || [
      "Visite initiale de prise de connaissance du programme du client et du site de construction",
      "Prise en compte des caractéristiques physiques et réglementaires du site",
      "Relevé dimensionnel et altimétrique d'existant en complément des plans fournis par le M.O.",
      "Mise au point esquisses en concertation avec le Maître d'Ouvrage",
      "Mise au point avant projet en concertation avec le Maître d'Ouvrage, les services instructeurs et intégrant les incidences techniques existant et programme",
      "Etablissement des pièces écrites et graphiques de la demande d'Autorisation",
      "Suivi de l'instruction du dossier, et réponses aux questions éventuelles",
      "Modification et compléments d'informations demandés par les services instructeurs"
    ],
    financials: {
      preliminaryStudies: initialData?.financials?.preliminaryStudies || 1000,
      urbanPlanningMission: initialData?.financials?.urbanPlanningMission || 1475,
      commercialDiscountPercent: initialData?.financials?.commercialDiscountPercent || 25,
      tvaPercent: initialData?.financials?.tvaPercent || 20,
    },
    schedule: {
      sketchStart: initialData?.schedule?.sketchStart || '2 semaines',
      preliminaryProject: initialData?.schedule?.preliminaryProject || '3 semaines',
      urbanPlanningElaboration: initialData?.schedule?.urbanPlanningElaboration || '3 semaines',
      instructionDelay: initialData?.schedule?.instructionDelay || '3 mois',
    },
    pageFormat: 'portrait',
    stakeholders: [],
    companies: [],
    fieldCompanies: [],
    meetingNotes: '',
    isCotraitance: false,
    cotraitants: [],
  });

  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [isGenerating, setIsGenerating] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!containerRef.current || !previewRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const containerWidth = entry.contentRect.width;
        const pdfWidth = previewRef.current?.offsetWidth || 1;
        const scale = Math.min(1, (containerWidth - 40) / pdfWidth);
        containerRef.current?.style.setProperty('--pdf-scale', scale.toString());
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [view]);

  const addCotraitant = () => {
    setData({
      ...data,
      cotraitants: [...data.cotraitants, { name: '', percent: 0 }]
    });
  };

  const updateCotraitant = (index: number, field: string, value: any) => {
    const newCotraitants = [...data.cotraitants];
    newCotraitants[index] = { ...newCotraitants[index], [field]: value };
    setData({ ...data, cotraitants: newCotraitants });
  };

  const calculateFinancials = () => {
    const subtotal = data.financials.preliminaryStudies + data.financials.urbanPlanningMission;
    const discount = (subtotal * data.financials.commercialDiscountPercent) / 100;
    const totalHT = subtotal - discount;
    const tva = (totalHT * data.financials.tvaPercent) / 100;
    const totalTTC = totalHT + tva;

    return { subtotal, discount, totalHT, tva, totalTTC };
  };

  const exportPDF = async () => {
    if (!previewRef.current) return;
    setIsGenerating(true);
    
    // Hide icons before generation to prevent html2canvas errors
    const icons = previewRef.current.querySelectorAll('svg');
    icons.forEach(icon => icon.style.display = 'none');
    
    try {
      const pdf = new jsPDF(data.pageFormat === 'portrait' ? 'p' : 'l', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      
      const pages = previewRef.current.querySelectorAll('.pdf-page');
      
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i] as HTMLElement;
        
        if (i > 0) pdf.addPage();
        
        await pdf.html(page, {
          x: 0,
          y: 0,
          width: pdfWidth,
          windowWidth: page.scrollWidth,
          margin: [0, 0, 0, 0],
          autoPaging: false
        });
      }
      
      const filename = `Proposition_Honoraires_${data.client.name.replace(/\s+/g, '_') || 'Client'}.pdf`;
      pdf.save(filename);
      autoSaveDocument({
        blob: pdf.output('blob'),
        filename,
        name: `Proposition Honoraires - ${data.client.name || 'Client'}`,
        phase: 'ESQ',
        category: 'Contract',
      });
    } catch (err) {
      console.error('PDF Generation Error:', err);
      alert('Erreur lors de la génération du PDF. Veuillez réessayer.');
    } finally {
      // Restore icons
      icons.forEach(icon => icon.style.display = '');
      setIsGenerating(false);
    }
  };

  const { discount, totalHT, tva, totalTTC } = calculateFinancials();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-hidden">
      <div className="bg-white dark:bg-zinc-900 w-full max-w-5xl h-full max-h-[90vh] rounded-2xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
              <IconFileExport size={20} />
            </div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Générateur de Proposition d'Honoraires</h2>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setView(view === 'edit' ? 'preview' : 'edit')}
              className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg text-sm font-medium transition-colors"
            >
              {view === 'edit' ? <IconEye size={16} /> : <IconEdit size={16} />}
              {view === 'edit' ? 'Aperçu' : 'Modifier'}
            </button>
            <button 
              onClick={onClose}
              className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 rounded-lg transition-colors"
            >
              <IconX size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-zinc-100 dark:bg-zinc-950 relative">
          {/* Always render preview hidden if not in preview mode to allow PDF generation from edit mode */}
          <div ref={containerRef} className={view === 'preview' ? "flex flex-col items-center gap-8 py-8 min-h-full w-full overflow-x-auto" : "fixed -left-[9999px] top-0"}>
            {/* PDF Preview Container */}
            <div ref={previewRef} className="flex flex-col gap-16 origin-top" style={{ transform: 'scale(var(--pdf-scale, 1))' }}>
              {/* PAGE 1: Cover */}
              <div className={`pdf-page bg-white text-black ${data.pageFormat === 'portrait' ? 'w-[210mm] h-[297mm]' : 'w-[297mm] h-[210mm]'} p-[20mm] shadow-xl font-sans text-[10pt] leading-relaxed flex flex-col`} style={{ fontFamily: 'Inter, sans-serif' }}>
                <h1 className="text-4xl font-bold text-center mt-20 mb-16">PROPOSITION D'HONORAIRES</h1>
                <h2 className="text-2xl text-center mb-24">{data.project.title}</h2>
                <div className="mt-auto">
                  <h3 className="font-bold underline mb-6">Intervenants :</h3>
                  <div className="grid grid-cols-2 gap-6">
                    {data.stakeholders.map((s, i) => (
                      <div key={i}><span className="font-bold">{s.role} :</span> {s.name}</div>
                    ))}
                  </div>
                </div>
              </div>

              {/* PAGE 2: Companies */}
              <div className={`pdf-page bg-white text-black ${data.pageFormat === 'portrait' ? 'w-[210mm] h-[297mm]' : 'w-[297mm] h-[210mm]'} p-[20mm] shadow-xl font-sans text-[10pt] leading-relaxed flex flex-col`} style={{ fontFamily: 'Inter, sans-serif' }}>
                <h3 className="font-bold underline mb-12">Entreprises :</h3>
                <div className="grid grid-cols-2 gap-6">
                  {data.companies.map((c, i) => (
                    <div key={i}><span className="font-bold">{c.trade} :</span> {c.name}</div>
                  ))}
                </div>
                
                {data.fieldCompanies.length > 0 && (
                  <div className="mt-12">
                    <h3 className="font-bold underline mb-12">Entreprises de terrain :</h3>
                    <div className="grid grid-cols-2 gap-6">
                      {data.fieldCompanies.map((c, i) => (
                        <div key={i}><span className="font-bold">{c.trade} :</span> {c.name}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* PAGE 3: Meeting Notes */}
              <div className={`pdf-page bg-white text-black ${data.pageFormat === 'portrait' ? 'w-[210mm] h-[297mm]' : 'w-[297mm] h-[210mm]'} p-[20mm] shadow-xl font-sans text-[10pt] leading-relaxed flex flex-col`} style={{ fontFamily: 'Inter, sans-serif' }}>
                <h3 className="font-bold underline mb-12">Notes de réunion :</h3>
                <p className="whitespace-pre-wrap">{data.meetingNotes}</p>
              </div>

              {/* PAGE 4: Existing PAGE 1 */}
              <div 
                className={`pdf-page bg-white text-black ${data.pageFormat === 'portrait' ? 'w-[210mm] h-[297mm]' : 'w-[297mm] h-[210mm]'} p-[20mm] shadow-xl font-sans text-[10pt] leading-relaxed flex flex-col`}
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                {/* PDF Header */}
                <div className="flex justify-between items-start mb-12">
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight">KHALDOUN SEKTAOUI</h1>
                    <p className="text-sm text-zinc-600">Architecture + Urbanisme</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="text-[8pt] font-bold text-red-600 uppercase">Ordre des</p>
                      <p className="text-[8pt] font-bold text-red-600 uppercase">Architectes</p>
                    </div>
                    <div className="w-12 h-12 bg-black flex items-center justify-center text-white font-bold text-xl">
                      OA
                    </div>
                  </div>
                </div>

                <h2 className="text-center font-bold uppercase mb-8 border-b-2 border-black pb-2">
                  PROPOSITION D'HONORAIRES - MISSION LIMITÉE AU PROJET ARCHITECTURAL NÉCESSAIRE À LA DEMANDE DE L'AUTORISATION D'URBANISME
                </h2>

                {/* Info Grid */}
                <div className="space-y-4 mb-8">
                  <div className="grid grid-cols-[150px_1fr] gap-2">
                    <span className="font-bold">Projet :</span>
                    <span>{data.project.title}</span>
                  </div>

                  <div className="grid grid-cols-[150px_1fr] gap-2">
                    <span className="font-bold">Maître d'Ouvrage :</span>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                      <div><span className="text-zinc-500">Nom, Prénom :</span> {data.client.name}</div>
                      <div><span className="text-zinc-500">Adresse :</span> {data.client.address}</div>
                      <div><span className="text-zinc-500">RCS si entreprise :</span> {data.client.rcs}</div>
                      <div><span className="text-zinc-500">Téléphone :</span> {data.client.phone}</div>
                      <div className="col-span-2"><span className="text-zinc-500">Mail :</span> {data.client.mail}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-[150px_1fr] gap-2">
                    <span className="font-bold">Maître d'Œuvre :</span>
                    <div>
                      <p>Khaldoun SEKTAOUI Architecte</p>
                      <p>Ordre des Architectes n° : 078686</p>
                      <p>Assurance MAF n° : 155162B</p>
                    </div>
                  </div>
                </div>

                {/* Project Details */}
                <div className="mb-8">
                  <h3 className="font-bold underline mb-2">Informations Projet :</h3>
                  <div className="grid grid-cols-2 gap-x-12 gap-y-1 text-[9pt]">
                    <div className="grid grid-cols-[150px_1fr] gap-1">
                      <span className="underline">Référence cadastrale :</span>
                      <span>{data.project.cadastralRef}</span>
                    </div>
                    <div className="grid grid-cols-[150px_1fr] gap-1">
                      <span className="underline">Adresse Terrain :</span>
                      <span>{data.project.siteAddress}</span>
                    </div>
                    <div className="grid grid-cols-[150px_1fr] gap-1">
                      <span className="underline">Surface terrain :</span>
                      <span>{data.project.siteSurface} m²</span>
                    </div>
                    <div className="grid grid-cols-[150px_1fr] gap-1">
                      <span className="underline">Montant estimé travaux :</span>
                      <span>{data.project.estimatedWorksCost} € HT</span>
                    </div>
                  </div>
                </div>

                {/* Program */}
                <div className="mb-8">
                  <h3 className="font-bold underline mb-2">Programme de l'opération :</h3>
                  <div className="space-y-2 text-[9pt]">
                    {data.program.frontExtension && (
                      <div>
                        <span className="font-bold">Extension avant :</span>
                        <p className="ml-4">{data.program.frontExtension}</p>
                      </div>
                    )}
                    {data.program.backExtension && (
                      <div>
                        <span className="font-bold">Extension arrière :</span>
                        <p className="ml-4">{data.program.backExtension}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* PLU Analysis */}
                <div className="mb-8">
                  <h3 className="font-bold underline mb-2">Analyse PLU</h3>
                  <p className="text-[9pt] mb-2">Le terrain est soumis au {data.pluAnalysis.rnu ? 'RNU' : 'PLU'} :</p>
                  <div className="grid grid-cols-[150px_1fr] gap-y-1 text-[9pt]">
                    <span className="font-bold">Implantation</span>
                    <span>{data.pluAnalysis.implantation}</span>
                    <span className="font-bold">Hauteur</span>
                    <span>{data.pluAnalysis.height}</span>
                    <span className="font-bold">Stationnement</span>
                    <span>{data.pluAnalysis.parking}</span>
                    <span className="font-bold">Espaces verts</span>
                    <span>{data.pluAnalysis.greenSpaces}</span>
                    <span className="font-bold">Réseaux</span>
                    <span>{data.pluAnalysis.networks}</span>
                    <span className="font-bold">Risques & structure</span>
                    <span>{data.pluAnalysis.risks}</span>
                  </div>
                </div>

                {/* Missions */}
                <div className="mb-8 mt-12">
                  <h3 className="font-bold underline mb-2">Proposition de missions :</h3>
                  <p className="text-[8pt] font-bold uppercase mb-2">MISSION LIMITÉE AU PROJET ARCHITECTURAL NÉCESSAIRE À LA DEMANDE DE L'AUTORISATION D'URBANISME</p>
                  <ul className="list-none space-y-1 text-[9pt]">
                    {data.missions.map((m, i) => (
                      <li key={i} className="flex gap-2">
                        <span>-</span>
                        <span>{m}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Financial Summary */}
                <div className="ml-auto w-[300px] border-t-2 border-black pt-4 space-y-1 text-[10pt] mb-12">
                  <div className="flex justify-between">
                    <span className="font-bold">Mission d'Etudes Préliminaires</span>
                    <span>{data.financials.preliminaryStudies.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-bold">Mission Autorisation d'Urbanisme</span>
                    <span>{data.financials.urbanPlanningMission.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT</span>
                  </div>
                  <div className="flex justify-between text-zinc-500">
                    <span>Remise commerciale {data.financials.commercialDiscountPercent.toFixed(2)} %</span>
                    <span>-{discount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-zinc-200 pt-1">
                    <span>L'ensemble HT :</span>
                    <span>{totalHT.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                  </div>
                  <div className="flex justify-between">
                    <span>TVA {data.financials.tvaPercent.toFixed(2)} %</span>
                    <span>{tva.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg border-t-2 border-black pt-1">
                    <span>Total TTC :</span>
                    <span>{totalTTC.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € TTC</span>
                  </div>
                </div>

                {/* Footer Legal */}
                <div className="mt-auto pt-8 border-t border-zinc-200 text-[7pt] text-center text-zinc-400">
                  <p>KHALDOUN SEKTAOUI X ARCHITECTURE - 14 rue Colonel Moll - 54500 LAXOU - Tél : 0684016633 - Mail : contact@ksxa.fr</p>
                  <p>SIRET 801 417 122 00026 – Inscrit à l'Ordre des Architectes sous la référence : 078686</p>
                </div>
              </div>

              {/* PAGE 5: Existing PAGE 2 */}
              <div 
                className={`pdf-page bg-white text-black ${data.pageFormat === 'portrait' ? 'w-[210mm] h-[297mm]' : 'w-[297mm] h-[210mm]'} p-[20mm] shadow-xl font-sans text-[10pt] leading-relaxed flex flex-col`}
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                <div className="space-y-12">
                  <div className="grid grid-cols-2 gap-12">
                    <div className="space-y-4">
                      <h3 className="font-bold underline">Echéancier :</h3>
                      <div className="grid grid-cols-[180px_1fr] gap-y-1 text-[9pt]">
                        <span>Début de l'esquisse</span>
                        <span>{data.schedule.sketchStart}</span>
                        <span>Délai de l'Avant Projet</span>
                        <span>{data.schedule.preliminaryProject}</span>
                        <span>Délai de l'élaboration de l'AU</span>
                        <span>{data.schedule.urbanPlanningElaboration}</span>
                        <span>Délai d'instruction du dossier</span>
                        <span>{data.schedule.instructionDelay}</span>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h3 className="font-bold underline">Paiement :</h3>
                      <div className="space-y-1 text-[9pt]">
                        <div className="flex justify-between">
                          <span>- Acompte 30 % à la commande</span>
                          <span>{(totalTTC * 0.3).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € TTC</span>
                        </div>
                        <div className="flex justify-between">
                          <span>- Acompte 50 % au dépôt de l'AU</span>
                          <span>{(totalTTC * 0.5).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € TTC</span>
                        </div>
                        <div className="flex justify-between">
                          <span>- Solde 20 % à l'obtention de l'AU</span>
                          <span>{(totalTTC * 0.2).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € TTC</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between items-end mt-12 mb-12">
                    <div className="text-[9pt]">
                      <p>A Laxou, le {new Date().toLocaleDateString('fr-FR')}</p>
                      <p>Khaldoun Sektaoui Architecte</p>
                      <div className="mt-4 w-32 h-16 border border-zinc-100 flex items-center justify-center text-zinc-300 text-[8pt]">Signature</div>
                    </div>
                    <div className="text-[9pt] text-right">
                      <p>A ........................., le .........................</p>
                      <p>Bon pour mission, le client,</p>
                      <div className="mt-4 ml-auto w-32 h-16 border border-zinc-100 flex items-center justify-center text-zinc-300 text-[8pt]">Signature</div>
                    </div>
                  </div>

                  <div className="text-[8pt] text-zinc-500 italic space-y-4">
                    <p>Nota :</p>
                    <p>Au-delà de 66m² de surface de plancher une étude thermique faite par un thermicien est nécessaire, prévoir un budget de 2000€ entre l'étude thermique et l'attestation en fin de travaux.</p>
                    <p>Le Maître d'Ouvrage déclare avoir été informé par l'architecte de la nécessité de réaliser une étude de sol de conception (G2 AVP ou G2 PRO le terrain étant en zone d'aléas forts, argiles et remontées de nappe) et de souscrire à une assurance dommage-ouvrage conformément à l'article L242-1 du code des assurances.</p>
                    <p>La mission partielle n'intègre pas les plans d'exécution, les tests d'étanchéité à l'air, l'étude thermique et l'attestation thermique de fin de chantier.</p>
                    <p>La présente mission se termine à l'obtention de l'autorisation d'urbanisme (Permis de Construire ou Déclaration Préalable)</p>
                  </div>
                </div>

                {/* Footer Legal */}
                <div className="mt-auto pt-8 border-t border-zinc-200 text-[7pt] text-center text-zinc-400">
                  <p>KHALDOUN SEKTAOUI X ARCHITECTURE - 14 rue Colonel Moll - 54500 LAXOU - Tél : 0684016633 - Mail : contact@ksxa.fr</p>
                  <p>SIRET 801 417 122 00026 – Inscrit à l'Ordre des Architectes sous la référence : 078686</p>
                </div>
              </div>
            </div>
          </div>

          {view === 'edit' && (
            <div className="space-y-8 max-w-3xl mx-auto bg-white dark:bg-zinc-900 p-8 rounded-xl border border-zinc-200 dark:border-zinc-800">
              {/* PDF Settings */}
              <section className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 pb-2">Paramètres PDF</h3>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="pageFormat" value="portrait" checked={data.pageFormat === 'portrait'} onChange={() => setData({...data, pageFormat: 'portrait'})} />
                    Portrait
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="pageFormat" value="landscape" checked={data.pageFormat === 'landscape'} onChange={() => setData({...data, pageFormat: 'landscape'})} />
                    Paysage
                  </label>
                </div>
              </section>

              {/* Client Info */}
              <section className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 pb-2">Maître d'Ouvrage (Client)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Nom, Prénom <span className="text-red-500">*</span></label>
                    <input 
                      type="text" 
                      value={data.client.name}
                      onChange={(e) => setData({...data, client: {...data.client, name: e.target.value}})}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                      placeholder="M. Carl D'hont"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Adresse <span className="text-red-500">*</span></label>
                    <input 
                      type="text" 
                      value={data.client.address}
                      onChange={(e) => setData({...data, client: {...data.client, address: e.target.value}})}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                      placeholder="19, rue du Gué 54740 ORMES-ET-VILLE"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Téléphone</label>
                    <input 
                      type="text" 
                      value={data.client.phone}
                      onChange={(e) => setData({...data, client: {...data.client, phone: e.target.value}})}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                      placeholder="06 18 81 56 06"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Email</label>
                    <input 
                      type="email" 
                      value={data.client.mail}
                      onChange={(e) => setData({...data, client: {...data.client, mail: e.target.value}})}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                      placeholder="carl.dhont@gmail.com"
                    />
                  </div>
                </div>
              </section>

              {/* Stakeholders */}
              <section className="space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Intervenants (Page de garde)</h3>
                  <button onClick={() => setData({...data, stakeholders: [...data.stakeholders, { name: '', role: '' }]})} className="p-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-lg transition-colors">
                    <IconPlus size={16} />
                  </button>
                </div>
                <div className="space-y-2">
                  {data.stakeholders.map((s, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input type="text" placeholder="Nom" value={s.name || ''} onChange={(e) => { const n = [...data.stakeholders]; n[idx].name = e.target.value; setData({...data, stakeholders: n}); }} className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                      <input type="text" placeholder="Rôle" value={s.role || ''} onChange={(e) => { const n = [...data.stakeholders]; n[idx].role = e.target.value; setData({...data, stakeholders: n}); }} className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                      <button onClick={() => setData({...data, stakeholders: data.stakeholders.filter((_, i) => i !== idx)})} className="p-2 text-zinc-400 hover:text-red-500 transition-colors">
                        <IconTrash size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Project Info */}
              <section className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 pb-2">Informations Projet</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-zinc-500">Titre du Projet <span className="text-red-500">*</span></label>
                    <input 
                      type="text" 
                      value={data.project.title}
                      onChange={(e) => setData({...data, project: {...data.project, title: e.target.value}})}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Référence Cadastrale <span className="text-red-500">*</span></label>
                    <input 
                      type="text" 
                      value={data.project.cadastralRef}
                      onChange={(e) => setData({...data, project: {...data.project, cadastralRef: e.target.value}})}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Surface Terrain (m²)</label>
                    <input 
                      type="text" 
                      value={data.project.siteSurface}
                      onChange={(e) => setData({...data, project: {...data.project, siteSurface: e.target.value}})}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Montant estimé travaux (HT)</label>
                    <input 
                      type="text" 
                      value={data.project.estimatedWorksCost}
                      onChange={(e) => setData({...data, project: {...data.project, estimatedWorksCost: e.target.value}})}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                    />
                  </div>
                </div>
              </section>

              {/* Financials */}
              <section className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 pb-2">Honoraires</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Etudes Préliminaires (€)</label>
                    <input 
                      type="number" 
                      value={data.financials.preliminaryStudies}
                      onChange={(e) => setData({...data, financials: {...data.financials, preliminaryStudies: parseFloat(e.target.value) || 0}})}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Mission Autorisation (€)</label>
                    <input 
                      type="number" 
                      value={data.financials.urbanPlanningMission}
                      onChange={(e) => setData({...data, financials: {...data.financials, urbanPlanningMission: parseFloat(e.target.value) || 0}})}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Remise Commerciale (%)</label>
                    <input 
                      type="number" 
                      value={data.financials.commercialDiscountPercent}
                      onChange={(e) => setData({...data, financials: {...data.financials, commercialDiscountPercent: parseFloat(e.target.value) || 0}})}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">TVA (%)</label>
                    <input 
                      type="number" 
                      value={data.financials.tvaPercent}
                      onChange={(e) => setData({...data, financials: {...data.financials, tvaPercent: parseFloat(e.target.value) || 0}})}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                    />
                  </div>
                </div>
              </section>

              {/* Missions */}
              <section className="space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Détail des Missions</h3>
                  <button 
                    onClick={() => setData({...data, missions: [...data.missions, "Nouvelle mission"]})}
                    className="p-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-lg transition-colors"
                  >
                    <IconPlus size={16} />
                  </button>
                </div>
                <div className="space-y-2">
                  {data.missions.map((mission, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input 
                        type="text" 
                        value={mission}
                        onChange={(e) => {
                          const newMissions = [...data.missions];
                          newMissions[idx] = e.target.value;
                          setData({...data, missions: newMissions});
                        }}
                        className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                      />
                      <button 
                        onClick={() => setData({...data, missions: data.missions.filter((_, i) => i !== idx)})}
                        className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                      >
                        <IconTrash size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Companies */}
              <section className="space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Entreprises (Page 2)</h3>
                  <button onClick={() => setData({...data, companies: [...data.companies, { name: '', trade: '' }]})} className="p-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-lg transition-colors">
                    <IconPlus size={16} />
                  </button>
                </div>
                <div className="space-y-2">
                  {data.companies.map((c, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input type="text" placeholder="Nom" value={c.name || ''} onChange={(e) => { const n = [...data.companies]; n[idx].name = e.target.value; setData({...data, companies: n}); }} className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                      <input type="text" placeholder="Corps d'état" value={c.trade || ''} onChange={(e) => { const n = [...data.companies]; n[idx].trade = e.target.value; setData({...data, companies: n}); }} className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                      <button onClick={() => setData({...data, companies: data.companies.filter((_, i) => i !== idx)})} className="p-2 text-zinc-400 hover:text-red-500 transition-colors">
                        <IconTrash size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Field Companies */}
              <section className="space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Entreprises de terrain</h3>
                  <button onClick={() => setData({...data, fieldCompanies: [...data.fieldCompanies, { name: '', trade: '' }]})} className="p-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-lg transition-colors">
                    <IconPlus size={16} />
                  </button>
                </div>
                <div className="space-y-2">
                  {data.fieldCompanies.map((c, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input type="text" placeholder="Nom" value={c.name || ''} onChange={(e) => { const n = [...data.fieldCompanies]; n[idx].name = e.target.value; setData({...data, fieldCompanies: n}); }} className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                      <input type="text" placeholder="Corps d'état" value={c.trade || ''} onChange={(e) => { const n = [...data.fieldCompanies]; n[idx].trade = e.target.value; setData({...data, fieldCompanies: n}); }} className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                      <button onClick={() => setData({...data, fieldCompanies: data.fieldCompanies.filter((_, i) => i !== idx)})} className="p-2 text-zinc-400 hover:text-red-500 transition-colors">
                        <IconTrash size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Meeting Notes */}
              <section className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 pb-2">Notes de réunion (Page 3)</h3>
                <textarea value={data.meetingNotes} onChange={(e) => setData({...data, meetingNotes: e.target.value})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm h-32" />
              </section>

              {/* Cotraitance */}
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    checked={data.isCotraitance} 
                    onChange={(e) => setData({...data, isCotraitance: e.target.checked})}
                    className="w-4 h-4 text-blue-600 rounded border-zinc-300 focus:ring-blue-500"
                  />
                  <label className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Cotraitance</label>
                </div>
                
                {data.isCotraitance && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      {data.cotraitants.map((c, idx) => (
                        <div key={idx} className="flex gap-2">
                          <input type="text" placeholder="Nom cotraitant" value={c.name || ''} onChange={(e) => updateCotraitant(idx, 'name', e.target.value)} className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                          <input type="number" placeholder="%" value={c.percent || 0} onChange={(e) => updateCotraitant(idx, 'percent', parseFloat(e.target.value))} className="w-20 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                          <button onClick={() => setData({...data, cotraitants: data.cotraitants.filter((_, i) => i !== idx)})} className="p-2 text-zinc-400 hover:text-red-500 transition-colors">
                            <IconTrash size={16} />
                          </button>
                        </div>
                      ))}
                      <button onClick={addCotraitant} className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                        <IconPlus size={16} /> Ajouter un cotraitant
                      </button>
                    </div>
                    <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold">Créer une répartition d'honoraires</button>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-3 shrink-0">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-sm font-medium transition-colors"
          >
            Annuler
          </button>
          <button 
            onClick={exportPDF}
            disabled={isGenerating}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-bold shadow-lg shadow-blue-500/20 transition-all active:scale-95"
          >
            {isGenerating ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <IconDownload size={18} />
            )}
            {isGenerating ? 'Génération...' : 'Exporter en PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
