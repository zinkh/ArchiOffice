import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBuilding, IconLock, IconLogout } from '@tabler/icons-react';
import { useUser } from '../UserContext';
import { TENANT_SUSPENDED_EVENT } from '../lib/tenantSuspended';

/**
 * Écran de blocage d'un cabinet suspendu par le superadmin.
 *
 * Le serveur refuse toute requête visant ce cabinet (403 TENANT_SUSPENDED) ;
 * le premier refus fait apparaître cet écran, qui recouvre toute
 * l'application. Une personne qui exerce aussi dans un autre cabinet peut y
 * basculer : c'est la seule porte de sortie, avec la déconnexion.
 *
 * Le motif de la suspension n'est volontairement pas affiché : il peut
 * décrire un litige entre associés.
 */
export function TenantSuspendedGate() {
  const { t } = useTranslation();
  const { tenants, activeTenantId, switchTenant, signOut } = useUser();
  const [suspended, setSuspended] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    const onSuspended = () => setSuspended(true);
    window.addEventListener(TENANT_SUSPENDED_EVENT, onSuspended);
    return () => window.removeEventListener(TENANT_SUSPENDED_EVENT, onSuspended);
  }, []);

  if (!suspended) return null;

  const others = tenants.filter(tenant => tenant.tenantId !== activeTenantId);

  const handleSwitch = async (tenantId: string) => {
    if (switching) return;
    setSwitching(tenantId);
    // switchTenant recharge l'application : cette vue disparaît avec elle.
    await switchTenant(tenantId);
  };

  const handleSignOut = async () => {
    await signOut();
    window.location.href = '/login';
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="tenant-suspended-title"
      className="fixed inset-0 z-[400] flex items-center justify-center p-4"
      style={{ background: 'var(--tblr-bg-surface, var(--tblr-surface))' }}
    >
      <div
        className="w-full max-w-md rounded-xl border p-6 text-center"
        style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
      >
        <IconLock size={32} className="mx-auto mb-3" style={{ color: 'var(--tblr-muted)' }} />
        <h1 id="tenant-suspended-title" className="text-lg font-bold" style={{ color: 'var(--tblr-text)' }}>
          {t('tenant_suspended_title')}
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--tblr-muted)' }}>
          {t('tenant_suspended_body')}
        </p>

        {others.length > 0 && (
          <div className="mt-5 text-left">
            <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wide" style={{ color: 'var(--tblr-muted)' }}>
              {t('tenant_suspended_switch')}
            </p>
            {others.map(tenant => (
              <button
                key={tenant.tenantId}
                onClick={() => handleSwitch(tenant.tenantId)}
                disabled={!!switching}
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-[0.8125rem] hover:bg-[var(--tblr-surface-2)] disabled:opacity-60"
                style={{ color: 'var(--tblr-text)' }}
              >
                <IconBuilding size={15} style={{ color: 'var(--tblr-muted)', flexShrink: 0 }} />
                <span className="truncate">{tenant.name || tenant.tenantId}</span>
              </button>
            ))}
          </div>
        )}

        <button
          onClick={handleSignOut}
          className="mt-5 inline-flex items-center gap-1.5 text-sm underline"
          style={{ color: 'var(--tblr-muted)' }}
        >
          <IconLogout size={14} />
          {t('tenant_suspended_sign_out')}
        </button>
      </div>
    </div>
  );
}
