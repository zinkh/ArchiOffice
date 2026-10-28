// Téléchargement, depuis le navigateur, du PV d'OPR privé en PDF et en Word.
// Le contenu est construit par oprPvDocument.ts, rendu par oprPvPdf.ts et oprPvDocx.ts.
import { saveAs } from 'file-saver';
import type { AgencySettings } from './proposalExport';
import { nomFichier, preparer } from './certificatPaiementExport';
import { fetchAgencySettings } from './pdfLetterhead';
import type { NatureReserve, OprPv } from './oprPv';
import { construirePvPrive, libelleLot, type DocPv, type DonneesPvPrive } from './oprPvDocument';
import { livrer, nomSur, type FichierExporte } from './exportSortie';
import { construireExe, identiteEnLignes, type DonneesExe, type FormulaireExeAvecRendu, type IdentiteSource } from './oprPvExe';
import { rendreDocPv } from './oprPvPdf';

export interface SourcePvPrive {
  pv: OprPv;
  reference?: string | null;
  maitreOuvrage?: string | null;
  objet?: string | null;
  marche: { lot_numero?: string | null; lot_titre?: string | null; entreprise_nom?: string | null; date_signature?: string | null; date_notification?: string | null } | null;
  reserves: Array<{ number: number | null; batiment: string | null; local: string | null; created_at: string | null; title: string; nature?: NatureReserve | null; status?: string | null }>;
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

// ---------------------------------------------------------------------------
// Cerfas EXE4 et EXE5 (marché public)

/** La part d'une fiche contact dont les cerfas ont besoin (voir la table `contacts`). */
export interface ContactIdentite {
  company_name?: string | null; first_name?: string | null; last_name?: string | null;
  address?: string | null; zip?: string | null; city?: string | null;
  address_work_street?: string | null; address_work_zip?: string | null; address_work_city?: string | null;
  email?: string | null; email_work?: string | null;
  phone?: string | null; phone_work?: string | null; phone_main?: string | null; phone_mobile?: string | null;
  siret?: string | null;
}

/** Identité d'une fiche contact : raison sociale (à défaut la personne), adresse de travail (à défaut l'adresse générale). */
export function identiteDepuisContact(c: ContactIdentite | null | undefined): IdentiteSource {
  if (!c) return {};
  const personne = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return {
    nom: c.company_name || personne,
    adresse: c.address_work_street || c.address,
    codePostal: c.address_work_zip || c.zip,
    ville: c.address_work_city || c.city,
    siret: c.siret,
    telephone: c.phone_work || c.phone_main || c.phone || c.phone_mobile,
    courriel: c.email_work || c.email,
  };
}

export interface SourceExe {
  pv: OprPv;
  reference?: string | null;
  projet: { nom: string; objet?: string | null; maitreOuvrage?: string | null };
  /** Fiche du maître d'ouvrage, quand l'affaire en désigne une. */
  maitreOuvrageContact?: ContactIdentite | null;
  marche: { lot_numero?: string | null; lot_titre?: string | null; entreprise_nom?: string | null; entreprise_siret?: string | null; objet?: string | null } | null;
  /** Fiche de l'entreprise titulaire, quand le marché en désigne une. */
  titulaireContact?: ContactIdentite | null;
  agence: AgencySettings;
  lieu?: string | null;
  reserves: SourcePvPrive['reserves'];
}

/** Les données d'un cerfa depuis ce que l'écran a chargé : rien d'inventé, une fiche absente laisse des pointillés. */
export function donneesExe(s: SourceExe): DonneesExe {
  const mo = identiteDepuisContact(s.maitreOuvrageContact);
  const titulaire = identiteDepuisContact(s.titulaireContact);
  const lot = libelleLot(s.marche?.lot_numero, s.marche?.lot_titre);
  const agence = s.agence;
  return {
    pv: s.pv,
    reference: s.reference ?? null,
    adjudicateur: identiteEnLignes({ ...mo, nom: mo.nom || s.projet.maitreOuvrage }),
    titulaire: identiteEnLignes({ ...titulaire, nom: titulaire.nom || s.marche?.entreprise_nom, siret: titulaire.siret || s.marche?.entreprise_siret }),
    maitreOeuvre: identiteEnLignes({
      nom: [agence.agencyName, agence.architectName].filter(Boolean).join(' · '),
      adresse: agence.address, siret: agence.siret, telephone: agence.phone, courriel: agence.email,
    }),
    objet: [s.marche?.objet || s.projet.objet || s.projet.nom, lot].filter(Boolean) as string[],
    lot, entreprise: s.marche?.entreprise_nom ?? null,
    lieu: s.lieu ?? null,
    reserves: s.reserves.map(r => ({ numero: r.number, batiment: r.batiment, localisation: r.local, date: r.created_at, points: r.title, nature: r.nature ?? null, statut: r.status ?? null })),
  };
}

const nomDuExe = (code: FormulaireExeAvecRendu, d: DonneesExe): (string | null | undefined)[] => [code, d.reference, d.lot];

export async function telechargerExe(code: FormulaireExeAvecRendu, donnees: DonneesExe, format: 'pdf' | 'docx', settings?: AgencySettings): Promise<void> {
  const doc = construireExe(code, donnees);
  if (format === 'pdf') {
    const r = await preparer(settings);
    rendreDocPv(r, doc);
    r.pdf.save(nomFichier(...nomDuExe(code, donnees)));
    return;
  }
  const reglages = settings && Object.keys(settings).length ? settings : await fetchAgencySettings();
  const { construireDocxPv } = await import('./oprPvDocx');
  saveAs(await construireDocxPv(doc, reglages), nomFichier(...nomDuExe(code, donnees)).replace(/\.pdf$/, '.docx'));
}

// ---------------------------------------------------------------------------
// Export groupé : tous les PV d'une affaire, un fichier PDF par formulaire et par lot

export interface DocumentAExporter {
  /** Nom du fichier, sans extension. */
  nom: string;
  doc: DocPv;
}

/** Un PDF par document, remis tel quel s'il est seul, en ZIP sinon. Rend le nombre de fichiers produits. */
export async function telechargerArchivePv(documents: DocumentAExporter[], nomArchive: string, settings?: AgencySettings): Promise<number> {
  const fichiers: FichierExporte[] = [];
  for (const { nom, doc } of documents) {
    const r = await preparer(settings);
    rendreDocPv(r, doc);
    fichiers.push({ nom: nomSur(`${nom}.pdf`), blob: r.pdf.output('blob') });
  }
  await livrer(fichiers, nomSur(`${nomArchive}.zip`));
  return fichiers.length;
}
