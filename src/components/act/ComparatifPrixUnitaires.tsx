// Comparatif des prix unitaires, lot par lot : l'estimation du document de
// référence puis, côte à côte, le prix unitaire remis par chaque entreprise.
// Une entreprise saisie au total seul reste dans le tableau (colonne hachurée) et
// dans le classement du lot, sans détail par article. Sous 768 px, une carte par article.
import React, { useMemo, useState } from 'react';
import { IconScale, IconDownload } from '@tabler/icons-react';
import type { ProjectLot } from '../../types';
import type { Lot, OffreDocument } from '../../types/dpgf';
import {
  construireLot, ecartPct, eur0, eur2, ligneEnEcart, niveauEcart, pctFr,
  type EntrepriseComparee, type LigneComparee,
} from '../../lib/comparatifPrix';
import { cn } from '../../lib/utils';

interface Props {
  lots: ProjectLot[];
  documentLots: Lot[];
  offres: OffreDocument[];
  /** Entreprises consultées sur un lot du projet, chacune avec son mode de saisie. */
  entreprisesDuLot: (projectLotId: string) => EntrepriseComparee[];
  documentLabel: string;
  onExport?: () => void;
}

const HACHURE = { background: 'repeating-linear-gradient(135deg, var(--tblr-surface-2) 0 6px, transparent 6px 12px)' } as const;

function SousPrix({ ligne, pu, montrer }: { ligne: LigneComparee; pu: number; montrer: 'ecart' | 'total' }) {
  if (montrer === 'total') return <span className="block text-[0.6875rem] text-[var(--tblr-muted)] tabular-nums">{eur0(pu * ligne.quantite)}</span>;
  const pct = ecartPct(pu, ligne.estimation);
  if (pct == null) return null;
  const niveau = niveauEcart(pct);
  return (
    <span className={cn('block text-[0.6875rem] tabular-nums', niveau === 'haut' ? 'text-red-600 dark:text-red-400 font-bold' : niveau === 'bas' ? 'text-amber-700 dark:text-amber-400 font-bold' : 'text-[var(--tblr-muted)]')}>
      {pctFr(pct)}
    </span>
  );
}

