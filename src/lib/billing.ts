export type PlanId = 'trial' | 'starter' | 'pro' | 'enterprise';

export interface PlanLimits {
  projects: number; // 999 = unlimited
  users: number;
  documents: number;
  storage_mb: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  price_monthly: number; // EUR cents; 0 = free or contact sales
  limits: PlanLimits;
  features: string[];
  highlight?: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  trial: {
    id: 'trial',
    name: 'Essai gratuit',
    price_monthly: 0,
    limits: { projects: 3, users: 1, documents: 10, storage_mb: 100 },
    features: ['3 projets', '1 utilisateur', '10 documents', '100 Mo stockage', 'Fonctionnalités de base'],
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    price_monthly: 2900,
    limits: { projects: 10, users: 2, documents: 100, storage_mb: 1000 },
    features: ['10 projets', '2 utilisateurs', '100 documents', '1 Go stockage', 'Devis & Factures', 'Export PDF'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price_monthly: 5900,
    limits: { projects: 999, users: 10, documents: 999, storage_mb: 10000 },
    features: ['Projets illimités', '10 utilisateurs', 'Documents illimités', '10 Go stockage', 'Toutes les intégrations', 'Support prioritaire'],
    highlight: true,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Entreprise',
    price_monthly: 0,
    limits: { projects: 999, users: 999, documents: 999, storage_mb: 100000 },
    features: ['Tout ce qui est inclus dans Pro', 'Utilisateurs illimités', 'Stockage illimité', 'SLA garanti', 'Account manager dédié', 'Formation sur site incluse'],
  },
};

export const PLAN_ORDER: PlanId[] = ['trial', 'starter', 'pro', 'enterprise'];

export function isPlanAtLeast(currentPlan: string, requiredPlan: PlanId): boolean {
  const ci = PLAN_ORDER.indexOf(currentPlan as PlanId);
  const ri = PLAN_ORDER.indexOf(requiredPlan);
  if (ci === -1 || ri === -1) return false;
  return ci >= ri;
}

export function formatPrice(cents: number): string {
  if (cents === 0) return 'Gratuit';
  return `${(cents / 100).toFixed(0)} €`;
}
