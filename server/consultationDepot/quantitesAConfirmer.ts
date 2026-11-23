// Quantités à confirmer par une entreprise : ses postes dont la quantité diffère de celle du dossier.
// Calculé côté serveur à partir du DPGF et du BPU/DQE de l'affaire et des offres de l'entreprise : la page
// publique ne reçoit que les lignes de SES lots, jamais les prix des autres.
import { chapitresDuLot } from '../../src/lib/comparatifPrix';
import { quantitesEntreprise } from '../../src/lib/quantitesOffre';
import type { Lot, OffreDocument } from '../../src/types/dpgf';
import type { LigneQuantiteAConfirmer, LotQuantitesAConfirmer } from '../../src/lib/quantitesConfirmation';

const json = (v: unknown): any => {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
};

/** Les lots (avec leur document et ses offres) de l'affaire : DPGF puis BPU/DQE. */
export async function sourcesQuantites(supabaseAdmin: any, tenantId: string, projectId: string): Promise<Array<{ lots: Lot[]; offres: OffreDocument[] }>> {
  const sources: Array<{ lots: Lot[]; offres: OffreDocument[] }> = [];
  const { data: dpgf } = await supabaseAdmin.from('dpgfs').select('data, offres').eq('tenant_id', tenantId).eq('project_id', projectId).maybeSingle();
  if (dpgf) sources.push({ lots: json((dpgf as any).data)?.lots ?? [], offres: json((dpgf as any).offres) ?? [] });
  const { data: bpu } = await supabaseAdmin.from('bpu_data').select('document, offres').eq('tenant_id', tenantId).eq('project_id', projectId).maybeSingle();
  if (bpu) sources.push({ lots: json((bpu as any).document)?.lots ?? [], offres: json((bpu as any).offres) ?? [] });
  return sources;
}

/** Postes dont la quantité de l'entreprise diffère du dossier, par lot (lots de la liste `lotsIds` seulement). */
export function lotsAConfirmer(
  sources: Array<{ lots: Lot[]; offres: OffreDocument[] }>, entrepriseId: string, lotsIds: string[],
  titreLot: (projectLotId: string) => string,
): LotQuantitesAConfirmer[] {
  const out: LotQuantitesAConfirmer[] = [];
  for (const { lots, offres } of sources) {
    const quantites = quantitesEntreprise(offres, entrepriseId);
    if (Object.keys(quantites).length === 0) continue;
    for (const lot of lots) {
      if (!lot.projectLotId || !lotsIds.includes(lot.projectLotId)) continue;
      const lignes: LigneQuantiteAConfirmer[] = [];
      for (const c of chapitresDuLot(lot)) {
        for (const l of c.lignes) {
          const q = quantites[l.id];
          const moe = l.quantite || 0;
          if (typeof q !== 'number' || moe <= 0 || Math.abs(q - moe) <= 1e-9) continue;
          lignes.push({ ligneId: l.id, code: l.numero, titre: l.designation, unite: l.unite, quantiteDossier: moe, quantiteEntreprise: q });
        }
      }
      if (lignes.length) out.push({ lot: titreLot(lot.projectLotId), lignes });
    }
  }
  return out;
}
