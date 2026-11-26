// Contrôles des tranches fermes et conditionnelles de la répartition des honoraires.
// Partagés par la fiche proposition (src/pages/Proposals.tsx) et l'onglet Honoraires
// d'un appel d'offres (src/components/HonorairesSection.tsx) : les deux écrans
// éditent le même JSON `fee_distribution` (voir src/lib/tranches.ts).
import * as React from 'react';
import { IconPlus } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../lib/utils';
import { defaultFeeDistribution } from '../lib/feeDistribution';
import {
  ajouterTranche, activerTranches, desactiverTranches, lireDonnees, tranchesActives, totauxParTranche,
  type DonneesTranches, type PerimetreContrat,
} from '../lib/tranches';

interface TranchesControlsProps {
  /** JSON `fee_distribution` du document (proposition ou appel d'offres). */
  feeDistribution: string | undefined;
  onChange: (feeDistribution: string) => void;
}

function useTranches({ feeDistribution, onChange }: TranchesControlsProps) {
  const donnees = React.useMemo<DonneesTranches>(
    () => lireDonnees(feeDistribution) ?? (defaultFeeDistribution() as DonneesTranches),
    [feeDistribution],
  );
  const appliquer = (fn: (d: DonneesTranches) => DonneesTranches) => onChange(JSON.stringify(fn(donnees)));
  return {
    donnees,
    appliquer,
    actif: tranchesActives(donnees),
    aUneConditionnelle: (donnees.tranches ?? []).some(x => x.type === 'conditionnelle'),
  };
}

const boutonTranche = 'text-[0.6875rem] flex items-center gap-1 font-bold uppercase tracking-wider px-2 py-1 rounded bg-[var(--tblr-surface-2)] text-[var(--tblr-text)] border border-[var(--tblr-border)]';

/** Interrupteur « Découper en tranches » et boutons d'ajout de tranche (à poser dans la barre d'outils). */
export function TranchesToolbar(props: TranchesControlsProps) {
  const { t } = useTranslation();
  const { appliquer, actif, aUneConditionnelle } = useTranches(props);
  return (
    <>
      <label className="flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-wider cursor-pointer text-[var(--tblr-muted)]">
        <input
          type="checkbox"
          checked={actif}
          disabled={actif && aUneConditionnelle}
          title={actif && aUneConditionnelle ? t('fee_tranches_cannot_disable') : undefined}
          onChange={e => appliquer(e.target.checked ? activerTranches : desactiverTranches)}
        />
        {t('fee_tranches_toggle')}
      </label>
      {actif && (
        <>
          <button type="button" onClick={() => appliquer(d => ajouterTranche(d, 'ferme'))} className={boutonTranche}>
            <IconPlus size={12} /> {t('fee_tranches_add_firm')}
          </button>
          <button type="button" onClick={() => appliquer(d => ajouterTranche(d, 'conditionnelle'))} className={boutonTranche}>
            <IconPlus size={12} /> {t('fee_tranches_add_cond')}
          </button>
        </>
      )}
    </>
  );
}

/** Choix du périmètre du contrat MOE à l'acceptation, et rappel des totaux ferme / conditionnel. */
export function TranchesSummary(props: TranchesControlsProps) {
  const { t } = useTranslation();
  const { donnees, appliquer, actif, aUneConditionnelle } = useTranches(props);
  const totaux = React.useMemo(() => totauxParTranche(donnees), [donnees]);
  if (!actif) return null;
  return (
    <div className="space-y-2">
      {aUneConditionnelle && (
        <label className="flex items-center gap-2 text-xs text-[var(--tblr-text)]">
          {t('fee_tranches_contract_scope')}
          <select
            value={donnees.contrat_tranches ?? 'toutes'}
            onChange={e => appliquer(d => ({ ...d, contrat_tranches: e.target.value as PerimetreContrat }))}
            className="px-2 py-1 rounded text-xs bg-[var(--tblr-surface-2)] border border-[var(--tblr-border)] text-[var(--tblr-text)]"
          >
            <option value="toutes">{t('fee_tranches_contract_all')}</option>
            <option value="ferme">{t('fee_tranches_contract_firm')}</option>
          </select>
        </label>
      )}
      <p className="text-xs text-[var(--tblr-muted)]">
        {t('fee_tranches_summary', { ferme: formatCurrency(totaux.ferme), cond: formatCurrency(totaux.conditionnel) })}
      </p>
    </div>
  );
}
