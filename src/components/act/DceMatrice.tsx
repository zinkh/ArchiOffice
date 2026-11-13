import { useMemo, useState } from 'react';
import { IconPaperclip, IconPlus, IconTrash } from '@tabler/icons-react';
import type { ProjectLot } from '../../types';
import type { DocumentDce } from '../../lib/dceIndices';
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

const HACHURE = 'repeating-linear-gradient(45deg, currentColor 0 2px, transparent 2px 4px)';

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
        <p className="text-sm text-[var(--tblr-muted)] italic mb-3">Aucun document DCE. Cliquez sur « Ajouter » pour commencer.</p>
        <button type="button" onClick={onAjouter} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition">
          <IconPlus size={13} /> Ajouter une pièce
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.6875rem] text-[var(--tblr-muted)]">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-3 border-[1.5px] border-current bg-current" /> Pièce donnée au lot</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-3 border-[1.5px] border-current opacity-60" style={{ backgroundImage: HACHURE }} /> Donnée par « Tous les lots »</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-3 border-[1.5px] border-current" /> Non transmise</span>
        <span>Un clic sur un en-tête de lot coche toute la colonne.</span>
        <label className="ml-auto inline-flex items-center gap-1.5 cursor-pointer text-[var(--tblr-text)]">
          <input type="checkbox" checked={aCompleter} onChange={e => setACompleter(e.target.checked)} className="rounded w-3.5 h-3.5" />
          Lots à compléter seulement
        </label>
      </div>

      <div className="overflow-auto border border-[var(--tblr-border)] max-h-[70vh]">
        <table className="border-separate border-spacing-0 w-full" style={{ minWidth: 560 + lotsVisibles.length * 40 }} aria-label="Pièces du DCE par lot">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 bg-[var(--tblr-surface-2)] text-left align-bottom px-3 py-2 border-b border-r border-[var(--tblr-text)] w-[300px] min-w-[300px] text-[0.625rem] uppercase tracking-wider text-[var(--tblr-muted)] font-semibold">
                Pièce du DCE
              </th>
              {lotsVisibles.map(lot => (
                <th key={lot.id} className="sticky top-0 z-20 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-text)] p-0 align-bottom w-10 min-w-10" style={{ height: 120 }}>
                  <button type="button" onClick={() => onChange(basculerColonne(pieces, lot.id, lotIds))}
                    title={`Lot ${lot.lot_number} : ${lot.lot_title}. Cocher ou décocher toute la colonne`}
                    className="w-full h-full flex flex-col items-center justify-end gap-1.5 py-1.5 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60">
                    <span className="text-[0.6875rem] text-[var(--tblr-text)] overflow-hidden text-ellipsis whitespace-nowrap" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: 84 }}>{lot.lot_title}</span>
                    <b className="text-xs">{lot.lot_number}</b>
                  </button>
                </th>
              ))}
              <th className="sticky top-0 z-20 bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-text)] px-2 align-bottom pb-1.5 text-[0.625rem] uppercase tracking-wider text-[var(--tblr-muted)] font-semibold min-w-[64px]">Lots</th>
            </tr>
          </thead>
          <tbody>
            {pieces.map(p => {
              const n = lotsDeLaPiece(p, lotIds);
              const ouvert = fichiersOuverts.has(p.id);
              const nbFichiers = p.document_ids?.length ?? 0;
              return (
                <tr key={p.id}>
                  <th scope="row" className="sticky left-0 z-10 bg-[var(--tblr-surface)] text-left align-top px-3 py-2 border-b border-r border-[var(--tblr-text)] font-normal">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <select aria-label="Type de pièce" value={p.type_doc}
                          onChange={e => maj(p.id, x => ({ ...x, type_doc: e.target.value, nom: typeLabels[e.target.value] || '' }))}
                          className="w-full px-2 py-1 text-[0.6875rem] border border-[var(--tblr-border)] rounded bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-zinc-500">
                          {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <input aria-label="Intitulé précis" placeholder="Intitulé précis" value={p.nom}
                          onChange={e => maj(p.id, x => ({ ...x, nom: e.target.value }))}
                          className="w-full px-2 py-1 text-xs font-semibold border border-[var(--tblr-border)] rounded bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-zinc-500" />
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" aria-pressed={p.tous_lots} onClick={() => maj(p.id, basculerTous)}
                            className={`px-2 py-0.5 text-[0.6875rem] border border-[var(--tblr-text)] rounded-sm ${p.tous_lots ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
                            Tous les lots
                          </button>
                          <button type="button" aria-expanded={ouvert} onClick={() => basculerFichiers(p.id)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[0.6875rem] border border-[var(--tblr-border)] rounded-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                            <IconPaperclip size={12} /> {nbFichiers > 0 ? `${nbFichiers} fichier${nbFichiers > 1 ? 's' : ''}` : 'Joindre'}
                          </button>
                          {n === 0 && <span className="text-[0.625rem] font-semibold px-1.5 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Aucun lot</span>}
                        </div>
                        {ouvert && (
                          <DceFichiersPicker documents={documentsAffaire} value={p.document_ids ?? []} label={`Documents joints à ${p.nom || 'la pièce'}`}
                            onChange={ids => maj(p.id, x => ({ ...x, document_ids: ids }))} />
                        )}
                      </div>
                      <button type="button" aria-label={`Supprimer ${p.nom || 'la pièce'}`} onClick={() => onChange(pieces.filter(x => x.id !== p.id))}
                        className="p-1 text-zinc-400 hover:text-red-500 transition-colors flex-shrink-0"><IconTrash size={13} /></button>
                    </div>
                  </th>
                  {lotsVisibles.map(lot => {
                    const etat = p.tous_lots ? 'der' : p.lots_ids.includes(lot.id) ? 'on' : 'off';
                    return (
                      <td key={lot.id} className="border-b border-[var(--tblr-border)] p-0 text-center">
                        <button type="button" role="checkbox" aria-checked={etat !== 'off'}
                          aria-label={`${p.nom || 'Pièce'}, lot ${lot.lot_number}`}
                          onClick={() => { maj(p.id, x => basculerCase(x, lot.id, lotIds)); setLotApercu(lot.id); }}
                          className="w-full h-11 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800">
                          <span className={`block w-[18px] h-[18px] border-[1.5px] ${etat === 'on' ? 'bg-current' : ''} ${etat === 'der' ? 'opacity-60' : ''}`}
                            style={etat === 'der' ? { backgroundImage: HACHURE } : undefined} />
                        </button>
                      </td>
                    );
                  })}
                  <td className="border-b border-[var(--tblr-border)] px-2 text-center text-xs tabular-nums text-[var(--tblr-muted)]">
                    {p.tous_lots ? 'Tous' : `${n} / ${lotIds.length}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky left-0 z-10 bg-[var(--tblr-surface-2)] px-3 h-9 text-xs border-r border-t border-[var(--tblr-text)]">Pièces reçues par lot</td>
              {lotsVisibles.map(lot => {
                const c = piecesDuLot(pieces, lot.id);
                return (
                  <td key={lot.id} className={`border-t border-[var(--tblr-text)] text-center text-xs tabular-nums ${c === 0 ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-semibold' : 'bg-[var(--tblr-surface-2)]'}`}>{c}</td>
                );
              })}
              <td className="border-t border-[var(--tblr-text)] bg-[var(--tblr-surface-2)]" />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="border-t-2 border-[var(--tblr-text)] pt-3" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--tblr-text)]">Ce que reçoit une entreprise</h4>
          <select aria-label="Lot à prévisualiser" value={lotChoisi?.id ?? ''} onChange={e => setLotApercu(e.target.value)}
            className="px-2 py-1 text-xs border border-[var(--tblr-border)] rounded bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-zinc-500">
            {lots.map(l => <option key={l.id} value={l.id}>Lot {l.lot_number} · {l.lot_title}</option>)}
          </select>
          <span className="text-[0.6875rem] text-[var(--tblr-muted)] tabular-nums">{recues.length} pièce{recues.length > 1 ? 's' : ''} sur {pieces.length}</span>
        </div>
        <ul className="border border-[var(--tblr-border)] divide-y divide-[var(--tblr-border)] text-xs">
          {recues.length === 0 && <li className="px-3 py-2 text-[var(--tblr-muted)]">Aucune pièce transmise à ce lot.</li>}
          {recues.map(p => (
            <li key={p.id} className="px-3 py-2 flex flex-wrap items-baseline gap-x-3">
              <span className="w-24 text-[0.625rem] uppercase tracking-wider text-[var(--tblr-muted)]">{p.type_doc}</span>
              <span className="font-medium">{p.nom || typeLabels[p.type_doc]}</span>
              <span className="text-[var(--tblr-muted)]">{p.document_ids?.length ? `${p.document_ids.length} fichier(s)` : 'sans fichier joint'}</span>
            </li>
          ))}
        </ul>
      </div>

      <button type="button" onClick={onAjouter} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition">
        <IconPlus size={13} /> Ajouter une pièce
      </button>
    </div>
  );
}
