import { describe, expect, it } from 'vitest';
import {
  comparePhaseCodes, documentNodeId, parseNodeId, phaseCode, phaseNodeId, projectNodeId, safeNodeName,
  tenantNodeId, uniqueSiblingNames,
} from '../desktopNodes';

describe('identifiants de nœuds', () => {
  it('fait l\'aller-retour pour chaque type', () => {
    expect(parseNodeId(tenantNodeId('t1'))).toEqual({ kind: 'tenant', tenantId: 't1' });
    expect(parseNodeId('inbox:t1')).toEqual({ kind: 'inbox', tenantId: 't1' });
    expect(parseNodeId(projectNodeId('p1'))).toEqual({ kind: 'prj', projectId: 'p1' });
    expect(parseNodeId(documentNodeId('d1'))).toEqual({ kind: 'doc', documentId: 'd1' });
    expect(parseNodeId(phaseNodeId('p1', 'APD'))).toEqual({ kind: 'phase', projectId: 'p1', code: 'APD' });
  });
  it('garde un « : » dans le code d\'une phase', () => {
    expect(parseNodeId(phaseNodeId('p1', 'Lot 2: gros oeuvre'))).toEqual({ kind: 'phase', projectId: 'p1', code: 'Lot 2: gros oeuvre' });
  });
  it('refuse ce qui n\'est pas un identifiant', () => {
    for (const bad of ['', 'doc', 'doc:', ':x', 'phase:p1', 'phase:p1:', 'phase::APD', 'inconnu:x', null, undefined]) {
      expect(parseNodeId(bad as any)).toBeNull();
    }
  });
});

describe('phaseCode', () => {
  it('range un document sans phase sous « Général »', () => {
    expect(phaseCode(null)).toBe('Général');
    expect(phaseCode('  ')).toBe('Général');
    expect(phaseCode(' APD ')).toBe('APD');
  });
});

describe('comparePhaseCodes', () => {
  it('suit l\'ordre de la mission puis place les phases inconnues après', () => {
    const sorted = ['Général', 'DCE', 'Zèbre', 'ESQ', 'Alpha', 'APD'].sort(comparePhaseCodes);
    expect(sorted).toEqual(['ESQ', 'APD', 'DCE', 'Général', 'Alpha', 'Zèbre']);
  });
});

describe('safeNodeName', () => {
  it('remplace les caractères réservés', () => {
    expect(safeNodeName('Plan: RDC/R+1 <v2>?.pdf')).toBe('Plan_ RDC_R+1 _v2__.pdf');
  });
  it('retire le point et l\'espace finals', () => {
    expect(safeNodeName('note. ')).toBe('note');
    expect(safeNodeName('   ')).toBe('Sans nom');
    expect(safeNodeName('')).toBe('Sans nom');
  });
  it('écarte les noms réservés de Windows', () => {
    expect(safeNodeName('CON.txt')).toBe('_CON.txt');
    expect(safeNodeName('nul')).toBe('_nul');
    expect(safeNodeName('COM1.dwg')).toBe('_COM1.dwg');
    expect(safeNodeName('Console.txt')).toBe('Console.txt');
  });
  it('borne à 255 caractères en gardant l\'extension', () => {
    const name = safeNodeName(`${'a'.repeat(400)}.dwg`);
    expect(name.length).toBeLessThanOrEqual(255);
    expect(name.endsWith('.dwg')).toBe(true);
  });
  it('garde les accents', () => {
    expect(safeNodeName('Façade nord - élévation.pdf')).toBe('Façade nord - élévation.pdf');
  });
});

describe('uniqueSiblingNames', () => {
  it('suffixe les homonymes, sans tenir compte de la casse, de façon déterministe', () => {
    const names = uniqueSiblingNames([
      { id: 'c', name: 'plan.pdf' },
      { id: 'a', name: 'Plan.pdf' },
      { id: 'b', name: 'Autre.pdf' },
      { id: 'd', name: 'PLAN.PDF' },
    ]);
    expect(names.get('a')).toBe('Plan.pdf');
    expect(names.get('c')).toBe('plan (2).pdf');
    expect(names.get('d')).toBe('PLAN (3).PDF');
    expect(names.get('b')).toBe('Autre.pdf');
  });
  it('donne le même résultat quel que soit l\'ordre d\'entrée', () => {
    const items = [{ id: '2', name: 'x.dwg' }, { id: '1', name: 'x.dwg' }];
    expect(uniqueSiblingNames(items)).toEqual(uniqueSiblingNames([...items].reverse()));
  });
  it('suffixe un nom sans extension', () => {
    const names = uniqueSiblingNames([{ id: '1', name: 'LISEZMOI' }, { id: '2', name: 'LISEZMOI' }]);
    expect(names.get('2')).toBe('LISEZMOI (2)');
  });
});
