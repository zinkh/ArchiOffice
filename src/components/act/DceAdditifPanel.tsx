// Additifs au DCE : publier une modification du dossier de consultation (pièces modifiées, indice, motif),
// prévenir par mail les seules entreprises concernées, suivre qui a confirmé la réception.
// La publication ne touche à aucun fichier : elle consigne QUOI a changé ; les fichiers restent ceux de
// l'affaire. Les envois passent par la fenêtre d'envoi groupé (mode `additif`).
import { useEffect, useMemo, useState } from 'react';
import { IconCheck, IconFilePlus, IconSend } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { todayIso, type EntrepriseSuivi } from '../../lib/actEntreprises';
import type { DocumentDce } from '../../lib/dceIndices';
import type { ContexteEnvoiDce } from '../../lib/dceEnvoiPreparation';
import {
  MAX_MOTIF_REVISION, controlerRevision, entreprisesConcernees, numeroRevision, type DceRevision,
} from '../../lib/dceRevisions';
import DceEnvoiGroupeDialog from './DceEnvoiGroupeDialog';

interface PieceChoisissable {
  id: string; nom: string; tous_lots: boolean; lots_ids: string[]; document_ids?: string[]; partage?: boolean;
}

interface Props {
  projectId: string;
  /** Pièces du DCE (consultation.dce_documents), avec leurs libellés tels que l'écran les affiche. */
  pieces: Array<PieceChoisissable & { libelle: string }>;
  documents: DocumentDce[];
  revisions: DceRevision[];
  entreprises: EntrepriseSuivi[];
  contexte: Omit<ContexteEnvoiDce, 'additif'>;
  onChangeRevisions: (next: DceRevision[]) => void;
  /** Une entreprise vient d'être prévenue : l'écran l'enregistre (mise à jour sur la dernière version). */
  onNotifiee: (revisionId: string, entrepriseId: string) => void;
}

const CHAMP = 'text-sm border border-[var(--tblr-border)] rounded-lg px-2.5 py-1.5 bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');

