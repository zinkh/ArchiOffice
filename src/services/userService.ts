export interface UserProfile {
  id: string;
  name: string;
  email: string;
  system_role: 'admin' | 'pm' | 'user';
}

export const getAllUsers = async (): Promise<UserProfile[]> => {
  console.log('Fetching all users');
  return [
    { id: '1', name: 'Admin User', email: 'admin@example.com', system_role: 'admin' },
    { id: '2', name: 'PM User', email: 'pm@example.com', system_role: 'pm' },
    { id: '3', name: 'Regular User', email: 'user@example.com', system_role: 'user' },
  ];
};

export const updateUserRole = async (id: string, role: 'admin' | 'pm' | 'user'): Promise<void> => {
  console.log(`Updating user ${id} to role ${role}`);
};
