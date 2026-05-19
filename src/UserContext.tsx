import * as React from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import type { TeamMember as UserProfile } from './types';
import { supabase } from './lib/supabase';

interface UserContextType {
  currentUser: UserProfile | null;
  setCurrentUser: (user: UserProfile | null) => void;
  allUsers: UserProfile[];
  isLoading: boolean;
  headerTitle: string;
  setHeaderTitle: (title: string) => void;
  signOut: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

function mapSupabaseUser(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email ?? '',
    name: user.user_metadata?.name ?? user.email?.split('@')[0] ?? 'Utilisateur',
    system_role: (user.app_metadata?.system_role as UserProfile['system_role']) ?? 'admin',
    role: user.user_metadata?.role ?? 'admin',
    avatar: user.user_metadata?.avatar_url,
  };
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [headerTitle, setHeaderTitle] = useState('Dashboard');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUser(session?.user ? mapSupabaseUser(session.user) : null);
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ? mapSupabaseUser(session.user) : null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
  };

  return (
    <UserContext.Provider value={{
      currentUser,
      setCurrentUser,
      allUsers: currentUser ? [currentUser] : [],
      isLoading,
      headerTitle,
      setHeaderTitle,
      signOut,
    }}>
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
