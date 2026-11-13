import { useMemo, useState } from 'react';
import { IconCheck, IconPaperclip, IconPlus, IconTrash } from '@tabler/icons-react';
import type { ProjectLot } from '../../types';
import type { DocumentDce } from '../../lib/dceIndices';
import { cn } from '../../lib/utils';
import {
  basculerCase, basculerColonne, basculerTous, lotsACompleter, lotsDeLaPiece, piecesDuLot, pieceAtteintLot,
} from '../../lib/dceMatrice';
import DceFichiersPicker from './DceFichiersPicker';

export interface LigneDce {
  id: string;
  nom: string;
  type_doc: string;
  tous_lots: boolean;
  lots_ids: string[];
  document_ids?: string[];
}

interface Props<T extends LigneDce> {
  pieces: T[];
  lots: ProjectLot[];
  documentsAffaire: DocumentDce[];
  /** Intitulés proposés par type de pièce (RC, CCAP, CCTP...). */
  typeLabels: Record<string, string>;
  onChange: (next: T[]) => void;
  onAjouter: () => void;
}

// Même gabarit que les tableaux de l'ACT (ACTEntreprisesTable) : jetons Tabler, bleu primaire, coins arrondis.
const TH = 'text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]';
const CHAMP = 'w-full px-2.5 py-1.5 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500';
const BOUTON = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition';

type Etat = 'on' | 'der' | 'off';

/** Case de la matrice : coche pleine (donnée au lot), coche claire (donnée par « Tous les lots »), vide. */
function Pastille({ etat }: { etat: Etat }) {
  return (
    <span className={cn(
      'flex items-center justify-center w-[18px] h-[18px] rounded border-[1.5px] transition-colors',
      etat === 'on' && 'bg-blue-600 border-blue-600 text-white',
      etat === 'der' && 'bg-[var(--tblr-primary-lt)] border-blue-300 dark:border-blue-700 text-[var(--tblr-primary)]',
      etat === 'off' && 'border-[var(--tblr-border)] bg-[var(--tblr-surface)]',
    )}>
      {etat !== 'off' && <IconCheck size={12} stroke={3} />}
    </span>
  );
}

function fichiersTexte(n: number): string {
  return n === 0 ? 'sans fichier joint' : `${n} fichier${n > 1 ? 's' : ''} joint${n > 1 ? 's' : ''}`;
}

/**
 * Pièces du DCE en matrice : une ligne par pièce, une colonne par lot. Une case donne la pièce au lot,
 * un en-tête de lot coche toute la colonne. Mêmes champs que l'ancienne liste (`tous_lots`, `lots_ids`,
 * `document_ids`), donc aucune migration.
 */
