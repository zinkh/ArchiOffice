// Contenu du panneau d'accueil des tableaux de bord, selon le profil.
//
// Un seul panneau pour tout le monde, mais pas le même message : l'administrateur
// lit la santé financière de l'agence, le manager celle de son équipe, un
// collaborateur ce qui l'attend sur SES affaires (jamais de chiffres de
// facturation). Pur et sans rendu : le composant n'a plus qu'à traduire.

export type HeroRole = 'admin' | 'manager' | 'member';

/** `admin` et `manager` ont leur propre rôle, tout autre rôle est un collaborateur. */
export function heroRoleOf(systemRole: string | null | undefined): HeroRole {
  if (systemRole === 'admin') return 'admin';
  if (systemRole === 'manager') return 'manager';
  return 'member';
}

export interface HeroStats {
  paidThisMonth: number;
  overdueInvoices: number;
  activeProjects: number;
  openDeadlines: number;
  meetingsThisWeek: number;
  /** Jalons, RFI, réserves et tâches en retard, sur le périmètre de la personne. */
  lateItems: number;
}

export interface HeroPart {
  key: string;
  params?: Record<string, string | number>;
  alert?: boolean;
}

export interface HeroContent {
  lines: HeroPart[][];
  cta: { key: string; to: string; alert?: boolean };
}

export function buildHeroContent(
  role: HeroRole,
  stats: HeroStats,
  formatAmount: (amount: number) => string,
): HeroContent {
  const amount = formatAmount(stats.paidThisMonth);
  const overdue: HeroPart = stats.overdueInvoices > 0
    ? { key: 'dashboard_kpi_overdue', params: { count: stats.overdueInvoices }, alert: true }
    : { key: 'dashboard_kpi_no_overdue' };
  const activity: HeroPart = {
    key: 'dashboard_hero_activity',
    params: { active: stats.activeProjects, deadlines: stats.openDeadlines },
  };

  if (role === 'member') {
    return {
      lines: [
        [stats.lateItems > 0
          ? { key: 'dashboard_hero_member_late', params: { count: stats.lateItems }, alert: true }
          : { key: 'dashboard_hero_member_ok' }],
        [{
          key: 'dashboard_hero_member_activity',
          params: { active: stats.activeProjects, meetings: stats.meetingsThisWeek },
        }],
      ],
      cta: { key: 'dashboard_hero_cta_tasks', to: '/kanban' },
    };
  }

  const paidKey = role === 'manager' ? 'dashboard_hero_team_paid' : 'dashboard_hero_paid_month';
  return {
    lines: [[{ key: paidKey, params: { amount } }, overdue], [activity]],
    cta: stats.overdueInvoices > 0
      ? { key: 'dashboard_hero_cta_overdue', to: '/invoices', alert: true }
      : role === 'manager'
        ? { key: 'dashboard_hero_cta_projects', to: '/projects' }
        : { key: 'dashboard_hero_cta', to: '/invoices' },
  };
}
