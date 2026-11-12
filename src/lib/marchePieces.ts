// ── Pièces du marché générées pour l'envoi aux entreprises ───────────────────
// Règlement de consultation, CCAP et formulaire d'acte d'engagement, produits au
// moment de l'envoi d'après les réglages de la consultation : le mail d'invitation
// les joint d'office avec le DCE.
import { fetchAgencySettings } from './pdfLetterhead';
import {
  PARAMETRES_MARCHE_DEFAUT, construireCCAP, construireRC, type ContexteMarche, type ParametresMarche,
} from './actMarche';
import { exporterMarchePdf } from './actMarcheExport';
import { genererActeFormulaire } from './actEngagementForm';
import { PARAMETRES_DEFAUT, parametresDe, piecesOffreDe, type DonneesNegociation } from './actNegociation';

export interface OperationPourMarche {
  nom: string;
  code?: string;
  adresse?: string;
  maitreOuvrage?: string;
  permisNumero?: string;
  permisDate?: string;
}

/** Réglages du marché, complétés par ce que l'affaire sait déjà (maître d'ouvrage, adresse, permis). */
export function contexteMarche(marche: ParametresMarche | undefined, operation: OperationPourMarche): ContexteMarche {
  const p = { ...PARAMETRES_MARCHE_DEFAUT, ...(marche ?? {}) } as ParametresMarche;
  return {
    operation: { nom: operation.nom, code: operation.code, adresse: operation.adresse },
    params: {
      ...p,
      moa_nom: p.moa_nom || operation.maitreOuvrage,
      lieu_construction: p.lieu_construction || operation.adresse,
      permis_numero: p.permis_numero || operation.permisNumero,
      permis_date: p.permis_date || operation.permisDate,
    },
    agence: {},
  };
}

export type TypePieceMarche = 'RC' | 'CCAP' | 'ACTE';

export interface PieceMarcheGeneree {
  type: TypePieceMarche;
  libelle: string;
  fichier: File;
}

export interface ConsultationPourMarche extends DonneesNegociation {
  marche?: ParametresMarche;
  dce_documents: { nom: string; type_doc: string }[];
  criteres: { nom: string; poids: number }[];
  pieces_admin: { id: string; nom: string }[];
}

const nomSur = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');

/** Génère le RC, le CCAP et le formulaire d'acte d'engagement (PDF), dans cet ordre. */
export async function genererPiecesMarchePdf(opts: {
  consultation: ConsultationPourMarche;
  lots: Array<{ lot_number: string; lot_title: string }>;
  operation: OperationPourMarche;
}): Promise<PieceMarcheGeneree[]> {
  const { consultation, lots, operation } = opts;
  const settings = await fetchAgencySettings();
  const ctx: ContexteMarche = { ...contexteMarche(consultation.marche, operation), agence: { nom: settings.agencyName, adresse: settings.address } };
  const base = nomSur(operation.code || operation.nom);

  const pdf = async (docs: ReturnType<typeof construireCCAP>[], nom: string): Promise<File> => {
    let fichier: { nom: string; blob: Blob } | null = null;
    await exporterMarchePdf(docs, settings, nom, (n, blob) => { fichier = { nom: n, blob }; });
    const f = fichier as { nom: string; blob: Blob } | null;
    if (!f) throw new Error('PDF non généré');
    return new File([f.blob], f.nom, { type: 'application/pdf' });
  };

  const rc = construireRC(ctx, {
    dce: consultation.dce_documents,
    piecesAdmin: consultation.pieces_admin,
    piecesOffre: piecesOffreDe(consultation),
    criteres: consultation.criteres,
    lots: lots.map(l => ({ numero: l.lot_number, titre: l.lot_title })),
  });
  const tvaPct = parametresDe(consultation).tva_pct ?? PARAMETRES_DEFAUT.tva_pct;
  const acte = await genererActeFormulaire(ctx, lots.map(l => ({ numero: l.lot_number, titre: l.lot_title })), tvaPct, settings);

  return [
    { type: 'RC', libelle: 'Règlement de consultation', fichier: await pdf([rc], `Reglement_consultation_${base}`) },
    { type: 'CCAP', libelle: 'CCAP', fichier: await pdf([construireCCAP(ctx)], `CCAP_${base}`) },
    { type: 'ACTE', libelle: "Acte d'engagement (formulaire à compléter)",
      fichier: new File([acte], `Acte_engagement_formulaire_${base}.pdf`, { type: 'application/pdf' }) },
  ];
}
