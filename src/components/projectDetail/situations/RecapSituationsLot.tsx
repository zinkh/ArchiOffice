import { useMemo } from 'react';
import { formatEuros } from './DialogShell';
import { recapParLot } from '../../../lib/recapSituations';
import type { MarcheTravaux, SituationTravaux } from '../../../lib/certificatPaiement';

interface RecapSituationsLotProps {
  marches: MarcheTravaux[];
  situations: SituationTravaux[];
}

const formatDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '-');

const ETATS: Record<string, string> = { Brouillon: 'À vérifier', Validée: 'Certificat établi', Payée: 'Payée' };

/**
 * Tableau récapitulatif par lot : toutes les situations présentées par l'entreprise, avec la date de la
 * situation, la date de paiement, le reste à payer et la retenue de garantie. Les montants sont ceux des
 * certificats de paiement (net à payer TTC, retenue sur le TTC).
 */
export function RecapSituationsLot({ marches, situations }: RecapSituationsLotProps) {
  const recaps = useMemo(() => recapParLot(marches, situations), [marches, situations]);
  if (!recaps.length) return null;

  const th = 'px-3 py-2 text-left text-[0.6875rem] font-semibold uppercase tracking-wide';
  const td = 'px-3 py-2 whitespace-nowrap';
  const nombre = 'text-right tabular-nums';

  return (
    <section aria-label="Récapitulatif des situations par lot" className="space-y-4">
      <h3 className="text-sm font-semibold">Récapitulatif des situations par lot</h3>
      {recaps.map((recap) => (
        <div key={recap.marche.id} className="rounded-lg border overflow-x-auto" style={{ borderColor: 'var(--tblr-border)' }}>
          <div className="px-3 py-2 border-b text-sm font-semibold flex flex-wrap items-baseline justify-between gap-2" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
            <span>{recap.lot}</span>
            <span className="text-xs font-normal" style={{ color: 'var(--tblr-muted)' }}>{recap.marche.entreprise_nom}</span>
          </div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--tblr-border)' }}>
                <th scope="col" className={th}>N°</th>
                <th scope="col" className={th}>Date</th>
                <th scope="col" className={`${th} ${nombre}`}>Cumul admis HT</th>
                <th scope="col" className={`${th} ${nombre}`}>Période HT</th>
                <th scope="col" className={`${th} ${nombre}`}>Net à payer TTC</th>
                <th scope="col" className={th}>État</th>
                <th scope="col" className={th}>Date de paiement</th>
                <th scope="col" className={`${th} ${nombre}`}>Reste à payer</th>
                <th scope="col" className={`${th} ${nombre}`}>Retenue de garantie</th>
              </tr>
            </thead>
            <tbody>
              {recap.lignes.map((l) => (
                <tr key={l.situationId} className="border-b last:border-b-0" style={{ borderColor: 'var(--tblr-border)' }}>
                  <td className={td}>{l.numero}</td>
                  <td className={td}>{formatDate(l.dateSituation)}</td>
                  <td className={`${td} ${nombre}`}>{formatEuros(l.cumulAdmisHt)}</td>
                  <td className={`${td} ${nombre}`}>{formatEuros(l.periodeHt)}</td>
                  <td className={`${td} ${nombre}`}>{formatEuros(l.netAPayer)}</td>
                  <td className={td}>{ETATS[l.etat] ?? l.etat}</td>
                  <td className={td}>{l.payee ? formatDate(l.datePaiement) : '-'}</td>
                  <td className={`${td} ${nombre} font-medium`}>{formatEuros(l.resteAPayer)}</td>
                  <td className={`${td} ${nombre}`}>{formatEuros(l.retenue)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
                <td className={td} colSpan={3}>Total ({recap.lignes.length} situation{recap.lignes.length > 1 ? 's' : ''})</td>
                <td className={`${td} ${nombre}`}>{formatEuros(recap.totalPeriodeHt)}</td>
                <td className={`${td} ${nombre}`}>{formatEuros(recap.totalNetAPayer)}</td>
                <td className={td} colSpan={2}>Payé : {formatEuros(recap.totalPaye)}</td>
                <td className={`${td} ${nombre}`}>{formatEuros(recap.totalResteAPayer)}</td>
                <td className={`${td} ${nombre}`}>{formatEuros(recap.retenueCumulee)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
    </section>
  );
}
