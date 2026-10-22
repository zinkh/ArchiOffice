import { describe, expect, it } from 'vitest';
import { buildFtmRows, euros } from '../ftmPdf';

const ctx = {
  project: { name: 'Gymnase Nord', project_code: '26014', client: 'Ville de Nancy' },
  entreprises: ['Maçonnerie Durand', 'Charpente Petit'],
  devis: [
    { objet: 'Micropieux', montant_ht: 4000, statut: 'accepte' },
    { objet: 'Charpente', montant_ht: 3500.5, statut: 'recu' },
  ],
  ordre: { numero: '002 / 001', titre: 'Reprise' },
};

describe('FTM : lignes du PDF', () => {
  it('résume l\'identification, les incidences et le total des devis', () => {
    const r = buildFtmRows({ numero: 'FTM-03 / FTM-01', title: 'T', status: 'validee', origine: 'aleas', incidence_delai_jours: 5, incidences_delais_details: 'Reprise du planning', montant_estime_ht: 9000 }, ctx);
    expect(r.identification.find(l => l[0] === 'Entreprise(s) concernée(s)')![1]).toBe('Maçonnerie Durand ; Charpente Petit');
    expect(r.identification.find(l => l[0] === 'État')![1]).toBe('Validée');
    expect(r.identification.find(l => l[0] === 'Origine de la demande')![1]).toBe('Aléas de chantier');
    expect(r.incidences.find(l => l[0] === 'Incidence sur le délai')![1]).toBe('5 jours : Reprise du planning');
    expect(r.incidences.find(l => l[0] === 'Ordre de service émis')![1]).toContain('OS 002 / 001');
    expect(r.totalDevis).toBe(7500.5);
  });

  it('n\'invente rien : champs absents et sans incidence', () => {
    const r = buildFtmRows({ numero: 'FTM-01', title: 'T', status: 'brouillon' }, { project: { name: 'X' }, entreprises: [], devis: [] });
    expect(r.identification.find(l => l[0] === 'Entreprise(s) concernée(s)')![1]).toBe('—');
    expect(r.incidences.find(l => l[0] === 'Incidence sur le délai')![1]).toBe('Sans incidence sur le délai');
    expect(r.incidences.find(l => l[0] === 'Ordre de service émis')![1]).toBe('—');
    expect(r.totalDevis).toBe(0);
  });

  it('formate les montants sans espace fine (absente des polices du PDF)', () => {
    expect(euros(12500)).not.toMatch(/[  ]/);
    expect(euros(null)).toBe('—');
  });
});
