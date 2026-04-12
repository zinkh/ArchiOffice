export interface UserProfile {
  id: string;
  name: string;
  email: string;
  system_role: 'admin' | 'pm' | 'user';
  role?: string;
  avatar?: string;
}

export const getAllUsers = async (): Promise<UserProfile[]> => {
  const res = await fetch('/api/team');
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
};

export const updateUserRole = async (id: string, role: 'admin' | 'pm' | 'user'): Promise<void> => {
  const res = await fetch(`/api/team/${id}/role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error('Failed to update role');
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
