// Archive transmise au maître d'ouvrage : les plans de la maîtrise d'œuvre, les
// DOE des entreprises (rangés par lot, entreprise et pièce), les visas émis et un
// bordereau de transmission. Construite côté serveur : les fichiers sont lus là
// où ils sont (Supabase ou espace externe du cabinet).
//
//   00 - Bordereau de transmission.pdf
//   01 - Plans de la maitrise d'oeuvre/…
//   02 - DOE des entreprises/Lot 02 Charpente - SARL Dupont/<pièce>/…
//   03 - Visas/Visa DOE-2026-001 - SARL Dupont.pdf
//
// Seuls les dossiers VISÉS entrent dans l'archive, sauf demande explicite : un
// dossier non visé n'a pas été contrôlé et ne part pas chez le maître d'ouvrage
// sans que l'architecte l'ait voulu. Les documents refusés n'y sont jamais.
import JSZip from 'jszip';
import {
  ARCHIVE_DOSSIER_DOE, ARCHIVE_DOSSIER_PLANS, ARCHIVE_DOSSIER_VISAS, DOE_AVIS_DOCUMENT_LABELS, DOE_AVIS_VISA_LABELS,
  DOE_PIECE_LABELS, avisDocument, cheminsArchive, nomSur, pieceConnue,
  type DoeAvisVisa,
} from '../../src/lib/doeAtelier';
import { parseExternalRef } from '../externalStorage/externalRef';
import { parseStorageRef } from '../storagePaths';
import { projectFolderName } from '../externalStorage/businessFolderPath';
import { libelleLot, type DossierDoe } from './dossier';
import { construireBordereauPdf } from './pdf';
import { lireFichierStocke } from './storage';

/** Au-delà, l'archive ne tient pas raisonnablement en mémoire : on refuse en le disant. */
export const ARCHIVE_MAX_OCTETS = 300 * 1024 * 1024;

export interface OptionsArchive {
  inclurePlans: boolean;
  /** Tous les plans de l'affaire ; sinon ceux de la phase AOR (ou sans catégorie). */
  plansTous: boolean;
  /** Joindre aussi les dossiers non visés. */
  inclureNonVises: boolean;
  destinataire?: string | null;
}

export interface ResultatArchive {
  buffer: Buffer;
  nom: string;
  fichiers: number;
  octets: number;
  /** Fichiers introuvables ou illisibles, non joints. */
  ignores: string[];
  /** Entreprises dont le dossier n'est pas visé (ou visé avec réserves). */
  reserves: string[];
}

export class ArchiveTropGrosse extends Error {
  status = 413;
  constructor() {
    super(`L'archive dépasserait ${Math.round(ARCHIVE_MAX_OCTETS / 1024 / 1024)} Mo : transmettez les dossiers en plusieurs fois, ou sans les plans.`);
  }
}

/** Ajoute l'extension du fichier stocké quand le nom du plan n'en porte pas. */
function nomAvecExtension(nom: string, fileUrl: string | null | undefined): string {
  if (/\.[A-Za-z0-9]{2,5}$/.test(nom)) return nom;
  const source = parseExternalRef(fileUrl)?.fileName || parseStorageRef(fileUrl || '')?.path || '';
  const ext = source.match(/\.[A-Za-z0-9]{2,5}$/)?.[0];
  return ext ? `${nom}${ext}` : nom;
}

/** Plans les plus récents : un plan remplacé par une version suivante (parent_id) n'est pas joint. */
export function plansCourants(plans: any[]): any[] {
  const remplaces = new Set(plans.map(p => p.parent_id).filter(Boolean));
  return plans.filter(p => !remplaces.has(p.id));
}

interface Entree {
  dossier: string[];
  nom: string;
  fileUrl: string | null;
  ligne: { dossier: string; entreprise: string; lot: string; document: string; avis: string };
}

