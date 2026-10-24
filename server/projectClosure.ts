// Dossier de clôture d'une affaire archivée : lecture des données, rendu PDF
// (src/lib/closureDossierPdf.ts) et dépôt comme document de l'affaire. Le dépôt
// passe par storeBusinessFile : sur l'espace du cabinet quand il en a branché un,
// dans Supabase sinon. Voir CLAUDE.md, « Archivage des affaires ».
import crypto from 'crypto';
import { chargerCharte, chargerOperation } from './etatAcompte';
import { projectFolderName } from './externalStorage/businessFolderPath';
import type { StoreBusinessFile } from './externalStorage/storeBusinessFile';
import {
  rendreDossierCloture, type DossierClotureData, type ControleCloture,
} from '../src/lib/closureDossierPdf';

export const DOSSIER_CLOTURE_DOC_TYPE = 'DOSSIER_CLOTURE';

export interface ContexteCloture {
  archivedAt: string;
  retentionUntil?: string | null;
  motif?: string | null;
  archivePar?: string | null;
  controles: ControleCloture[];
}

async function lignes(supabaseAdmin: any, tenantId: string, table: string, colonnes: string, projectId: string): Promise<any[]> {
  const { data, error } = await supabaseAdmin.from(table).select(colonnes)
    .eq('tenant_id', tenantId).eq('project_id', projectId);
  if (error) throw error;
  return data || [];
}

const RESERVE_LEVEE = new Set(['Levée', 'Quitus Transmis']);

export async function chargerDossierCloture(
  supabaseAdmin: any, tenantId: string, projectId: string, contexte: ContexteCloture,
): Promise<DossierClotureData> {
  const [factures, reserves, documents] = await Promise.all([
    lignes(supabaseAdmin, tenantId, 'invoices', 'invoice_number, issue_date, total_amount, status', projectId),
    lignes(supabaseAdmin, tenantId, 'reserves', 'status', projectId),
    lignes(supabaseAdmin, tenantId, 'documents', 'name, category, phase, uploaded_at, doc_type', projectId),
  ]);
  return {
    ...contexte,
    factures: factures.map(f => ({
      numero: f.invoice_number ?? '', date: f.issue_date, totalTtc: Number(f.total_amount) || 0, statut: f.status ?? '',
    })),
    reserves: { total: reserves.length, levees: reserves.filter(r => RESERVE_LEVEE.has(String(r.status ?? ''))).length },
    // Un dossier de clôture précédent n'est pas une pièce de l'affaire à lister.
    documents: documents
      .filter(d => d.doc_type !== DOSSIER_CLOTURE_DOC_TYPE)
      .map(d => ({ nom: d.name ?? '', categorie: d.category, phase: d.phase, date: d.uploaded_at })),
  };
}

export async function construireDossierCloturePdf(
  supabaseAdmin: any, tenantId: string, projectId: string, contexte: ContexteCloture,
): Promise<Buffer> {
  const [charte, operation, donnees] = await Promise.all([
    chargerCharte(supabaseAdmin, tenantId),
    chargerOperation(supabaseAdmin, tenantId, projectId),
    chargerDossierCloture(supabaseAdmin, tenantId, projectId, contexte),
  ]);
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default as any;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  rendreDossierCloture({ pdf, autoTable, settings: charte.settings, logo: charte.logo }, donnees, operation);
  return Buffer.from(pdf.output('arraybuffer'));
}

export function nomDossierCloture(project: { project_code?: string | null; name?: string | null }): string {
  return `Dossier de clôture - ${projectFolderName(project) || 'affaire'}.pdf`;
}

export interface DeposerDeps {
  supabaseAdmin: any;
  storeBusinessFile: StoreBusinessFile;
  checkQuota: (tenantId: string, resource: 'projects' | 'users' | 'documents') => Promise<void>;
}

/** Dépose le PDF comme document de l'affaire (catégorie « Clôture »). Rend l'identifiant du document. */
export async function deposerDossierCloture(
  { supabaseAdmin, storeBusinessFile, checkQuota }: DeposerDeps,
  p: { tenantId: string; project: { id: string; project_code?: string | null; name?: string | null }; pdf: Buffer; userName: string; archivedAt: string },
): Promise<string> {
  await checkQuota(p.tenantId, 'documents');
  const id = crypto.randomUUID();
  const nom = nomDossierCloture(p.project);
  const depose = await storeBusinessFile({
    tenantId: p.tenantId, bucket: 'documents', folderPath: [projectFolderName(p.project), 'Clôture'],
    fileName: nom, supabasePath: `${p.tenantId}/${p.project.id}/CLOTURE/${id}/${nom.replace(/[^A-Za-z0-9._-]+/g, '_')}`,
  }, p.pdf, 'application/pdf');
  const { error } = await supabaseAdmin.from('documents').insert({
    id, tenant_id: p.tenantId, project_id: p.project.id, resource_type: 'projects', resource_id: p.project.id,
    name: nom, category: 'Clôture', phase: 'AOR', version: 1, file_url: depose.fileUrl, storage_backend: depose.storageBackend,
    mime_type: 'application/pdf', size_bytes: depose.sizeBytes, uploaded_by: p.userName, uploaded_at: p.archivedAt,
    indice: 'A', doc_statut: 'en_cours', doc_type: DOSSIER_CLOTURE_DOC_TYPE,
  });
  if (error) throw error;
  return id;
}
