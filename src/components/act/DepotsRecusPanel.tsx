// « Dépôts des entreprises » (phase Offres du module ACT) : la zone d'attente où
// arrivent les remises faites depuis les liens personnels. Rien n'est jamais
// appliqué aux offres sans geste explicite : saisie en ligne (aperçu puis
// intégration), bordereau (import du DPGF / BPU), acte d'engagement (lecture du
// formulaire), fichier (montants probables en suggestion) ou simple ouverture.
import { useState } from 'react';
import {
  IconAlertTriangle, IconCheck, IconDownload, IconFileText, IconLoader2, IconLock, IconSettings,
  IconSparkles, IconTableImport, IconUpload, IconX,
} from '@tabler/icons-react';
import { cn } from '../../lib/utils';
import { useConfirmDialog } from '../ui/ConfirmDialog';
import type { DepotRecu, useConsultationDepot } from '../../hooks/useConsultationDepot';
import {
  DEPOT_KIND_LABELS, DEPOT_STATUT_LABELS, DEPOT_TABLEURS, extensionDe, formatOctets, type DepotStatut,
} from '../../lib/consultationDepot';
import { appliquerSaisie, type ConsultationApplicable } from '../../lib/consultationDepotApply';
import type { ResultatImport } from '../../lib/actEngagementApply';
import { euros, formaterDate, formaterDateHeure } from '../../lib/depotAffichage';
import {
  ActeLecteur, AnalyseMontantsDialog, BordereauImporter, SaisieApercuDialog,
  libelleLot, type LotLibelle,
} from './DepotIntegration';

type Depot = ReturnType<typeof useConsultationDepot>;

interface Props {
  projectId: string;
  depot: Depot;
  lots: LotLibelle[];
  contacts: Array<{ id: string; siret?: string; company_name?: string; first_name?: string; last_name?: string }>;
  consultation: ConsultationApplicable;
  onChangeConsultation: (next: any) => void;
  onImporterActe: (res: ResultatImport) => void;
  onOpenSettings: () => void;
}

const BOUTON = 'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[0.6875rem] font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50';
const BOUTON_PRIMAIRE = 'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[0.6875rem] font-bold bg-[var(--tblr-primary)] text-white hover:opacity-90 disabled:opacity-50';

const PILL_STATUT: Record<DepotStatut, string> = {
  recu: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  integre: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejete: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  retire: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
};

type Dialogue =
  | { type: 'saisie'; depot: DepotRecu }
  | { type: 'analyse'; depot: DepotRecu }
  | { type: 'bordereau'; depot: DepotRecu; fichier: File }
  | { type: 'acte'; depot: DepotRecu; fichier: File };

