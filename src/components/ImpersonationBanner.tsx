import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useUser } from '../UserContext';

const STORAGE_KEY = 'archioffice_impersonating';

// Persistent top banner shown for the lifetime of an impersonated browser
// session — started from a magic link minted by
// POST /api/admin/tenants/:id/impersonate (server/routes/superAdmin.ts),
// which redirects to `/?impersonating=1`. Session-scoped (sessionStorage,
// not localStorage) so it never leaks into a later normal session in the
// same browser. There is no "return to my own session" — ending
// impersonation is just signing out, same as any other session.
export default function ImpersonationBanner() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useUser();
  const [active, setActive] = useState(() => {
    try { return sessionStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('impersonating') === '1') {
      try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch {}
      setActive(true);
      params.delete('impersonating');
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  if (!active) return null;

  const handleLeave = async () => {
    setLeaving(true);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
    await signOut();
    window.location.href = '/login';
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[300] flex items-center justify-center gap-3 py-2 px-4 text-sm font-semibold text-black"
      style={{ background: '#f59e0b' }}
    >
      <IconAlertTriangle size={16} />
      Session d'assistance ArchiOffice — vous naviguez avec les droits d'un autre compte.
      <button onClick={handleLeave} disabled={leaving} className="underline disabled:opacity-60">
        {leaving ? 'Fin de session…' : 'Quitter'}
      </button>
    </div>
  );
}
