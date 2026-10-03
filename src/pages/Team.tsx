import * as React from 'react';
import { lazy, Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { AnimatePresence } from 'motion/react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';
import { getAllUsers, updateUserRole, updateUserManager, createUser, UserProfile, getJoinRequests, decideJoinRequest, JoinRequest } from '../services/userService';
import { JOIN_REQUESTS_CHANGED } from '../components/Sidebar';
import { useUser } from '../UserContext';
import TeamHeader from '../components/team/TeamHeader';
import TeamTabs, { TAB_PARAM, tabFromParam, type TeamTab } from '../components/team/TeamTabs';
import TeamToolbar, { type RoleFilter, type TeamSort, type TeamView } from '../components/team/TeamToolbar';
import JoinRequestQueue from '../components/team/JoinRequestQueue';
import TeamMembers from '../components/team/TeamMembers';
import TeamOrgChart from '../components/team/TeamOrgChart';
import TeamNotice, { type TeamNoticeData } from '../components/team/TeamNotice';
import AddMemberModal from '../components/team/AddMemberModal';
import { EmptyTeam, LoadError, NoResults, TeamSkeleton } from '../components/team/TeamStates';
import { ROLE_RANK } from '../components/team/teamShared';

const Leave = lazy(() => import('./Leave'));
const TimeTracking = lazy(() => import('./TimeTracking'));

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
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [view, setView] = useState<TeamView>('list');

  const [pendingLeave, setPendingLeave] = useState(0);
  // Un lien vers un membre (`?member=`) ouvre toujours l'onglet Équipe.
  const tab: TeamTab = highlightId ? 'team' : tabFromParam(searchParams.get('tab'));

  const changeTab = (next: TeamTab) => {
    const params = new URLSearchParams(searchParams);
    params.delete('member');
    const value = TAB_PARAM[next];
    if (value) params.set('tab', value); else params.delete('tab');
    setSearchParams(params, { replace: true });
  };

  const isAdmin = currentUser?.system_role === 'admin';

  const loadTeam = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    getAllUsers()
      .then(setTeam)
      .catch((err) => { console.error(err); setLoadFailed(true); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  // Demandes de congés à valider : l'API ne répond que pour les responsables et les administrateurs.
  useEffect(() => {
    apiFetch<{ status: string }[]>('/api/leave_requests?scope=team')
      .then((rows) => setPendingLeave(rows.filter((r) => r.status === 'pending').length))
      .catch(() => setPendingLeave(0));
  }, [tab]);

  useEffect(() => {
    if (!isAdmin) return;
    getJoinRequests().then(setJoinRequests).catch(console.error);
  }, [isAdmin]);

  // Scroll to and highlight a member linked from a mention elsewhere in the app
  useEffect(() => {
    if (!highlightId || team.length === 0) return;
    memberRefs.current[highlightId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, team, view]);

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
      const decided = joinRequests.find(r => r.id === id);
      setJoinRequests(prev => prev.filter(r => r.id !== id));
      setNotice({
        kind: 'success',
        text: t(decision === 'approve' ? 'team_request_approved' : 'team_request_rejected', { name: decided?.name || decided?.email || '' }),
      });
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
    const target = team.find(member => member.id === id);
    if (target?.system_role === 'admin' && newRole !== 'admin') {
      // Un cabinet ne doit jamais se retrouver sans administrateur : le
      // serveur refuse aussi, mais autant l'expliquer avant l'appel.
      if (team.filter(member => member.system_role === 'admin').length <= 1) {
        setNotice({ kind: 'error', text: t('team_last_admin_blocked') });
        return;
      }
      // Seul un administrateur peut rendre ce rôle : rétrogradé, plus personne
      // ne peut défaire le geste depuis ce compte.
      const confirmed = window.confirm(t(
        id === currentUser?.id ? 'team_confirm_demote_self' : 'team_confirm_demote_admin',
        { name: target.name },
      ));
      if (!confirmed) return;
    }
    try {
      await updateUserRole(id, newRole);
      setTeam(team.map(member => member.id === id ? { ...member, system_role: newRole } : member));
    } catch (err: any) {
      console.error(err);
      setNotice({ kind: 'error', text: err?.message && err.message !== 'Failed to update role' ? err.message : t('team_update_role_failed') });
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
  else if (view === 'org') body = <TeamOrgChart team={team} highlightId={highlightId} memberRefs={memberRefs} />;
  else if (visible.length === 0) body = <NoResults onReset={resetFilters} />;
  else body = <TeamMembers {...viewProps} />;

  return (
    <div className={cn('mx-auto max-w-[88rem] space-y-5', notice ? 'pb-28' : 'pb-10')}>
      <TeamHeader
        headcount={team.length}
        admins={team.filter((m) => m.system_role === 'admin').length}
        pending={isAdmin ? joinRequests.length : 0}
        isAdmin={isAdmin}
        showTeamTools={tab === 'team'}
        onAdd={() => setIsModalOpen(true)}
      />

      <TeamTabs tab={tab} onTab={changeTab} pendingLeave={pendingLeave} />

      {tab === 'team' && (
        <>
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
              view={view}
              onView={setView}
            />
          )}

          {body}
        </>
      )}

      {tab !== 'team' && (
        <Suspense fallback={<TeamSkeleton />}>
          {tab === 'leave' ? <Leave embedded /> : <TimeTracking embedded />}
        </Suspense>
      )}

      <AnimatePresence>
        {notice && <TeamNotice key={notice.text} notice={notice} onClose={closeNotice} />}
      </AnimatePresence>

      <AnimatePresence>
        {isModalOpen && <AddMemberModal isSubmitting={isSubmitting} onClose={closeModal} onSubmit={handleAddUser} />}
      </AnimatePresence>
    </div>
  );
}
