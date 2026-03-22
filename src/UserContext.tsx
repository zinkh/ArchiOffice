import * as React from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
import type { TeamMember } from './types';

interface UserContextType {
  currentUser: TeamMember | null;
  setCurrentUser: (user: TeamMember | null) => void;
  allUsers: TeamMember[];
  isLoading: boolean;
  headerTitle: string;
  setHeaderTitle: (title: string) => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<TeamMember | null>(null);
  const [allUsers, setAllUsers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [headerTitle, setHeaderTitle] = useState('Dashboard');

  useEffect(() => {
    fetch('/api/team')
      .then(async res => {
        const contentType = res.headers.get('content-type');
        if (!res.ok || !contentType || !contentType.includes('application/json')) {
          const text = await res.text();
          if (text.includes('Please wait while your application starts')) {
            throw new Error('Server starting');
          }
          throw new Error(`Failed to fetch team: ${res.status} ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        setAllUsers(data);
        // Default to the first user (admin in seed data)
        if (data.length > 0) {
          setCurrentUser(data[0]);
        }
        setIsLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch users:', err);
        // If it's just starting, we might want to retry after a delay
        if (err.message === 'Server starting') {
          setTimeout(() => {
            // This is a simple retry, but in a real app you might want something more robust
            window.location.reload();
          }, 3000);
        } else {
          setIsLoading(false);
        }
      });
  }, []);

  return (
    <UserContext.Provider value={{ currentUser, setCurrentUser, allUsers, isLoading, headerTitle, setHeaderTitle }}>
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
