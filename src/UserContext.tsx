import * as React from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
import type { TeamMember as UserProfile } from './types';

interface UserContextType {
  currentUser: UserProfile | null;
  setCurrentUser: (user: UserProfile | null) => void;
  allUsers: UserProfile[];
  isLoading: boolean;
  headerTitle: string;
  setHeaderTitle: (title: string) => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const MOCK_USERS: UserProfile[] = [
  {
    id: 'admin-user',
    email: 'admin@example.com',
    name: 'Admin User',
    system_role: 'admin',
    role: 'admin',
    avatar: 'https://picsum.photos/seed/admin/32/32'
  },
  {
    id: 'pm-user',
    email: 'pm@example.com',
    name: 'Project Manager',
    system_role: 'pm',
    role: 'pm',
    avatar: 'https://picsum.photos/seed/pm/32/32'
  },
  {
    id: 'regular-user',
    email: 'user@example.com',
    name: 'Regular User',
    system_role: 'user',
    role: 'user',
    avatar: 'https://picsum.photos/seed/user/32/32'
  }
];

// Mock service functions
const getUserProfile = async (id: string) => MOCK_USERS.find(u => u.id === id) || null;
const getAllUsers = async () => MOCK_USERS;
const saveUserProfile = async (user: UserProfile) => {};

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [headerTitle, setHeaderTitle] = useState('Dashboard');

  useEffect(() => {
    const initUser = async () => {
      try {
        // Set default user if none selected
        const savedUserId = localStorage.getItem('selectedUserId') || MOCK_USERS[0].id;
        let profile = await getUserProfile(savedUserId);
        if (!profile) {
          profile = MOCK_USERS[0];
        }
        setCurrentUser(profile);
        
        const users = await getAllUsers();
        setAllUsers(users);
      } catch (err) {
        console.error('Failed to initialize user:', err);
      } finally {
        setIsLoading(false);
      }
    };

    initUser();
  }, []);

  const handleSetCurrentUser = (user: UserProfile | null) => {
    setCurrentUser(user);
    if (user) {
      localStorage.setItem('selectedUserId', user.id);
    } else {
      localStorage.removeItem('selectedUserId');
    }
  };

  return (
    <UserContext.Provider value={{ currentUser, setCurrentUser: handleSetCurrentUser, allUsers, isLoading, headerTitle, setHeaderTitle }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
