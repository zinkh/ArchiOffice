import { describe, expect, it } from 'vitest';
import { sharedInitialTab, sharedProSubTabs, sharedVisibleTabs } from '../sharedTabs';

const g = (kind: string, access: 'read' | 'comment' | 'write' = 'read') => ({ kind, access });

describe('sharedVisibleTabs', () => {
  it('ne montre que « Infos » quand rien n\'est accordé', () => {
    expect([...sharedVisibleTabs([])]).toEqual(['INFOS']);
  });

  it('associe chaque atelier accordé à l\'onglet de la fiche qui le porte', () => {
    const tabs = sharedVisibleTabs([g('cctp'), g('dpgf'), g('tasks'), g('act'), g('reports'), g('reserves'), g('gpa')]);
    expect([...tabs].sort()).toEqual(['ACT', 'AOR', 'GPA', 'INFOS', 'PRO', 'RDT', 'TACHES']);
  });

  it('range les lots et les documents sous « Infos », sans ajouter d\'onglet', () => {
    expect([...sharedVisibleTabs([g('lots'), g('documents')])]).toEqual(['INFOS']);
  });

  it('ignore un atelier inconnu plutôt que d\'ouvrir un onglet', () => {
    expect([...sharedVisibleTabs([g('facturation')])]).toEqual(['INFOS']);
  });
});

describe('sharedInitialTab', () => {
  const visible = sharedVisibleTabs([g('cctp')]);

  it('ouvre l\'onglet demandé quand il est visible', () => {
    expect(sharedInitialTab('PRO', visible)).toBe('PRO');
  });

  it('retombe sur « Infos » pour un onglet non accordé ou inconnu (adresse devinée)', () => {
    expect(sharedInitialTab('HONOS', visible)).toBe('INFOS');
    expect(sharedInitialTab('ACT', visible)).toBe('INFOS');
    expect(sharedInitialTab('n\'importe quoi', visible)).toBe('INFOS');
    expect(sharedInitialTab(null, visible)).toBe('INFOS');
  });
});

describe('sharedProSubTabs', () => {
  it('liste le CCTP et le DPGF comme deux ateliers distincts', () => {
    expect(sharedProSubTabs([g('dpgf')])).toEqual(['dpgf']);
    expect(sharedProSubTabs([g('dpgf'), g('cctp', 'comment')])).toEqual(['cctp', 'dpgf']);
    expect(sharedProSubTabs([g('tasks')])).toEqual([]);
  });
});
