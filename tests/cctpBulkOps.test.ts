import { describe, expect, it } from 'vitest';
import { appliquerTexte, dupliquerSelection, modifierEnMasse, racinesDeSelection } from '../src/components/pro/cctpBulkOps';
import type { Ligne, Lot } from '../src/types/dpgf';

const ligne = (id: string, numero: string, extra: Partial<Ligne> = {}): Ligne => ({
  id, numero, designation: id, unite: 'u', quantite: 1, prixUnitaire: 10, prixTotal: 10, type: 'ouvrage', children: [], ...extra,
});

const makeLots = (): Lot[] => [
  {
    id: 'lot-1', numero: '01', titre: 'Gros œuvre', sousTotal: 0, chapitres: [
      { id: 'chap-1', numero: '1', titre: 'Fondations', lignes: [
        ligne('a', '1.1', { cctpDescription: 'Texte A' }),
        ligne('b', '1.2', { cctpDescription: 'Béton C25/30 partout', children: [ligne('b1', '1.2.1', { cctpDescription: 'Béton C25/30' })] }),
        ligne('c', '1.3'),
      ] },
      { id: 'chap-2', numero: '2', titre: 'Élévation', lignes: [ligne('d', '2.1')] },
    ],
  },
  { id: 'lot-2', numero: '02', titre: 'Charpente', sousTotal: 0, chapitres: [{ id: 'chap-3', numero: '1', titre: 'Bois', lignes: [ligne('e', '1.1')] }] },
];

let n = 0;
const newId = () => `copie-${n++}`;

describe('racinesDeSelection', () => {
  it('écarte un élément dont un ancêtre est aussi sélectionné', () => {
    const r = racinesDeSelection(['chap-0-0', 'ligne-0-0-1', 'ligne-0-0-1-0', 'ligne-0-1-0']);
    expect(r.map(s => s.kind === 'chapitre' ? `chap-${s.lotIdx}-${s.chapIdx}` : s.kind === 'ligne' ? `ligne-${s.lotIdx}-${s.chapIdx}-${s.lignePath.join('-')}` : 'lot'))
      .toEqual(['chap-0-0', 'ligne-0-1-0']);
  });
});

