// Envoi de documents du DCE choisis, sans passer par un additif : un document seul (bouton de sa ligne) ou
// une sélection de documents mis à jour, à plusieurs entreprises d'un coup. Les envois passent par la fenêtre
// d'envoi groupé (mode `documents`) : un mail individuel par entreprise, qui ne joint que ceux des documents
// choisis qui concernent SES lots. Rien n'est enregistré sur l'entreprise : ce n'est pas la transmission du DCE.
import { useMemo, useState } from 'react';
import { IconSend } from '@tabler/icons-react';
import { dateFr, type DocumentDce } from '../../lib/dceIndices';
import type { EntrepriseSuivi } from '../../lib/actEntreprises';
import type { ContexteEnvoiDce } from '../../lib/dceEnvoiPreparation';
import { entreprisesConcerneesParPieces } from '../../lib/dceEnvoiGroupe';
import DceEnvoiGroupeDialog from './DceEnvoiGroupeDialog';

export interface PieceEnvoyable {
  id: string; libelle: string; tous_lots: boolean; lots_ids: string[]; document_ids?: string[]; partage?: boolean;
}

interface Props {
  /** Pièces du DCE (consultation.dce_documents), avec leurs libellés tels que l'écran les affiche. */
  pieces: PieceEnvoyable[];
  documents: DocumentDce[];
  entreprises: EntrepriseSuivi[];
  contexte: Omit<ContexteEnvoiDce, 'piecesChoisies'>;
}

const BOUTON = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-[var(--tblr-border)] hover:bg-[var(--tblr-primary-lt)] disabled:opacity-50';

export default function DceEnvoiDocumentsPanel({ pieces, documents, entreprises, contexte }: Props) {
  const parId = useMemo(() => new Map(documents.map(d => [d.id, d])), [documents]);
  // Une pièce n'est envoyable que si elle porte au moins un fichier de l'affaire (un dossier partagé ne part jamais en pièce jointe).
  const envoyables = useMemo(
    () => pieces.filter(p => !p.partage && (p.document_ids ?? []).some(id => parId.has(id))),
    [pieces, parId],
  );
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const [cible, setCible] = useState<string[] | null>(null);

  const cochees = envoyables.filter(p => coches.has(p.id)).map(p => p.id);
  const concernees = (ids: string[]) => entreprisesConcerneesParPieces(ids, pieces, entreprises);
  const libelleLots = (p: PieceEnvoyable) => p.tous_lots
    ? 'Tous les lots'
    : contexte.lots.filter(l => p.lots_ids.includes(l.id)).map(l => `Lot ${l.lot_number}`).join(', ') || 'Aucun lot';
  const basculer = (id: string) => setCoches(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toutesCochees = envoyables.length > 0 && cochees.length === envoyables.length;

  const bouton = (ids: string[], libelle: string, aria: string) => {
    const n = concernees(ids).length;
    return (
      <button type="button" className={BOUTON} disabled={ids.length === 0 || n === 0} aria-label={aria}
        title={n === 0 && ids.length > 0 ? 'Aucune entreprise n\'est concernée par ces documents (lots)' : undefined}
        onClick={() => setCible(ids)}>
        <IconSend size={13} aria-hidden="true" /> {libelle}
      </button>
    );
  };

  return (
    <section aria-label="Envoyer des documents du DCE" className="px-5 pb-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Envoyer des documents</h4>
          <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-0.5">
            Un document à renvoyer, ou plusieurs documents mis à jour ? Choisissez-les puis les entreprises : chacune ne reçoit que ceux de ses lots, dans un message individuel.
          </p>
        </div>
        {bouton(cochees, `Envoyer la sélection (${cochees.length})`, 'Envoyer les documents sélectionnés')}
      </div>

      {envoyables.length === 0 ? (
        <p className="text-xs text-[var(--tblr-muted)] italic">Aucun document n'est encore rattaché aux pièces du DCE.</p>
      ) : (
        <div className="border border-[var(--tblr-border)] rounded-lg overflow-hidden">
          <label className="flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-[var(--tblr-surface-2)] border-b border-[var(--tblr-border)]">
            <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={toutesCochees}
              onChange={() => setCoches(toutesCochees ? new Set() : new Set(envoyables.map(p => p.id)))} />
            Tout sélectionner
          </label>
          <ul className="divide-y divide-[var(--tblr-border)] max-h-96 overflow-y-auto">
            {envoyables.map(p => {
              const fichiers = (p.document_ids ?? []).map(id => parId.get(id)).filter((d): d is DocumentDce => !!d);
              return (
                <li key={p.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <input type="checkbox" className="mt-1 w-4 h-4 accent-blue-600" checked={coches.has(p.id)}
                    onChange={() => basculer(p.id)} aria-label={`Sélectionner ${p.libelle}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold break-words">{p.libelle}</p>
                    <p className="text-xs text-[var(--tblr-muted)] break-words">
                      {libelleLots(p)} · {fichiers.map(d => `${d.name}${(d.indice ?? '').trim() ? ` (indice ${d.indice!.trim()})` : ''}${dateFr(d.uploaded_at) ? `, ${dateFr(d.uploaded_at)}` : ''}`).join(' ; ')}
                    </p>
                  </div>
                  {bouton([p.id], 'Envoyer', `Envoyer ${p.libelle} aux entreprises`)}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {cible && (
        <DceEnvoiGroupeDialog
          titre={cible.length === 1 ? 'Envoyer un document aux entreprises' : `Envoyer ${cible.length} documents aux entreprises`}
          mode="documents"
          entreprises={concernees(cible)}
          contexte={{ ...contexte, piecesChoisies: cible }}
          onEnvoye={() => { /* rien à enregistrer : un envoi de documents n'est pas la transmission du DCE */ }}
          onClose={() => setCible(null)}
        />
      )}
    </section>
  );
}
