// Certificat de paiement (anciennement « état d'acompte ») d'une situation de
// travaux, côté serveur : pièce jointe déposée sur la facture de l'entreprise
// chez Chorus Pro / Super PDP, et téléchargement direct. Le calcul
// (src/lib/certificatPaiement.ts) et le rendu (src/lib/certificatPaiementPdf.ts)
// sont ceux de l'écran : le maître d'ouvrage reçoit le même document, quel que
// soit le chemin.
import { tenantScopedFrom } from './tenantScopedFrom';
import { calculerCertificat, situationsDuMarche, type Certificat, type MarcheTravaux, type SituationTravaux } from '../src/lib/certificatPaiement';
import { rendreCertificatPaiement, type OperationInfo } from '../src/lib/certificatPaiementPdf';
import type { AgencySettings } from '../src/lib/proposalExport';

/** Situations du même marché que `sit` (la situation elle-même comprise). */
async function situationsSoeurs(supabaseAdmin: any, tenantId: string, sit: any): Promise<SituationTravaux[]> {
  if (!sit?.marche_id) return [sit];
  const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations')
    .select('*')
    .eq('marche_id', sit.marche_id);
  const liste = (data ?? []) as SituationTravaux[];
  return liste.some((s) => s.id === sit.id) ? liste : [...liste, sit];
}

/** Certificat d'une situation, calculé sur les situations de son marché. */
export async function certificatSituation(supabaseAdmin: any, tenantId: string, sit: any, marche: any): Promise<Certificat> {
  const soeurs = await situationsSoeurs(supabaseAdmin, tenantId, sit);
  return calculerCertificat(sit, marche as MarcheTravaux | null, soeurs.filter((s) => s.marche_id === sit.marche_id));
}

async function chargerCharte(supabaseAdmin: any, tenantId: string): Promise<{ settings: AgencySettings; logo: any }> {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('agency_name, address, phone, email, siret, vat_number, ape, oa_number, architect_name')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const row = (data ?? {}) as any;
  const settings: AgencySettings = {
    agencyName: row.agency_name || '', address: row.address || '', phone: row.phone || '',
    email: row.email || '', siret: row.siret || '', vatNumber: row.vat_number || '',
    ape: row.ape || '', oaNumber: row.oa_number || '', architectName: row.architect_name || '',
  };
  let logo: any = null;
  try {
    const { loadAgencyIdentity } = await import('@zinkh/archioffice-agents/server');
    const identity = await loadAgencyIdentity(supabaseAdmin, tenantId);
    if (identity.logo) {
      const mime = identity.logo.format === 'png' ? 'image/png' : 'image/jpeg';
      logo = {
        dataUrl: `data:${mime};base64,${identity.logo.data.toString('base64')}`,
        format: identity.logo.format === 'png' ? 'PNG' : 'JPEG',
        width: identity.logo.width,
        height: identity.logo.height,
      };
    }
  } catch { /* un logo illisible ne doit pas empêcher le certificat de partir */ }
  return { settings, logo };
}

async function chargerOperation(supabaseAdmin: any, tenantId: string, projectId: string): Promise<OperationInfo> {
  if (!projectId) return {};
  const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects')
    .select('name, project_code, address, client')
    .eq('id', projectId)
    .maybeSingle();
  const p = (data ?? {}) as any;
  return { nom: p.name, code: p.project_code, adresse: p.address, maitreOuvrage: p.client };
}

/** PDF du certificat de paiement d'une situation, à la charte du cabinet. */
export async function buildCertificatPdfBuffer(supabaseAdmin: any, tenantId: string, sit: any, marche: any): Promise<Buffer> {
  const [soeurs, charte, operation] = await Promise.all([
    situationsSoeurs(supabaseAdmin, tenantId, sit),
    chargerCharte(supabaseAdmin, tenantId),
    chargerOperation(supabaseAdmin, tenantId, sit.project_id),
  ]);
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default as any;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const marcheTravaux: MarcheTravaux = marche ?? { id: sit.marche_id ?? '', entreprise_nom: '' };
  rendreCertificatPaiement(
    { pdf, autoTable, settings: charte.settings, logo: charte.logo },
    sit, marcheTravaux, situationsDuMarche(soeurs, marcheTravaux.id).length ? soeurs : [sit], operation,
  );
  return Buffer.from(pdf.output('arraybuffer'));
}