export default function ComparatifPrixUnitaires({ lots, documentLots, offres, entreprisesDuLot, documentLabel, onExport }: Props) {
  const lotsComparables = useMemo(
    () => lots.filter(l => documentLots.some(d => d.projectLotId === l.id)),
    [lots, documentLots],
  );
  const [lotChoisi, setLotChoisi] = useState<string | null>(null);
  const [montrer, setMontrer] = useState<'ecart' | 'total'>('ecart');
  const [filtre, setFiltre] = useState(false);

  const lotId = lotChoisi && lotsComparables.some(l => l.id === lotChoisi) ? lotChoisi : lotsComparables[0]?.id ?? null;
  const lotDoc = documentLots.find(d => d.projectLotId === lotId);
  const entreprises = useMemo(() => (lotId ? entreprisesDuLot(lotId) : []), [lotId, entreprisesDuLot]);
  const data = useMemo(() => (lotDoc ? construireLot(lotDoc, offres, entreprises) : null), [lotDoc, offres, entreprises]);

  if (lotsComparables.length === 0 || !lotDoc || !data) {
    return (
      <div className="rounded-lg p-6 text-sm text-[var(--tblr-muted)]" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 text-[var(--tblr-text)] mb-2"><IconScale size={15} /> Comparatif des prix unitaires</h3>
        Aucun lot du {documentLabel} n’est rattaché à un lot de la consultation. Rattachez les lots dans l’onglet PRO pour comparer les prix unitaires des entreprises.
      </div>
    );
  }

  const enPostes = entreprises.filter(e => e.mode === 'postes');
  const nbColonnes = 5 + entreprises.length + 1;
  const chapitres = data.chapitres
    .map(c => ({ ...c, lignes: c.lignes.filter(l => !filtre || ligneEnEcart(l, entreprises)) }))
    .filter(c => c.lignes.length > 0);
  const nbLignes = chapitres.reduce((s, c) => s + c.lignes.length, 0);
  const classes = [...entreprises].filter(e => data.rangs[e.id] != null).sort((a, b) => (data.rangs[a.id]! - data.rangs[b.id]!));

  const bouton = 'px-3 py-1.5 text-xs font-bold';
  return (
    <div className="rounded-lg overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <div className="p-5 border-b border-[var(--tblr-border)] flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-[var(--tblr-text)] uppercase tracking-wider flex items-center gap-2"><IconScale size={15} /> Comparatif des prix unitaires</h3>
          <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-0.5">Prix unitaires HT remis par les entreprises, rapportés à l’estimation du {documentLabel}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg overflow-hidden border border-[var(--tblr-border)]" role="group" aria-label="Sous le prix unitaire">
            <button type="button" aria-pressed={montrer === 'ecart'} onClick={() => setMontrer('ecart')} className={cn(bouton, montrer === 'ecart' ? 'bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)]' : 'bg-[var(--tblr-surface)]')}>Écart / estimation</button>
            <button type="button" aria-pressed={montrer === 'total'} onClick={() => setMontrer('total')} className={cn(bouton, 'border-l border-[var(--tblr-border)]', montrer === 'total' ? 'bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)]' : 'bg-[var(--tblr-surface)]')}>Total ligne</button>
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={filtre} onChange={e => setFiltre(e.target.checked)} /> Écarts supérieurs à 10 % seulement
          </label>
          {onExport && (
            <button type="button" onClick={onExport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 text-white hover:bg-green-700 transition">
              <IconDownload size={13} /> Export Excel
            </button>
          )}
        </div>
      </div>

      <div className="px-5 pt-3 flex flex-wrap gap-2" role="tablist" aria-label="Lots comparés">
        {lotsComparables.map(l => (
          <button
            key={l.id} type="button" role="tab" aria-selected={l.id === lotId} onClick={() => setLotChoisi(l.id)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-bold border', l.id === lotId ? 'bg-[var(--tblr-primary-lt)] border-[var(--tblr-primary)] text-[var(--tblr-primary)]' : 'border-[var(--tblr-border)] bg-[var(--tblr-surface)]')}
          >
            Lot {l.lot_number} · {l.lot_title}
          </button>
        ))}
      </div>

      {entreprises.length === 0 ? (
        <p className="p-6 text-sm italic text-[var(--tblr-muted)]">Aucune entreprise consultée sur ce lot (phase Préparation).</p>
      ) : (
        <>
          {/* Tableau (768 px et plus) */}
          <div className="hidden md:block overflow-x-auto mt-3">
            <table className="w-full text-xs" style={{ minWidth: `${480 + entreprises.length * 130}px` }}>
              <thead className="bg-[var(--tblr-surface-2)]">
                <tr className="text-[0.6875rem] uppercase tracking-wider text-[var(--tblr-muted)]">
                  <th className="px-3 py-2 text-left sticky left-0 bg-[var(--tblr-surface-2)]">Code</th>
                  <th className="px-3 py-2 text-left">Désignation</th>
                  <th className="px-3 py-2 text-center">U</th>
                  <th className="px-3 py-2 text-right">Qté</th>
                  <th className="px-3 py-2 text-right">Estimation</th>
                  {entreprises.map(e => (
                    <th key={e.id} className="px-3 py-2 text-right border-l border-[var(--tblr-border)] text-[var(--tblr-text)]">
                      {e.nom}
                      <span className="block normal-case tracking-normal font-medium text-[var(--tblr-muted)]">{e.mode === 'total' ? 'total du lot seul' : 'P.U. HT'}</span>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right border-l border-[var(--tblr-border)]">Médiane</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--tblr-border)]">
                {chapitres.map(c => (
                  <React.Fragment key={c.id}>
                    <tr className="bg-[var(--tblr-surface-2)]"><td colSpan={nbColonnes} className="px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-wider">{c.code} {c.titre}</td></tr>
                    {c.lignes.map(l => (
                      <tr key={l.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                        <td className="px-3 py-2 text-[var(--tblr-muted)] sticky left-0 bg-[var(--tblr-surface)]">{l.code}</td>
                        <td className="px-3 py-2 min-w-[220px]">
                          {l.titre}
                          {l.horsBase && <span className="ml-2 text-[0.6875rem] font-bold px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">Hors base</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-[var(--tblr-muted)]">{l.unite}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{l.quantite.toLocaleString('fr-FR')}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold bg-[var(--tblr-surface-2)]">
                          {eur2(l.estimation)}
                          <span className="block text-[0.6875rem] font-normal text-[var(--tblr-muted)]">{montrer === 'ecart' ? 'référence' : eur0(l.estimation * l.quantite)}</span>
                        </td>
                        {entreprises.map(e => {
                          if (e.mode === 'total') return <td key={e.id} className="border-l border-[var(--tblr-border)]" style={HACHURE} aria-hidden="true" />;
                          const pu = l.prix[e.id];
                          if (pu === null) return <td key={e.id} className="px-3 py-2 text-right border-l border-[var(--tblr-border)] italic text-[var(--tblr-muted)]">p.m.<span className="block text-[0.6875rem] not-italic">pour mémoire</span></td>;
                          if (typeof pu !== 'number') return <td key={e.id} className="px-3 py-2 text-right border-l border-[var(--tblr-border)] text-[var(--tblr-muted)]">·</td>;
                          const meilleur = l.meilleur != null && pu === l.meilleur;
                          return (
                            <td key={e.id} className={cn('px-3 py-2 text-right border-l border-[var(--tblr-border)]', meilleur && 'bg-green-100 dark:bg-green-900/30')}>
                              <span className={cn('font-semibold tabular-nums', meilleur && 'text-green-800 dark:text-green-300')}>{eur2(pu)}</span>
                              <SousPrix ligne={l} pu={pu} montrer={montrer} />
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right border-l border-[var(--tblr-border)] tabular-nums text-[var(--tblr-muted)]">{l.mediane != null ? eur2(l.mediane) : '·'}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                {nbLignes === 0 && (
                  <tr><td colSpan={nbColonnes} className="px-4 py-6 text-center italic text-[var(--tblr-muted)]">Aucun article avec un écart supérieur à 10 %.</td></tr>
                )}
                {data.ajouts.length > 0 && (
                  <>
                    <tr className="bg-violet-50 dark:bg-violet-900/20"><td colSpan={nbColonnes} className="px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-wider text-violet-800 dark:text-violet-200">Postes ajoutés par les entreprises</td></tr>
                    {data.ajouts.map(a => (
                      <tr key={a.id}>
                        <td className="px-3 py-2 text-[var(--tblr-muted)] sticky left-0 bg-[var(--tblr-surface)]">{a.code}</td>
                        <td className="px-3 py-2">{a.titre}<br /><span className="inline-block mt-0.5 text-[0.6875rem] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">Ajouté par {a.entrepriseNom}</span></td>
                        <td className="px-3 py-2 text-center text-[var(--tblr-muted)]">{a.unite}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{a.quantite}</td>
                        <td className="px-3 py-2 text-right text-[var(--tblr-muted)] bg-[var(--tblr-surface-2)]">·</td>
                        {entreprises.map(e => (
                          e.mode === 'total'
                            ? <td key={e.id} className="border-l border-[var(--tblr-border)]" style={HACHURE} aria-hidden="true" />
                            : e.id === a.entrepriseId
                              ? <td key={e.id} className="px-3 py-2 text-right border-l border-[var(--tblr-border)] bg-violet-50 dark:bg-violet-900/20"><span className="font-semibold tabular-nums">{a.prixUnitaire != null ? eur2(a.prixUnitaire) : '·'}</span><span className="block text-[0.6875rem] text-[var(--tblr-muted)] tabular-nums">{eur0(a.montant)}</span></td>
                              : <td key={e.id} className="px-3 py-2 text-right border-l border-[var(--tblr-border)] text-[var(--tblr-muted)]">·</td>
                        ))}
                        <td className="border-l border-[var(--tblr-border)]" />
                      </tr>
                    ))}
                  </>
                )}
                <tr className="font-bold border-t-2 border-[var(--tblr-border)]">
                  <td className="px-3 py-2 sticky left-0 bg-[var(--tblr-surface)]" />
                  <td className="px-3 py-2">Total du lot HT</td><td /><td />
                  <td className="px-3 py-2 text-right tabular-nums bg-[var(--tblr-surface-2)]">{eur0(data.estimationTotale)}</td>
                  {entreprises.map(e => (
                    <td key={e.id} className="px-3 py-2 text-right border-l border-[var(--tblr-border)] tabular-nums">{data.totaux[e.id] != null ? eur0(data.totaux[e.id]!) : <span className="font-normal text-[var(--tblr-muted)]">·</span>}</td>
                  ))}
                  <td className="border-l border-[var(--tblr-border)]" />
                </tr>
                <tr>
                  <td className="sticky left-0 bg-[var(--tblr-surface)]" /><td className="px-3 py-2 text-[var(--tblr-muted)]">Écart à l’estimation</td><td /><td /><td />
                  {entreprises.map(e => {
                    const t = data.totaux[e.id];
                    const pct = t != null ? ecartPct(t, data.estimationTotale) : null;
                    return <td key={e.id} className={cn('px-3 py-2 text-right border-l border-[var(--tblr-border)] tabular-nums font-semibold', pct != null && niveauEcart(pct) === 'haut' && 'text-red-600 dark:text-red-400')}>{pct != null ? pctFr(pct) : <span className="font-normal text-[var(--tblr-muted)]">·</span>}</td>;
                  })}
                  <td className="border-l border-[var(--tblr-border)]" />
                </tr>
                <tr>
                  <td className="sticky left-0 bg-[var(--tblr-surface)]" /><td className="px-3 py-2 text-[var(--tblr-muted)]">Classement</td><td /><td /><td />
                  {entreprises.map(e => {
                    const rang = data.rangs[e.id];
                    const pm = data.pourMemoire[e.id] ?? 0;
                    return (
                      <td key={e.id} className="px-3 py-2 text-right border-l border-[var(--tblr-border)]">
                        {rang != null
                          ? <span className={cn('inline-block min-w-[22px] text-center px-1.5 rounded-full font-bold', rang === 1 ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-[var(--tblr-surface-2)]')}>{rang === 1 ? '1er' : `${rang}e`}</span>
                          : <span className="text-[var(--tblr-muted)]">·</span>}
                        {pm > 0 && <span className="block text-[0.6875rem] text-[var(--tblr-muted)]">{pm} p.m. non compté{pm > 1 ? 's' : ''}</span>}
                      </td>
                    );
                  })}
                  <td className="border-l border-[var(--tblr-border)]" />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Cartes (moins de 768 px) */}
          <div className="md:hidden p-3 space-y-2.5">
            {chapitres.flatMap(c => c.lignes).map(l => (
              <div key={l.id} className="rounded-lg border border-[var(--tblr-border)] p-3 space-y-1.5">
                <div className="text-sm"><b>{l.code}</b> {l.titre}</div>
                <div className="text-[0.6875rem] text-[var(--tblr-muted)]">{l.quantite.toLocaleString('fr-FR')} {l.unite} · estimation {eur2(l.estimation)} €/{l.unite}</div>
                {enPostes.map(e => {
                  const pu = l.prix[e.id];
                  const meilleur = typeof pu === 'number' && l.meilleur != null && pu === l.meilleur;
                  return (
                    <div key={e.id} className={cn('flex justify-between gap-3 text-sm rounded px-1.5 py-0.5', meilleur && 'bg-green-100 dark:bg-green-900/30')}>
                      <span className="min-w-0 truncate">{e.nom}</span>
                      <span className="tabular-nums whitespace-nowrap">
                        <b>{pu === null ? 'p.m.' : typeof pu === 'number' ? eur2(pu) : '·'}</b>
                        {typeof pu === 'number' && ecartPct(pu, l.estimation) != null && <span className="ml-1.5 text-[0.6875rem] text-[var(--tblr-muted)]">{pctFr(ecartPct(pu, l.estimation)!)}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="rounded-lg border border-[var(--tblr-border)] p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-[var(--tblr-muted)]">Estimation du lot</span><b className="tabular-nums">{eur0(data.estimationTotale)}</b></div>
              {classes.map(e => (
                <div key={e.id} className="flex justify-between gap-3">
                  <span className="truncate">{data.rangs[e.id]}. {e.nom}{e.mode === 'total' ? ' (total seul)' : ''}</span>
                  <b className="tabular-nums">{eur0(data.totaux[e.id]!)}</b>
                </div>
              ))}
            </div>
          </div>

          <div className="px-5 py-3 border-t border-[var(--tblr-border)] flex flex-wrap gap-x-4 gap-y-1 text-[0.6875rem] text-[var(--tblr-muted)]">
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-100 border border-green-700 mr-1 align-[-1px]" />Prix unitaire le plus bas</span>
            <span><span className="text-red-600 dark:text-red-400 font-bold">+15 %</span> au-dessus de l’estimation</span>
            <span><span className="text-amber-700 dark:text-amber-400 font-bold">-15 %</span> en dessous (offre à vérifier)</span>
            <span><i>p.m.</i> pour mémoire, <b>·</b> non chiffré</span>
          </div>
        </>
      )}
    </div>
  );
}
