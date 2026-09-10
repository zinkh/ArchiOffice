import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconBuilding, IconCheck, IconPlus } from '@tabler/icons-react';
import { useUser } from '../UserContext';

/**
 * Le sélecteur de cabinet, rendu en tête du menu utilisateur.
 *
 * Il ne s'affiche qu'à partir de deux cabinets : pour l'immense majorité des
 * comptes, qui n'en ont qu'un, l'en-tête reste exactement ce qu'elle était.
 * Le seul ajout permanent est l'entrée « Rejoindre ou créer un cabinet »,
 * point d'entrée du second rattachement.
 */
export function TenantSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tenants, activeTenantId, switchTenant } = useUser();
  const [switching, setSwitching] = useState<string | null>(null);

  const handleSwitch = async (tenantId: string) => {
    if (tenantId === activeTenantId || switching) return;
    setSwitching(tenantId);
    // switchTenant recharge l'application : inutile de remettre l'état à
    // zéro ensuite, cette vue ne sera plus là.
    await switchTenant(tenantId);
  };

  return (
    <div className="border-b" style={{ borderColor: 'var(--tblr-border)' }}>
      {tenants.length > 1 && (
        <div className="p-1">
          <p
            className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--tblr-muted)' }}
          >
            {t('tenant_switcher_label')}
          </p>
          {tenants.map(tenant => {
            const isActive = tenant.tenantId === activeTenantId;
            return (
              <button
                key={tenant.tenantId}
                onClick={() => handleSwitch(tenant.tenantId)}
                disabled={!!switching}
                title={isActive ? t('tenant_switcher_current') : t('tenant_switcher_switch')}
                className="w-full flex items-center gap-2 px-3 py-2 rounded text-[13px] transition-colors text-left disabled:opacity-60"
                style={{ color: 'var(--tblr-text)', background: isActive ? 'var(--tblr-surface-2)' : '' }}
                onMouseOver={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                onMouseOut={e => (e.currentTarget.style.background = isActive ? 'var(--tblr-surface-2)' : '')}
              >
                <IconBuilding size={15} style={{ color: 'var(--tblr-muted)', flexShrink: 0 }} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{tenant.name || tenant.tenantId}</span>
                  <span className="block text-[11px] truncate" style={{ color: 'var(--tblr-muted)' }}>
                    {switching === tenant.tenantId
                      ? t('tenant_switcher_switching')
                      : tenant.systemRole === 'admin'
                        ? t('tenant_switcher_role_admin')
                        : t('tenant_switcher_role_member')}
                  </span>
                </span>
                {isActive && <IconCheck size={15} style={{ color: 'var(--tblr-muted)', flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      )}
      <div className="p-1 pt-0">
        <button
          onClick={() => { navigate('/agency-setup?add=1'); onNavigate?.(); }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded text-[13px] transition-colors"
          style={{ color: 'var(--tblr-muted)' }}
          onMouseOver={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
          onMouseOut={e => (e.currentTarget.style.background = '')}
        >
          <IconPlus size={15} />
          {t('tenant_switcher_add')}
        </button>
      </div>
    </div>
  );
}
