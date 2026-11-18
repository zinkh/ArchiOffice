// Photo d'un chantier partagé avec un confrère. L'adresse du fichier n'est jamais dans les données de la page : elle est
// demandée au serveur (qui revérifie le partage, le détail accordé et le rattachement à l'affaire) quand la photo
// s'affiche, et expire. Un clic ouvre la photo en grand, dans un nouvel onglet, avec un lien lui aussi demandé à ce moment.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../lib/api';

type Link = { url: string };

export default function SharedPhoto({ route, fullRoute, alt }: { route: string; /** Route de la photo en taille réelle, si `route` sert une miniature. */ fullRoute?: string; alt: string }) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(null); setFailed(false);
    apiFetch<Link>(route).then(link => { if (!cancelled) setSrc(link.url); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [route]);

  const openFull = async () => {
    try {
      const { url } = await apiFetch<Link>(fullRoute ?? route);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch { setFailed(true); }
  };

  if (failed) return <span className="inline-flex h-20 w-20 items-center justify-center rounded-lg text-[0.6875rem] text-center text-[var(--tblr-muted)]" style={{ background: 'var(--tblr-surface-2)' }}>{t('shared_photo_error')}</span>;
  if (!src) return <span aria-hidden className="inline-block h-20 w-20 rounded-lg animate-pulse" style={{ background: 'var(--tblr-surface-2)' }} />;
  return (
    <button type="button" onClick={openFull} aria-label={`${t('shared_photo_open')} ${alt}`} title={t('shared_photo_open')}
      className="rounded-lg overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)]">
      <img src={src} alt={alt} loading="lazy" className="h-20 w-20 object-cover" />
    </button>
  );
}
