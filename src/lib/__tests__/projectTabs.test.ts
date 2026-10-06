import { describe, it, expect } from 'vitest';
import {
  CHANTIER_ONLY_TABS, PROJECT_TAB_GROUPS, groupOfTab, isProjectTab, tabForGroup, visibleTabGroups,
  type ProjectTabId,
} from '../projectTabs';

describe('navigation de la fiche affaire', () => {
  it('range chacun des onze onglets dans une seule famille', () => {
    const all = PROJECT_TAB_GROUPS.flatMap(g => g.tabs);
    expect(all).toHaveLength(11);
    expect(new Set(all).size).toBe(11);
  });

  it('accepte les identifiants des liens existants (?tab=) et refuse le reste', () => {
    expect(isProjectTab('TACHES')).toBe(true);
    expect(isProjectTab('HONOS')).toBe(true);
    expect(isProjectTab('CHANTIER')).toBe(false);
    expect(isProjectTab('honos')).toBe(false);
    expect(isProjectTab(null)).toBe(false);
  });

  it('place les quatre missions de chantier sous la même famille', () => {
    expect(groupOfTab('DET')?.id).toBe('CHANTIER');
    expect(groupOfTab('RDT')?.id).toBe('CHANTIER');
    expect(groupOfTab('PRO')?.id).toBe('ETUDES');
    expect(groupOfTab('NOTICES')?.id).toBe('ETUDES');
  });

  it('hors mission chantier, ne garde que cinq entrées', () => {
    const groups = visibleTabGroups(tab => !CHANTIER_ONLY_TABS.includes(tab));
    expect(groups.map(g => g.id)).toEqual(['INFOS', 'TACHES', 'HONOS', 'ETUDES', 'CORRESPONDANCE']);
  });

  it('en mission chantier, ramène onze onglets à sept entrées', () => {
    expect(visibleTabGroups(() => true)).toHaveLength(7);
  });

  it("retire d'une famille les onglets masqués sans la vider", () => {
    const hidden: ProjectTabId[] = ['VISA', 'RDT'];
    const chantier = visibleTabGroups(tab => !hidden.includes(tab)).find(g => g.id === 'CHANTIER');
    expect(chantier?.tabs).toEqual(['DET', 'AOR']);
  });

  it("rouvre l'onglet déjà consulté dans la famille, sinon le premier", () => {
    const chantier = PROJECT_TAB_GROUPS.find(g => g.id === 'CHANTIER')!;
    expect(tabForGroup(chantier, 'AOR')).toBe('AOR');
    expect(tabForGroup(chantier, 'HONOS')).toBe('VISA');
    expect(tabForGroup(chantier, 'HONOS', 'DET')).toBe('DET');
    // Un souvenir d'une autre famille est ignoré.
    expect(tabForGroup(chantier, 'HONOS', 'PRO')).toBe('VISA');
  });
});
