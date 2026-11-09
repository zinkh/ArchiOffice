export interface UserProfile {
  id: string;
  name: string;
  email: string;
  system_role: 'admin' | 'manager' | 'pm' | 'user';
  manager_id?: string | null;
  role?: string;
  avatar?: string;
}

export const getAllUsers = async (): Promise<UserProfile[]> => {
  const res = await fetch('/api/team');
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
};

export const updateUserRole = async (id: string, role: 'admin' | 'manager' | 'pm' | 'user'): Promise<void> => {
  const res = await fetch(`/api/team/${id}/role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || 'Failed to update role');
  }
};

export const updateUserManager = async (id: string, managerId: string | null): Promise<void> => {
  const res = await fetch(`/api/team/${id}/manager`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manager_id: managerId }),
  });
  if (!res.ok) throw new Error('Failed to update manager');
};

export const createUser = async (user: Omit<UserProfile, 'id'>): Promise<UserProfile> => {
  const res = await fetch('/api/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to create user');
  }
  return res.json();
};

export interface JoinRequest {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export const getJoinRequests = async (): Promise<JoinRequest[]> => {
  const res = await fetch('/api/team/join-requests');
  if (!res.ok) throw new Error('Failed to fetch join requests');
  return res.json();
};

export const decideJoinRequest = async (id: string, decision: 'approve' | 'reject'): Promise<void> => {
  const res = await fetch(`/api/team/join-requests/${id}/${decision}`, { method: 'POST' });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to decide join request');
  }
};

export const revokeUser = async (id: string): Promise<{ accountBlocked: boolean }> => {
  const res = await fetch(`/api/team/${id}/revoke`, { method: 'POST' });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || 'Failed to revoke user');
  return { accountBlocked: !!body?.accountBlocked };
};

export const resetUserPassword = async (id: string): Promise<{ emailSent: boolean; emailError: string | null }> => {
  const res = await fetch(`/api/team/${id}/reset-password`, { method: 'POST' });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || 'Failed to reset password');
  return { emailSent: !!body?.emailSent, emailError: body?.emailError ?? null };
};
