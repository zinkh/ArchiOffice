// Téléchargement, depuis le navigateur, du PV d'OPR privé en PDF et en Word.
// Le contenu est construit par oprPvDocument.ts, rendu par oprPvPdf.ts et oprPvDocx.ts.
import { saveAs } from 'file-saver';
import type { AgencySettings } from './proposalExport';
import { nomFichier, preparer } from './certificatPaiementExport';
import { fetchAgencySettings } from './pdfLetterhead';
import type { OprPv } from './oprPv';
import { construirePvPrive, libelleLot, type DonneesPvPrive } from './oprPvDocument';
import { rendreDocPv } from './oprPvPdf';

export interface SourcePvPrive {
  pv: OprPv;
  reference?: string | null;
  maitreOuvrage?: string | null;
  objet?: string | null;
  marche: { lot_numero?: string | null; lot_titre?: string | null; entreprise_nom?: string | null; date_signature?: string | null; date_notification?: string | null } | null;
  reserves: Array<{ number: number | null; batiment: string | null; local: string | null; created_at: string | null; title: string }>;
  /** Nom de l'agence, imprimé sous la signature du maître d'œuvre. */
  agence?: string | null;
}

/** Les données d'un PV privé telles que les attend le rendu, depuis ce que l'écran a chargé. */
export function donneesPvPrive(s: SourcePvPrive): DonneesPvPrive {
  return {
    pv: s.pv,
    reference: s.reference ?? null,
    maitreOuvrage: s.maitreOuvrage,
    objetMarche: s.objet,
    dateMarche: s.marche?.date_signature ?? s.marche?.date_notification ?? null,
    lot: libelleLot(s.marche?.lot_numero, s.marche?.lot_titre),
    entreprise: s.marche?.entreprise_nom ?? null,
    maitreOeuvre: s.agence ?? null,
    reserves: s.reserves.map(r => ({ numero: r.number, batiment: r.batiment, localisation: r.local, date: r.created_at, points: r.title })),
  };
}

const nomDuPv =(d: DonneesPvPrive): (string | null | undefined)[] => ['PV_OPR', d.reference, d.lot];

export async function telechargerPvPdf(donnees: DonneesPvPrive, settings?: AgencySettings): Promise<void> {
  const r = await preparer(settings);
  rendreDocPv(r, construirePvPrive(donnees));
  r.pdf.save(nomFichier(...nomDuPv(donnees)));
}

export async function telechargerPvDocx(donnees: DonneesPvPrive, settings?: AgencySettings): Promise<void> {
  const reglages = settings && Object.keys(settings).length ? settings : await fetchAgencySettings();
  const { construireDocxPv } = await import('./oprPvDocx');
  const blob = await construireDocxPv(construirePvPrive(donnees), reglages);
  saveAs(blob, nomFichier(...nomDuPv(donnees)).replace(/\.pdf$/, '.docx'));
}
