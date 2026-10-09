// Les gestes qui font passer une remise de la zone d'attente aux offres de la
// consultation. Chacun montre son EFFET avant de l'appliquer et ne touche à rien
// tant que l'architecte n'a pas confirmé :
//   - saisie en ligne  -> aperçu puis intégration (consultationDepotApply.ts) ;
//   - bordereau chiffré -> l'import existant du DPGF / BPU (OffreImportDialog) ;
//   - acte d'engagement -> la lecture existante du formulaire PDF (RecapActe) ;
//   - tout fichier      -> montants probables lus dans le texte (suggestion).
import { useEffect, useState } from 'react';
import { IconLoader2, IconSparkles, IconX } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { OffreImportDialog } from '../pro/OffreImportDialog';
import { RecapActe } from './MarcheDocumentsPanel';
import { lireActeDepuisBuffer } from '../../lib/actEngagementRead';
import { FormulaireNonReconnuError } from '../../lib/actEngagementImport';
import { appliquerActeAuxOffres, type ResultatImport } from '../../lib/actEngagementApply';
import type { ActeRempli } from '../../lib/actEngagementForm';
import { apercuSaisie, type ConsultationApplicable, type DepotSaisie } from '../../lib/consultationDepotApply';
import { NATURE_LABELS, type MontantCandidat } from '../../lib/depotMontants';
import { euros, formaterDateHeure } from '../../lib/depotAffichage';
import type { DepotRecu } from '../../hooks/useConsultationDepot';
import type { DocumentAvecArticles } from '../../lib/bpuImport';

const BOUTON = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50';
const BOUTON_PRIMAIRE = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--tblr-primary)] text-white hover:opacity-90 disabled:opacity-50';

export interface LotLibelle { id: string; lot_number: string; lot_title: string }
export const libelleLot = (lots: LotLibelle[], id: string | null) => {
  const l = lots.find(x => x.id === id);
  return l ? `Lot ${l.lot_number} : ${l.lot_title}` : 'Tous lots';
};

function Fenetre({ titre, onClose, children, large }: { titre: string; onClose: () => void; children: React.ReactNode; large?: boolean }) {
  useEscapeKey(true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label={titre}
        className={`rounded-xl shadow-xl w-full ${large ? 'max-w-3xl' : 'max-w-lg'} max-h-[88dvh] flex flex-col`}
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 flex justify-between items-start gap-3" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <h3 className="text-base font-bold" style={{ color: 'var(--tblr-text)' }}>{titre}</h3>
          <button type="button" onClick={onClose} aria-label="Fermer" style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
        </div>
        <div className="p-4 overflow-y-auto text-sm" style={{ color: 'var(--tblr-text)' }}>{children}</div>
      </div>
    </div>
  );
}

// ── Saisie en ligne ──────────────────────────────────────────────────────────

