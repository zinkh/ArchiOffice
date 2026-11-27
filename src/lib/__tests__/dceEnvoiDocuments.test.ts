// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ apiFetch: vi.fn() }));
vi.mock('../authToken', () => ({ getAccessToken: async () => null }));

import { entreprisesConcerneesParPieces, marquageEnvoi, planEnvoiGroupe } from '../dceEnvoiGroupe';
import { donneesSansReseau, type ContexteEnvoiDce } from '../dceEnvoiPreparation';
import { blocsMessageDce, MODELE_CORPS_DOCUMENTS, remplirModele } from '../dceEnvoiMessage';
import { deposerFichierDce, nomFichierDce, rattacherPieces, type EntreePieceDce } from '../dceVersement';

const entreprise = (id: string, nom: string, lots: string[], extra: Record<string, unknown> = {}) =>
  ({ id, nom, lots_ids: lots, email: `${id}@exemple.fr`, ...extra }) as any;

const pieces = [
  { id: 'rc', libelle: 'Règlement de consultation', tous_lots: true, lots_ids: [] },
  { id: 'cctp1', libelle: 'CCTP - Lot 01', tous_lots: false, lots_ids: ['l1'] },
  { id: 'cctp2', libelle: 'CCTP - Lot 02', tous_lots: false, lots_ids: ['l2'] },
];

describe('envoi de documents choisis du DCE', () => {
  const alpha = entreprise('a', 'Alpha', ['l1']);
  const bravo = entreprise('b', 'Bravo', ['l2']);
  const charlie = entreprise('c', 'Charlie', ['l3']);

  it('ne propose que les entreprises concernées, sans exiger que le DCE leur soit déjà parti', () => {
    expect(entreprisesConcerneesParPieces(['cctp1'], pieces, [alpha, bravo, charlie]).map(e => e.id)).toEqual(['a']);
    expect(entreprisesConcerneesParPieces(['cctp1', 'cctp2'], pieces, [alpha, bravo, charlie]).map(e => e.id)).toEqual(['a', 'b']);
    expect(entreprisesConcerneesParPieces(['rc'], pieces, [alpha, bravo, charlie])).toHaveLength(3);
    expect(entreprisesConcerneesParPieces([], pieces, [alpha])).toEqual([]);
  });

  it('écarte avec motif sans adresse ou « ne répond pas », et ne présume pas d\'un envoi antérieur', () => {
    const plan = planEnvoiGroupe([
      alpha,
      entreprise('d', 'Delta', ['l1'], { email: '' }),
      entreprise('e', 'Echo', ['l1'], { ne_repond_pas: true, dce_transmis_le: '2026-11-01' }),
    ], 'documents');
    expect(plan.map(l => l.motif)).toEqual([undefined, 'sans_adresse', 'ne_repond_pas']);
    expect(plan[0].dejaEnvoye).toBe(false);
  });

  it('n\'enregistre rien sur l\'entreprise : ce n\'est pas la transmission du DCE', () => {
    expect(marquageEnvoi(alpha, 'documents', '2026-11-27', true)).toEqual({});
  });

  it('ne cite dans le message que les pièces choisies qui concernent les lots de l\'entreprise', () => {
    const ctx = {
      projectName: 'SELIA', depotActif: true, piecesChoisies: ['cctp1', 'cctp2'],
      lots: [{ id: 'l1', lot_number: '01', lot_title: 'Gros œuvre' }, { id: 'l2', lot_number: '02', lot_title: 'Charpente' }],
      pieces, documents: [],
    } as unknown as ContexteEnvoiDce;
    const texte = remplirModele(MODELE_CORPS_DOCUMENTS, blocsMessageDce(donneesSansReseau(ctx, alpha)));
    expect(texte).toContain('CCTP - Lot 01');
    expect(texte).not.toContain('CCTP - Lot 02');
    expect(texte).not.toContain('Règlement de consultation');
    expect(texte).not.toContain('{{');
  });
});

describe('DPGF au format Excel versé au DCE', () => {
  it('se nomme en .xlsx et forme une pièce distincte du DPGF en PDF du même lot', () => {
    expect(nomFichierDce({ code: '2419', piece: 'DPGF', lot: { numero: '02', titre: 'Charpente bois' }, indice: 'A', ext: 'xlsx' }))
      .toBe('2419_DPGF_02-Charpente-bois-A.xlsx');
    let n = 0;
    const dce = rattacherPieces<EntreePieceDce>([], [
      { spec: { typeDoc: 'DPGF', nom: 'DPGF - Lot 01', lotsIds: ['l1'] }, documentId: 'pdf' },
      { spec: { typeDoc: 'DPGF', nom: 'DPGF (Excel) - Lot 01', lotsIds: ['l1'] }, documentId: 'xlsx' },
    ], () => `p${++n}`);
    expect(dce).toHaveLength(2);
    expect(dce.map(d => d.document_ids)).toEqual([['pdf'], ['xlsx']]);
  });

  it('dépose le classeur avec son type, et le PDF par défaut', async () => {
    const envoyes: File[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: FormData }) => {
      envoyes.push(init.body.get('file') as File);
      return { ok: true, json: async () => ({ id: 'doc-1' }) };
    }));
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    await deposerFichierDce({ projectId: 'p', nomFichier: 'a.xlsx', blob: new Blob(['x']), mimeType: xlsx });
    await deposerFichierDce({ projectId: 'p', nomFichier: 'a.pdf', blob: new Blob(['x']) });
    expect(envoyes.map(f => f.type)).toEqual([xlsx, 'application/pdf']);
    vi.unstubAllGlobals();
  });
});