export default function DceAdditifPanel({ projectId, pieces, documents, revisions, entreprises, contexte, onChangeRevisions, onNotifiee }: Props) {
  const modifiables = useMemo(() => pieces.filter(p => !p.partage && (p.document_ids ?? []).length > 0), [pieces]);
  const [ouvert, setOuvert] = useState(false);
  const [coches, setCoches] = useState<Record<string, { coche: boolean; indice: string }>>({});
  const [motif, setMotif] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [notifierId, setNotifierId] = useState<string | null>(null);
  const [accuses, setAccuses] = useState<Array<{ revision_id: string; entreprise_id: string; accuse_le: string }>>([]);

  const chargerAccuses = () => {
    apiFetch<typeof accuses>(`/api/projects/${encodeURIComponent(projectId)}/depot/additifs/accuses`)
      .then(r => setAccuses(Array.isArray(r) ? r : [])).catch(() => { /* accusés indisponibles : le suivi reste vide */ });
  };
  useEffect(() => { if (revisions.length > 0) chargerAccuses(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId, revisions.length]);

  const ouvrir = () => {
    // L'indice proposé est celui de la fiche du premier document de la pièce : jamais inventé, modifiable.
    const depart: Record<string, { coche: boolean; indice: string }> = {};
    for (const p of modifiables) {
      const premier = documents.find(d => d.id === (p.document_ids ?? [])[0]);
      depart[p.id] = { coche: false, indice: (premier?.indice ?? '').trim() };
    }
    setCoches(depart); setMotif(''); setErreur(null); setOuvert(true);
  };

  const publier = () => {
    const controle = controlerRevision(
      motif,
      modifiables.filter(p => coches[p.id]?.coche).map(p => ({ id: p.id, libelle: p.libelle, indice: coches[p.id].indice })),
    );
    if (!controle.ok) { setErreur(controle.raison); return; }
    const revision: DceRevision = { id: crypto.randomUUID(), cree_le: todayIso(), motif: controle.motif, pieces: controle.pieces };
    onChangeRevisions([...revisions, revision]);
    setOuvert(false);
    // Proposer d'emblée de prévenir les entreprises, s'il y en a à prévenir.
    if (entreprisesConcernees(revision, pieces, entreprises).length > 0) setNotifierId(revision.id);
  };

  const revisionNotifiee = revisions.find(r => r.id === notifierId);
  const concernees = (r: DceRevision) => entreprisesConcernees(r, pieces, entreprises);

  return (
    <section aria-label="Additifs au DCE" className="px-5 pb-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Additifs</h4>
          <p className="text-[0.6875rem] text-[var(--tblr-muted)] mt-0.5">
            Une pièce du DCE a changé après l'envoi ? Publiez un additif : seules les entreprises concernées sont prévenues, et chacune peut confirmer la réception.
          </p>
        </div>
        <button type="button" onClick={ouvrir} disabled={modifiables.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50">
          <IconFilePlus size={13} /> Publier une modification
        </button>
      </div>

      {ouvert && (
        <div className="rounded-lg border border-[var(--tblr-border)] p-4 space-y-3 bg-[var(--tblr-surface-2)]">
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold mb-1">Pièces modifiées</legend>
            {modifiables.map(p => (
              <div key={p.id} className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 text-sm flex-1 min-w-[12rem]">
                  <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={!!coches[p.id]?.coche}
                    onChange={e => setCoches(c => ({ ...c, [p.id]: { ...c[p.id], coche: e.target.checked } }))} />
                  <span className="break-words">{p.libelle}</span>
                </label>
                <label className="flex items-center gap-1.5 text-xs text-[var(--tblr-muted)]">
                  Indice
                  <input className={`${CHAMP} w-20`} value={coches[p.id]?.indice ?? ''} maxLength={20} disabled={!coches[p.id]?.coche}
                    aria-label={`Indice de ${p.libelle}`}
                    onChange={e => setCoches(c => ({ ...c, [p.id]: { ...c[p.id], indice: e.target.value } }))} />
                </label>
              </div>
            ))}
          </fieldset>
          <label className="block text-xs font-semibold">Motif de la modification
            <textarea className={`${CHAMP} block w-full mt-1`} rows={3} maxLength={MAX_MOTIF_REVISION} value={motif}
              placeholder="Ex. : cotes de la façade nord modifiées, indice C"
              onChange={e => setMotif(e.target.value)} />
          </label>
          <p className="text-[0.6875rem] text-[var(--tblr-muted)]">
            Mettez d'abord à jour le fichier dans les documents de l'affaire (nouvel indice) : c'est lui qui sera joint au mail et proposé sur la page de dépôt.
          </p>
          {erreur && <p role="alert" className="text-xs text-red-600">{erreur}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOuvert(false)} className="px-3 py-1.5 text-xs text-[var(--tblr-muted)]">Annuler</button>
            <button type="button" onClick={publier} className="px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700">Publier l'additif</button>
          </div>
        </div>
      )}

      {revisions.length === 0 ? (
        <p className="text-xs text-[var(--tblr-muted)] italic">Aucun additif publié.</p>
      ) : (
        <ul className="divide-y divide-[var(--tblr-border)] border border-[var(--tblr-border)] rounded-lg">
          {[...revisions].reverse().map(r => {
            const cibles = concernees(r);
            const prevenues = cibles.filter(e => (r.notifiee_a ?? []).includes(e.id)).length;
            const confirmees = cibles.filter(e => accuses.some(a => a.revision_id === r.id && a.entreprise_id === e.id)).length;
            const restantes = cibles.length - prevenues;
            return (
              <li key={r.id} className="p-3 text-sm space-y-1">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="font-semibold">Additif n° {numeroRevision(revisions, r.id)} du {fmtDate(r.cree_le)}</p>
                  <button type="button" onClick={() => setNotifierId(r.id)} disabled={cibles.length === 0}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border border-[var(--tblr-border)] hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50">
                    <IconSend size={11} /> {restantes > 0 ? `Prévenir (${restantes})` : 'Renvoyer'}
                  </button>
                </div>
                <p className="whitespace-pre-line break-words">{r.motif}</p>
                <p className="text-xs text-[var(--tblr-muted)]">{r.pieces.map(p => `${p.libelle}${p.indice ? ` (indice ${p.indice})` : ''}`).join(' ; ')}</p>
                <p className="text-xs text-[var(--tblr-muted)] flex items-center gap-1.5">
                  {cibles.length === 0
                    ? 'Aucune entreprise à prévenir (le DCE n\'est pas encore parti, ou aucune n\'est concernée).'
                    : <>{prevenues} prévenue{prevenues > 1 ? 's' : ''} sur {cibles.length} · <IconCheck size={12} aria-hidden /> {confirmees} réception{confirmees > 1 ? 's' : ''} confirmée{confirmees > 1 ? 's' : ''}</>}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {revisionNotifiee && (
        <DceEnvoiGroupeDialog
          titre={`Prévenir les entreprises de l'additif n° ${numeroRevision(revisions, revisionNotifiee.id)}`}
          mode="additif"
          dejaDiffusee={new Set(revisionNotifiee.notifiee_a ?? [])}
          entreprises={concernees(revisionNotifiee)}
          contexte={{ ...contexte, additif: { revision: revisionNotifiee, numero: numeroRevision(revisions, revisionNotifiee.id) } }}
          onEnvoye={entrepriseId => onNotifiee(revisionNotifiee.id, entrepriseId)}
          onClose={() => { setNotifierId(null); chargerAccuses(); }}
        />
      )}
    </section>
  );
}