export function SaisieApercuDialog({ consultation, depot, lots, onConfirm, onClose }: {
  consultation: ConsultationApplicable;
  depot: DepotSaisie & { entreprise_nom: string };
  lots: LotLibelle[];
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [enCours, setEnCours] = useState(false);
  const apercu = apercuSaisie(consultation, depot);
  const libelleAction = { ajoutee: 'ajoutée', mise_a_jour: 'mise à jour', identique: 'déjà enregistrée' } as const;

  return (
    <Fenetre titre={`Intégrer la saisie de ${depot.entreprise_nom}`} onClose={onClose}>
      {!apercu ? (
        <p className="text-xs text-red-600 dark:text-red-400">
          Cette saisie ne peut pas être intégrée : elle ne vise aucun lot, ou l’entreprise n’est plus dans la consultation.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{libelleLot(lots, apercu.lotId)} · remise du {formaterDateHeure(depot.received_at)}</p>
          <table className="w-full text-xs">
            <tbody>
              <tr className="border-t border-[var(--tblr-border)]">
                <td className="py-1.5 pr-2">Offre de base HT</td>
                <td className="py-1.5 pr-2 text-right font-bold">{euros(apercu.nouveauMontant)}</td>
                <td className="py-1.5 text-right" style={{ color: 'var(--tblr-muted)' }}>
                  Offre {libelleAction[apercu.action]}{apercu.action === 'mise_a_jour' ? ` (${euros(apercu.ancienMontant)} avant)` : ''}
                </td>
              </tr>
              {apercu.lignes.map((l, i) => (
                <tr key={i} className="border-t border-[var(--tblr-border)]">
                  <td className="py-1.5 pr-2">{l.kind === 'option' ? 'Option' : 'Variante'} : {l.libelle}</td>
                  <td className="py-1.5 pr-2 text-right font-bold">{euros(l.montant)}</td>
                  <td className="py-1.5 text-right" style={{ color: 'var(--tblr-muted)' }}>
                    {l.action === 'ajoutee' ? 'ajoutée' : l.action === 'identique' ? 'inchangée' : `mise à jour (${euros(l.ancien)} avant)`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {apercu.delaiSemaines ? <p className="text-xs">Délai annoncé : {apercu.delaiSemaines} semaines.</p> : null}
          {apercu.observations ? <p className="text-xs">Observations : {apercu.observations}</p> : null}
          <p className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>
            Les options et variantes rejoignent la négociation au prix d’ouverture ; les tours déjà saisis ne changent pas. L’offre reste modifiable dans la phase Offres.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={BOUTON} onClick={onClose}>Annuler</button>
            <button type="button" className={BOUTON_PRIMAIRE} disabled={enCours}
              onClick={async () => { setEnCours(true); try { await onConfirm(); } finally { setEnCours(false); } }}>
              {enCours && <IconLoader2 size={13} className="animate-spin" />} Intégrer aux offres
            </button>
          </div>
        </div>
      )}
    </Fenetre>
  );
}

// ── Bordereau chiffré : l'import existant du DPGF ou du BPU ──────────────────

type CibleBordereau = 'dpgf' | 'bpu';

export function BordereauImporter({ projectId, depot, fichier, onDone, onClose }: {
  projectId: string;
  depot: DepotRecu;
  fichier: File;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const [documents, setDocuments] = useState<Partial<Record<CibleBordereau, DocumentAvecArticles>> | null>(null);
  const [cible, setCible] = useState<CibleBordereau | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      const lire = (url: string) => apiFetch<DocumentAvecArticles>(url).catch(() => null);
      const [dpgf, bpu] = await Promise.all([lire(`/api/projects/${projectId}/dpgf`), lire(`/api/projects/${projectId}/bpu`)]);
      if (annule) return;
      const trouves: Partial<Record<CibleBordereau, DocumentAvecArticles>> = {};
      if (dpgf?.lots?.length) trouves.dpgf = dpgf;
      if (bpu?.lots?.length) trouves.bpu = bpu;
      setDocuments(trouves);
      setCible(trouves.dpgf ? 'dpgf' : trouves.bpu ? 'bpu' : null);
    })();
    return () => { annule = true; };
  }, [projectId]);

  if (!documents) {
    return <Fenetre titre="Bordereau chiffré" onClose={onClose}><p className="flex items-center gap-2 text-xs"><IconLoader2 size={14} className="animate-spin" /> Lecture du DPGF et du bordereau…</p></Fenetre>;
  }
  if (!cible) {
    return (
      <Fenetre titre="Bordereau chiffré" onClose={onClose}>
        <p className="text-xs">Aucun DPGF ni bordereau n’est renseigné dans l’onglet PRO de cette opération : il n’y a rien à quoi rapprocher les prix de {depot.entreprise_nom}. Ouvrez le fichier pour le lire.</p>
      </Fenetre>
    );
  }

  const enregistrer = async (offre: any) => {
    try {
      await apiFetch(`/api/projects/${projectId}/${cible === 'dpgf' ? 'dpgf' : 'bpu'}/offres`, { method: 'POST', body: JSON.stringify({ offre }) });
      await onDone();
    } catch (e: any) {
      setErreur(e?.message || 'L’offre n’a pas pu être enregistrée.');
      throw e;
    }
  };

  return (
    <>
      {Object.keys(documents).length > 1 && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] rounded-lg px-3 py-2 text-xs shadow-lg flex items-center gap-2" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
          Rapprocher avec :
          {(['dpgf', 'bpu'] as const).filter(c => documents[c]).map(c => (
            <button key={c} type="button" onClick={() => setCible(c)} className={`${BOUTON} ${cible === c ? 'ring-2 ring-blue-500' : ''}`}>{c === 'dpgf' ? 'DPGF' : 'Bordereau (BPU)'}</button>
          ))}
        </div>
      )}
      {erreur && <p role="alert" className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[60] text-xs text-red-600 bg-white px-3 py-2 rounded shadow">{erreur}</p>}
      <OffreImportDialog
        key={cible}
        doc={documents[cible]!}
        docLabel={cible === 'dpgf' ? 'DPGF' : 'bordereau'}
        fichierInitial={fichier}
        entrepriseInitiale={{ id: depot.entreprise_id, nom: depot.entreprise_nom }}
        dateReceptionInitiale={depot.received_at.slice(0, 10)}
        onClose={onClose}
        onConfirm={enregistrer}
      />
    </>
  );
}

// ── Acte d'engagement ────────────────────────────────────────────────────────

export function ActeLecteur({ fichier, lots, contacts, consultation, onImporter, onClose }: {
  fichier: File;
  lots: LotLibelle[];
  contacts: Array<{ id: string; siret?: string; company_name?: string; first_name?: string; last_name?: string }>;
  consultation: { entreprises: any[]; offres: any[] };
  onImporter: (res: ResultatImport) => Promise<void>;
  onClose: () => void;
}) {
  const [acte, setActe] = useState<ActeRempli | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const a = await lireActeDepuisBuffer(await fichier.arrayBuffer(), lots);
        if (!annule) setActe(a);
      } catch (e) {
        if (!annule) setErreur(e instanceof FormulaireNonReconnuError ? e.message : 'Ce fichier n’a pas pu être lu comme un acte d’engagement.');
      }
    })();
    return () => { annule = true; };
  }, [fichier, lots]);

  return (
    <Fenetre titre="Acte d’engagement remis" onClose={onClose} large>
      {erreur && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{erreur} Ouvrez le fichier pour le lire à la main.</p>}
      {!acte && !erreur && <p className="flex items-center gap-2 text-xs"><IconLoader2 size={14} className="animate-spin" /> Lecture du formulaire…</p>}
      {acte && (
        <RecapActe
          lu={{ fichier: fichier.name, acte }}
          apercu={appliquerActeAuxOffres(
            consultation as never, acte, lots, contacts,
            { aujourdhui: new Date().toISOString().slice(0, 10), genererId: () => crypto.randomUUID() },
          )}
          onImporter={res => { void onImporter(res); }}
        />
      )}
    </Fenetre>
  );
}

