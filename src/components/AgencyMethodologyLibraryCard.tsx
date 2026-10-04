// Bibliothèque de documents du cabinet servant à la rédaction assistée des
// notes méthodologiques d'appel d'offres (plan Enterprise, bouton "Depuis la
// bibliothèque" de l'onglet Note méthodologique — voir
// server/routes/tenderAi.ts). Un rattachement générique de plus sur
// `documents` (resource_type='agency_library'), au même titre que la
// bibliothèque de connaissances d'un agent — sauf qu'ici resource_id est le
// tenant_id lui-même : une seule bibliothèque par cabinet, pas une par fiche.
import { useTranslation } from 'react-i18next';
import { useUser } from '../UserContext';
import { ResourceAttachments } from './ResourceAttachments';

export function AgencyMethodologyLibraryCard() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const tenantId = currentUser?.tenantId;
  if (!tenantId) return null;

  return (
    <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('agency_library_title')}</h2>
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('agency_library_explanation')}</p>
      <ResourceAttachments resourceType="agency_library" resourceId={tenantId} />
    </div>
  );
}
