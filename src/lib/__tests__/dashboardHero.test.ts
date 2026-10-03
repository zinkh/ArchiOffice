import { describe, it, expect } from 'vitest';
import { buildHeroContent, heroRoleOf, type HeroStats } from '../dashboardHero';

const fmt = (n: number) => `${n} €`;
const stats: HeroStats = {
  paidThisMonth: 1200, overdueInvoices: 2, activeProjects: 3, openDeadlines: 10, meetingsThisWeek: 4, lateItems: 5,
};

describe('heroRoleOf', () => {
  it('distingue administrateur, manager et collaborateur', () => {
    expect(heroRoleOf('admin')).toBe('admin');
    expect(heroRoleOf('manager')).toBe('manager');
    expect(heroRoleOf('pm')).toBe('member');
    expect(heroRoleOf('user')).toBe('member');
    expect(heroRoleOf(undefined)).toBe('member');
  });
});

describe('buildHeroContent', () => {
  it('administrateur : encaissé du mois, retards de facturation, lien vers les factures', () => {
    const c = buildHeroContent('admin', stats, fmt);
    expect(c.lines[0][0]).toEqual({ key: 'dashboard_hero_paid_month', params: { amount: '1200 €' } });
    expect(c.lines[0][1]).toMatchObject({ key: 'dashboard_kpi_overdue', alert: true });
    expect(c.cta).toEqual({ key: 'dashboard_hero_cta_overdue', to: '/invoices', alert: true });
  });

  it('manager : parle de l\'équipe, sans retard renvoie vers les affaires', () => {
    const c = buildHeroContent('manager', { ...stats, overdueInvoices: 0 }, fmt);
    expect(c.lines[0][0].key).toBe('dashboard_hero_team_paid');
    expect(c.lines[0][1]).toEqual({ key: 'dashboard_kpi_no_overdue' });
    expect(c.cta).toEqual({ key: 'dashboard_hero_cta_projects', to: '/projects' });
  });

  it('collaborateur : aucun chiffre de facturation, retards sur ses affaires', () => {
    const c = buildHeroContent('member', stats, fmt);
    const keys = c.lines.flat().map(p => p.key);
    expect(keys).toEqual(['dashboard_hero_member_late', 'dashboard_hero_member_activity']);
    expect(JSON.stringify(c)).not.toContain('1200');
    expect(c.cta.to).toBe('/kanban');
  });

  it('collaborateur sans retard : message rassurant', () => {
    const c = buildHeroContent('member', { ...stats, lateItems: 0 }, fmt);
    expect(c.lines[0][0]).toEqual({ key: 'dashboard_hero_member_ok' });
  });
});
