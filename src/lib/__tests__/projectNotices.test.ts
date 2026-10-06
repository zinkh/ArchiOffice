import { describe, expect, it } from 'vitest';
import {
  ARCHITECTURAL_NOTICE_PHASES,
  isProjectNoticeKind,
  isProjectNoticePhase,
  projectNoticeFacts,
  projectNoticeOutline,
  projectNoticeOutlineText,
  projectNoticeTitle,
} from '../projectNotices';

describe('project notices', () => {
  it('keeps one architectural outline for every study phase', () => {
    expect(ARCHITECTURAL_NOTICE_PHASES).toEqual(['ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE']);
    for (const phase of ARCHITECTURAL_NOTICE_PHASES) {
      const outline = projectNoticeOutline('architectural', phase);
      expect(outline.length).toBeGreaterThanOrEqual(8);
      expect(projectNoticeOutlineText('architectural', phase)).toContain('1.');
      expect(projectNoticeTitle('architectural', phase)).toContain(phase);
    }
  });

  it('provides dedicated accessibility and fire-safety structures', () => {
    expect(projectNoticeOutline('accessibility', 'PC').join(' ')).toMatch(/cheminements|Circulations/);
    expect(projectNoticeOutline('security', 'PC').join(' ')).toMatch(/évacuation|Désenfumage|secours/);
    expect(projectNoticeTitle('accessibility', 'PC')).toBe('Notice d’accessibilité');
    expect(projectNoticeTitle('security', 'PC')).toBe('Notice de sécurité incendie');
  });

  it('only serialises facts already present on the project', () => {
    const facts = projectNoticeFacts({
      name: 'École test',
      address: '1 rue du Projet',
      surface: 420,
      construction_cost: 900000,
      type_et_cat: 'ERP type R — 4e catégorie',
      effectif_public: '220',
    } as any);

    expect(facts).toContain('Opération : École test');
    expect(facts).toContain('1 rue du Projet');
    expect(facts).toContain('420 m²');
    expect(facts).toContain('ERP type R — 4e catégorie');
    expect(facts).not.toContain('undefined');
    expect(facts).not.toContain('null');
  });

  it('rejects unknown notice kinds and phases', () => {
    expect(isProjectNoticeKind('architectural')).toBe(true);
    expect(isProjectNoticeKind('other')).toBe(false);
    expect(isProjectNoticePhase('PC')).toBe(true);
    expect(isProjectNoticePhase('DIAG')).toBe(false);
  });
});
