import type { MutableRefObject } from 'react';
import type { UserProfile } from '../../services/userService';
import type { SystemRole } from './teamShared';

export interface MemberViewProps {
  /** Membres affichés (déjà filtrés et triés). */
  members: UserProfile[];
  /** Équipe complète : sert aux listes de responsables. */
  team: UserProfile[];
  isAdmin: boolean;
  highlightId: string | null;
  currentUserId?: string;
  memberRefs: MutableRefObject<Record<string, HTMLElement | null>>;
  onRoleChange: (id: string, role: SystemRole) => void;
  onManagerChange: (id: string, managerId: string) => void;
}