export async function construireArchive(
  supabaseAdmin: any, tenantId: string, projectId: string, dossier: DossierDoe, options: OptionsArchive,
): Promise<ResultatArchive> {
  const { data: projet } = await supabaseAdmin.from('projects').select('name, project_code')
    .eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();

  const entrees: Entree[] = [];
  const reserves: string[] = [];
  const visasJoints: Array<{ numero: string; entreprise: string; avis: DoeAvisVisa; issued_at: string }> = [];

  // 1. Plans de la maîtrise d'œuvre.
  if (options.inclurePlans) {
    const { data: plans } = await supabaseAdmin.from('plans').select('*').eq('tenant_id', tenantId).eq('project_id', projectId);
    const retenus = plansCourants((plans as any[]) || [])
      .filter(p => options.plansTous || !p.category || p.category === 'AOR');
    for (const p of retenus) {
      const nom = nomAvecExtension(p.name || 'plan', p.file_url);
      entrees.push({
        dossier: [ARCHIVE_DOSSIER_PLANS], nom, fileUrl: p.file_url,
        ligne: { dossier: 'Plans MOE', entreprise: "Maîtrise d'œuvre", lot: '', document: nom, avis: p.index ? `Indice ${p.index}` : '' },
      });
    }
  }

  // 2. DOE et visas, entreprise par entreprise.
  const idsVisas = dossier.entreprises.map(e => e.visa?.document_id).filter(Boolean) as string[];
  const documentsVisas = new Map<string, any>();
  if (idsVisas.length) {
    const { data } = await supabaseAdmin.from('documents').select('id, file_url, name').eq('tenant_id', tenantId).in('id', idsVisas);
    for (const d of (data as any[]) || []) documentsVisas.set(d.id, d);
  }
  for (const e of dossier.entreprises) {
    const visa = e.visa;
    const vise = e.statut === 'vise';
    if (!vise) reserves.push(`${e.nom} : dossier ${e.documents.length ? 'non visé' : 'non remis'}.`);
    else if (visa && visa.avis !== 'favorable') reserves.push(`${e.nom} : visé « ${DOE_AVIS_VISA_LABELS[visa.avis as DoeAvisVisa]} ».`);
    if (!vise && !options.inclureNonVises) continue;

    const lots = e.lots.map(libelleLot).join(', ');
    const dossierEntreprise = nomSur(`${lots || 'Sans lot'} - ${e.nom}`);
    for (const d of e.documents) {
      if (avisDocument(d.validation_status) === 'rejected') continue;
      const piece = pieceConnue(d.doe_piece) ? DOE_PIECE_LABELS[d.doe_piece] : 'Non classé';
      entrees.push({
        dossier: [ARCHIVE_DOSSIER_DOE, dossierEntreprise, piece], nom: d.name, fileUrl: d.file_url,
        ligne: { dossier: 'DOE', entreprise: e.nom, lot: lots, document: d.name, avis: DOE_AVIS_DOCUMENT_LABELS[avisDocument(d.validation_status)] },
      });
    }
    const docVisa = visa?.document_id ? documentsVisas.get(visa.document_id) : null;
    if (visa && docVisa) {
      visasJoints.push({ numero: visa.numero, entreprise: e.nom, avis: visa.avis, issued_at: visa.issued_at });
      entrees.push({
        dossier: [ARCHIVE_DOSSIER_VISAS], nom: `Visa ${visa.numero} - ${e.nom}.pdf`, fileUrl: docVisa.file_url,
        ligne: { dossier: 'Visa', entreprise: e.nom, lot: lots, document: `Visa ${visa.numero}`, avis: DOE_AVIS_VISA_LABELS[visa.avis as DoeAvisVisa] },
      });
    }
  }

  // 3. Lecture des fichiers et assemblage.
  const chemins = cheminsArchive(entrees.map(e => ({ nom: e.nom, dossier: e.dossier })));
  const zip = new JSZip();
  const ignores: string[] = [];
  const lignes: Entree['ligne'][] = [];
  let octets = 0;
  let fichiers = 0;
  for (let i = 0; i < entrees.length; i += 1) {
    const buffer = await lireFichierStocke(supabaseAdmin, tenantId, entrees[i].fileUrl, 150 * 1024 * 1024);
    if (!buffer) { ignores.push(entrees[i].nom); continue; }
    octets += buffer.length;
    if (octets > ARCHIVE_MAX_OCTETS) throw new ArchiveTropGrosse();
    zip.file(chemins[i], buffer);
    lignes.push(entrees[i].ligne);
    fichiers += 1;
  }

  const bordereau = await construireBordereauPdf(supabaseAdmin, tenantId, projectId, {
    destinataire: options.destinataire ?? null,
    date: new Date().toISOString(),
    lignes,
    visas: visasJoints,
    reserves: [...reserves, ...ignores.map(n => `${n} : fichier introuvable, non joint.`)],
  });
  zip.file('00 - Bordereau de transmission.pdf', bordereau);

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 1 } });
  const jour = new Date().toISOString().slice(0, 10);
  return {
    buffer,
    nom: `${nomSur(`DOE - ${projectFolderName(projet as any) || 'Opération'} - ${jour}`)}.zip`,
    fichiers,
    octets,
    ignores,
    reserves,
  };
}
