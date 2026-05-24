import * as React from 'react';
import { createContext, useContext, useState, useEffect } from 'react';
import type { Session, User } from '@supabase/supabase-js';
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
  tenantPlan: string;
  trialEndsAt: string | null;
  isTrialExpired: boolean;
  refreshBillingStatus: () => Promise<void>;
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

async function loadFullProfile(session: Session): Promise<UserProfile> {
  const base = mapSupabaseUser(session.user);
  try {
    const res = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return base;
    const profile = await res.json();
    if (!profile) return base;
    return {
      ...base,
      // Custom avatar overrides OAuth avatar if set
      avatar: profile.avatar || base.avatar,
      phone: profile.phone ?? undefined,
      address: profile.address ?? undefined,
      jobTitle: profile.jobTitle ?? undefined,
      department: profile.department ?? undefined,
      senderOption: profile.senderOption ?? undefined,
      defaultEmailTemplate: profile.defaultEmailTemplate ?? undefined,
    };
  } catch {
    return base;
  }
}

async function loadBillingStatus(session: Session): Promise<{ plan: string; trial_ends_at: string | null; is_expired: boolean }> {
  try {
    const res = await fetch('/api/billing/status', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return { plan: 'trial', trial_ends_at: null, is_expired: false };
    const data = await res.json();
    return {
      plan: data.plan || 'trial',
      trial_ends_at: data.trial_ends_at ?? null,
      is_expired: !!data.is_expired,
    };
  } catch {
    return { plan: 'trial', trial_ends_at: null, is_expired: false };
  }
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [headerTitle, setHeaderTitle] = useState('Dashboard');
  const [tenantPlan, setTenantPlan] = useState('trial');
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [isTrialExpired, setIsTrialExpired] = useState(false);
  const sessionRef = React.useRef<Session | null>(null);

  const refreshBillingStatus = React.useCallback(async () => {
    if (!sessionRef.current) return;
    const billing = await loadBillingStatus(sessionRef.current);
    setTenantPlan(billing.plan);
    setTrialEndsAt(billing.trial_ends_at);
    setIsTrialExpired(billing.is_expired);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error) {
        supabase.auth.signOut();
        setCurrentUser(null);
      } else if (session) {
        sessionRef.current = session;
        const [user, billing] = await Promise.all([loadFullProfile(session), loadBillingStatus(session)]);
        setCurrentUser(user);
        setTenantPlan(billing.plan);
        setTrialEndsAt(billing.trial_ends_at);
        setIsTrialExpired(billing.is_expired);
      } else {
        setCurrentUser(null);
      }
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      sessionRef.current = session;
      if (session) {
        const [user, billing] = await Promise.all([loadFullProfile(session), loadBillingStatus(session)]);
        setCurrentUser(user);
        setTenantPlan(billing.plan);
        setTrialEndsAt(billing.trial_ends_at);
        setIsTrialExpired(billing.is_expired);
      } else {
        setCurrentUser(null);
      }
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
      tenantPlan,
      trialEndsAt,
      isTrialExpired,
      refreshBillingStatus,
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
