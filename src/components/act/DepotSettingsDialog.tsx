// Réglages du dépôt des offres d'une consultation : date limite, plis scellés,
// consignes aux entreprises et pièces du DCE publiées sur le portail.
import { useEffect, useState } from 'react';
import { IconLoader2, IconLock, IconX } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import type { ReglagesDepotCabinet } from '../../hooks/useConsultationDepot';
import { depuisChampDateHeure, formaterDateHeure, versChampDateHeure } from '../../lib/depotAffichage';
import { formatOctets } from '../../lib/consultationDepot';

interface PieceProjet { id: string; name: string; phase?: string | null; size_bytes?: number | null }

interface Props {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}

const CHAMP = 'w-full text-sm px-3 py-2 border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900 outline-none focus:ring-2 focus:ring-blue-500';
const BOUTON_PRIMAIRE = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--tblr-primary)] text-white hover:opacity-90 disabled:opacity-50';
const BOUTON = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50';

export default function DepotSettingsDialog({ projectId, onClose, onSaved }: Props) {
  const [reglages, setReglages] = useState<ReglagesDepotCabinet | null>(null);
  const [pieces, setPieces] = useState<PieceProjet[]>([]);
  const [limite, setLimite] = useState('');
  const [scelle, setScelle] = useState(false);
  const [consignes, setConsignes] = useState('');
  const [publiees, setPubliees] = useState<Set<string>>(new Set());
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  useEscapeKey(true, onClose);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const [r, docs] = await Promise.all([
          apiFetch<ReglagesDepotCabinet>(`/api/projects/${projectId}/depot/settings`),
          apiFetch<PieceProjet[]>(`/api/documents?project_id=${encodeURIComponent(projectId)}`).catch(() => []),
        ]);
        if (annule) return;
        setReglages(r);
        setLimite(versChampDateHeure(r.deadline_at));
        setScelle(r.sealed);
        setConsignes(r.instructions || '');
        setPubliees(new Set(r.published_document_ids));
        // Les pièces de la consultation d'abord : le DCE est classé en phase DCE.
        setPieces([...docs].sort((a, b) => Number(b.phase === 'DCE') - Number(a.phase === 'DCE') || a.name.localeCompare(b.name, 'fr')));
      } catch (e: any) {
        if (!annule) setErreur(e?.message || 'Lecture des réglages impossible.');
      }
    })();
    return () => { annule = true; };
  }, [projectId]);

  const verrouille = !!reglages?.plis_scelles_actifs;

  const enregistrer = async () => {
    setEnCours(true); setErreur(null);
    try {
      await apiFetch(`/api/projects/${projectId}/depot/settings`, {
        method: 'PUT',
        body: JSON.stringify({
          deadline_at: depuisChampDateHeure(limite), sealed: scelle,
          instructions: consignes, published_document_ids: [...publiees],
        }),
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setErreur(e?.message || 'Les réglages n’ont pas pu être enregistrés.');
      setEnCours(false);
    }
  };

  const basculer = (id: string) => setPubliees(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label="Réglages du dépôt des offres"
        className="rounded-xl shadow-xl w-full max-w-xl max-h-[88dvh] flex flex-col"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 flex justify-between items-start gap-3" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <h3 className="text-base font-bold" style={{ color: 'var(--tblr-text)' }}>Réglages du dépôt des offres</h3>
          <button type="button" onClick={onClose} aria-label="Fermer" style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
        </div>

        {!reglages && !erreur && <p className="p-6 flex items-center gap-2 text-sm"><IconLoader2 size={14} className="animate-spin" /> Lecture…</p>}

        {reglages && (
          <div className="p-4 space-y-4 overflow-y-auto text-sm" style={{ color: 'var(--tblr-text)' }}>
            <label className="block">
              <span className="block text-[0.6875rem] font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Date et heure limites de remise</span>
              <input type="datetime-local" className={CHAMP} value={limite} onChange={e => setLimite(e.target.value)} />
              <span className="block text-[0.6875rem] mt-1" style={{ color: 'var(--tblr-muted)' }}>
                Une remise plus tardive est acceptée mais signalée « hors délai ». Sans date, aucune remise n’est signalée.
              </span>
            </label>

            <div className="rounded-lg border border-[var(--tblr-border)] p-3">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 w-4 h-4 accent-blue-600" checked={scelle} disabled={verrouille} onChange={e => setScelle(e.target.checked)} />
                <span>
                  <span className="font-semibold flex items-center gap-1.5"><IconLock size={13} /> Plis scellés jusqu’à la date limite</span>
                  <span className="block text-[0.6875rem] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
                    Vous voyez qu’une remise existe, mais ni son contenu ni son nom de fichier : impossible de l’ouvrir, de l’intégrer ou de la lire avant la date limite. Une fois la consultation scellée, le scellement ne peut plus être levé et la date ne peut qu’être repoussée.
                  </span>
                </span>
              </label>
              {scelle && !limite && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-2">Des plis scellés demandent une date limite.</p>}
              {verrouille && <p className="text-xs mt-2" style={{ color: 'var(--tblr-muted)' }}>Plis scellés jusqu’au {formaterDateHeure(reglages.deadline_at)}.</p>}
            </div>

            <label className="block">
              <span className="block text-[0.6875rem] font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Consignes affichées aux entreprises</span>
              <textarea className={CHAMP} rows={3} maxLength={4000} value={consignes} onChange={e => setConsignes(e.target.value)}
                placeholder="Ex. : remettre un devis détaillé par lot, accompagné du mémoire technique." />
            </label>

            <fieldset>
              <legend className="text-[0.6875rem] font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Pièces du dossier proposées au téléchargement</legend>
              <p className="text-[0.6875rem] mb-2" style={{ color: 'var(--tblr-muted)' }}>Seules les pièces cochées sont visibles depuis le lien. Elles viennent des documents de l’opération.</p>
              {pieces.length === 0 ? (
                <p className="text-xs italic" style={{ color: 'var(--tblr-muted)' }}>Aucun document dans l’opération.</p>
              ) : (
                <ul className="max-h-48 overflow-y-auto rounded-lg border border-[var(--tblr-border)] divide-y divide-[var(--tblr-border)]">
                  {pieces.map(p => (
                    <li key={p.id}>
                      <label className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer">
                        <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={publiees.has(p.id)} onChange={() => basculer(p.id)} />
                        <span className="flex-1 min-w-0 truncate">{p.name}</span>
                        {p.phase && <span style={{ color: 'var(--tblr-muted)' }}>{p.phase}</span>}
                        {p.size_bytes ? <span style={{ color: 'var(--tblr-muted)' }}>{formatOctets(p.size_bytes)}</span> : null}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>

            {erreur && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{erreur}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={BOUTON} onClick={onClose}>Annuler</button>
              <button type="button" className={BOUTON_PRIMAIRE} disabled={enCours || (scelle && !limite)} onClick={enregistrer}>
                {enCours && <IconLoader2 size={13} className="animate-spin" />} Enregistrer
              </button>
            </div>
          </div>
        )}
        {!reglages && erreur && <p role="alert" className="p-4 text-xs text-red-600 dark:text-red-400">{erreur}</p>}
      </div>
    </div>
  );
}
