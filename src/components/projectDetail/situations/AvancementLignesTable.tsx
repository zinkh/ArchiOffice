import { Fragment, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconSearch } from '@tabler/icons-react';
import { bornerPct, montantDepuisLignes, type LigneSaisie } from '../../../lib/situationDetaillee';
import { inputClass, boutonSecondaire, formatEuros } from './DialogShell';

/**
 * Saisie détaillée : un avancement CUMULÉ (%) par ligne du DPGF du lot. Le
 * cumul HT de la situation en découle ; la colonne « Période » montre ce que la
 * ligne ajoute depuis la situation précédente.
 */
export function AvancementLignesTable({
  lignes, onChange, disabled,
}: {
  lignes: LigneSaisie[];
  onChange: (lignes: LigneSaisie[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const [filtre, setFiltre] = useState('');
  // Saisie en cours, ligne par ligne : on garde le texte tapé (« 12, » est un
  // état intermédiaire légitime) et on ne borne qu'à la sortie du champ.
  const [brouillons, setBrouillons] = useState<Record<string, string>>({});

  const visibles = useMemo(() => {
    const f = filtre.trim().toLowerCase();
    return f ? lignes.filter((l) => `${l.numero} ${l.designation} ${l.chapitre ?? ''}`.toLowerCase().includes(f)) : lignes;
  }, [lignes, filtre]);

  const majPct = (ligneId: string, valeur: unknown) =>
    onChange(lignes.map((l) => (l.ligneId === ligneId ? { ...l, avancementPct: bornerPct(valeur) } : l)));

  const appliquerATous = (calc: (l: LigneSaisie) => number) =>
    onChange(lignes.map((l) => (visibles.includes(l) ? { ...l, avancementPct: bornerPct(calc(l)) } : l)));

  const totalHt = lignes.reduce((s, l) => s + l.montantHt, 0);
  const cumul = montantDepuisLignes(lignes);
  const precedent = montantDepuisLignes(lignes.map((l) => ({ montantHt: l.montantHt, avancementPct: l.avancementPrecedentPct })));

  let chapitreCourant: string | undefined;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)]" aria-hidden />
          <label htmlFor={`${uid}-filtre`} className="sr-only">{t('situations_travaux_lines_filter')}</label>
          <input
            id={`${uid}-filtre`} type="search" className={inputClass + ' pl-8'}
            placeholder={t('situations_travaux_lines_filter')} value={filtre} onChange={(e) => setFiltre(e.target.value)}
          />
        </div>
        {!disabled && (
          <>
            <button type="button" className={boutonSecondaire} onClick={() => appliquerATous((l) => l.avancementPrecedentPct)}>
              {t('situations_travaux_lines_reset_previous')}
            </button>
            <button type="button" className={boutonSecondaire} onClick={() => appliquerATous(() => 100)}>
              {t('situations_travaux_lines_all_done')}
            </button>
          </>
        )}
      </div>

      <div className="overflow-auto max-h-[50dvh] rounded-lg border border-[var(--tblr-border)]">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 z-10 bg-[var(--tblr-surface-2)] text-[var(--tblr-muted)] text-[0.6875rem] font-bold uppercase">
            <tr>
              <th scope="col" className="px-2 py-2 text-left">{t('situations_travaux_lines_col_item')}</th>
              <th scope="col" className="px-2 py-2 text-right hidden sm:table-cell">{t('situations_travaux_lines_col_amount')}</th>
              <th scope="col" className="px-2 py-2 text-right">{t('situations_travaux_lines_col_previous')}</th>
              <th scope="col" className="px-2 py-2 text-right">{t('situations_travaux_lines_col_cumulative')}</th>
              <th scope="col" className="px-2 py-2 text-right">{t('situations_travaux_lines_col_period')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--tblr-border)]">
            {visibles.map((l) => {
              const enTete = l.chapitre && l.chapitre !== chapitreCourant ? l.chapitre : null;
              chapitreCourant = l.chapitre;
              const periode = l.montantHt * (l.avancementPct - l.avancementPrecedentPct) / 100;
              const recul = l.avancementPct < l.avancementPrecedentPct;
              const inputId = `${uid}-${l.ligneId}`;
              return (
                <Fragment key={l.ligneId}>
                  {enTete && (
                    <tr className="bg-[var(--tblr-surface-2)]">
                      <th scope="colgroup" colSpan={5} className="px-2 py-1.5 text-left text-[0.6875rem] font-bold text-[var(--tblr-text)]">{enTete}</th>
                    </tr>
                  )}
                  <tr className={l.retiree ? 'opacity-70' : undefined}>
                    <td className="px-2 py-1.5 align-top">
                      <label htmlFor={inputId} className="block text-[var(--tblr-text)]">
                        <span className="text-[var(--tblr-muted)] tabular-nums mr-1">{l.numero}</span>
                        {l.designation}
                      </label>
                      <span className="text-[0.6875rem] text-[var(--tblr-muted)] tabular-nums">
                        {l.quantite.toLocaleString('fr-FR')} {l.unite} × {formatEuros(l.prixUnitaire)}
                        <span className="sm:hidden"> = {formatEuros(l.montantHt)}</span>
                        {l.retiree && ` · ${t('situations_travaux_lines_removed')}`}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums align-top hidden sm:table-cell">{formatEuros(l.montantHt)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums align-top text-[var(--tblr-muted)]">{l.avancementPrecedentPct.toLocaleString('fr-FR')} %</td>
                    <td className="px-2 py-1 text-right align-top">
                      <div className="inline-flex items-center gap-1">
                        <input
                          id={inputId}
                          type="text" inputMode="decimal" disabled={disabled}
                          aria-invalid={recul || undefined}
                          className={inputClass + ' w-[4.5rem] py-1 text-right tabular-nums' + (recul ? ' border-amber-500' : '')}
                          value={brouillons[l.ligneId] ?? String(l.avancementPct).replace('.', ',')}
                          onChange={(e) => setBrouillons((b) => ({ ...b, [l.ligneId]: e.target.value }))}
                          onBlur={(e) => {
                            majPct(l.ligneId, e.target.value);
                            setBrouillons(({ [l.ligneId]: _, ...reste }) => reste);
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        />
                        <span className="text-[var(--tblr-muted)]" aria-hidden>%</span>
                      </div>
                    </td>
                    <td className={'px-2 py-1.5 text-right tabular-nums align-top ' + (recul ? 'text-amber-700 dark:text-amber-400' : 'text-[var(--tblr-text)]')}>
                      {formatEuros(Math.round(periode * 100) / 100)}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {visibles.length === 0 && (
              <tr><td colSpan={5} className="px-2 py-6 text-center text-[var(--tblr-muted)]">{t('situations_travaux_lines_no_match')}</td></tr>
            )}
          </tbody>
          <tfoot className="sticky bottom-0 bg-[var(--tblr-surface-2)] font-bold text-[var(--tblr-text)]">
            <tr>
              <td className="px-2 py-2">{t('situations_travaux_lines_total')}</td>
              <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">{formatEuros(totalHt)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-[var(--tblr-muted)]">{formatEuros(precedent)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatEuros(cumul)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatEuros(Math.round((cumul - precedent) * 100) / 100)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
