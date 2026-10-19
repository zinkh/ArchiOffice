// Téléchargement, depuis le navigateur, du PDF d'un marché subséquent. Le rendu
// est dans marcheSubsequentPdf.ts.
import type { AgencySettings } from './proposalExport';
import { nomFichier, preparer } from './certificatPaiementExport';
import type { OperationInfo } from './certificatPaiementPdf';
import { rendreMarcheSubsequent, type MarcheContrat } from './marcheSubsequentPdf';

export async function telechargerMarcheSubsequent(
  accordCadre: MarcheContrat,
  sub: MarcheContrat & { id?: string },
  autres: { montant_ht?: number | string | null; statut?: string | null; id?: string }[],
  operation: OperationInfo,
  settings?: AgencySettings,
): Promise<void> {
  const r = await preparer(settings);
  rendreMarcheSubsequent(r, accordCadre, sub, autres, operation);
  r.pdf.save(nomFichier('Marche_subsequent', sub.numero_subsequent, accordCadre.lot_numero, accordCadre.entreprise_nom));
}
