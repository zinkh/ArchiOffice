import { beforeEach, describe, expect, it, vi } from 'vitest';

const { saveAsMock, pdfSaveSpy } = vi.hoisted(() => ({ saveAsMock: vi.fn(), pdfSaveSpy: vi.fn() }));
vi.mock('file-saver', () => ({ saveAs: saveAsMock }));
// jsPDF écrit sur disque à `.save()` en Node : on l'intercepte (voir proExport.test.ts).
vi.mock('jspdf', async importOriginal => {
  const actual = await importOriginal<typeof import('jspdf')>();
  class TestJsPDF extends (actual as any).default {
    constructor(...args: any[]) {
      super(...args);
      (this as any).save = (...a: any[]) => { pdfSaveSpy(this, ...a); return this; };
    }
  }
  return { ...actual, default: TestJsPDF };
});

import { genererFicheNegociation, genererPVOuverture, genererSynthesePDF, genererSyntheseExcel, type ConsultationNegociationExport } from '../actNegociationExport';

const settings = { agencyName: 'AAZS', address: '23 Bd de l\'Europe', siret: '102 663 416 00018' } as any;
const lots = [
  { id: 'L1', lot_number: '03', lot_title: 'Fondations profondes' },
  { id: 'L2', lot_number: '04', lot_title: 'Gros œuvre' },
] as any[];
const consultation: ConsultationNegociationExport = {
  entreprises: [
    { id: 'A', nom: 'DURMEYER', lots_ids: ['L1'] }, { id: 'B', nom: 'HCT', lots_ids: ['L1'] },
  ],
  offres: [
    { lot_id: 'L1', entreprise_id: 'A', montant_base: 31210, conforme: true },
    { lot_id: 'L1', entreprise_id: 'B', montant_base: 59500, conforme: true },
  ],
  attributions: [],
  pieces_admin: [{ id: 'kbis', nom: 'Kbis' }],
  negociations: [{
    lot_id: 'L1', entreprise_id: 'B', verifie: true, remarque_verification: 'Pas d\'anomalie comptable',
    lignes: [{ id: 'o1', kind: 'option', libelle: 'Option 1', montant_ouverture: 2000 }],
    objectifs: { base: 50000 },
    tours: [{ id: 't1', date: '2026-08-02', montants: { base: 53900 }, remarque: 'Remise sur installation', auteur: 'M. Husson' }],
  }],
  synthese: { L1: { estimation_apd: 40000, estimation_pro_base: 41302.5 } },
  pieces_recues: { A: ['kbis'] },
};

beforeEach(() => { saveAsMock.mockClear(); pdfSaveSpy.mockClear(); });

describe('exports de négociation', () => {
  it('PV d\'ouverture : un PDF, une page par lot avec offres, pagination « P1|2 »', async () => {
    await genererPVOuverture(lots, consultation, 'Projet test', settings);
    expect(pdfSaveSpy).toHaveBeenCalledTimes(1);
    const [doc, nom] = pdfSaveSpy.mock.calls[0];
    expect(nom).toMatch(/^PV_ouverture_Projet_test/);
    expect(doc.internal.getNumberOfPages()).toBe(1);
  });

  it('fiche de négociation : un PDF nommé d\'après l\'entreprise et le lot', async () => {
    await genererFicheNegociation(lots[0], consultation.entreprises[1], consultation, 'Projet test', settings);
    const [doc, nom] = pdfSaveSpy.mock.calls[0];
    expect(nom).toBe('Negociation_HCT_Lot03.pdf');
    expect(doc.internal.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('synthèse PDF et Excel', async () => {
    await genererSynthesePDF(lots, consultation, 'Projet test', settings, 'courant');
    expect(pdfSaveSpy.mock.calls[0][1]).toMatch(/^Synthese_economique_Projet_test\.pdf$/);

    await genererSyntheseExcel(lots, consultation, 'Projet test', settings, 'courant');
    const [blob, nom] = saveAsMock.mock.calls[0];
    expect(nom).toBe('Synthese_economique_Projet_test.xlsx');
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('une consultation sans aucune négociation ne casse aucun export', async () => {
    const vide: ConsultationNegociationExport = { entreprises: [], offres: [], attributions: [] };
    await genererPVOuverture(lots, vide, 'P', settings);
    await genererSynthesePDF(lots, vide, 'P', settings);
    await genererSyntheseExcel([], vide, 'P', settings);
    expect(pdfSaveSpy).toHaveBeenCalledTimes(2);
    expect(saveAsMock).toHaveBeenCalledTimes(1);
  });
});
