import * as React from 'react';
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { IconX, IconChevronLeft, IconChevronRight, IconCalculator } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import {
  MIQCP_OUVRAGES,
  MIQCP_CRITERIA,
  MIQCP_SCALE_LABELS,
  computeMiqcpResult,
  type MiqcpCriterionCategory,
} from '../lib/miqcpGuide';
import type { MiqcpAssessment } from '../types';
import { formatCurrency } from '../lib/utils';

const CATEGORY_ORDER: MiqcpCriterionCategory[] = ['contexte', 'programme', 'contractuel'];

const CATEGORY_LABELS: Record<MiqcpCriterionCategory, string> = {
  contexte: "1. Contraintes physiques du contexte et insertion dans l'environnement",
  programme: '2. Nature du programme et spécificité du projet',
  contractuel: '3. Exigences contractuelles',
};

const SCALE_VALUES = [-2, -1, 0, 1, 2] as const;

interface Props {
  montantTravaux: number;
  initialAssessment?: MiqcpAssessment | null;
  onApply: (result: { complexityRate: number; baseFeePercent: number; assessment: MiqcpAssessment }) => void;
  onClose: () => void;
}

export const MiqcpComplexityWizardModal: React.FC<Props> = ({ montantTravaux, initialAssessment, onApply, onClose }) => {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [montantHT, setMontantHT] = useState<number>(initialAssessment?.montantTravauxHT || montantTravaux || 0);
  const [domaineCode, setDomaineCode] = useState<string>(() => {
    if (initialAssessment?.ouvrageCode) {
      return MIQCP_OUVRAGES.find(o => o.ouvrageCode === initialAssessment.ouvrageCode)?.domaineCode || MIQCP_OUVRAGES[0].domaineCode;
    }
    return MIQCP_OUVRAGES[0].domaineCode;
  });
  const [ouvrageCode, setOuvrageCode] = useState<string>(initialAssessment?.ouvrageCode || MIQCP_OUVRAGES[0].ouvrageCode);
  const [scores, setScores] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const c of MIQCP_CRITERIA) initial[c.id] = 0;
    if (initialAssessment?.criteriaScores) {
      for (const cs of initialAssessment.criteriaScores) initial[cs.criterionId] = cs.score;
    }
    return initial;
  });

  const domaines = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of MIQCP_OUVRAGES) seen.set(o.domaineCode, o.domaineLabel);
    return Array.from(seen.entries()).map(([code, label]) => ({ code, label }));
  }, []);

  const ouvragesForDomaine = useMemo(
    () => MIQCP_OUVRAGES.filter(o => o.domaineCode === domaineCode),
    [domaineCode]
  );

  const result = useMemo(() => {
    const criteriaScores = MIQCP_CRITERIA.map(c => scores[c.id] ?? 0);
    return computeMiqcpResult({ montantTravauxHT: montantHT || 0, ouvrageCode, criteriaScores });
  }, [montantHT, ouvrageCode, scores]);

  const handleDomaineChange = (code: string) => {
    setDomaineCode(code);
    const first = MIQCP_OUVRAGES.find(o => o.domaineCode === code);
    if (first) setOuvrageCode(first.ouvrageCode);
  };

  const handleApply = () => {
    const assessment: MiqcpAssessment = {
      domaineCode,
      ouvrageCode,
      montantTravauxHT: montantHT || 0,
      criteriaScores: MIQCP_CRITERIA.map(c => ({ criterionId: c.id, score: (scores[c.id] ?? 0) as -2 | -1 | 0 | 1 | 2 })),
      tauxReference: result.tauxReference,
      coefficientComplexite: result.coefficientComplexite,
      tauxApplicable: result.tauxApplicable,
      computedAt: new Date().toISOString(),
    };
    onApply({
      complexityRate: Number(result.coefficientComplexite.toFixed(4)),
      baseFeePercent: Number(result.tauxReference.toFixed(4)),
      assessment,
    });
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="rounded-lg shadow-xl w-full max-w-2xl overflow-hidden"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        >
          <div className="p-6 flex items-center justify-between" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
            <div className="flex items-center gap-2">
              <IconCalculator size={20} className="text-blue-600" />
              <h3 className="text-lg font-bold" style={{ color: 'var(--tblr-text)' }}>
                {t('miqcp_wizard_title')}
              </h3>
            </div>
            <button type="button" onClick={onClose} style={{ color: 'var(--tblr-muted)' }}>
              <IconX size={20} />
            </button>
          </div>

          <div className="px-6 pt-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
            {[1, 2, 3].map(s => (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center ${step >= s ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'}`}
                >
                  {s}
                </div>
                {s < 3 && <div className={`h-0.5 flex-1 ${step > s ? 'bg-blue-600' : 'bg-zinc-200 dark:bg-zinc-700'}`} />}
              </div>
            ))}
          </div>

          <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
            {step === 1 && (
              <div className="space-y-4">
                <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('miqcp_wizard_step1_intro')}</p>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>
                    {t('miqcp_wizard_domaine_label')}
                  </label>
                  <select
                    className="w-full px-3 py-2 rounded-lg outline-none text-sm"
                    style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                    value={domaineCode}
                    onChange={e => handleDomaineChange(e.target.value)}
                  >
                    {domaines.map(d => (
                      <option key={d.code} value={d.code}>{d.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>
                    {t('miqcp_wizard_ouvrage_label')}
                  </label>
                  <select
                    className="w-full px-3 py-2 rounded-lg outline-none text-sm"
                    style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                    value={ouvrageCode}
                    onChange={e => setOuvrageCode(e.target.value)}
                  >
                    {ouvragesForDomaine.map(o => (
                      <option key={o.ouvrageCode} value={o.ouvrageCode}>{o.ouvrageLabel}</option>
                    ))}
                  </select>
                  {result.plageComplexite && (
                    <p className="text-[10px] mt-1" style={{ color: 'var(--tblr-muted)' }}>
                      {t('miqcp_wizard_plage_label')}: {result.plageComplexite.bas} — {result.plageComplexite.haut}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>
                    {t('miqcp_wizard_montant_label')}
                  </label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 rounded-lg outline-none text-sm"
                    style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                    value={montantHT}
                    onChange={e => setMontantHT(Number(e.target.value))}
                  />
                  <p className="text-[10px] mt-1" style={{ color: 'var(--tblr-muted)' }}>
                    {t('miqcp_wizard_taux_reference_label')}: {result.tauxReference.toFixed(2)} %
                  </p>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('miqcp_wizard_step2_intro')}</p>
                {CATEGORY_ORDER.map(category => (
                  <div key={category} className="space-y-3">
                    <h4 className="text-xs font-bold text-blue-600 dark:text-blue-400">{CATEGORY_LABELS[category]}</h4>
                    {MIQCP_CRITERIA.filter(c => c.category === category).map(criterion => (
                      <div key={criterion.id} className="space-y-1">
                        <div className="text-xs" style={{ color: 'var(--tblr-text)' }}>
                          {criterion.order}/ {criterion.label}
                        </div>
                        <div className="grid grid-cols-5 gap-1">
                          {SCALE_VALUES.map(v => (
                            <button
                              key={v}
                              type="button"
                              title={MIQCP_SCALE_LABELS[v]}
                              onClick={() => setScores(prev => ({ ...prev, [criterion.id]: v }))}
                              className={`py-1.5 rounded text-[10px] font-bold transition-colors ${
                                (scores[criterion.id] ?? 0) === v
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                              }`}
                            >
                              {v > 0 ? `+${v}` : v}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('miqcp_wizard_step3_intro')}</p>
                <div className="rounded-lg p-4 space-y-2" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' }}>
                  <Row label={t('miqcp_wizard_result_taux_reference')} value={`${result.tauxReference.toFixed(4)} %`} />
                  <Row
                    label={t('miqcp_wizard_result_plage')}
                    value={result.plageComplexite ? `${result.plageComplexite.bas} — ${result.plageComplexite.haut}` : '—'}
                  />
                  <Row label={t('miqcp_wizard_result_coefficient')} value={result.coefficientComplexite.toFixed(4)} />
                  <div className="pt-2 mt-2" style={{ borderTop: '1px solid var(--tblr-border)' }}>
                    <Row label={t('miqcp_wizard_result_taux_applicable')} value={`${result.tauxApplicable.toFixed(4)} %`} bold />
                    <Row label={t('miqcp_wizard_result_honoraires')} value={formatCurrency(result.montantHonorairesEstime)} bold />
                  </div>
                </div>
                <p className="text-[10px]" style={{ color: 'var(--tblr-muted)' }}>{t('miqcp_wizard_result_note')}</p>
              </div>
            )}
          </div>

          <div className="p-6 flex items-center justify-between" style={{ borderTop: '1px solid var(--tblr-border)' }}>
            <button
              type="button"
              onClick={() => (step === 1 ? onClose() : setStep(prev => (prev - 1) as 1 | 2))}
              className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
            >
              {step === 1 ? t('btn_cancel') : <><IconChevronLeft size={16} /> {t('miqcp_wizard_back')}</>}
            </button>
            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep(prev => (prev + 1) as 2 | 3)}
                className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
              >
                {t('miqcp_wizard_next')} <IconChevronRight size={16} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleApply}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
              >
                {t('miqcp_wizard_apply')}
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

const Row: React.FC<{ label: string; value: string; bold?: boolean }> = ({ label, value, bold }) => (
  <div className="flex items-center justify-between">
    <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{label}</span>
    <span className={`text-sm ${bold ? 'font-bold text-blue-700 dark:text-blue-400' : ''}`} style={!bold ? { color: 'var(--tblr-text)' } : undefined}>
      {value}
    </span>
  </div>
);

export default MiqcpComplexityWizardModal;