export default function DceMatrice<T extends LigneDce>({ pieces, lots, documentsAffaire, typeLabels, onChange, onAjouter }: Props<T>) {
  const [aCompleter, setACompleter] = useState(false);
  const [lotApercu, setLotApercu] = useState<string>('');
  const [fichiersOuverts, setFichiersOuverts] = useState<Set<string>>(new Set());

  const lotIds = useMemo(() => lots.map(l => l.id), [lots]);
  const lotsVisibles = useMemo(() => {
    if (!aCompleter) return lots;
    const ids = new Set(lotsACompleter(pieces, lotIds));
    return lots.filter(l => ids.has(l.id));
  }, [aCompleter, lots, lotIds, pieces]);
  const lotChoisi = lots.find(l => l.id === lotApercu) ?? lots[0];
  const recues = lotChoisi ? pieces.filter(p => pieceAtteintLot(p, lotChoisi.id)) : [];

  const maj = (id: string, patch: (p: T) => T) => onChange(pieces.map(p => (p.id === id ? patch(p) : p)));
  const basculerFichiers = (id: string) =>
    setFichiersOuverts(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (pieces.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-[var(--tblr-muted)] italic mb-3">Aucun document DCE. Cliquez sur "Ajouter" pour commencer.</p>
        <button type="button" onClick={onAjouter} className={BOUTON}><IconPlus size={13} /> Ajouter une pièce</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.6875rem] text-[var(--tblr-muted)]">
        <span className="inline-flex items-center gap-1.5"><Pastille etat="on" /> Pièce donnée au lot</span>
        <span className="inline-flex items-center gap-1.5"><Pastille etat="der" /> Donnée par « Tous les lots »</span>
        <span className="inline-flex items-center gap-1.5"><Pastille etat="off" /> Non transmise</span>
        <label className="ml-auto inline-flex items-center gap-1.5 cursor-pointer text-[var(--tblr-text)]">
          <input type="checkbox" checked={aCompleter} onChange={e => setACompleter(e.target.checked)} className="w-4 h-4 rounded accent-blue-600" />
          Lots à compléter seulement
        </label>
      </div>

      <div className="overflow-auto rounded-lg border border-[var(--tblr-border)] max-h-[70vh]">
        <table className="border-separate border-spacing-0 w-full text-sm" style={{ minWidth: 520 + lotsVisibles.length * 44 }} aria-label="Pièces du DCE par lot">
          <thead>
            <tr>
              <th className={cn(TH, 'sticky top-0 left-0 z-30 bg-[var(--tblr-surface-2)] text-left align-bottom px-3 py-2.5 border-b border-r border-[var(--tblr-border)] w-[300px] min-w-[300px]')}>
                Pièce du DCE
              </th>
              {lotsVisibles.map(lot => (
                <th key={lot.id} className="sticky top-0 z-20 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] p-0 align-bottom w-11 min-w-11" style={{ height: 124 }}>
                  <button type="button" onClick={() => onChange(basculerColonne(pieces, lot.id, lotIds))}
                    title={`Lot ${lot.lot_number} : ${lot.lot_title}. Cocher ou décocher toute la colonne`}
                    className="w-full h-full flex flex-col items-center justify-end gap-1.5 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors">
                    <span className="text-[0.6875rem] font-semibold text-[var(--tblr-muted)] overflow-hidden text-ellipsis whitespace-nowrap" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: 84 }}>{lot.lot_title}</span>
                    <span className="px-1.5 py-0.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[0.6875rem] font-black">{lot.lot_number}</span>
                  </button>
                </th>
              ))}
              <th className={cn(TH, 'sticky top-0 z-20 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)] px-3 align-bottom pb-2.5 min-w-[72px] text-center')}>Lots</th>
            </tr>
          </thead>
          <tbody>
            {pieces.map(p => {
              const n = lotsDeLaPiece(p, lotIds);
              const ouvert = fichiersOuverts.has(p.id);
              const nbFichiers = p.document_ids?.length ?? 0;
              return (
                <tr key={p.id}>
                  <th scope="row" className="sticky left-0 z-10 bg-[var(--tblr-surface)] text-left align-top px-3 py-2.5 border-b border-r border-[var(--tblr-border)] font-normal">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <select aria-label="Type de pièce" value={p.type_doc}
                          onChange={e => maj(p.id, x => ({ ...x, type_doc: e.target.value, nom: typeLabels[e.target.value] || '' }))}
                          className={CHAMP}>
                          {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <input aria-label="Intitulé précis" placeholder="Intitulé précis" value={p.nom}
                          onChange={e => maj(p.id, x => ({ ...x, nom: e.target.value }))} className={CHAMP} />
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" aria-pressed={p.tous_lots} onClick={() => maj(p.id, basculerTous)}
                            className={cn('px-2.5 py-1 rounded-lg text-[0.6875rem] font-bold transition-colors border',
                              p.tous_lots
                                ? 'bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)] border-blue-300 dark:border-blue-700'
                                : 'bg-[var(--tblr-surface)] border-[var(--tblr-border)] hover:bg-zinc-100 dark:hover:bg-zinc-800')}>
                            Tous les lots
                          </button>
                          <button type="button" aria-expanded={ouvert} onClick={() => basculerFichiers(p.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.6875rem] font-bold border border-[var(--tblr-border)] bg-[var(--tblr-surface)] hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                            <IconPaperclip size={12} /> {nbFichiers > 0 ? `${nbFichiers} fichier${nbFichiers > 1 ? 's' : ''}` : 'Joindre'}
                          </button>
                          {n === 0 && <span className="text-[0.6875rem] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Aucun lot</span>}
                        </div>
                        {ouvert && (
                          <DceFichiersPicker documents={documentsAffaire} value={p.document_ids ?? []} label={`Documents joints à ${p.nom || 'la pièce'}`}
                            onChange={ids => maj(p.id, x => ({ ...x, document_ids: ids }))} />
                        )}
                      </div>
                      <button type="button" aria-label={`Supprimer ${p.nom || 'la pièce'}`} onClick={() => onChange(pieces.filter(x => x.id !== p.id))}
                        className="p-1 text-zinc-300 hover:text-red-500 transition-colors flex-shrink-0 mt-1"><IconTrash size={13} /></button>
                    </div>
                  </th>
                  {lotsVisibles.map(lot => {
                    const etat: Etat = p.tous_lots ? 'der' : p.lots_ids.includes(lot.id) ? 'on' : 'off';
                    return (
                      <td key={lot.id} className="border-b border-[var(--tblr-border)] p-0 text-center">
                        <button type="button" role="checkbox" aria-checked={etat !== 'off'}
                          aria-label={`${p.nom || 'Pièce'}, lot ${lot.lot_number}`}
                          onClick={() => { maj(p.id, x => basculerCase(x, lot.id, lotIds)); setLotApercu(lot.id); }}
                          className="w-full h-full min-h-[44px] flex items-center justify-center hover:bg-zinc-50 dark:hover:bg-zinc-800/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
                          <Pastille etat={etat} />
                        </button>
                      </td>
                    );
                  })}
                  <td className="border-b border-[var(--tblr-border)] px-3 text-center text-xs tabular-nums text-[var(--tblr-muted)]">
                    {p.tous_lots ? 'Tous' : `${n} / ${lotIds.length}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className={cn(TH, 'sticky left-0 z-10 bg-[var(--tblr-surface-2)] px-3 h-10 border-r border-[var(--tblr-border)]')}>Pièces reçues par lot</td>
              {lotsVisibles.map(lot => {
                const c = piecesDuLot(pieces, lot.id);
                return (
                  <td key={lot.id} className={cn('text-center text-xs tabular-nums font-bold',
                    c === 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-[var(--tblr-surface-2)] text-[var(--tblr-text)]')}>{c}</td>
                );
              })}
              <td className="bg-[var(--tblr-surface-2)]" />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="border-t border-[var(--tblr-border)] pt-4" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h4 className="text-sm font-bold text-[var(--tblr-text)] uppercase tracking-wider">Ce que reçoit une entreprise</h4>
          <select aria-label="Lot à prévisualiser" value={lotChoisi?.id ?? ''} onChange={e => setLotApercu(e.target.value)} className={cn(CHAMP, 'w-auto')}>
            {lots.map(l => <option key={l.id} value={l.id}>Lot {l.lot_number} · {l.lot_title}</option>)}
          </select>
          <span className="text-[0.6875rem] text-[var(--tblr-muted)] tabular-nums">{recues.length} pièce{recues.length > 1 ? 's' : ''} sur {pieces.length}</span>
        </div>
        <ul className="rounded-lg border border-[var(--tblr-border)] divide-y divide-[var(--tblr-border)] text-xs bg-[var(--tblr-surface-2)]">
          {recues.length === 0 && <li className="px-3 py-2.5 text-[var(--tblr-muted)] italic">Aucune pièce transmise à ce lot.</li>}
          {recues.map(p => (
            <li key={p.id} className="px-3 py-2.5 flex flex-wrap items-baseline gap-x-3">
              <span className={cn(TH, 'w-20')}>{p.type_doc}</span>
              <span className="font-semibold text-[var(--tblr-text)]">{p.nom || typeLabels[p.type_doc]}</span>
              <span className="text-[var(--tblr-muted)]">{fichiersTexte(p.document_ids?.length ?? 0)}</span>
            </li>
          ))}
        </ul>
      </div>

      <button type="button" onClick={onAjouter} className={BOUTON}><IconPlus size={13} /> Ajouter une pièce</button>
    </div>
  );
}
