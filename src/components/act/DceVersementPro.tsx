import { useState } from 'react';
import { IconFolderPlus } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import type { ProjectLot } from '../../types';
import type { DPGF } from '../../types/dpgf';
import { fetchAgencySettings } from '../../lib/pdfLetterhead';
import { SELECTION_COMPLETE } from '../../lib/exportPerimetre';
import { produireDossier } from '../../lib/exportDossier';
import { suffixeLot } from '../../lib/exportOrientation';
import type { DocumentDce } from '../../lib/dceIndices';
import {
  deposerFichierDce, documentDejaVerse, type EntreePieceDce, type SpecPieceDce,
} from '../../lib/dceVersement';

const BOUTON = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 transition';

/**
 * Verse au DCE le CCTP ou le DPGF de l'onglet PRO, UN PDF PAR LOT : chaque pièce est
 * cochée pour son seul lot, donc une entreprise ne reçoit que ceux de ses lots. Le DPGF
 * part sans prix (bordereau à chiffrer par l'entreprise).
 */
export default function DceVersementPro({ projectId, projectName, lots, dce, documentsAffaire, onVerser }: {
  projectId: string;
  projectName: string;
  lots: ProjectLot[];
  dce: EntreePieceDce[];
  documentsAffaire: DocumentDce[];
  onVerser: (versements: Array<{ spec: SpecPieceDce; documentId: string }>) => void;
}) {
  const [enCours, setEnCours] = useState<'cctp' | 'dpgf' | null>(null);
  const [message, setMessage] = useState<{ texte: string; erreur: boolean } | null>(null);

  const verser = async (doc: 'cctp' | 'dpgf') => {
    setEnCours(doc); setMessage(null);
    try {
      const dpgf = await apiFetch<DPGF>(`/api/projects/${encodeURIComponent(projectId)}/dpgf`);
      if (!dpgf?.lots?.length) throw new Error('Aucun lot dans le document PRO : rédigez le CCTP ou le DPGF avant de le verser.');
      const settings = await fetchAgencySettings();
      const versements: Array<{ spec: SpecPieceDce; documentId: string }> = [];
      const sansLot: string[] = [];
      let nouvelles = 0;
      for (const lot of dpgf.lots) {
        const lotProjet = lots.find(l => l.id === lot.projectLotId)
          ?? lots.find(l => l.lot_number.trim().toLowerCase() === String(lot.numero).trim().toLowerCase());
        if (!lotProjet) { sansLot.push(`Lot ${lot.numero}`); continue; }
        const res = await produireDossier({
          dpgf, bpu: null, documents: { [doc]: 'pdf' }, selection: { ...SELECTION_COMPLETE, lotNumeros: [lot.numero] },
          avecPrix: false, cctpParBatiment: false, parLot: false, projectName, settings,
        });
        const fichier = res.fichiers[0];
        if (!fichier) continue; // lot sans contenu pour ce document
        const spec: SpecPieceDce = {
          typeDoc: doc === 'cctp' ? 'CCTP' : 'DPGF',
          nom: `${doc === 'cctp' ? 'CCTP' : 'DPGF'} - ${suffixeLot(lot)}`, lotsIds: [lotProjet.id],
        };
        const existant = documentDejaVerse(dce, documentsAffaire, spec, fichier.nom);
        const documentId = await deposerFichierDce({ projectId, nomFichier: fichier.nom, blob: fichier.blob, existantId: existant?.id });
        if (!existant) nouvelles++;
        versements.push({ spec, documentId });
      }
      if (versements.length === 0) throw new Error(`Aucun lot du ${doc.toUpperCase()} n'a de contenu à verser.`);
      onVerser(versements);
      setMessage({
        texte: `${versements.length} fichier${versements.length > 1 ? 's' : ''} ${doc.toUpperCase()} versé${versements.length > 1 ? 's' : ''} au DCE (${nouvelles} nouveau${nouvelles > 1 ? 'x' : ''}, ${versements.length - nouvelles} mis à jour). Chaque entreprise ne reçoit que ceux de ses lots.`
          + (sansLot.length ? ` Non versés, lot absent de l'affaire : ${sansLot.join(', ')}.` : ''),
        erreur: false,
      });
    } catch (e: any) {
      setMessage({ texte: e?.message || 'Le versement au DCE a échoué.', erreur: true });
    } finally { setEnCours(null); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-[var(--tblr-border)]">
      <span className="text-[0.6875rem] font-semibold text-[var(--tblr-muted)]">Verser au DCE, un PDF par lot :</span>
      <button type="button" className={BOUTON} disabled={!!enCours} onClick={() => verser('cctp')}>
        <IconFolderPlus size={13} /> {enCours === 'cctp' ? 'Versement…' : 'CCTP'}
      </button>
      <button type="button" className={BOUTON} disabled={!!enCours} onClick={() => verser('dpgf')}
        title="Le DPGF est versé sans prix, pour être chiffré par les entreprises">
        <IconFolderPlus size={13} /> {enCours === 'dpgf' ? 'Versement…' : 'DPGF (sans prix)'}
      </button>
      {message && <p role={message.erreur ? 'alert' : 'status'} className={`basis-full text-xs font-bold ${message.erreur ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>{message.texte}</p>}
    </div>
  );
}
