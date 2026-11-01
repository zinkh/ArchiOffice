import { describe, it, expect } from 'vitest';
import { CATEGORIE_CLAUSES, ajouterClause, cleClause, corpsExport, dossierValide, estClause } from '../bibliothequeClauses';

describe('clauses générales de la bibliothèque', () => {
  it('reconnaît une clause à sa catégorie', () => {
    expect(estClause({ categorie: CATEGORIE_CLAUSES })).toBe(true);
    expect(estClause({ categorie: 'gros_oeuvre' })).toBe(false);
    expect(estClause({ categorie: null })).toBe(false);
    expect(estClause(undefined)).toBe(false);
  });

  it('valide le dossier demandé', () => {
    expect(dossierValide('clauses')).toBe(true);
    expect(dossierValide('ouvrages')).toBe(true);
    expect(dossierValide('autre')).toBe(false);
  });

  it('compare deux intitulés sans tenir compte de la casse, des accents ni des espaces', () => {
    expect(cleClause('  Prescriptions  Générales ')).toBe(cleClause('prescriptions generales'));
  });

  it('ajoute une clause après une ligne vide, une seule fois', () => {
    const r = ajouterClause('Texte existant.', 'Clause A');
    expect(r).toEqual({ texte: 'Texte existant.\n\nClause A', ajoute: true });
    expect(ajouterClause(r.texte, 'Clause A')).toEqual({ texte: r.texte, ajoute: false });
  });

  it('pose la clause telle quelle sur un texte vide, et ignore une clause vide', () => {
    expect(ajouterClause('', ' Clause A ')).toEqual({ texte: 'Clause A', ajoute: true });
    expect(ajouterClause('abc', '   ')).toEqual({ texte: 'abc', ajoute: false });
  });

  it('construit le corps d’une clause sans prix ni unité', () => {
    expect(corpsExport({ type: 'clause', designation: ' Essais ', unite: 'm²', prix_unitaire: 12, description: 'Texte' }))
      .toEqual({ designation: 'Essais', categorie: CATEGORIE_CLAUSES, unite: '', prix_unitaire: 0, description: 'Texte', origine: 'saisie' });
  });

  it('construit le corps d’un ouvrage sans catégorie réservée', () => {
    const corps = corpsExport({ type: 'ouvrage', designation: 'Mur', unite: ' m² ', prix_unitaire: 42.5, description: 'D' });
    expect(corps).toEqual({ designation: 'Mur', unite: 'm²', prix_unitaire: 42.5, description: 'D', origine: 'saisie' });
    expect('categorie' in corps).toBe(false);
  });
});
