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
import { useAgentChat } from '@zinkh/archioffice-agents/client';

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
 * Menu de raccourcis mobile — une pastille flottante détachée des bords de
 * l'écran (pas une barre encastrée) : accueil, projets, messagerie, agenda,
 * comptes rendus de chantier, plus Agents. Le tabler « Agents » rouvre le
 * même panneau de chat que le bouton flottant global de
 * `AgentChatProvider` (`useAgentChat`), jamais une seconde entrée
 * concurrente — ce bouton global se masque sur mobile (voir AgentChat.tsx)
 * précisément parce que cette pastille le remplace. N'apparaît pas sur les
 * routes plein écran (fiche projet, chat d'agent) qui gèrent déjà tout leur
 * espace vertical.
 */
export function MobileShortcutBar() {
  const location = useLocation();
  const { currentUser } = useUser();
  const { openChat } = useAgentChat();
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

  const itemClass = (isActive: boolean) => cn(
    'relative flex items-center justify-center w-10 h-10 rounded-full transition-colors shrink-0',
    isActive ? 'bg-white text-zinc-900' : 'text-white/85 hover:text-white'
  );

  return (
    <nav
      className="md:hidden fixed inset-x-0 z-30 flex justify-center pointer-events-none"
      style={{ bottom: 'calc(14px + env(safe-area-inset-bottom, 0px))' }}
    >
      <div
        className="flex items-center gap-1 px-1.5 py-1.5 rounded-full pointer-events-auto"
        style={{ background: '#15171c', boxShadow: '0 8px 24px rgba(0,0,0,.28)' }}
      >
        {SHORTCUTS.map(item => {
          const isActive = item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);
          const Icon = item.icon;
          return (
            <Link key={item.path} to={item.path} aria-label={item.label} className={itemClass(isActive)}>
              <Icon size={19} />
              {item.path === '/messages' && unreadMessages > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-[3px] rounded-full text-[8px] font-bold text-white flex items-center justify-center leading-none"
                  style={{ background: 'var(--tblr-danger)' }}
                >
                  {unreadMessages > 9 ? '9+' : unreadMessages}
                </span>
              )}
            </Link>
          );
        })}
        <button type="button" onClick={() => openChat()} aria-label="Agents" className={itemClass(false)}>
          <IconRobot size={19} />
        </button>
      </div>
    </nav>
  );
}
