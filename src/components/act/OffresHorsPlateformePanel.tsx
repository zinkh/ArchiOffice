// « Offres reçues hors plateforme » (phase Offres du module ACT) : documents PDF ou contenu d'un dossier ZIP
// transmis par une entreprise par e-mail, clé USB ou courrier numérisé. Même présentation que les dépôts du
// portail, mais ces pièces ne passent par aucun lien personnel : elles sont rangées dans les documents de
// l'affaire et simplement référencées dans la consultation (`offres_recues_fichiers`, jsonb).
import { useState } from 'react';
import { IconCheck, IconDownload, IconFileText, IconInbox, IconTrash } from '@tabler/icons-react';
import { cn } from '../../lib/utils';
import { openSignedUrl } from '../../lib/signedStorageUrl';
import { formatOctets, type OffreFichierRecu } from '../../lib/offresRecues';
import { formaterDate } from '../../lib/depotAffichage';
import { useConfirmDialog } from '../ui/ConfirmDialog';
import { libelleLot, type LotLibelle } from './DepotIntegration';

interface Props {
  offres: OffreFichierRecu[];
  lots: LotLibelle[];
  onMarquer: (id: string, statut: OffreFichierRecu['statut']) => void;
  onRetirer: (id: string) => void;
}

const BOUTON = 'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[0.6875rem] font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50';

export default function OffresHorsPlateformePanel({ offres, lots, onMarquer, onRetirer }: Props) {
  const [erreur, setErreur] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmDialog();
  if (offres.length === 0) return null;

  const groupes = Object.values(offres.reduce<Record<string, { nom: string; lignes: OffreFichierRecu[] }>>((acc, o) => {
    (acc[o.entreprise_id || o.entreprise_nom] ??= { nom: o.entreprise_nom, lignes: [] }).lignes.push(o);
    return acc;
  }, {})).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  const aTraiter = offres.filter(o => o.statut === 'recu').length;

  const ouvrir = async (o: OffreFichierRecu) => {
    setErreur(null);
    try { await openSignedUrl(o.file_url); } catch (e: any) { setErreur(e?.message || "Le document n'a pas pu être ouvert."); }
  };

  const retirer = async (o: OffreFichierRecu) => {
    const ok = await confirm({
      title: `Retirer « ${o.nom} » de la consultation ?`,
      message: "Le document reste dans les documents de l'affaire ; seul son rattachement à cette consultation est supprimé.",
      confirmLabel: 'Retirer', cancelLabel: 'Annuler', tone: 'danger',
    });
    if (ok) onRetirer(o.id);
  };

  return (
    <section
      className="rounded-lg overflow-hidden"
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      aria-label="Offres reçues hors plateforme"
    >
      <div className="p-4" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}>
          <IconInbox size={15} /> Offres reçues hors plateforme
          {aTraiter > 0 && <span className="px-2 py-0.5 rounded-full text-[0.6875rem] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{aTraiter} à traiter</span>}
        </h3>
        <p className="text-[0.6875rem] mt-1" style={{ color: 'var(--tblr-muted)' }}>
          Documents transmis par e-mail, clé USB ou courrier, rangés dans les documents de l'affaire.
        </p>
      </div>
      {erreur && <p role="alert" className="px-4 py-2 text-xs text-red-600 dark:text-red-400">{erreur}</p>}
      <div className="divide-y divide-[var(--tblr-border)]">
        {groupes.map(g => (
          <div key={g.nom} className="px-4 py-3">
            <p className="text-sm font-bold" style={{ color: 'var(--tblr-text)' }}>{g.nom}</p>
            <ul className="mt-2 space-y-2">
              {g.lignes.map(o => (
                <li key={o.id} className={cn('rounded-md border border-[var(--tblr-border)] p-2.5 text-xs', o.statut === 'traite' && 'opacity-70')}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-semibold">Hors plateforme</span>
                    <span style={{ color: 'var(--tblr-muted)' }}>
                      {o.lots_ids.length === 0 ? 'Tous lots' : o.lots_ids.map(id => libelleLot(lots, id)).join(', ')}
                    </span>
                    <span style={{ color: 'var(--tblr-muted)' }}>{formaterDate(o.recu_le)}</span>
                    <span className={cn('px-1.5 py-0.5 rounded font-bold', o.statut === 'recu'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300')}>
                      {o.statut === 'recu' ? 'Reçu' : 'Traité'}
                    </span>
                  </div>
                  <p className="mt-1.5 break-words flex items-start gap-1.5">
                    <IconFileText size={13} className="mt-0.5 shrink-0" />
                    <span>
                      <strong>{o.chemin || o.nom}</strong>
                      <span style={{ color: 'var(--tblr-muted)' }}> · {formatOctets(o.taille)}{o.archive ? ` · dans ${o.archive}` : ''}</span>
                    </span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button type="button" className={BOUTON} onClick={() => void ouvrir(o)}><IconDownload size={12} /> Ouvrir</button>
                    {o.statut === 'recu'
                      ? <button type="button" className={BOUTON} onClick={() => onMarquer(o.id, 'traite')}><IconCheck size={12} /> Marquer comme traité</button>
                      : <button type="button" className={BOUTON} onClick={() => onMarquer(o.id, 'recu')}>Remettre à traiter</button>}
                    <button type="button" className={BOUTON} onClick={() => void retirer(o)}><IconTrash size={12} /> Retirer</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {dialog}
    </section>
  );
}
