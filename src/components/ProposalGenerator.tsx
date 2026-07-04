import React, { useState, useRef, useEffect } from 'react';
import { IconFileExport, IconDownload, IconX, IconPlus, IconTrash, IconEye, IconEdit } from '@tabler/icons-react';
import jsPDF from 'jspdf';
import { autoSaveDocument } from '../lib/autoSaveDocument';

const MISSION_COURTE_TITLE = "MISSION LIMITÉE AU PROJET ARCHITECTURAL NÉCESSAIRE À LA DEMANDE DE L'AUTORISATION D'URBANISME";

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
  architect: {
    name: string;
    oaNumber: string;
    mafNumber: string;
    city: string;
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
    projectedFloorArea: string;
    provisionalEnvelope: string;
  };
  program: {
    frontExtension: string;
    backExtension: string;
  };
  programShort: {
    description: string;
    levels: string;
    buildingType: string;
    parking: string;
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
    includePreliminaryStudies: boolean;
    applyDiscount: boolean;
    pricingMode: 'fixed' | 'percentTravaux';
    honorairesPercent: number;
    preliminaryStudiesSharePercent: number;
    mafRatioPerM2: number;
    mafRatioYear: string;
  };
  schedule: {
    sketchStart: string;
    preliminaryProject: string;
    urbanPlanningElaboration: string;
    instructionDelay: string;
    paymentAcompte1Percent: number;
    paymentAcompte2Percent: number;
  };
  appendixNotes: string;
  proposalType: 'court' | 'detaille';
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
    architect?: Partial<ProposalData['architect']>;
    project?: Partial<ProposalData['project']>;
    program?: Partial<ProposalData['program']>;
    programShort?: Partial<ProposalData['programShort']>;
    pluAnalysis?: Partial<ProposalData['pluAnalysis']>;
    missions?: string[];
    financials?: Partial<ProposalData['financials']>;
    schedule?: Partial<ProposalData['schedule']>;
    appendixNotes?: string;
    proposalType?: ProposalData['proposalType'];
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
    architect: {
      name: initialData?.architect?.name || 'Khaldoun SEKTAOUI Architecte',
      oaNumber: initialData?.architect?.oaNumber || '078686',
      mafNumber: initialData?.architect?.mafNumber || '155162B',
      city: initialData?.architect?.city || 'Laxou',
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
      projectedFloorArea: initialData?.project?.projectedFloorArea || '',
      provisionalEnvelope: initialData?.project?.provisionalEnvelope || '',
    },
    program: {
      frontExtension: initialData?.program?.frontExtension || "Création d'une surface d'environ 60 m², implantée sur la façade donnant sur la route, correspondant à la largeur de la maison et sur environ 10 m de profondeur.",
      backExtension: initialData?.program?.backExtension || "Ajout d'une avancée sur toute la largeur de la maison, d'environ 2 à 2,50 m de profondeur, destinée à accueillir la cuisine.",
    },
    programShort: {
      description: initialData?.programShort?.description || "Construction d'une maison individuelle",
      levels: initialData?.programShort?.levels || 'RDC + Étage',
      buildingType: initialData?.programShort?.buildingType || 'Maison individuelle',
      parking: initialData?.programShort?.parking || '1 place de stationnement',
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
      includePreliminaryStudies: initialData?.financials?.includePreliminaryStudies ?? true,
      applyDiscount: initialData?.financials?.applyDiscount ?? true,
      pricingMode: initialData?.financials?.pricingMode || 'fixed',
      honorairesPercent: initialData?.financials?.honorairesPercent || 8,
      preliminaryStudiesSharePercent: initialData?.financials?.preliminaryStudiesSharePercent ?? 40,
      mafRatioPerM2: initialData?.financials?.mafRatioPerM2 || 1714,
      mafRatioYear: initialData?.financials?.mafRatioYear || String(new Date().getFullYear()),
    },
    schedule: {
      sketchStart: initialData?.schedule?.sketchStart || '2 semaines',
      preliminaryProject: initialData?.schedule?.preliminaryProject || '3 semaines',
      urbanPlanningElaboration: initialData?.schedule?.urbanPlanningElaboration || '3 semaines',
      instructionDelay: initialData?.schedule?.instructionDelay || '3 mois',
      paymentAcompte1Percent: initialData?.schedule?.paymentAcompte1Percent ?? 30,
      paymentAcompte2Percent: initialData?.schedule?.paymentAcompte2Percent ?? 50,
    },
    appendixNotes: initialData?.appendixNotes || "Assurances obligatoires\nAssurance dommages-ouvrage (DO) : 1,5 à 3 % du coût des travaux HT\nAssurance CNR (uniquement si vente dans les 10 ans) : variable\n\nÉtudes techniques obligatoires\nÉtude géotechnique de sol (G2-AVP) pour le dimensionnement des fondations : 1 500 à 2 000 € HT\nÉtude thermique et fluides RE2020 (au dépôt du permis de construire et à l'achèvement) : 1 500 à 2 000 € HT\nÉtude de structure (béton, charpente, fondations) : 2 000 à 3 000 € HT - Facultatif mais fortement conseillé\n\nTaxes et participations\nTaxe d'aménagement (TA) : calculée sur la surface taxable × valeur forfaitaire × taux communal/départemental\nParticipation raccordement réseaux (eau, assainissement, électricité, gaz, télécom) : 3 000 à 15 000 € selon commune",
    proposalType: initialData?.proposalType || 'detaille',
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
  const [logoUrl, setLogoUrl] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [agencyAddress, setAgencyAddress] = useState('');
  const [agencyEmail, setAgencyEmail] = useState('');
  const [agencySiret, setAgencySiret] = useState('');
  const [agencyVat, setAgencyVat] = useState('');
  const [mafPluginEnabled, setMafPluginEnabled] = useState(false);
  const [showMafCost, setShowMafCost] = useState(false);
  const [mafTauxContratPermil, setMafTauxContratPermil] = useState(0);
  const [mafTauxMission, setMafTauxMission] = useState(100);
  const [mafPartInteret, setMafPartInteret] = useState(100);
  const [mafIsMaisonInd, setMafIsMaisonInd] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        if (s && !s.error) {
          if (s.logoUrl) setLogoUrl(s.logoUrl);
          if (s.agencyName) setAgencyName(s.agencyName);
          if (s.address) setAgencyAddress(s.address);
          if (s.email) setAgencyEmail(s.email);
          if (s.siret) setAgencySiret(s.siret);
          if (s.vatNumber) setAgencyVat(s.vatNumber);
          if (s.maf_enabled) setMafPluginEnabled(true);
          if (s.maf_taux_contrat_permil) setMafTauxContratPermil(parseFloat(s.maf_taux_contrat_permil) || 0);
        }
      })
      .catch(() => {});
  }, []);
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

  // Montant des travaux estimé à partir du ratio MAF (€/m², évolutif par année), quand le mode "pourcentage" est actif
  const computedMontantTravaux = (() => {
    if (data.financials.pricingMode !== 'percentTravaux') return null;
    const floorArea = parseFloat(data.project.projectedFloorArea) || 0;
    if (!floorArea) return null;
    return floorArea * data.financials.mafRatioPerM2;
  })();

  // Répartition des honoraires (Etudes Préliminaires optionnelles / Mission Autorisation), selon le mode de tarification
  const { effectivePreliminaryStudies, effectiveUrbanPlanningMission } = (() => {
    if (data.financials.pricingMode === 'percentTravaux' && computedMontantTravaux !== null) {
      const totalFees = computedMontantTravaux * (data.financials.honorairesPercent / 100);
      const prelimShare = data.financials.includePreliminaryStudies ? data.financials.preliminaryStudiesSharePercent / 100 : 0;
      return {
        effectivePreliminaryStudies: totalFees * prelimShare,
        effectiveUrbanPlanningMission: totalFees * (1 - prelimShare),
      };
    }
    return {
      effectivePreliminaryStudies: data.financials.includePreliminaryStudies ? data.financials.preliminaryStudies : 0,
      effectiveUrbanPlanningMission: data.financials.urbanPlanningMission,
    };
  })();

  const calculateFinancials = () => {
    const subtotal = effectivePreliminaryStudies + effectiveUrbanPlanningMission;
    const effectiveDiscountPercent = data.financials.applyDiscount ? data.financials.commercialDiscountPercent : 0;
    const discount = (subtotal * effectiveDiscountPercent) / 100;
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
      
      const typeSuffix = data.proposalType === 'court' ? 'Courte' : 'Detaillee';
      const filename = `Proposition_Honoraires_${typeSuffix}_${data.client.name.replace(/\s+/g, '_') || 'Client'}.pdf`;
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
  const paymentSoldePercent = Math.max(0, 100 - data.schedule.paymentAcompte1Percent - data.schedule.paymentAcompte2Percent);

  const mafCotisationEstimee = (() => {
    if (!showMafCost || !mafTauxContratPermil) return null;
    const worksHT = parseFloat(data.project.estimatedWorksCost) || 0;
    if (!worksHT) return null;
    const montantM = mafIsMaisonInd ? 1714 * worksHT : worksHT;
    const assiette = montantM * (mafTauxMission / 100) * (mafPartInteret / 100);
    return assiette * mafTauxContratPermil / 1000;
  })();

  // Mission limitée au projet architectural (PC/DP) — taux de mission MAF fixe à 30 %
  const MAF_TAUX_MISSION_COURTE = 30;
  const decennaleShort = (() => {
    if (!showMafCost || !mafTauxContratPermil) return null;
    const floorArea = parseFloat(data.project.projectedFloorArea) || 0;
    if (!floorArea) return null;
    return floorArea * data.financials.mafRatioPerM2 * (mafTauxContratPermil / 100) * (MAF_TAUX_MISSION_COURTE / 100);
  })();

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
              {data.proposalType === 'detaille' && (
              <>
              {/* PAGE 1: Cover */}
              <div className={`pdf-page bg-white text-black ${data.pageFormat === 'portrait' ? 'w-[210mm] h-[297mm]' : 'w-[297mm] h-[210mm]'} p-[20mm] shadow-xl font-sans text-[10pt] leading-relaxed flex flex-col`} style={{ fontFamily: 'Inter, sans-serif' }}>
                {/* Agency logo + name header */}
                <div className="flex items-center gap-4 mb-8 pb-6 border-b border-zinc-200">
                  {logoUrl && <img src={logoUrl} alt="Logo" style={{ height: '48px', maxWidth: '140px', objectFit: 'contain', display: 'block' }} crossOrigin="anonymous" />}
                  {agencyName && <span className="text-sm font-semibold text-zinc-700">{agencyName}</span>}
                </div>
                <h1 className="text-4xl font-bold text-center mt-12 mb-16">PROPOSITION D'HONORAIRES</h1>
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
                  {data.financials.includePreliminaryStudies && (
                    <div className="flex justify-between">
                      <span className="font-bold">Mission d'Etudes Préliminaires</span>
                      <span>{effectivePreliminaryStudies.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="font-bold">Mission Autorisation d'Urbanisme</span>
                    <span>{effectiveUrbanPlanningMission.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT</span>
                  </div>
                  {data.financials.applyDiscount && (
                    <div className="flex justify-between text-zinc-500">
                      <span>Remise commerciale {data.financials.commercialDiscountPercent.toFixed(2)} %</span>
                      <span>-{discount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                    </div>
                  )}
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
                  {mafCotisationEstimee !== null && (
                    <div className="mt-3 p-2 rounded text-[8pt]" style={{ background: '#fff4e6', border: '1px solid #f59e0b', color: '#92400e' }}>
                      <div className="font-semibold">Coût assurance MAF estimé :</div>
                      <div className="font-bold text-[10pt]">{mafCotisationEstimee.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € HT</div>
                      <div className="text-[7pt] opacity-75 mt-0.5">Assiette M×T×P — taux {mafTauxContratPermil} ‰</div>
                    </div>
                  )}
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
                          <span>- Acompte {data.schedule.paymentAcompte1Percent} % à la commande</span>
                          <span>{(totalTTC * data.schedule.paymentAcompte1Percent / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € TTC</span>
                        </div>
                        <div className="flex justify-between">
                          <span>- Acompte {data.schedule.paymentAcompte2Percent} % au dépôt de l'AU</span>
                          <span>{(totalTTC * data.schedule.paymentAcompte2Percent / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € TTC</span>
                        </div>
                        <div className="flex justify-between">
                          <span>- Solde {paymentSoldePercent} % à l'obtention de l'AU</span>
                          <span>{(totalTTC * paymentSoldePercent / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € TTC</span>
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
              </>
              )}

              {data.proposalType === 'court' && (
              <>
              {/* PAGE COURTE 1 */}
              <div className={`pdf-page bg-white text-black ${data.pageFormat === 'portrait' ? 'w-[210mm] h-[297mm]' : 'w-[297mm] h-[210mm]'} p-[20mm] shadow-xl font-sans text-[10pt] leading-relaxed flex flex-col`} style={{ fontFamily: 'Inter, sans-serif' }}>
                {/* Header */}
                <div className="flex justify-between items-start mb-8 pb-4 border-b-2 border-black">
                  <div className="flex items-center gap-3">
                    {logoUrl && <img src={logoUrl} alt="Logo" style={{ height: '48px', maxWidth: '160px', objectFit: 'contain', display: 'block' }} crossOrigin="anonymous" />}
                    {agencyName && <span className="text-lg font-bold uppercase text-zinc-900">{agencyName}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="text-[8pt] font-bold text-red-600 uppercase">Ordre des</p>
                      <p className="text-[8pt] font-bold text-red-600 uppercase">Architectes</p>
                    </div>
                    <div className="w-12 h-12 bg-black flex items-center justify-center text-white font-bold text-xl">OA</div>
                  </div>
                </div>

                <h2 className="text-center font-bold uppercase mb-8 border-b-2 border-black pb-2 text-[11pt]">
                  PROPOSITION D'HONORAIRES - {MISSION_COURTE_TITLE}
                </h2>

                <div className="space-y-3 mb-6 text-[9pt]">
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
                      <p>{data.architect.name}</p>
                      <p>Ordre des Architectes n° : {data.architect.oaNumber}</p>
                      <p>Assurance MAF n° : {data.architect.mafNumber}</p>
                    </div>
                  </div>
                </div>

                <div className="mb-6">
                  <h3 className="font-bold underline mb-2 text-[9pt]">Informations Projet :</h3>
                  <div className="grid grid-cols-2 gap-x-12 gap-y-1 text-[9pt]">
                    <div className="grid grid-cols-[170px_1fr] gap-y-1">
                      <span className="underline">Référence cadastrale :</span><span>{data.project.cadastralRef}</span>
                      <span className="underline">Surface terrain :</span><span>{data.project.siteSurface} m²</span>
                      <span className="underline">Surface existante (SHON) :</span><span>{data.project.existingSurface} m²</span>
                      <span className="underline">Emprise au sol existante :</span><span>{data.project.existingFootprint} m²</span>
                      <span className="underline">Emprise au sol projetée :</span><span>{data.project.projectedFootprint}</span>
                      <span className="underline">SDO projetée :</span><span>{data.project.projectedFloorArea} m²</span>
                      <span className="underline">Enveloppe Prévisionnelle :</span><span>{(computedMontantTravaux ?? (parseFloat(data.project.provisionalEnvelope) || 0)).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                    </div>
                    <div className="space-y-1">
                      <div><span className="underline">Adresse Terrain :</span> {data.project.siteAddress}</div>
                      <div className="mt-2">Montant estimé travaux (Hors VRD) <span className="font-bold">{(computedMontantTravaux ?? (parseFloat(data.project.estimatedWorksCost) || 0)).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT</span></div>
                      <div className="text-[7pt] text-zinc-500">Taxe d'Aménagement, Maîtrise d'Oeuvre et Frais divers non compris</div>
                      <div className="text-[7pt] text-zinc-500">Estimation sur la base des ratios MAF (Mutuelle des Arch. Français) — {data.financials.mafRatioPerM2.toLocaleString('fr-FR')} €/m² ({data.financials.mafRatioYear})</div>
                    </div>
                  </div>
                </div>

                <div className="mb-6">
                  <h3 className="font-bold underline mb-2 text-[9pt]">Programme de l'opération :</h3>
                  <div className="text-[9pt] space-y-1">
                    <div className="flex gap-2"><span>-</span><span>{data.programShort.description}</span></div>
                    <div className="ml-4">Nombre de niveaux : {data.programShort.levels}</div>
                    <div className="ml-4">Type de bâtiment : {data.programShort.buildingType}</div>
                    <div className="ml-4">Stationnement : {data.programShort.parking}</div>
                  </div>
                </div>

                <div className="mb-6">
                  <h3 className="font-bold underline mb-2 text-[9pt]">Proposition de missions :</h3>
                  <p className="text-[8pt] font-bold uppercase underline mb-2">{MISSION_COURTE_TITLE}</p>
                  <ul className="list-none space-y-1 text-[9pt]">
                    {data.missions.map((m, i) => (
                      <li key={i} className="flex gap-2">
                        <span>-</span>
                        <span>{m}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-auto w-full max-w-[320px] space-y-1 text-[9pt]">
                  {data.financials.includePreliminaryStudies && (
                    <div className="flex justify-between">
                      <span className="font-bold">Mission d'Etudes Préliminaires</span>
                      <span>{effectivePreliminaryStudies.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="font-bold">Mission Autorisation d'Urbanisme</span>
                    <span>{effectiveUrbanPlanningMission.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT</span>
                  </div>
                  <div className="flex justify-between border-t border-black pt-1">
                    <span>TOTAL HT</span>
                    <span>{(effectivePreliminaryStudies + effectiveUrbanPlanningMission).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT</span>
                  </div>
                  {data.financials.applyDiscount && (
                    <div className="flex justify-between text-zinc-600">
                      <span>Remise -{data.financials.commercialDiscountPercent.toFixed(0)} %</span>
                      <span>-{discount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t-2 border-black pt-1">
                    <span>TOTAL HT</span>
                    <span>{totalHT.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT</span>
                  </div>
                </div>

                {/* Footer Legal */}
                <div className="mt-8 pt-4 border-t border-zinc-200 text-[7pt] text-center text-zinc-400">
                  <p>
                    {agencyName}{agencyAddress ? ` - ${agencyAddress}` : ''}{agencyEmail ? ` : ${agencyEmail}` : ''}
                    {agencySiret ? ` - SIRET ${agencySiret}` : ''}{data.architect.oaNumber ? ` – OA : ${data.architect.oaNumber}` : ''}{agencyVat ? ` - TVA : ${agencyVat}` : ''}
                  </p>
                </div>
              </div>

              {/* PAGE COURTE 2 */}
              <div className={`pdf-page bg-white text-black ${data.pageFormat === 'portrait' ? 'w-[210mm] h-[297mm]' : 'w-[297mm] h-[210mm]'} p-[20mm] shadow-xl font-sans text-[10pt] leading-relaxed flex flex-col`} style={{ fontFamily: 'Inter, sans-serif' }}>
                <div className="w-full max-w-[320px] ml-auto space-y-1 text-[9pt] mb-8">
                  <div className="flex justify-between">
                    <span>TVA {data.financials.tvaPercent.toFixed(0)} %</span>
                    <span>{tva.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                  </div>
                  <div className="flex justify-between font-bold text-[10pt] border-t-2 border-black pt-1">
                    <span>TOTAL TTC</span>
                    <span>{totalTTC.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € TTC</span>
                  </div>
                </div>

                <p className="text-[8pt] text-zinc-600 mb-6">
                  Nota : La mission limitée au projet architectural n'intègre pas les plans d'exécution, la consultation des entreprises, ni le suivi des travaux et réception. La mission se termine à l'obtention de l'autorisation d'urbanisme. Elle n'intègre pas les plans de réseaux, les plans techniques (Elec, CVC…)
                </p>

                {decennaleShort !== null && (
                  <div className="mb-8 text-[9pt]">
                    <p><span className="font-bold">Dont Assurance Décennale = Surface Plancher x {data.financials.mafRatioPerM2.toLocaleString('fr-FR')}€ x {mafTauxContratPermil.toLocaleString('fr-FR')}%</span> : {decennaleShort.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}</p>
                    <p className="text-[7pt] italic text-zinc-500 mt-1">Dans l'hypothèse d'augmentation de la surface de plancher en cours d'études, le montant de l'assurance sera recalculé selon la formule ci-dessus, la facture finale sera revalorisée pour inclure l'augmentation des frais d'assurances</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-12 mb-8">
                  <div className="space-y-2">
                    <h3 className="font-bold underline text-[9pt]">Echéancier :</h3>
                    <div className="grid grid-cols-[190px_1fr] gap-y-1 text-[9pt]">
                      <span>Début de l'esquisse</span><span>{data.schedule.sketchStart}</span>
                      <span>Délai de l'Avant Projet</span><span>{data.schedule.preliminaryProject}</span>
                      <span>Délai de l'élaboration de l'Autorisation d'Urbanisme</span><span>{data.schedule.urbanPlanningElaboration}</span>
                      <span>Délai d'instruction du dossier :</span><span>{data.schedule.instructionDelay}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-bold underline text-[9pt]">Paiement :</h3>
                    <div className="space-y-1 text-[9pt]">
                      <div className="flex justify-between">
                        <span>- Acompte {data.schedule.paymentAcompte1Percent} % à la commande</span>
                        <span>{(totalTTC * data.schedule.paymentAcompte1Percent / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                      </div>
                      <div className="flex justify-between">
                        <span>- Acompte {data.schedule.paymentAcompte2Percent} % au dépôt de l'Autorisation d'Urbanisme</span>
                        <span>{(totalTTC * data.schedule.paymentAcompte2Percent / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                      </div>
                      <div className="flex justify-between">
                        <span>- Solde {paymentSoldePercent} % à l'obtention de l'Autorisation d'Urbanisme</span>
                        <span>{(totalTTC * paymentSoldePercent / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-end mb-8 text-[9pt]">
                  <div>
                    <p>A {data.architect.city}, le {new Date().toLocaleDateString('fr-FR')}</p>
                    <p className="mt-1">{data.architect.name}</p>
                    <div className="mt-4 w-32 h-16 border border-zinc-100"></div>
                  </div>
                  <div className="text-right">
                    <p>A ........................., le .........................</p>
                    <p className="mt-1">Bon pour mission, le client,</p>
                    <div className="mt-4 ml-auto w-32 h-16 border border-zinc-100"></div>
                  </div>
                </div>

                <div className="text-[7.5pt] text-zinc-600 italic space-y-2 mb-6">
                  <p className="font-bold not-italic">Nota :</p>
                  <p>
                    La mission partielle n'intègre pas les plans d'exécution, les tests d'étanchéité à l'air, l'étude thermique et l'attestation thermique de fin de chantier.
                    {decennaleShort !== null && (
                      <> Le prix indiqué comprend les frais d'assurance décennale pour {decennaleShort.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € et les taxes pour {tva.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € soit un total de {(decennaleShort + tva).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</>
                    )}
                  </p>
                  <p>La présente mission se termine à l'obtention de l'autorisation d'urbanisme (Permis de Construire ou Déclaration Préalable)</p>
                </div>

                <div className="text-[7.5pt] text-zinc-600 space-y-2 mb-6">
                  <p className="font-bold">Assurance dommages-ouvrage (DO)</p>
                  <p className="italic">Il est rappelé que conformément à l'article L. 242-1 du Code des assurances, le maître d'ouvrage est tenu de souscrire une assurance dommages-ouvrage avant l'ouverture du chantier, garantissant la prise en charge immédiate des réparations relevant de la responsabilité décennale, sans attendre la détermination des responsabilités.</p>
                </div>

                <div className="text-[7.5pt] text-zinc-600 space-y-2">
                  <p className="italic">Rappel des frais et coûts annexes à la charge du maître d'ouvrage, non compris dans la prestation</p>
                  <p className="whitespace-pre-wrap">{data.appendixNotes}</p>
                </div>

                {/* Footer Legal */}
                <div className="mt-auto pt-8 border-t border-zinc-200 text-[7pt] text-center text-zinc-400">
                  <p>
                    {agencyName}{agencyAddress ? ` - ${agencyAddress}` : ''}{agencyEmail ? ` : ${agencyEmail}` : ''}
                    {agencySiret ? ` - SIRET ${agencySiret}` : ''}{data.architect.oaNumber ? ` – OA : ${data.architect.oaNumber}` : ''}{agencyVat ? ` - TVA : ${agencyVat}` : ''}
                  </p>
                </div>
              </div>
              </>
              )}
            </div>
          </div>

          {view === 'edit' && (
            <div className="space-y-8 max-w-3xl mx-auto bg-white dark:bg-zinc-900 p-8 rounded-xl border border-zinc-200 dark:border-zinc-800">
              {/* PDF Settings */}
              <section className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 pb-2">Paramètres PDF</h3>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-500">Type de proposition</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2">
                      <input type="radio" name="proposalType" value="court" checked={data.proposalType === 'court'} onChange={() => setData({...data, proposalType: 'court'})} />
                      Courte (2 pages)
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" name="proposalType" value="detaille" checked={data.proposalType === 'detaille'} onChange={() => setData({...data, proposalType: 'detaille'})} />
                      Détaillée (5 pages)
                    </label>
                  </div>
                </div>
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
              {data.proposalType === 'detaille' && (
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
              )}

              {/* Maître d'Œuvre (Proposition courte) */}
              {data.proposalType === 'court' && (
              <section className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 pb-2">Maître d'Œuvre</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-zinc-500">Nom de l'architecte</label>
                    <input type="text" value={data.architect.name} onChange={(e) => setData({...data, architect: {...data.architect, name: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Ordre des Architectes n°</label>
                    <input type="text" value={data.architect.oaNumber} onChange={(e) => setData({...data, architect: {...data.architect, oaNumber: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Assurance MAF n°</label>
                    <input type="text" value={data.architect.mafNumber} onChange={(e) => setData({...data, architect: {...data.architect, mafNumber: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Ville de signature</label>
                    <input type="text" value={data.architect.city} onChange={(e) => setData({...data, architect: {...data.architect, city: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                </div>
              </section>
              )}

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

              {/* Informations Projet — complément (Proposition courte) */}
              {data.proposalType === 'court' && (
              <section className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 pb-2">Informations Projet — Complément</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-zinc-500">Adresse Terrain</label>
                    <input type="text" value={data.project.siteAddress} onChange={(e) => setData({...data, project: {...data.project, siteAddress: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Surface existante - SHON (m²)</label>
                    <input type="text" value={data.project.existingSurface} onChange={(e) => setData({...data, project: {...data.project, existingSurface: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Emprise au sol existante (m²)</label>
                    <input type="text" value={data.project.existingFootprint} onChange={(e) => setData({...data, project: {...data.project, existingFootprint: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Emprise au sol projetée</label>
                    <input type="text" value={data.project.projectedFootprint} onChange={(e) => setData({...data, project: {...data.project, projectedFootprint: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">SDO projetée (m²)</label>
                    <input type="text" value={data.project.projectedFloorArea} onChange={(e) => setData({...data, project: {...data.project, projectedFloorArea: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Enveloppe Prévisionnelle (€)</label>
                    <input type="text" value={data.project.provisionalEnvelope} onChange={(e) => setData({...data, project: {...data.project, provisionalEnvelope: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                </div>
              </section>
              )}

              {/* Programme (Proposition courte) */}
              {data.proposalType === 'court' && (
              <section className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 pb-2">Programme de l'opération</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-zinc-500">Description</label>
                    <textarea value={data.programShort.description} onChange={(e) => setData({...data, programShort: {...data.programShort, description: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm h-20" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Nombre de niveaux</label>
                    <input type="text" value={data.programShort.levels} onChange={(e) => setData({...data, programShort: {...data.programShort, levels: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Type de bâtiment</label>
                    <input type="text" value={data.programShort.buildingType} onChange={(e) => setData({...data, programShort: {...data.programShort, buildingType: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-medium text-zinc-500">Stationnement</label>
                    <input type="text" value={data.programShort.parking} onChange={(e) => setData({...data, programShort: {...data.programShort, parking: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                </div>
              </section>
              )}

              {/* Financials */}
              <section className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 pb-2">Honoraires</h3>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-500">Mode de tarification</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="radio" name="pricingMode" value="fixed" checked={data.financials.pricingMode === 'fixed'} onChange={() => setData({...data, financials: {...data.financials, pricingMode: 'fixed'}})} />
                      Montant fixe
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="radio" name="pricingMode" value="percentTravaux" checked={data.financials.pricingMode === 'percentTravaux'} onChange={() => setData({...data, financials: {...data.financials, pricingMode: 'percentTravaux'}})} />
                      % du montant des travaux (ratio MAF)
                    </label>
                  </div>
                </div>

                {data.financials.pricingMode === 'percentTravaux' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-500">Taux MAF (€/m²)</label>
                      <input type="number" value={data.financials.mafRatioPerM2} onChange={(e) => setData({...data, financials: {...data.financials, mafRatioPerM2: parseFloat(e.target.value) || 0}})} className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-500">Année du taux</label>
                      <input type="text" value={data.financials.mafRatioYear} onChange={(e) => setData({...data, financials: {...data.financials, mafRatioYear: e.target.value}})} className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-500">Honoraires (% du montant travaux)</label>
                      <input type="number" step="0.1" value={data.financials.honorairesPercent} onChange={(e) => setData({...data, financials: {...data.financials, honorairesPercent: parseFloat(e.target.value) || 0}})} className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                    </div>
                    {data.financials.includePreliminaryStudies && (
                      <div className="space-y-1 md:col-span-3">
                        <label className="text-xs font-medium text-zinc-500">Part des honoraires allouée aux Etudes Préliminaires (%)</label>
                        <input type="number" value={data.financials.preliminaryStudiesSharePercent} onChange={(e) => setData({...data, financials: {...data.financials, preliminaryStudiesSharePercent: parseFloat(e.target.value) || 0}})} className="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input type="checkbox" id="includePrelim" checked={data.financials.includePreliminaryStudies} onChange={(e) => setData({...data, financials: {...data.financials, includePreliminaryStudies: e.target.checked}})} className="w-4 h-4 text-blue-600 rounded border-zinc-300" />
                  <label htmlFor="includePrelim" className="text-sm text-zinc-700 dark:text-zinc-300">Inclure la mission d'Etudes Préliminaires</label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {data.financials.pricingMode === 'fixed' && data.financials.includePreliminaryStudies && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-500">Etudes Préliminaires (€)</label>
                      <input
                        type="number"
                        value={data.financials.preliminaryStudies}
                        onChange={(e) => setData({...data, financials: {...data.financials, preliminaryStudies: parseFloat(e.target.value) || 0}})}
                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                      />
                    </div>
                  )}
                  {data.financials.pricingMode === 'fixed' && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-500">Mission Autorisation (€)</label>
                      <input
                        type="number"
                        value={data.financials.urbanPlanningMission}
                        onChange={(e) => setData({...data, financials: {...data.financials, urbanPlanningMission: parseFloat(e.target.value) || 0}})}
                        className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                      />
                    </div>
                  )}
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

                <div className="flex items-center gap-2">
                  <input type="checkbox" id="applyDiscount" checked={data.financials.applyDiscount} onChange={(e) => setData({...data, financials: {...data.financials, applyDiscount: e.target.checked}})} className="w-4 h-4 text-blue-600 rounded border-zinc-300" />
                  <label htmlFor="applyDiscount" className="text-sm text-zinc-700 dark:text-zinc-300">Appliquer une remise commerciale</label>
                </div>
                {data.financials.applyDiscount && (
                  <div className="space-y-1 max-w-xs">
                    <label className="text-xs font-medium text-zinc-500">Remise Commerciale (%)</label>
                    <input
                      type="number"
                      value={data.financials.commercialDiscountPercent}
                      onChange={(e) => setData({...data, financials: {...data.financials, commercialDiscountPercent: parseFloat(e.target.value) || 0}})}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                    />
                  </div>
                )}
              </section>

              {/* Rappel des frais annexes (Proposition courte) */}
              {data.proposalType === 'court' && (
              <section className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 pb-2">Rappel des frais annexes</h3>
                <textarea value={data.appendixNotes} onChange={(e) => setData({...data, appendixNotes: e.target.value})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm h-40" />
              </section>
              )}

              {/* Échéancier */}
              <section className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 pb-2">Échéancier</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Début de l'esquisse</label>
                    <input type="text" value={data.schedule.sketchStart} onChange={(e) => setData({...data, schedule: {...data.schedule, sketchStart: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Délai de l'Avant Projet</label>
                    <input type="text" value={data.schedule.preliminaryProject} onChange={(e) => setData({...data, schedule: {...data.schedule, preliminaryProject: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Délai d'élaboration de l'Autorisation d'Urbanisme</label>
                    <input type="text" value={data.schedule.urbanPlanningElaboration} onChange={(e) => setData({...data, schedule: {...data.schedule, urbanPlanningElaboration: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-500">Délai d'instruction du dossier</label>
                    <input type="text" value={data.schedule.instructionDelay} onChange={(e) => setData({...data, schedule: {...data.schedule, instructionDelay: e.target.value}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Échéancier de paiement</label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-1">
                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-400">Acompte à la commande (%)</label>
                      <input type="number" min={0} max={100} value={data.schedule.paymentAcompte1Percent} onChange={(e) => setData({...data, schedule: {...data.schedule, paymentAcompte1Percent: parseFloat(e.target.value) || 0}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-400">Acompte au dépôt de l'AU (%)</label>
                      <input type="number" min={0} max={100} value={data.schedule.paymentAcompte2Percent} onChange={(e) => setData({...data, schedule: {...data.schedule, paymentAcompte2Percent: parseFloat(e.target.value) || 0}})} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-400">Solde à l'obtention de l'AU (%)</label>
                      <input type="number" value={paymentSoldePercent} readOnly className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-500" />
                    </div>
                  </div>
                </div>
              </section>

              {/* MAF Insurance Cost */}
              {mafPluginEnabled && (
                <section className="space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 pb-2">Assurance MAF</h3>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="showMafCost"
                      checked={showMafCost}
                      onChange={e => setShowMafCost(e.target.checked)}
                      className="w-4 h-4 text-orange-500 rounded border-zinc-300 focus:ring-orange-500"
                    />
                    <label htmlFor="showMafCost" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Afficher le coût assurance MAF</label>
                  </div>
                  {showMafCost && data.proposalType === 'court' && (
                    <p className="text-xs text-zinc-500">Taux de mission fixé à {MAF_TAUX_MISSION_COURTE} % (mission limitée au projet architectural — PC/DP seul).</p>
                  )}
                  {showMafCost && data.proposalType === 'detaille' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-zinc-500">Taux de mission T (%)</label>
                        <select
                          value={mafTauxMission}
                          onChange={e => setMafTauxMission(parseInt(e.target.value))}
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                        >
                          <option value={30}>30 % — Mission PC seule</option>
                          <option value={60}>60 % — Mission partielle</option>
                          <option value={100}>100 % — Mission complète</option>
                          <option value={110}>110 % — Mission complète + OPC</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-zinc-500">Part d'intérêt P (%)</label>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={mafPartInteret}
                          onChange={e => setMafPartInteret(parseFloat(e.target.value) || 100)}
                          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm"
                        />
                      </div>
                      <div className="md:col-span-2 flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="mafMaisonInd"
                          checked={mafIsMaisonInd}
                          onChange={e => setMafIsMaisonInd(e.target.checked)}
                          className="w-4 h-4 text-orange-500 rounded border-zinc-300"
                        />
                        <label htmlFor="mafMaisonInd" className="text-xs text-zinc-600 dark:text-zinc-400">Maison individuelle (coût moyen MAF 1 714 €/m²)</label>
                      </div>
                    </div>
                  )}
                </section>
              )}

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
              {data.proposalType === 'detaille' && (
              <>
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
              </>
              )}
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
