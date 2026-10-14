import { describe, expect, it } from 'vitest';
import { evalFormula, parsePrixSaisi } from '../src/components/pro/treeOps';
import { formatQuantite } from '../src/lib/quantiteFormat';

describe('saisie d\'une quantité', () => {
  it('lit la virgule décimale', () => {
    expect(evalFormula('17,7')).toBe(17.7);
    expect(evalFormula('1 234,5')).toBe(1234.5);
    expect(evalFormula('7.355')).toBe(7.355);
  });

  it('calcule comme Excel, virgules françaises comprises', () => {
    expect(evalFormula('=17,7+7,35')).toBe(25.05);
    expect(evalFormula('=2*(3,5+1,5)')).toBe(10);
    expect(evalFormula('= 12 / 4')).toBe(3);
    expect(evalFormula('=0,1+0,2')).toBe(0.3);
  });

  it('une formule fausse vaut 0, une formule piégée n\'exécute rien', () => {
    expect(evalFormula('=1/0')).toBe(0);
    expect(evalFormula('=(1+')).toBe(0);
    // Les lettres sont retirées avant calcul : aucun code n'est exécuté.
    expect(evalFormula('=alert(1)')).toBe(1);
    expect(evalFormula('=process.exit()')).toBe(0);
    expect(evalFormula('abc')).toBe(0);
  });

  it('n\'arrondit pas ce qui est saisi', () => {
    expect(evalFormula('7,3555')).toBe(7.3555);
    expect(evalFormula('=7,3555*2')).toBe(14.711);
  });

  it('le prix accepte aussi la formule et PM', () => {
    expect(parsePrixSaisi('=10,5*2')).toEqual({ pourMemoire: false, valeur: 21 });
    expect(parsePrixSaisi('PM')).toEqual({ pourMemoire: true });
  });
});

describe('affichage d\'une quantité', () => {
  it('deux décimales au moins, jamais arrondie en dessous de six', () => {
    expect(formatQuantite(7)).toBe('7,00');
    expect(formatQuantite(17.7)).toBe('17,70');
    expect(formatQuantite(7.355)).toBe('7,355');
    expect(formatQuantite(7.3555)).toBe('7,3555');
  });
});
