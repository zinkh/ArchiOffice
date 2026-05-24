import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUser } from '../UserContext';
import { PLANS, PLAN_ORDER, formatPrice } from '../lib/billing';
import type { PlanId } from '../lib/billing';
import {
  IconCheck, IconLoader2, IconAlertTriangle, IconCreditCard,
  IconRocket, IconCircleCheck, IconRefresh, IconExternalLink,
  IconChevronRight, IconClock,
} from '@tabler/icons-react';
import { cn } from '../lib/utils';

interface BillingStatus {
  plan: string;
  trial_ends_at: string | null;
  is_expired: boolean;
  usage: {
    projects: { used: number; limit: number };
    users: { used: number; limit: number };
    documents: { used: number; limit: number };
  };
}

interface BillingEvent {
  id: string;
  event_type: string;
  plan_id: string;
  amount: number;
  status: string;
  created_at: string;
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = limit >= 999;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const isWarning = !unlimited && pct >= 80;
  const isFull = !unlimited && pct >= 100;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>{label}</span>
        <span className={cn(isFull ? 'text-red-500' : isWarning ? 'text-amber-500' : '')}>
          {used} / {unlimited ? '∞' : limit}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              isFull ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-blue-500'
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const badges: Record<string, string> = {
    trial: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300',
    starter: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    pro: 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400',
    enterprise: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
    expired: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
  };
  const labels: Record<string, string> = {
    trial: 'Essai', starter: 'Starter', pro: 'Pro', enterprise: 'Entreprise', expired: 'Expiré',
  };
  return (
    <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide', badges[plan] || badges.trial)}>
      {labels[plan] || plan}
    </span>
  );
}

