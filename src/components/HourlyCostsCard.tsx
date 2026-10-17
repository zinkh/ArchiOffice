import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';
import { getAllUsers, type UserProfile } from '../services/userService';

/**
 * Coût horaire chargé de chaque membre (salaire, charges, frais généraux), en
 * euros par heure. Réservé aux administrateurs : il sert à calculer la
 * rentabilité par phase et ne s'affiche à personne d'autre.
 */
export default function HourlyCostsCard() {
  const { t } = useTranslation();
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [costs, setCosts] = useState<Record<string, number | null>>({});
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAllUsers(), apiFetch('/api/hourly-costs')])
      .then(([users, data]) => {
        if (cancelled) return;
        setMembers(users);
        setCosts(data.costs || {});
        setAvailable(data.available !== false);
      })
      .catch((e: any) => { if (!cancelled) setError(e.message || t('hourly_costs_load_error')); });
    return () => { cancelled = true; };
  }, [t]);

  const save = async (userId: string, raw: string) => {
    const eur = raw.trim() === '' ? null : Number(raw.replace(',', '.'));
    const current = costs[userId] == null ? null : (costs[userId] as number) / 100;
    if (eur === current) return;
    try {
      setError('');
      const res = await apiFetch(`/api/hourly-costs/${userId}`, { method: 'PUT', body: JSON.stringify({ hourly_cost_eur: eur }) });
      setCosts(prev => ({ ...prev, [userId]: res.hourly_cost_cents ?? null }));
    } catch (e: any) { setError(e.message || t('hourly_costs_save_error')); }
  };

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
      <h3 className="font-bold">{t('hourly_costs_title')}</h3>
      <p className="text-xs text-zinc-500">{t('hourly_costs_hint')}</p>
      {!available && <p role="alert" className="text-xs text-amber-600">{t('hourly_costs_unavailable')}</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-700">
        {members.map(m => (
          <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="min-w-0 truncate">{m.name}</span>
            <label className="flex shrink-0 items-center gap-1.5">
              <span className="sr-only">{t('hourly_costs_input_label', { name: m.name })}</span>
              <input
                type="number" min="0" step="0.5" inputMode="decimal"
                defaultValue={costs[m.id] == null ? '' : (costs[m.id] as number) / 100}
                key={`${m.id}:${costs[m.id] ?? ''}`}
                disabled={!available}
                onBlur={e => save(m.id, e.target.value)}
                className="w-24 p-1.5 border rounded text-right tabular-nums dark:bg-zinc-900 dark:border-zinc-700"
              />
              <span className="text-zinc-500">{t('hourly_costs_unit')}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