// ── Montants probables lus dans un fichier ───────────────────────────────────

export function AnalyseMontantsDialog({ depot, lots, lotsOuverts, onUtiliser, onClose }: {
  depot: DepotRecu;
  lots: LotLibelle[];
  /** Lots que l'entreprise peut viser (tous si l'invitation n'en précise pas). */
  lotsOuverts: string[];
  onUtiliser: (montant: number, lotId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [resultat, setResultat] = useState<{ texte_lu: boolean; candidats: MontantCandidat[]; note: string | null } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [lotId, setLotId] = useState<string>(depot.lot_id || lotsOuverts[0] || '');
  const [enCours, setEnCours] = useState<number | null>(null);

  useEffect(() => {
    let annule = false;
    apiFetch<{ texte_lu: boolean; candidats: MontantCandidat[]; note: string | null }>(`/api/depots/${depot.id}/analyser`, { method: 'POST', body: '{}' })
      .then(r => { if (!annule) setResultat(r); })
      .catch(e => { if (!annule) setErreur(e?.message || 'La lecture du document a échoué.'); });
    return () => { annule = true; };
  }, [depot.id]);

  const choix = lots.filter(l => lotsOuverts.length === 0 || lotsOuverts.includes(l.id));

  return (
    <Fenetre titre={`Montants lus dans ${depot.file_name || 'le fichier'}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
          Lecture automatique du texte, sans modèle ni coût : ce ne sont que des propositions. Vérifiez le montant dans le document avant de l’utiliser.
        </p>
        {!resultat && !erreur && <p className="flex items-center gap-2 text-xs"><IconLoader2 size={14} className="animate-spin" /> Lecture du document…</p>}
        {erreur && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{erreur}</p>}
        {resultat && !resultat.texte_lu && <p className="text-xs">{resultat.note}</p>}
        {resultat?.texte_lu && resultat.candidats.length === 0 && <p className="text-xs">Aucun montant en euros n’a été repéré dans ce document.</p>}
        {resultat && resultat.candidats.length > 0 && (
          <>
            <label className="block text-xs">
              <span className="block text-[0.6875rem] font-semibold mb-1" style={{ color: 'var(--tblr-muted)' }}>Lot concerné</span>
              <select className="w-full text-sm px-3 py-2 border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-900" value={lotId} onChange={e => setLotId(e.target.value)}>
                {!lotId && <option value="">Choisir un lot…</option>}
                {choix.map(l => <option key={l.id} value={l.id}>Lot {l.lot_number} : {l.lot_title}</option>)}
              </select>
            </label>
            <ul className="divide-y divide-[var(--tblr-border)] rounded-lg border border-[var(--tblr-border)]">
              {resultat.candidats.map(c => (
                <li key={`${c.ligne}-${c.montant}`} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm">{euros(c.montant)} <span className="text-[0.6875rem] font-normal" style={{ color: 'var(--tblr-muted)' }}>{NATURE_LABELS[c.nature]}</span></p>
                    <p className="text-[0.6875rem] truncate" style={{ color: 'var(--tblr-muted)' }} title={c.contexte}>Ligne {c.ligne} : {c.contexte}</p>
                  </div>
                  <button type="button" className={BOUTON} disabled={!lotId || enCours !== null}
                    onClick={async () => { setEnCours(c.montant); try { await onUtiliser(c.montant, lotId); } finally { setEnCours(null); } }}>
                    {enCours === c.montant ? <IconLoader2 size={13} className="animate-spin" /> : <IconSparkles size={13} />} Utiliser comme offre de base
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Fenetre>
  );
}
