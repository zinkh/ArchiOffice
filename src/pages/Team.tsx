import * as React from 'react';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { AnimatePresence } from 'motion/react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAllUsers, updateUserRole, updateUserManager, createUser, UserProfile, getJoinRequests, decideJoinRequest, JoinRequest } from '../services/userService';
import { JOIN_REQUESTS_CHANGED } from '../components/Sidebar';
import { useUser } from '../UserContext';
import TeamHeader from '../components/team/TeamHeader';
import TeamToolbar, { type RoleFilter, type TeamSort, type TeamView } from '../components/team/TeamToolbar';
import JoinRequestQueue from '../components/team/JoinRequestQueue';
import TeamRegistry from '../components/team/TeamRegistry';
import TeamCards from '../components/team/TeamCards';
import TeamOrgChart from '../components/team/TeamOrgChart';
import TeamNotice, { type TeamNoticeData } from '../components/team/TeamNotice';
import AddMemberModal from '../components/team/AddMemberModal';
import { EmptyTeam, LoadError, NoResults, TeamSkeleton } from '../components/team/TeamStates';
import { ROLE_RANK, useMediaQuery } from '../components/team/teamShared';

function sortMembers(list: UserProfile[], sort: TeamSort): UserProfile[] {
  const byName = (a: UserProfile, b: UserProfile) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
  return [...list].sort((a, b) => {
    if (sort === 'access') return ROLE_RANK[a.system_role] - ROLE_RANK[b.system_role] || byName(a, b);
    if (sort === 'role') {
      if (!a.role !== !b.role) return a.role ? -1 : 1;
      return (a.role || '').localeCompare(b.role || '', 'fr', { sensitivity: 'base' }) || byName(a, b);
    }
    return byName(a, b);
  });
}

export default function Team() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('member');
  const memberRefs = useRef<Record<string, HTMLElement | null>>({});
  const [team, setTeam] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [sort, setSort] = useState<TeamSort>('name');
  const [notice, setNotice] = useState<TeamNoticeData | null>(null);
  const [view, setView] = useState<TeamView>('registry');

  const isAdmin = currentUser?.system_role === 'admin';
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  // Le registre dense exige de la largeur : sous un téléphone il retombe sur les fiches.
  const activeView: TeamView = view === 'registry' && !isDesktop ? 'cards' : view;

  const loadTeam = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    getAllUsers()
      .then(setTeam)
      .catch((err) => { console.error(err); setLoadFailed(true); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  useEffect(() => {
    if (!isAdmin) return;
    getJoinRequests().then(setJoinRequests).catch(console.error);
  }, [isAdmin]);

  // Scroll to and highlight a member linked from a mention elsewhere in the app
  useEffect(() => {
    if (!highlightId || team.length === 0) return;
    memberRefs.current[highlightId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, team, activeView]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = team.filter((m) =>
      (roleFilter === 'all' || m.system_role === roleFilter) &&
      (!q || [m.name, m.email, m.role].some((v) => (v || '').toLowerCase().includes(q))));
    return sortMembers(filtered, sort);
  }, [team, query, roleFilter, sort]);

  const handleDecideJoinRequest = async (id: string, decision: 'approve' | 'reject') => {
    setDecidingId(id);
    try {
      await decideJoinRequest(id, decision);
      setJoinRequests(prev => prev.filter(r => r.id !== id));
      // Fait retomber le compteur du menu latéral, qui vit dans un autre
      // composant sans état partagé avec celui-ci.
      window.dispatchEvent(new Event(JOIN_REQUESTS_CHANGED));
      if (decision === 'approve') getAllUsers().then(setTeam).catch(console.error);
    } catch (err: any) {
      setNotice({ kind: 'error', text: err.message || t('team_join_request_process_failed') });
    } finally {
      setDecidingId(null);
    }
  };

  const handleRoleChange = async (id: string, newRole: 'admin' | 'manager' | 'pm' | 'user') => {
    try {
      await updateUserRole(id, newRole);
      setTeam(team.map(member => member.id === id ? { ...member, system_role: newRole } : member));
    } catch (err) {
      console.error(err);
      setNotice({ kind: 'error', text: t('team_update_role_failed') });
    }
  };

  const handleManagerChange = async (id: string, managerId: string) => {
    try {
      await updateUserManager(id, managerId || null);
      setTeam(team.map(member => member.id === id ? { ...member, manager_id: managerId || null } : member));
    } catch (err) {
      console.error(err);
      setNotice({ kind: 'error', text: t('team_update_manager_failed') });
    }
  };

  const handleAddUser = async (newUser: Omit<UserProfile, 'id'>) => {
    setIsSubmitting(true);
    try {
      const result = await createUser(newUser) as any;
      setTeam([...team, result]);
      setIsModalOpen(false);

      if (result.emailSent) {
        setNotice({ kind: 'info', text: t('team_user_created_email_sent') });
      } else {
        setNotice({ kind: 'error', text: t('team_user_created_email_failed', { error: result.emailError || t('team_unknown_error') }) });
      }
    } catch (err: any) {
      console.error(err);
      setNotice({ kind: 'error', text: err.message || t('team_create_user_failed') });
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeNotice = useCallback(() => setNotice(null), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);
  const resetFilters = () => { setQuery(''); setRoleFilter('all'); };

  const viewProps = {
    members: visible,
    team,
    isAdmin,
    highlightId,
    currentUserId: currentUser?.id,
    memberRefs,
    onRoleChange: handleRoleChange,
    onManagerChange: handleManagerChange,
  };

  let body: React.ReactNode;
  if (loading) body = <TeamSkeleton />;
  else if (loadFailed) body = <LoadError onRetry={loadTeam} />;
  else if (team.length === 0) body = <EmptyTeam isAdmin={isAdmin} onAdd={() => setIsModalOpen(true)} />;
  else if (activeView === 'org') body = <TeamOrgChart team={team} highlightId={highlightId} memberRefs={memberRefs} />;
  else if (visible.length === 0) body = <NoResults onReset={resetFilters} />;
  else body = activeView === 'registry' ? <TeamRegistry {...viewProps} /> : <TeamCards {...viewProps} />;

  return (
    <div className="mx-auto max-w-[88rem] space-y-8 pb-10">
      <TeamHeader
        headcount={team.length}
        admins={team.filter((m) => m.system_role === 'admin').length}
        pending={isAdmin ? joinRequests.length : 0}
        isAdmin={isAdmin}
        onAdd={() => setIsModalOpen(true)}
      />

      {isAdmin && <JoinRequestQueue requests={joinRequests} decidingId={decidingId} onDecide={handleDecideJoinRequest} />}

      {!loading && !loadFailed && team.length > 0 && (
        <TeamToolbar
          team={team}
          query={query}
          onQuery={setQuery}
          roleFilter={roleFilter}
          onRoleFilter={setRoleFilter}
          sort={sort}
          onSort={setSort}
          view={activeView}
          onView={setView}
          registryAvailable={isDesktop}
        />
      )}

      {body}

      <AnimatePresence>
        {notice && <TeamNotice key={notice.text} notice={notice} onClose={closeNotice} />}
      </AnimatePresence>

      <AnimatePresence>
        {isModalOpen && <AddMemberModal isSubmitting={isSubmitting} onClose={closeModal} onSubmit={handleAddUser} />}
      </AnimatePresence>
    </div>
  );
}
