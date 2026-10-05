// Contrôle des pièces de candidature et d'offre : entreprises × pièces.
// Une pièce manquante se voit d'un coup d'œil ; un bouton explicite marque les
// offres de l'entreprise non conformes avec ce motif (jamais d'office : c'est
// l'architecte qui juge).
import { cn } from '../../lib/utils';
import {
  PIECES_OFFRE_DEFAUT, basculerPiece, piecesManquantes, type PieceAttendue, type PiecesRecues,
} from '../../lib/actNegociation';
import { BOUTON, CARTE_STYLE, ENTETE_TH } from './negociationUi';

interface Props {
  entreprises: { id: string; nom: string }[];
  piecesAdmin: PieceAttendue[];
  piecesOffre?: PieceAttendue[];
  recues: PiecesRecues | undefined;
  onChange: (next: PiecesRecues) => void;
  /** Marque les offres de l'entreprise non conformes, motif « Pièces manquantes : … ». */
  onMotif?: (entrepriseId: string, motif: string) => void;
}

export default function PiecesRecuesGrid({ entreprises, piecesAdmin, piecesOffre, recues, onChange, onMotif }: Props) {
  const offre = piecesOffre ?? PIECES_OFFRE_DEFAUT;
  const toutes = [...piecesAdmin, ...offre];
  if (entreprises.length === 0) {
    return <div className="rounded-lg p-8 text-center text-[var(--tblr-muted)] italic" style={CARTE_STYLE}>Aucune entreprise consultée.</div>;
  }
  return (
    <div className="rounded-lg overflow-hidden" style={CARTE_STYLE}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--tblr-surface-2)]">
            <tr>
              <th className={cn(ENTETE_TH, 'text-left sticky left-0 bg-[var(--tblr-surface-2)]')} rowSpan={2}>Entreprise</th>
              <th className={cn(ENTETE_TH, 'text-center')} colSpan={Math.max(piecesAdmin.length, 1)}>Candidature</th>
              <th className={cn(ENTETE_TH, 'text-center border-l border-[var(--tblr-border)]')} colSpan={Math.max(offre.length, 1)}>Offre</th>
              <th className={cn(ENTETE_TH, 'text-left')} rowSpan={2}>Contrôle</th>
            </tr>
            <tr>
              {toutes.map((p, i) => (
                <th key={p.id} className={cn('px-2 py-1.5 text-[0.6875rem] font-semibold text-[var(--tblr-muted)] text-center align-bottom max-w-[7rem]', i === piecesAdmin.length && 'border-l border-[var(--tblr-border)]')}>
                  {p.nom}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--tblr-border)]">
            {entreprises.map(e => {
              const manque = piecesManquantes(toutes, recues, e.id);
              return (
                <tr key={e.id}>
                  <td className="px-3 py-2 font-medium sticky left-0 bg-[var(--tblr-surface)]">{e.nom}</td>
                  {toutes.map((p, i) => (
                    <td key={p.id} className={cn('px-2 py-2 text-center', i === piecesAdmin.length && 'border-l border-[var(--tblr-border)]')}>
                      <input
                        type="checkbox" className="w-4 h-4 accent-green-600"
                        aria-label={`${p.nom}, ${e.nom}`}
                        checked={(recues?.[e.id] ?? []).includes(p.id)}
                        onChange={() => onChange(basculerPiece(recues, e.id, p.id))}
                      />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {manque.length === 0
                      ? <span className="font-bold text-green-700 dark:text-green-400">Complet</span>
                      : (
                        <span className="inline-flex items-center gap-2">
                          <span className="font-bold text-amber-700 dark:text-amber-400">{manque.length} manquante{manque.length > 1 ? 's' : ''}</span>
                          {onMotif && (
                            <button type="button" className={BOUTON} onClick={() => onMotif(e.id, `Pièces manquantes : ${manque.map(p => p.nom).join(', ')}`)}>
                              Marquer non conforme
                            </button>
                          )}
                        </span>
                      )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
