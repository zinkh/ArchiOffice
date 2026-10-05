// Couvre zohoItemIdentity() — la fonction pure qui décide du nom et de la
// description de l'« article » Zoho créé pour chaque ligne de facture
// ArchiOffice (server/zohoSync.ts). Testée séparément des routes zohoInvoice/
// zohoBooks : tests/fakeSupabaseAdmin.ts ne résout pas les relations imbriquées
// (`select('*, projects(...))')`), donc un test de bout en bout ne verrait
// jamais le numéro/nom d'affaire réellement circuler — cette fonction pure
// est le seul endroit où ce comportement est directement vérifiable.
import { describe, expect, it } from 'vitest';
import { zohoItemIdentity, zohoLineItems } from '../server/zohoSync';

describe('zohoItemIdentity', () => {
  it('garde le seul intitulé de la ligne quand aucune affaire n\'est rattachée — rien à indiquer', () => {
    expect(zohoItemIdentity('Honoraires ESQ', undefined)).toEqual({ name: 'Honoraires ESQ', description: undefined });
    expect(zohoItemIdentity(undefined, {})).toEqual({ name: 'Honoraires', description: undefined });
  });

  it('inscrit le numéro et le nom d\'affaire dans le NOM de l\'article, et l\'adresse dans sa description', () => {
    const result = zohoItemIdentity('Honoraires ESQ', {
      projectCode: '26014', projectName: 'Villa Martin', projectAddress: '12 rue des Lilas, 54000 Nancy',
    });
    expect(result.name).toBe('Honoraires ESQ — 26014 Villa Martin');
    expect(result.description).toBe('12 rue des Lilas, 54000 Nancy');
  });

  it('se limite au nom d\'affaire quand le contrat/projet ne porte pas de numéro', () => {
    const result = zohoItemIdentity('Honoraires', { projectName: 'Villa Martin' });
    expect(result.name).toBe('Honoraires — Villa Martin');
    expect(result.description).toBeUndefined();
  });

  // Zoho impose un nom d'article unique par organisation : deux affaires
  // portant la même ligne générique ("Honoraires") ne doivent jamais produire
  // le même nom, sous peine de voir la seconde réutiliser l'article — et donc
  // l'historique de facturation — de la première.
  it('deux affaires différentes ne produisent jamais le même nom d\'article pour une ligne identique', () => {
    const a = zohoItemIdentity('Honoraires ESQ', { projectCode: '26014', projectName: 'Villa Martin' });
    const b = zohoItemIdentity('Honoraires ESQ', { projectCode: '26015', projectName: 'Villa Dupont' });
    expect(a.name).not.toBe(b.name);
  });

  it('une seconde facture sur la MÊME affaire (un second acompte) retombe sur le même nom d\'article', () => {
    const a = zohoItemIdentity('Honoraires APS', { projectCode: '26014', projectName: 'Villa Martin' });
    const b = zohoItemIdentity('Honoraires APS', { projectCode: '26014', projectName: 'Villa Martin' });
    expect(a.name).toBe(b.name);
  });
});

describe('zohoLineItems : avancement par phase', () => {
  const acompte = {
    invoice_type: 'acompte', amount: 2363.79, description: "Note d'honoraires NH-01 : Acompte sur honoraires",
    items: [{ description: "Note d'honoraires NH-01 : Acompte sur honoraires", quantity: 1, unit_price: 2363.79, vat_rate: 0 }],
    phases: [
      { phase_id: 'esq', phase_name: 'Esquisse (ESQ)', avancement_pct: 100, montant_phase: 1074.45 },
      { phase_id: 'aps', phase_name: 'Avant-Projet Sommaire (APS)', avancement_pct: 100, montant_phase: 1289.34 },
      { phase_id: 'apd', phase_name: 'Avant-Projet Détaillé (APD)', avancement_pct: 0, montant_phase: 0 },
    ],
  };

  it('ajoute le texte d\'avancement à la description de la première ligne, sans toucher à son nom', () => {
    const [line] = zohoLineItems(acompte);
    expect(line.name).toBe("Note d'honoraires NH-01 : Acompte sur honoraires");
    expect(line.description).toBe([
      "Note d'honoraires NH-01 : Acompte sur honoraires", '',
      'Avancement par phase :',
      "Esquisse (ESQ) : 100% d'avancement, 1 074,45 €",
      "Avant-Projet Sommaire (APS) : 100% d'avancement, 1 289,34 €",
      "Avant-Projet Détaillé (APD) : 0% d'avancement, 0,00 €",
    ].join('\n'));
    expect(line.description).not.toMatch(/[  ]/);
  });

  it('ne l\'ajoute qu\'à la première ligne', () => {
    const lines = zohoLineItems({ ...acompte, items: [{ description: 'A', unit_price: 1 }, { description: 'B', unit_price: 2 }] });
    expect(lines[0].description).toContain('Avancement par phase');
    expect(lines[1].description).toBe('B');
  });

  it('une facture qui n\'est pas un acompte reste inchangée', () => {
    const [line] = zohoLineItems({ ...acompte, invoice_type: 'standard' });
    expect(line.description).toBe("Note d'honoraires NH-01 : Acompte sur honoraires");
  });

  it('reprend la phase unique des factures antérieures au modèle multi-phases', () => {
    const [line] = zohoLineItems({ invoice_type: 'acompte', amount: 500, description: 'Acompte', mission_name: 'Esquisse (ESQ)', advancement_pct: 50 });
    expect(line.description).toContain("Esquisse (ESQ) : 50% d'avancement, 500,00 €");
  });

  it('un acompte sans phase garde sa description telle quelle', () => {
    const [line] = zohoLineItems({ invoice_type: 'acompte', amount: 500, description: 'Acompte' });
    expect(line.description).toBe('Acompte');
  });
});