describe('dupliquerSelection', () => {
  it('duplique plusieurs articles juste après eux, sans décalage ni double copie', () => {
    const lots = makeLots();
    const avant = structuredClone(lots);
    const { lots: next, copies } = dupliquerSelection(lots, ['ligne-0-0-0', 'ligne-0-0-2', 'ligne-0-0-1', 'ligne-0-0-1-0'], newId);
    expect(copies).toBe(3);
    // a, copie de a, b (+ b1), copie de b (avec son b1 copié une fois), c, copie de c
    expect(next[0].chapitres[0].lignes.map(l => l.designation)).toEqual(['a', 'a', 'b', 'b', 'c', 'c']);
    expect(next[0].chapitres[0].lignes[3].children).toHaveLength(1);
    expect(lots).toEqual(avant);
  });

  it('donne un nouvel identifiant à chaque copie, descendants compris', () => {
    const { lots: next } = dupliquerSelection(makeLots(), ['ligne-0-0-1'], newId);
    const ids = next[0].chapitres[0].lignes.flatMap(l => [l.id, ...(l.children ?? []).map(c => c.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('duplique des chapitres et des lots', () => {
    const { lots: next } = dupliquerSelection(makeLots(), ['chap-0-1', 'lot-1'], newId);
    expect(next[0].chapitres).toHaveLength(3);
    expect(next).toHaveLength(3);
  });
});

describe('appliquerTexte', () => {
  it('ajoute à la fin après une ligne vide, une seule fois', () => {
    expect(appliquerTexte('Texte', { mode: 'fin', valeur: 'Clause' })).toBe('Texte\n\nClause');
    expect(appliquerTexte('Texte\n\nClause', { mode: 'fin', valeur: 'Clause' })).toBeNull();
  });

  it('ajoute au début', () => {
    expect(appliquerTexte('Texte', { mode: 'debut', valeur: 'Intro' })).toBe('Intro\n\nTexte');
    expect(appliquerTexte('', { mode: 'debut', valeur: 'Intro' })).toBe('Intro');
    expect(appliquerTexte('Intro puis texte', { mode: 'debut', valeur: 'Intro' })).toBeNull();
  });

  it('remplace une expression partout, et ne change rien si elle est absente ou vide', () => {
    expect(appliquerTexte('C25/30 et C25/30', { mode: 'remplacer', cherche: 'C25/30', valeur: 'C30/37' })).toBe('C30/37 et C30/37');
    expect(appliquerTexte('Texte', { mode: 'remplacer', cherche: 'absent', valeur: 'x' })).toBeNull();
    expect(appliquerTexte('Texte', { mode: 'remplacer', cherche: '', valeur: 'x' })).toBeNull();
  });
});

describe('modifierEnMasse', () => {
  it('modifie les éléments choisis seulement, sans toucher à l’original', () => {
    const lots = makeLots();
    const avant = structuredClone(lots);
    const { lots: next, modifies } = modifierEnMasse(lots, ['ligne-0-0-0', 'ligne-0-0-2'], { localisation: ' Façade nord ', unite: 'm²' });
    expect(modifies).toBe(2);
    expect(next[0].chapitres[0].lignes.map(l => l.localisation)).toEqual(['Façade nord', undefined, 'Façade nord']);
    expect(next[0].chapitres[0].lignes[1].unite).toBe('u');
    expect(lots).toEqual(avant);
  });

  it('ne compte pas un élément déjà dans l’état demandé', () => {
    const { modifies } = modifierEnMasse(makeLots(), ['ligne-0-0-0'], { unite: 'u', visibleDpgf: true });
    expect(modifies).toBe(0);
  });

  it('bascule la visibilité DPGF des chapitres et articles, jamais celle d’un lot', () => {
    const { lots: next, modifies } = modifierEnMasse(makeLots(), ['lot-0', 'chap-0-1', 'ligne-0-0-0'], { visibleDpgf: false });
    expect(modifies).toBe(2);
    expect(next[0].chapitres[1].cctpOnly).toBe(true);
    expect(next[0].chapitres[0].lignes[0].cctpOnly).toBe(true);
    expect((next[0] as any).cctpOnly).toBeUndefined();
  });

  it('pose et retire une phase', () => {
    const posee = modifierEnMasse(makeLots(), ['chap-0-0', 'ligne-0-1-0'], { phaseId: 'ph1' });
    expect(posee.lots[0].chapitres[0].phaseId).toBe('ph1');
    expect(posee.lots[0].chapitres[1].lignes[0].phaseId).toBe('ph1');
    const retiree = modifierEnMasse(posee.lots, ['chap-0-0'], { phaseId: '' });
    expect('phaseId' in retiree.lots[0].chapitres[0]).toBe(false);
  });

  it('applique le texte à tous les niveaux et compte seulement ce qui change', () => {
    const { lots: next, modifies } = modifierEnMasse(makeLots(), ['lot-0', 'ligne-0-0-0', 'ligne-0-0-1'], {
      texte: { mode: 'remplacer', cherche: 'Béton C25/30', valeur: 'Béton C30/37' },
    });
    expect(modifies).toBe(1);
    expect(next[0].chapitres[0].lignes[1].cctpDescription).toBe('Béton C30/37 partout');
    // Les descendants non sélectionnés ne sont pas touchés.
    expect(next[0].chapitres[0].lignes[1].children![0].cctpDescription).toBe('Béton C25/30');
  });

  it('ajoute et retire un bâtiment sur les articles', () => {
    const ajoute = modifierEnMasse(makeLots(), ['ligne-0-0-0'], { batiments: { ajouter: ['bat-a'] } });
    expect(ajoute.modifies).toBe(1);
    expect(JSON.stringify(ajoute.lots)).toContain('bat-a');
    const retire = modifierEnMasse(ajoute.lots, ['ligne-0-0-0'], { batiments: { retirer: ['bat-a'] } });
    expect(JSON.stringify(retire.lots)).not.toContain('"batimentId":"bat-a"');
  });
});
