import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { DPGF } from '../../types/dpgf';

// La photo est lue du disque : le vrai chargement passe par le navigateur (canvas).
const PHOTO = process.env.PDG_PHOTO;
vi.mock('../planRender', () => ({
  loadPhotoDataUrl: async () => (PHOTO
    ? { dataUrl: `data:image/jpeg;base64,${readFileSync(PHOTO).toString('base64')}`, width: 1600, height: 1000 }
    : null),
}));

import { dateFr, donneesPageDeGarde } from '../pageDeGarde';
import { exportCctpDocx, exportCctpPdf } from '../cctpExport';
import { exportDPGFtoPDF } from '../proExport';

const lot = (n: string, titre: string) => ({
  id: n, numero: n, titre, sousTotal: 0,
  chapitres: [{ id: `c${n}`, numero: '1', titre: 'Travaux préparatoires', lignes: [
    { id: `l${n}`, numero: '1.1', designation: 'Études d\'exécution', unite: 'u', quantite: 1, prixUnitaire: 0, prixTotal: 0, cctpDescription: 'Texte technique de l\'article.' },
  ] }],
});
const dpgf = {
  id: 'd', projectId: 'p', titre: 'DPGF test', version: 'B', dateCreation: '2022-10-03T00:00:00Z', statut: 'draft',
  lots: [lot('01', 'GROS-OEUVRE')], totalHT: 0, TVA: 0, totalTTC: 0,
} as unknown as DPGF;

describe('page de garde', () => {
  it('formate une date ISO et retombe sur le repli', () => {
    expect(dateFr('2022-10-03T00:00:00Z')).toBe('03/10/2022');
    expect(dateFr('pas une date', new Date('2024-01-02T12:00:00Z'))).toBe('02/01/2024');
  });

  it('reprend le nom de l\'opération, sinon le titre du document', () => {
    const base = { titreDocument: 'DPGF test', intitule: 'X', version: 'B' };
    expect(donneesPageDeGarde({ ...base, operation: 'SELIA' }).operation).toBe('SELIA');
    expect(donneesPageDeGarde(base).operation).toBe('DPGF test');
    expect(donneesPageDeGarde({ ...base, dateCreation: '2022-10-03T00:00:00Z' }).dateEmission).toBe('03/10/2022');
  });

  it('place la page de garde avant le contenu du CCTP (PDF) et du DPGF', async () => {
    const fichiers: Array<[string, Blob]> = [];
    const sortie = async (nom: string, blob: Blob) => { fichiers.push([nom, blob]); };
    const couverture = { imageUrl: 'photo', adresse: '1 rue Test', maitreOuvrage: 'SELIA' };
    await exportCctpPdf(dpgf, { projectName: 'SELIA', settings: { agencyName: 'AAZS' }, sortie, couverture });
    await exportCctpDocx(dpgf, { projectName: 'SELIA', settings: { agencyName: 'AAZS' }, sortie, couverture });
    await exportDPGFtoPDF(dpgf, 'SELIA', 'lot', { agencyName: 'AAZS' }, { sortie, couverture });
    expect(fichiers.map(f => f[0].split('.').pop())).toEqual(['pdf', 'docx', 'pdf']);
    const dossier = process.env.PDG_OUT;
    if (dossier) for (const [nom, blob] of fichiers) writeFileSync(`${dossier}/${nom}`, Buffer.from(await blob.arrayBuffer()));
    for (const [, blob] of fichiers) expect(blob.size).toBeGreaterThan(1000);
  });
});