export default function DepotsRecusPanel({ projectId, depot, lots, contacts, consultation, onChangeConsultation, onImporterActe, onOpenSettings }: Props) {
  const { eligibilite, depots, scelle, deadlineAt, loading, aTraiter } = depot;
  const [dialogue, setDialogue] = useState<Dialogue | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const { confirm, dialog: dialogueConfirmation } = useConfirmDialog();

  if (loading) return null;

  // Hors éligibilité et sans rien de reçu : une ligne qui dit pourquoi, sans bruit.
  if (!eligibilite?.eligible && depots.length === 0) {
    return (
      <div className="rounded-lg px-4 py-3 text-xs flex items-start gap-2" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
        <IconUpload size={14} className="mt-0.5 shrink-0" />
        <span><strong style={{ color: 'var(--tblr-text)' }}>Dépôt en ligne des offres.</strong> {eligibilite?.message || 'Indisponible.'}</span>
      </div>
    );
  }

  const geste = async (id: string, action: () => Promise<void>) => {
    setOccupe(id); setErreur(null);
    try { await action(); } catch (e: any) { setErreur(e?.message || 'Le geste a échoué.'); } finally { setOccupe(null); }
  };

  const lotsOuvertsDe = (d: DepotRecu) => consultation.entreprises.find(e => e.id === d.entreprise_id)?.lots_ids ?? [];
  const entrepriseDe = (d: DepotRecu) => consultation.entreprises.find(e => e.id === d.entreprise_id);

  const comme = (d: DepotRecu) => ({
    id: d.id, entreprise_id: d.entreprise_id, lot_id: d.lot_id, received_at: d.received_at,
    payload: d.payload!, entreprise_nom: d.entreprise_nom,
  });

  const rejeter = (d: DepotRecu) => geste(d.id, async () => {
    const ok = await confirm({
      title: `Rejeter la remise de ${d.entreprise_nom} ?`,
      message: 'Elle ne sera plus proposée à l’intégration. Le fichier reste sur l’espace de stockage du cabinet.',
      confirmLabel: 'Rejeter', cancelLabel: 'Annuler', tone: 'danger',
    });
    if (ok) await depot.marquer(d.id, 'rejeter');
  });

  const preparerFichier = (d: DepotRecu, type: 'bordereau' | 'acte') => geste(d.id, async () => {
    setDialogue({ type, depot: d, fichier: await depot.telecharger(d) });
  });

  const groupes = Object.values(depots.reduce<Record<string, { nom: string; lignes: DepotRecu[] }>>((acc, d) => {
    (acc[d.entreprise_id] ??= { nom: d.entreprise_nom, lignes: [] }).lignes.push(d);
    return acc;
  }, {})).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  const resume = (d: DepotRecu) => {
    if (d.scelle) return <span className="inline-flex items-center gap-1.5 italic"><IconLock size={12} /> Pli scellé : contenu masqué</span>;
    if (d.kind === 'saisie' && d.payload) {
      return <>Offre saisie en ligne : <strong>{euros(d.payload.montant_base)}</strong> HT{d.payload.lignes.length ? `, ${d.payload.lignes.length} option(s) ou variante(s)` : ''}</>;
    }
    return <><strong>{d.file_name}</strong>{d.size_bytes ? <span style={{ color: 'var(--tblr-muted)' }}> · {formatOctets(d.size_bytes)}</span> : null}</>;
  };

  return (
    <section
      className="rounded-lg overflow-hidden"
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      aria-label="Dépôts des entreprises"
    >
      <div className="p-4 flex flex-wrap items-start justify-between gap-3" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}>
            <IconUpload size={15} /> Dépôts des entreprises
            {aTraiter > 0 && <span className="px-2 py-0.5 rounded-full text-[0.6875rem] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{aTraiter} à traiter</span>}
          </h3>
          <p className="text-[0.6875rem] mt-1" style={{ color: 'var(--tblr-muted)' }}>
            Remises faites depuis les liens personnels{eligibilite?.stockage ? `, déposées sur ${eligibilite.stockage.nom || 'l’espace de stockage du cabinet'}` : ''}.
            {deadlineAt ? ` Date limite : ${formaterDateHeure(deadlineAt)}.` : ' Aucune date limite fixée.'}
          </p>
        </div>
        <button type="button" className={BOUTON} onClick={onOpenSettings}><IconSettings size={13} /> Réglages du dépôt</button>
      </div>

      {scelle && (
        <div className="px-4 py-2.5 text-xs flex items-start gap-2 bg-amber-50 dark:bg-amber-900/10 text-amber-900 dark:text-amber-200" role="status">
          <IconLock size={14} className="mt-0.5 shrink-0" />
          <span>Plis scellés jusqu’au {formaterDateHeure(deadlineAt)} : vous voyez qu’une remise existe, pas son contenu. Elle ne peut être ni ouverte, ni intégrée avant cette échéance.</span>
        </div>
      )}
      {erreur && <p role="alert" className="px-4 py-2 text-xs text-red-600 dark:text-red-400">{erreur}</p>}

      {groupes.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs italic" style={{ color: 'var(--tblr-muted)' }}>
          Aucune remise pour l’instant. Invitez une entreprise depuis le tableau « Entreprises consultées » (phase Préparation).
        </p>
      ) : (
        <div className="divide-y divide-[var(--tblr-border)]">
          {groupes.map(g => (
            <div key={g.nom} className="px-4 py-3">
              <p className="text-sm font-bold" style={{ color: 'var(--tblr-text)' }}>{g.nom}</p>
              <ul className="mt-2 space-y-2">
                {g.lignes.map(d => {
                  const traitable = d.status === 'recu' && !d.scelle;
                  const tableur = d.file_name ? (DEPOT_TABLEURS as string[]).includes(extensionDe(d.file_name)) : false;
                  const lisible = !!d.file_name && d.kind !== 'saisie';
                  return (
                    <li key={d.id} className={cn('rounded-md border border-[var(--tblr-border)] p-2.5 text-xs', d.status !== 'recu' && 'opacity-70')}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-semibold">{DEPOT_KIND_LABELS[d.kind]}</span>
                        <span style={{ color: 'var(--tblr-muted)' }}>{libelleLot(lots, d.lot_id)}</span>
                        <span style={{ color: 'var(--tblr-muted)' }}>v{d.version} · {formaterDate(d.received_at)}</span>
                        {d.hors_delai && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"><IconAlertTriangle size={11} /> Hors délai</span>}
                        <span className={cn('px-1.5 py-0.5 rounded font-bold', PILL_STATUT[d.status])}>{DEPOT_STATUT_LABELS[d.status]}</span>
                      </div>
                      <p className="mt-1.5 break-words">{resume(d)}</p>
                      {d.note && !d.scelle && <p className="mt-1" style={{ color: 'var(--tblr-muted)' }}>Note : {d.note}</p>}

                      {traitable && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {d.kind === 'saisie' && (
                            <button type="button" className={BOUTON_PRIMAIRE} disabled={occupe === d.id} onClick={() => setDialogue({ type: 'saisie', depot: d })}>
                              <IconCheck size={12} /> Aperçu et intégration
                            </button>
                          )}
                          {d.kind === 'bordereau' && tableur && (
                            <button type="button" className={BOUTON_PRIMAIRE} disabled={occupe === d.id} onClick={() => preparerFichier(d, 'bordereau')}>
                              {occupe === d.id ? <IconLoader2 size={12} className="animate-spin" /> : <IconTableImport size={12} />} Importer le bordereau
                            </button>
                          )}
                          {d.kind === 'acte' && (
                            <button type="button" className={BOUTON_PRIMAIRE} disabled={occupe === d.id} onClick={() => preparerFichier(d, 'acte')}>
                              {occupe === d.id ? <IconLoader2 size={12} className="animate-spin" /> : <IconFileText size={12} />} Lire l’acte d’engagement
                            </button>
                          )}
                          {lisible && (
                            <button type="button" className={BOUTON} disabled={occupe === d.id} onClick={() => geste(d.id, () => depot.ouvrir(d.id))}>
                              <IconDownload size={12} /> Ouvrir
                            </button>
                          )}
                          {lisible && d.kind !== 'bordereau' && (
                            <button type="button" className={BOUTON} onClick={() => setDialogue({ type: 'analyse', depot: d })}>
                              <IconSparkles size={12} /> Lire les montants
                            </button>
                          )}
                          {d.kind === 'fichier' && (
                            <button type="button" className={BOUTON} disabled={occupe === d.id} onClick={() => geste(d.id, () => depot.marquer(d.id, 'integrer'))}>
                              <IconCheck size={12} /> Marquer comme traité
                            </button>
                          )}
                          <button type="button" className={BOUTON} disabled={occupe === d.id} onClick={() => rejeter(d)}>
                            <IconX size={12} /> Rejeter
                          </button>
                        </div>
                      )}
                      {d.status !== 'recu' && !d.scelle && lisible && (
                        <div className="mt-2">
                          <button type="button" className={BOUTON} disabled={occupe === d.id} onClick={() => geste(d.id, () => depot.ouvrir(d.id))}><IconDownload size={12} /> Ouvrir</button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {dialogue?.type === 'saisie' && dialogue.depot.payload && (
        <SaisieApercuDialog
          consultation={consultation} lots={lots}
          depot={comme(dialogue.depot)}
          onClose={() => setDialogue(null)}
          onConfirm={async () => {
            onChangeConsultation(appliquerSaisie(consultation, comme(dialogue.depot), { genererId: () => crypto.randomUUID() }));
            await depot.marquer(dialogue.depot.id, 'integrer');
            setDialogue(null);
          }}
        />
      )}

      {dialogue?.type === 'bordereau' && (
        <BordereauImporter
          projectId={projectId} depot={dialogue.depot} fichier={dialogue.fichier}
          onClose={() => setDialogue(null)}
          onDone={async () => { await depot.marquer(dialogue.depot.id, 'integrer'); setDialogue(null); }}
        />
      )}

      {dialogue?.type === 'acte' && (
        <ActeLecteur
          fichier={dialogue.fichier} lots={lots} contacts={contacts} consultation={consultation}
          onClose={() => setDialogue(null)}
          onImporter={async res => { onImporterActe(res); await depot.marquer(dialogue.depot.id, 'integrer'); setDialogue(null); }}
        />
      )}

      {dialogue?.type === 'analyse' && (
        <AnalyseMontantsDialog
          depot={dialogue.depot} lots={lots} lotsOuverts={lotsOuvertsDe(dialogue.depot)}
          onClose={() => setDialogue(null)}
          onUtiliser={async (montant, lotId) => {
            const entreprise = entrepriseDe(dialogue.depot);
            if (!entreprise) { setErreur('Cette entreprise n’est plus dans la consultation.'); setDialogue(null); return; }
            onChangeConsultation(appliquerSaisie(consultation, {
              id: dialogue.depot.id, entreprise_id: dialogue.depot.entreprise_id, lot_id: lotId,
              received_at: dialogue.depot.received_at, payload: { montant_base: montant, lignes: [] },
            }, { genererId: () => crypto.randomUUID() }));
            await depot.marquer(dialogue.depot.id, 'integrer');
            setDialogue(null);
          }}
        />
      )}
      {dialogueConfirmation}
    </section>
  );
}
