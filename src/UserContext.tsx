import * as React from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import type { TeamMember as UserProfile } from './types';

interface UserContextType {
  // Supabase Auth
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;

  // Legacy / app-level user profile (mapped from Supabase user + allUsers list)
  currentUser: UserProfile | null;
  setCurrentUser: (user: UserProfile | null) => void;
  allUsers: UserProfile[];
  isLoading: boolean;
  headerTitle: string;
  setHeaderTitle: (title: string) => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

/** Map a Supabase User to a minimal UserProfile so existing pages keep working. */
function mapSupabaseUserToProfile(supabaseUser: User): UserProfile {
  const meta = supabaseUser.user_metadata ?? {};
  return {
    id: supabaseUser.id,
    email: supabaseUser.email ?? '',
    name: meta.full_name ?? meta.name ?? (supabaseUser.email?.split('@')[0] ?? 'User'),
    system_role: (meta.system_role as UserProfile['system_role']) ?? 'user',
    role: meta.role ?? 'user',
    avatar: meta.avatar_url ?? meta.picture ?? `https://picsum.photos/seed/${supabaseUser.id}/32/32`,
    phone: meta.phone ?? '',
    address: meta.address ?? '',
    jobTitle: meta.jobTitle ?? '',
    department: meta.department ?? '',
    senderOption: meta.senderOption ?? 'agency',
    defaultEmailTemplate: meta.defaultEmailTemplate ?? '',
  };
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentUser, setCurrentUserState] = useState<UserProfile | null>(null);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [headerTitle, setHeaderTitle] = useState('Dashboard');

  // Restore session on mount and subscribe to auth state changes
  useEffect(() => {
    // Get existing session
    supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
      setSession(existingSession);
      const supabaseUser = existingSession?.user ?? null;
      setUser(supabaseUser);
      if (supabaseUser) {
        setCurrentUserState(mapSupabaseUserToProfile(supabaseUser));
        setAllUsers([mapSupabaseUserToProfile(supabaseUser)]);
      }
      setLoading(false);
    });

    // Listen for auth changes (login, logout, token refresh, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      const supabaseUser = newSession?.user ?? null;
      setUser(supabaseUser);
      if (supabaseUser) {
        const profile = mapSupabaseUserToProfile(supabaseUser);
        setCurrentUserState(profile);
        setAllUsers([profile]);
      } else {
        setCurrentUserState(null);
        setAllUsers([]);
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSetCurrentUser = (updatedUser: UserProfile | null) => {
    setCurrentUserState(updatedUser);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // isLoading is an alias for loading to keep backward compat with any consumers
  const isLoading = loading;

  return (
    <UserContext.Provider value={{
      user,
      session,
      loading,
      signOut,
      currentUser,
      setCurrentUser: handleSetCurrentUser,
      allUsers,
      isLoading,
      headerTitle,
      setHeaderTitle,
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
