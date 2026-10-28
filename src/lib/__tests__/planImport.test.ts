import { describe, expect, it } from 'vitest';
import { ajouterAuLot, nomPlanRetenu, nomsEnDouble, PLANS_PAR_LOT_MAX } from '../planImport';

const fichier = (name: string, size = 10, lastModified = 1) => new File([new Uint8Array(size)], name, { lastModified });
let n = 0;
const cle = () => `k${n++}`;

describe('nomPlanRetenu', () => {
  it('garde le nom saisi et rétablit l\'extension effacée', () => {
    expect(nomPlanRetenu('Façade nord', 'plan-12.pdf')).toBe('Façade nord.pdf');
    expect(nomPlanRetenu('Façade nord.pdf', 'plan-12.pdf')).toBe('Façade nord.pdf');
  });
  it('respecte une autre extension saisie volontairement', () => {
    expect(nomPlanRetenu('Coupe.dwg', 'coupe.pdf')).toBe('Coupe.dwg');
  });
  it('retombe sur le nom du fichier si la saisie est vide', () => {
    expect(nomPlanRetenu('   ', 'plan.pdf')).toBe('plan.pdf');
  });
  it('retire les caractères interdits et compacte les espaces', () => {
    expect(nomPlanRetenu('A/B:  C?.pdf', 'x.pdf')).toBe('A B C .pdf');
  });
});

describe('nomsEnDouble', () => {
  it('repère les doublons du lot et ceux déjà sur l\'affaire, sans tenir compte de la casse', () => {
    const d = nomsEnDouble(['a.pdf', 'A.PDF', 'b.pdf', 'c.pdf'], ['C.pdf']);
    expect([...d].sort()).toEqual(['a.pdf', 'c.pdf']);
  });
});

describe('ajouterAuLot', () => {
  it('écarte les fichiers vides et les fichiers déjà présents', () => {
    const a = fichier('a.pdf');
    const r1 = ajouterAuLot([], [a, fichier('vide.pdf', 0)], cle);
    expect(r1.entries).toHaveLength(1);
    expect(r1.ignores).toBe(1);
    const r2 = ajouterAuLot(r1.entries, [a], cle);
    expect(r2.entries).toHaveLength(1);
    expect(r2.ignores).toBe(1);
  });
  it('tient le plafond', () => {
    const files = Array.from({ length: PLANS_PAR_LOT_MAX + 3 }, (_, i) => fichier(`p${i}.pdf`, 5, i));
    const r = ajouterAuLot([], files, cle);
    expect(r.entries).toHaveLength(PLANS_PAR_LOT_MAX);
    expect(r.tronque).toBe(true);
  });
});
