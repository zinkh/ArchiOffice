// Calcul des honoraires (montant des travaux → taux de complexité → %
// d'honoraires, avec l'assistant MIQCP), tableau des cotraitants et grille
// de répartition des honoraires — extrait de src/pages/Proposals.tsx pour
// être partagé, à l'identique, avec l'onglet Honoraires d'un appel d'offres
// MAPA (src/pages/TenderDetail.tsx). Un devis et un appel d'offres ne
// partagent pas le même schéma de données (Proposal.amount vs
// tenders.value, Proposal.specialties_list vs TenderSpecialty...), d'où le
// type `HonorairesDoc` générique : chaque appelant adapte son propre objet
// à cette forme plutôt que ce composant ne connaisse Proposal ou Tender.
import * as React from 'react';
import { IconPlus, IconFileSpreadsheet, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../lib/utils';
import type { Contact, Milestone, MiqcpAssessment } from '../types';
import { ContactAutocomplete } from './ContactAutocomplete';
import { ContactModal } from './ContactModal';
import { CONTACT_CATEGORY_COTRAITANT } from '../lib/contactCategories';
import { MiqcpComplexityWizardModal } from './MiqcpComplexityWizardModal';
import { MIQCP_PHASE_REPARTITION_GUIDE } from '../lib/miqcpGuide';
import { DEFAULT_MISSIONS, calculateFeeRatios, defaultFeeDistribution, exportFeeDistributionToXlsx } from '../lib/feeDistribution';
import { FeeDistributionGrid } from './FeeDistributionGrid';

export interface HonorairesSpecialty {
  id?: string;
  specialty_name?: string;
  contact_id?: string;
}

export interface HonorairesDoc {
  id?: string;
  amount?: number; // montant des honoraires HT (Proposal.amount / tenders.value)
  construction_cost?: number;
  complexity_rate?: number;
  base_fee_percent?: number;
  miqcp_assessment?: string;
  fee_distribution?: string;
  specialties_list?: HonorairesSpecialty[];
  decimal_precision?: number;
  vat_rate?: number;
}

export interface HonorairesSectionProps {
  doc: HonorairesDoc;
  onChange: (patch: Partial<HonorairesDoc>) => void;
  contacts: Contact[];
  onContactCreated: (contact: Contact) => void;
  milestones: Milestone[];
  onMilestonesChange: (milestones: Milestone[]) => void;
  milestoneEntityField: 'proposal_id' | 'tender_id';
  filenameLabel: string;
  /**
   * Faux quand la liste des cotraitants (doc.specialties_list) est déjà
   * éditée ailleurs — l'onglet Partenaires d'un appel d'offres la gère déjà
   * (src/pages/TenderDetail.tsx), donc l'onglet Honoraires ne fait que la
   * LIRE pour peupler les colonnes de la grille de répartition, sans la
   * dupliquer. Une proposition n'a pas d'onglet séparé : true par défaut.
   */
  showCotraitantsTable?: boolean;
}

const fieldStyle = { background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };

function NumberField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-[0.6875rem] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>{label}</label>
      <input
        type="number"
        className="w-full px-3 py-2 rounded-lg outline-none text-sm"
        style={fieldStyle}
        value={(typeof value === 'number' && isNaN(value)) ? '' : (value ?? '')}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function HonorairesSection({ doc, onChange, contacts, onContactCreated, milestones, onMilestonesChange, milestoneEntityField, filenameLabel, showCotraitantsTable = true }: HonorairesSectionProps) {
  const { t } = useTranslation();
  const [isMiqcpWizardOpen, setIsMiqcpWizardOpen] = React.useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = React.useState(false);
  const [addingSpecialtyIdx, setAddingSpecialtyIdx] = React.useState<number | null>(null);

  const feeRatios = React.useMemo(() => calculateFeeRatios(doc.fee_distribution), [doc.fee_distribution]);
  const calculatedExePercent = (doc.base_fee_percent || 0) * feeRatios.exeRatio;
  const calculatedTotalPercent = (doc.base_fee_percent || 0) * feeRatios.totalRatio;

  const miqcpAssessment: MiqcpAssessment | null = React.useMemo(() => {
    if (!doc.miqcp_assessment) return null;
    try { return JSON.parse(doc.miqcp_assessment); } catch { return null; }
  }, [doc.miqcp_assessment]);

  const handleApplyMiqcpAssessment = (result: { complexityRate: number; baseFeePercent: number; assessment: MiqcpAssessment }) => {
    onChange({
      complexity_rate: result.complexityRate,
      base_fee_percent: result.baseFeePercent,
      miqcp_assessment: JSON.stringify(result.assessment),
      construction_cost: result.assessment.montantTravauxHT,
    });
    setIsMiqcpWizardOpen(false);
  };

  const handleLoadMiqcpPhaseRepartition = () => {
    const currentData = doc.fee_distribution ? JSON.parse(doc.fee_distribution) : defaultFeeDistribution();
    const baseTotal = doc.amount || 0;
    const precision = doc.decimal_precision ?? 2;
    const missions = (currentData.missions || []).map((m: any) => {
      const guidePct = MIQCP_PHASE_REPARTITION_GUIDE.find(p => p.id === m.id)?.pct;
      if (guidePct === undefined) return m;
      return { ...m, default_pct: guidePct, amount: Number((baseTotal * (guidePct / 100)).toFixed(precision)) };
    });
    onChange({ fee_distribution: JSON.stringify({ ...currentData, missions }) });
  };

  const addMission = (category: 'Mission base' | 'Mission Exécution' | 'Missions complémentaires', defaultName: string) => {
    const currentData = JSON.parse(doc.fee_distribution || JSON.stringify(defaultFeeDistribution()));
    const newMission = { id: `mission-${Date.now()}`, name: defaultName, category, percentages: { architect: 100 } };
    onChange({ fee_distribution: JSON.stringify({ ...currentData, missions: [...(currentData.missions || []), newMission] }) });
  };

  // Recalcule le montant des honoraires quand le montant des travaux, le
  // taux de complexité ou le % d'honoraires de base change — même garde que
  // Proposals.tsx pour ne pas boucler sur un arrondi.
  React.useEffect(() => {
    if (doc.construction_cost && doc.complexity_rate && doc.base_fee_percent) {
      const calculatedAmount = doc.construction_cost * (doc.base_fee_percent / 100) * doc.complexity_rate;
      if (Math.abs(calculatedAmount - (doc.amount || 0)) > 0.01) {
        onChange({ amount: Number(calculatedAmount.toFixed(2)) });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.construction_cost, doc.complexity_rate, doc.base_fee_percent]);

  // Répercute un changement du montant global sur les missions de base de
  // la grille de répartition, au prorata de leur poids actuel.
  React.useEffect(() => {
    if (!doc.fee_distribution) return;
    try {
      const data = JSON.parse(doc.fee_distribution);
      const missions = data.missions || [];
      const baseMissions = missions.filter((m: any) => m.category === 'Mission base');
      if (baseMissions.length === 0) return;

      const currentBaseTotal = baseMissions.reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
      const targetBaseTotal = doc.amount || 0;

      if (Math.abs(currentBaseTotal - targetBaseTotal) > 0.01) {
        const updatedMissions = missions.map((m: any) => {
          if (m.category === 'Mission base') {
            if (baseMissions.length === 1) return { ...m, amount: targetBaseTotal };
            if (currentBaseTotal === 0) {
              const defaultPct = DEFAULT_MISSIONS.find(dm => dm.id === m.id)?.default_pct || (100 / baseMissions.length);
              return { ...m, amount: Number((targetBaseTotal * (defaultPct / 100)).toFixed(doc.decimal_precision ?? 2)) };
            }
            const relPct = (m.amount || 0) / currentBaseTotal;
            return { ...m, amount: Number((targetBaseTotal * relPct).toFixed(doc.decimal_precision ?? 2)) };
          }
          return m;
        });
        onChange({ fee_distribution: JSON.stringify({ ...data, missions: updatedMissions }) });
      }
    } catch (e) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.amount, doc.decimal_precision]);

  const addSpecialtyRow = () => {
    onChange({ specialties_list: [...(doc.specialties_list || []), { id: `new-${Date.now()}`, specialty_name: '', contact_id: '' }] });
  };
  const removeSpecialtyRow = (idx: number) => {
    onChange({ specialties_list: (doc.specialties_list || []).filter((_, i) => i !== idx) });
  };
  const updateSpecialty = (idx: number, field: 'specialty_name' | 'contact_id', value: string) => {
    const list = [...(doc.specialties_list || [])];
    list[idx] = { ...list[idx], [field]: value };
    onChange({ specialties_list: list });
  };

  return (
    <>
      {/* Honoraires */}
      <div className="space-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-6">
        <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400">{t('proposals_section_honoraires')}</h3>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => setIsMiqcpWizardOpen(true)}
            className="text-[0.6875rem] flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold uppercase tracking-wider bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded"
          >
            {t('miqcp_wizard_open_btn')}
          </button>
          {miqcpAssessment && (
            <span className="text-[0.6875rem] text-zinc-500 dark:text-zinc-400">
              {t('miqcp_wizard_summary', { cc: miqcpAssessment.coefficientComplexite.toFixed(2), taux: miqcpAssessment.tauxReference.toFixed(2) })}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <NumberField label="Montant des travaux (€)" value={doc.construction_cost} onChange={v => onChange({ construction_cost: v })} />
          <NumberField label="Taux de complexité" value={doc.complexity_rate} onChange={v => onChange({ complexity_rate: v })} />
          <NumberField label="% Honoraires Base" value={doc.base_fee_percent} onChange={v => onChange({ base_fee_percent: v })} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <NumberField label="Montant Honoraires HT (€)" value={doc.amount} onChange={v => onChange({ amount: v })} />
          <div className="space-y-1.5">
            <label className="text-[0.6875rem] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('proposals_pct_with_execution')}</label>
            <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-medium text-zinc-900 dark:text-white">
              {calculatedExePercent.toFixed(2)} %
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[0.6875rem] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('proposals_pct_with_complementary')}</label>
            <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-medium text-zinc-900 dark:text-white">
              {calculatedTotalPercent.toFixed(2)} %
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <NumberField label="Taux de TVA (%)" value={doc.vat_rate} onChange={v => onChange({ vat_rate: v })} />
          <div className="space-y-1.5">
            <label className="text-[0.6875rem] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Montant TVA (€)</label>
            <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-medium text-zinc-900 dark:text-white">
              {formatCurrency((doc.amount || 0) * ((doc.vat_rate || 0) / 100))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[0.6875rem] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Montant TTC (€)</label>
            <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm font-bold text-blue-700 dark:text-blue-400">
              {formatCurrency((doc.amount || 0) + (doc.amount || 0) * ((doc.vat_rate || 0) / 100))}
            </div>
          </div>
        </div>
      </div>

      {/* Cotraitants / Spécialités */}
      {showCotraitantsTable && (
        <div className="space-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400">{t('proposals_section_cotraitants')}</h3>
            <button type="button" onClick={addSpecialtyRow} className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold uppercase tracking-wider">
              <IconPlus size={14} /> {t('proposals_add_specialty')}
            </button>
          </div>
          <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-visible bg-white dark:bg-zinc-900/50">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                <tr>
                  <th className="px-4 py-3 text-left font-bold text-zinc-500 uppercase tracking-wider">{t('proposals_specialty_col')}</th>
                  <th className="px-4 py-3 text-left font-bold text-zinc-500 uppercase tracking-wider">{t('proposals_contact_col')}</th>
                  <th className="px-4 py-3 text-right font-bold text-zinc-500 uppercase tracking-wider w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {(doc.specialties_list || []).map((spec, idx) => (
                  <tr key={spec.id || idx}>
                    <td className="px-4 py-3">
                      <input
                        placeholder="Ex: BET Structure"
                        className="w-full bg-transparent outline-none focus:ring-2 focus:ring-blue-500/20 rounded-lg px-2 py-1 text-zinc-900 dark:text-white"
                        value={spec.specialty_name || ''}
                        onChange={e => updateSpecialty(idx, 'specialty_name', e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <ContactAutocomplete
                        contacts={contacts}
                        value={spec.contact_id || ''}
                        onChange={val => updateSpecialty(idx, 'contact_id', val)}
                        onAddNew={() => { setAddingSpecialtyIdx(idx); setIsContactModalOpen(true); }}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => removeSpecialtyRow(idx)} className="text-red-500 hover:text-red-700 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                        <IconTrash size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
                {(!doc.specialties_list || doc.specialties_list.length === 0) && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-zinc-400 italic">{t('proposals_no_cotraitants')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Répartition des honoraires */}
      <div className="space-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400">{t('proposals_section_fee_distribution')}</h3>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <label className="text-[0.6875rem] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Décimales</label>
              <input
                type="number" min="0" max="4"
                value={(typeof doc.decimal_precision === 'number' && isNaN(doc.decimal_precision)) ? '' : (doc.decimal_precision ?? '')}
                onChange={e => onChange({ decimal_precision: Number(e.target.value) })}
                className="w-10 bg-transparent text-xs font-bold text-zinc-900 dark:text-white outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => exportFeeDistributionToXlsx(doc.fee_distribution, doc.specialties_list, contacts, doc.vat_rate, filenameLabel)}
              className="text-[0.6875rem] flex items-center gap-1 text-green-700 hover:text-green-800 font-bold uppercase tracking-wider bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded"
            >
              <IconFileSpreadsheet size={12} /> {t('proposals_export_xlsx')}
            </button>
            <button type="button" onClick={handleLoadMiqcpPhaseRepartition} className="text-[0.6875rem] flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold uppercase tracking-wider bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded">
              {t('miqcp_wizard_load_phase_repartition_btn')}
            </button>
            <button type="button" onClick={() => addMission('Mission base', 'Nouvelle Mission Base')} className="text-[0.6875rem] flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold uppercase tracking-wider bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded">
              <IconPlus size={12} /> {t('proposals_mission_base')}
            </button>
            <button type="button" onClick={() => addMission('Mission Exécution', 'Nouvelle Mission Exé')} className="text-[0.6875rem] flex items-center gap-1 text-green-600 hover:text-green-700 font-bold uppercase tracking-wider bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded">
              <IconPlus size={12} /> {t('proposals_mission_execution')}
            </button>
            <button type="button" onClick={() => addMission('Missions complémentaires', 'Nouvelle Mission Comp')} className="text-[0.6875rem] flex items-center gap-1 text-purple-600 hover:text-purple-700 font-bold uppercase tracking-wider bg-purple-50 dark:bg-purple-900/20 px-2 py-1 rounded">
              <IconPlus size={12} /> {t('proposals_mission_complementary')}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-700 rounded-lg p-2 bg-white dark:bg-zinc-900/50 min-h-[400px]">
          <FeeDistributionGrid
            doc={doc}
            contacts={contacts}
            milestones={milestones}
            onMilestonesChange={onMilestonesChange}
            milestoneEntityField={milestoneEntityField}
            onChange={data => onChange({ fee_distribution: JSON.stringify(data) })}
          />
        </div>
      </div>

      {isMiqcpWizardOpen && (
        <MiqcpComplexityWizardModal
          montantTravaux={doc.construction_cost || 0}
          initialAssessment={miqcpAssessment}
          onApply={handleApplyMiqcpAssessment}
          onClose={() => setIsMiqcpWizardOpen(false)}
        />
      )}

      <ContactModal
        isOpen={isContactModalOpen}
        initialCategory={CONTACT_CATEGORY_COTRAITANT}
        onClose={() => setIsContactModalOpen(false)}
        onSuccess={(newContact) => {
          onContactCreated(newContact);
          if (addingSpecialtyIdx !== null) updateSpecialty(addingSpecialtyIdx, 'contact_id', newContact.id);
          setAddingSpecialtyIdx(null);
          setIsContactModalOpen(false);
        }}
      />
    </>
  );
}