export default function Billing() {
  const { t } = useTranslation();
  const location = useLocation();
  const { currentUser } = useUser();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [history, setHistory] = useState<BillingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<PlanId | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const fetchStatus = async () => {
    const res = await fetch('/api/billing/status');
    if (!res.ok) return;
    const data = await res.json();
    setStatus(data);
  };

  const fetchHistory = async () => {
    const res = await fetch('/api/billing/history');
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data)) setHistory(data);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('payment_status') === 'success') {
      setNotice({ type: 'success', msg: 'Paiement reçu ! Votre abonnement va être activé sous quelques instants.' });
    }
    Promise.all([fetchStatus(), fetchHistory()]).finally(() => setLoading(false));
  }, [location.search]);

  const handleCheckout = async (planId: PlanId) => {
    if (planId === 'enterprise') {
      window.open('mailto:contact@archioffice.fr?subject=Abonnement Entreprise', '_blank');
      return;
    }
    setCheckingOut(planId);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: 'error', msg: data.error || 'Erreur lors du paiement' });
        return;
      }
      if (data.payment_url) {
        window.location.href = data.payment_url;
      }
    } catch {
      setNotice({ type: 'error', msg: 'Impossible de contacter le serveur de paiement.' });
    } finally {
      setCheckingOut(null);
    }
  };

  const currentPlanId = (status?.plan || 'trial') as PlanId;
  const currentPlanIdx = PLAN_ORDER.indexOf(currentPlanId);

  const daysLeft = status?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(status.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <IconLoader2 size={28} className="animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Notices */}
      {notice && (
        <div className={cn(
          'flex items-center gap-3 p-4 rounded-xl border text-sm',
          notice.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400'
            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400'
        )}>
          {notice.type === 'success' ? <IconCircleCheck size={18} /> : <IconAlertTriangle size={18} />}
          {notice.msg}
          <button onClick={() => setNotice(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Trial expiry warning */}
      {status?.plan === 'trial' && daysLeft !== null && daysLeft <= 5 && !status.is_expired && (
        <div className="flex items-center gap-3 p-4 rounded-xl border bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-400 text-sm">
          <IconClock size={18} />
          {daysLeft === 0
            ? "Votre période d'essai expire aujourd'hui."
            : `Il vous reste ${daysLeft} jour${daysLeft > 1 ? 's' : ''} d'essai.`}
          {' '}Souscrivez maintenant pour ne pas perdre l'accès.
        </div>
      )}

      {status?.is_expired && (
        <div className="flex items-center gap-3 p-4 rounded-xl border bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 text-sm">
          <IconAlertTriangle size={18} />
          Votre période d'essai a expiré. Souscrivez à un plan pour retrouver l'accès à toutes les fonctionnalités.
        </div>
      )}

      {/* Current plan card */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Plan actuel</h2>
            <div className="flex items-center gap-2 mt-1">
              <PlanBadge plan={status?.plan || 'trial'} />
              {status?.plan === 'trial' && daysLeft !== null && (
                <span className="text-xs text-zinc-500">
                  {status.is_expired ? 'Expiré' : `Expire dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}`}
                </span>
              )}
              {status?.plan !== 'trial' && status?.trial_ends_at && (
                <span className="text-xs text-zinc-500">
                  Renouvellement le {new Date(status.trial_ends_at).toLocaleDateString('fr-FR')}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => { fetchStatus(); fetchHistory(); }}
            className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Actualiser"
          >
            <IconRefresh size={16} />
          </button>
        </div>

        {status && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <UsageBar label="Projets" used={status.usage.projects.used} limit={status.usage.projects.limit} />
            <UsageBar label="Utilisateurs" used={status.usage.users.used} limit={status.usage.users.limit} />
            <UsageBar label="Documents" used={status.usage.documents.used} limit={status.usage.documents.limit} />
          </div>
        )}
      </div>

      {/* Plan cards */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">Choisir un plan</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['starter', 'pro', 'enterprise'] as PlanId[]).map((planId) => {
            const plan = PLANS[planId];
            const planIdx = PLAN_ORDER.indexOf(planId);
            const isCurrent = currentPlanId === planId;
            const isDowngrade = planIdx < currentPlanIdx && currentPlanId !== 'trial' && currentPlanId !== 'expired';

            return (
              <div
                key={planId}
                className={cn(
                  'relative rounded-xl border p-6 flex flex-col',
                  plan.highlight
                    ? 'border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/10'
                    : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                )}
              >
                {plan.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-violet-600 text-white text-xs font-semibold rounded-full">
                    Recommandé
                  </span>
                )}
                <div className="mb-4">
                  <h3 className="font-semibold text-zinc-900 dark:text-white text-base">{plan.name}</h3>
                  <div className="mt-1">
                    {plan.price_monthly > 0 ? (
                      <span>
                        <span className="text-2xl font-bold text-zinc-900 dark:text-white">
                          {formatPrice(plan.price_monthly)}
                        </span>
                        <span className="text-zinc-500 text-sm">/mois</span>
                      </span>
                    ) : planId === 'enterprise' ? (
                      <span className="text-zinc-500 text-sm">Sur devis</span>
                    ) : (
                      <span className="text-zinc-500 text-sm">Gratuit</span>
                    )}
                  </div>
                </div>

                <ul className="space-y-2 flex-1 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                      <IconCheck size={14} className="mt-0.5 flex-shrink-0 text-emerald-500" />
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => !isCurrent && !isDowngrade && handleCheckout(planId)}
                  disabled={isCurrent || isDowngrade || checkingOut !== null}
                  className={cn(
                    'w-full py-2 px-4 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2',
                    isCurrent
                      ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-default'
                      : isDowngrade
                      ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-not-allowed'
                      : plan.highlight
                      ? 'bg-violet-600 hover:bg-violet-700 text-white'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  )}
                >
                  {checkingOut === planId ? (
                    <IconLoader2 size={14} className="animate-spin" />
                  ) : isCurrent ? (
                    <><IconCircleCheck size={14} /> Plan actuel</>
                  ) : planId === 'enterprise' ? (
                    <><IconExternalLink size={14} /> Contacter</>
                  ) : (
                    <><IconRocket size={14} /> {isDowngrade ? 'Rétrograder' : 'Souscrire'}</>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Payment history */}
      {history.length > 0 && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
            <h2 className="font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <IconCreditCard size={18} />
              Historique des paiements
            </h2>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {history.map((evt) => (
              <div key={evt.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-2 h-2 rounded-full',
                    evt.status === 'paid' ? 'bg-emerald-500'
                      : evt.status === 'failed' ? 'bg-red-500'
                      : 'bg-amber-400'
                  )} />
                  <div>
                    <span className="font-medium text-zinc-900 dark:text-white capitalize">
                      {PLANS[evt.plan_id as PlanId]?.name || evt.plan_id}
                    </span>
                    <span className="text-zinc-400 ml-2">
                      {new Date(evt.created_at).toLocaleDateString('fr-FR')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    evt.status === 'paid'
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                      : evt.status === 'failed'
                      ? 'bg-red-50 dark:bg-red-900/20 text-red-500'
                      : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600'
                  )}>
                    {evt.status === 'paid' ? 'Payé' : evt.status === 'failed' ? 'Échoué' : 'En attente'}
                  </span>
                  {evt.amount > 0 && (
                    <span className="font-medium text-zinc-900 dark:text-white">
                      {formatPrice(evt.amount)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info box */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-4 text-sm text-zinc-500 dark:text-zinc-400 flex items-start gap-3">
        <IconCreditCard size={18} className="flex-shrink-0 mt-0.5 text-zinc-400" />
        <div>
          <p>Les paiements sont sécurisés par <strong className="text-zinc-700 dark:text-zinc-300">Stancer</strong>, solution française de paiement en ligne.
          Vos données bancaires ne sont jamais stockées sur nos serveurs.</p>
          <p className="mt-1">Pour toute question, contactez-nous à <a href="mailto:contact@archioffice.fr" className="text-blue-500 hover:underline">contact@archioffice.fr</a></p>
        </div>
      </div>
    </div>
  );
}
