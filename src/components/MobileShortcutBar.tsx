import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  IconLayoutDashboard,
  IconBriefcase,
  IconMessageCircle,
  IconCalendarWeek,
  IconHelmet,
  IconRobot,
} from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { useUser } from '../UserContext';

// Raccourcis du quotidien sur le terrain : l'agenda (Réunions) et les
// comptes rendus de chantier (Réunion de chantier, /reunions) sont deux
// pages distinctes de l'app — voir la page Calendrier pour planifier une
// réunion et la page Réunions pour son compte rendu — donc deux entrées
// séparées plutôt qu'une seule qui forcerait à choisir.
const SHORTCUTS = [
  { path: '/', label: 'Accueil', icon: IconLayoutDashboard, exact: true },
  { path: '/projects', label: 'Projets', icon: IconBriefcase, exact: false },
  { path: '/messages', label: 'Messagerie', icon: IconMessageCircle, exact: false },
  { path: '/calendar', label: 'Réunions', icon: IconCalendarWeek, exact: false },
  { path: '/reunions', label: 'Chantier', icon: IconHelmet, exact: false },
] as const;

/**
 * Barre de raccourcis mobile, fixée en bas de l'écran, sur le modèle d'une
 * appli mobile grand public : les pages les plus consultées au quotidien
 * (accueil, projets, messagerie, agenda, comptes rendus de chantier) en
 * accès direct, plus Agents en bouton flottant à droite — toujours au même
 * endroit, quelle que soit la page. N'apparaît pas sur les routes plein
 * écran (fiche projet, chat d'agent) qui gèrent déjà tout leur espace vertical.
 */
export function MobileShortcutBar() {
  const location = useLocation();
  const { currentUser } = useUser();
  const [unreadMessages, setUnreadMessages] = useState(0);

  useEffect(() => {
    if (!currentUser) return;
    const fetchUnread = () => {
      apiFetch<{ count: number }>('/api/messages/unread-count')
        .then(data => setUnreadMessages(data.count || 0))
        .catch(() => {});
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, [currentUser?.email]);

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 flex items-stretch"
      style={{
        background: 'var(--tblr-surface)',
        borderTop: '1px solid var(--tblr-border)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        boxShadow: '0 -2px 12px rgba(0,0,0,.08)',
      }}
    >
      <div className="flex-1 flex">
        {SHORTCUTS.map(item => {
          const isActive = item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              to={item.path}
              className="relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors"
              style={{ color: isActive ? 'var(--tblr-primary)' : 'var(--tblr-muted)' }}
            >
              <Icon size={20} />
              <span className="leading-none">{item.label}</span>
              {item.path === '/messages' && unreadMessages > 0 && (
                <span
                  className="absolute top-1 right-[24%] min-w-[14px] h-[14px] px-1 rounded-full text-[8px] font-bold text-white flex items-center justify-center leading-none"
                  style={{ background: 'var(--tblr-danger)' }}
                >
                  {unreadMessages > 9 ? '9+' : unreadMessages}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Agents — toujours à droite, en bouton flottant au-dessus de la barre */}
      <div className="relative w-16 shrink-0">
        <Link
          to="/agents"
          aria-label="Agents"
          className={cn(
            'absolute -top-5 left-1/2 -translate-x-1/2 w-12 h-12 rounded-full flex items-center justify-center text-white shadow-lg transition-transform active:scale-95',
          )}
          style={{ background: 'var(--tblr-primary)' }}
        >
          <IconRobot size={22} />
        </Link>
      </div>
    </nav>
  );
}
