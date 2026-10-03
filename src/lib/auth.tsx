import { 
  createContext, 
  useContext, 
  useEffect, 
  useState, 
  useCallback, 
  useMemo, 
  type ReactNode 
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useQuery, useQueryClient, queryOptions } from '@tanstack/react-query';
import { get, set, del } from 'idb-keyval';
import { supabase } from './supabase';
import { toast } from 'sonner';

// --- Configuration & Constants ---
const SECURITY_HEARTBEAT_TTL_MS = 72 * 60 * 60 * 1000; // 72-hour offline GDPR limit
const HEARTBEAT_STORAGE_KEY = 'strixos_last_auth_heartbeat';
const HEARTBEAT_CHECK_INTERVAL_MS = 60 * 1000; // Evaluate expiration every minute
const AUTH_SESSION_KEY = 'strix-auth-session';

export interface UserProfile {
  id: string;
  name: string | null;
  initials: string | null;
  pin: string | null;
  role: string | null;
  avatar_url?: string;
  phone?: string;
  emergency_contact_phone?: string;
  is_active?: boolean;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isLocked: boolean;
  hasPermission: (permission: string | string[], showToastOnDenied?: boolean) => boolean;
  checkAccess: (allowedRoles: string[]) => boolean;
  lockSession: () => void;
  unlockSession: (pinCode: string) => boolean;
  logout: (isExpired?: boolean) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ------------------------------------------------------------------
// 1. RBAC PERMISSIONS QUERY
// ------------------------------------------------------------------
export const getPermissionsQueryOptions = (role?: string | null) => {
  const normalizedRole = role ? role.toUpperCase().trim() : 'ANONYMOUS';
  return queryOptions({
    queryKey: ['rbac_permissions', normalizedRole],
    queryFn: async () => {
      if (!role) return [];

      if (normalizedRole === 'ADMIN' || normalizedRole === 'DIRECTOR') {
        return ['*'];
      }

      const { data, error } = await supabase
        .from('rbac_matrix')
        .select('permissions')
        .ilike('role', normalizedRole)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.warn('[RBAC Matrix Query Notice]:', error.message);
      }

      if (!data?.permissions) return [];

      let perms: string[] = [];
      if (Array.isArray(data.permissions)) {
        perms = data.permissions;
      } else if (typeof data.permissions === 'string') {
        try {
          const parsed = JSON.parse(data.permissions);
          if (Array.isArray(parsed)) {
            perms = parsed;
          } else {
            perms = data.permissions.split(',').map((s: string) => s.trim().replace(/^["']|["']$/g, ''));
          }
        } catch {
          perms = data.permissions.split(',').map((s: string) => s.trim().replace(/^["'\[\]]|["'\[\]]$/g, ''));
        }
      }

      return perms.filter(Boolean);
    },
    enabled: Boolean(role),
    networkMode: 'offlineFirst',
    staleTime: 1000 * 60 * 15,
    gcTime: 1000 * 60 * 60 * 24 * 14,
    meta: { persist: true },
  });
};

// ------------------------------------------------------------------
// 2. USER PROFILE QUERY
// ------------------------------------------------------------------
export const getUserProfileQueryOptions = (userId?: string | null) => queryOptions({
  queryKey: ['userProfile', userId],
  queryFn: async () => {
    if (!userId) return null;
    const { data, error } = await supabase
      .from('users')
      .select('id, name, initials, pin, role, avatar_url, phone, is_active')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.warn('[UserProfile Query Notice]:', error.message);
      const cached = await get('strix-user-profile');
      return (cached || null) as UserProfile | null;
    }

    if (data) {
      await set('strix-user-profile', data);
    }
    return data as UserProfile;
  },
  enabled: Boolean(userId),
  networkMode: 'offlineFirst',
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 14,
  meta: { persist: true },
});

// ------------------------------------------------------------------
// 3. AUTH PROVIDER COMPONENT
// ------------------------------------------------------------------
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);

  const logout = useCallback(async (isExpired = false) => {
    await supabase.auth.signOut().catch(() => {});
    await del(AUTH_SESSION_KEY);
    await del('strix-user-profile');
    localStorage.removeItem(HEARTBEAT_STORAGE_KEY);
    localStorage.removeItem('strix-is-locked');
    
    queryClient.clear();
    setSession(null);
    setUser(null);

    if (isExpired) {
      toast.error('Security session expired (72h offline limit reached). Logged out for data protection.');
    }
  }, [queryClient]);

  // Evaluates whether the device has exceeded 72 hours offline without server validation
  const evaluateSecurityHeartbeat = useCallback(() => {
    const rawHeartbeat = localStorage.getItem(HEARTBEAT_STORAGE_KEY);
    const now = Date.now();

    if (navigator.onLine) {
      localStorage.setItem(HEARTBEAT_STORAGE_KEY, now.toString());
      return;
    }

    if (rawHeartbeat) {
      const lastHeartbeat = parseInt(rawHeartbeat, 10);
      if (now - lastHeartbeat > SECURITY_HEARTBEAT_TTL_MS) {
        logout(true);
      }
    } else {
      localStorage.setItem(HEARTBEAT_STORAGE_KEY, now.toString());
    }
  }, [logout]);

  // Auth Initialization & Realtime Subscription
  useEffect(() => {
    let isMounted = true;

    const initializeAuth = async () => {
      try {
        const { data: { session: nativeSession } } = await supabase.auth.getSession();
        let activeSession = nativeSession;
        
        if (!activeSession) {
          const cachedSession = await get(AUTH_SESSION_KEY);
          if (cachedSession) {
            await supabase.auth.setSession(cachedSession);
            activeSession = cachedSession;
          }
        }

        if (isMounted) {
          setSession(activeSession ?? null);
          setUser(activeSession?.user ?? null);
          
          if (activeSession?.user) {
            evaluateSecurityHeartbeat();
          }
        }
      } catch (error) {
        console.error('[Auth Engine] Initialization failed:', error);
      } finally {
        if (isMounted) setIsSessionLoading(false);
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (newSession?.user) {
        setSession(newSession);
        setUser(newSession.user);
        await set(AUTH_SESSION_KEY, newSession);
        localStorage.setItem(HEARTBEAT_STORAGE_KEY, Date.now().toString());
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        await del(AUTH_SESSION_KEY);
        await del('strix-user-profile');
        localStorage.removeItem(HEARTBEAT_STORAGE_KEY);
        localStorage.removeItem('strix-is-locked');
        queryClient.clear();
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [queryClient, evaluateSecurityHeartbeat]);

  // 72-Hour Security Heartbeat Listeners (Interval, Online event, Page Focus)
  useEffect(() => {
    if (!user) return;

    evaluateSecurityHeartbeat();

    const interval = setInterval(evaluateSecurityHeartbeat, HEARTBEAT_CHECK_INTERVAL_MS);
    const handleOnline = () => evaluateSecurityHeartbeat();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        evaluateSecurityHeartbeat();
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user, evaluateSecurityHeartbeat]);

  // Query Profile & RBAC Permissions
  const { data: profile, status: profileStatus } = useQuery(getUserProfileQueryOptions(user?.id));
  const { data: rawPermissions = [] } = useQuery(getPermissionsQueryOptions(profile?.role));

  const activePermissionsSet = useMemo(() => {
    const set = new Set<string>();
    rawPermissions.forEach((p: string) => {
      if (!p) return;
      const trimmed = p.trim();
      set.add(trimmed);
      const lower = trimmed.toLowerCase();
      set.add(lower);

      if (lower.startsWith('voucher:')) {
        set.add(lower.replace('voucher:', 'vouchers:'));
      } else if (lower.startsWith('vouchers:')) {
        set.add(lower.replace('vouchers:', 'voucher:'));
      }
    });
    return set;
  }, [rawPermissions]);

  // Permission Verification (No lockout check)
  const hasPermission = useCallback((permission: string | string[], showToastOnDenied = false): boolean => {
    if (profileStatus === 'pending') return false; 
    if (!profile && !session) return false;

    const normalizedRole = (profile?.role || session?.user?.user_metadata?.role || '').toUpperCase().trim();
    const isRootRole = normalizedRole === 'ADMIN' || normalizedRole === 'DIRECTOR';
    
    if (isRootRole || activePermissionsSet.has('*')) return true;

    const checkSingle = (perm: string): boolean => {
      if (!perm) return false;
      const trimmed = perm.trim();
      const lower = trimmed.toLowerCase();

      return (
        activePermissionsSet.has(trimmed) ||
        activePermissionsSet.has(lower) ||
        (lower.startsWith('vouchers:') && activePermissionsSet.has(lower.replace('vouchers:', 'voucher:'))) ||
        (lower.startsWith('voucher:') && activePermissionsSet.has(lower.replace('voucher:', 'vouchers:')))
      );
    };

    const allowed = Array.isArray(permission)
      ? permission.some(checkSingle)
      : checkSingle(permission);

    if (!allowed && showToastOnDenied) {
      toast.error('Unauthorized Access');
    }

    return allowed;
  }, [profile, session, profileStatus, activePermissionsSet]);

  const checkAccess = useCallback((allowedRoles: string[]): boolean => {
    if (!profile) return false;
    const normalizedRole = profile.role?.toUpperCase().trim() || '';
    if (normalizedRole === 'ADMIN' || normalizedRole === 'DIRECTOR') return true;
    return allowedRoles.map((r) => r.toUpperCase().trim()).includes(normalizedRole);
  }, [profile]);

  const isFullyLoading = isSessionLoading || (Boolean(user) && profileStatus === 'pending');

  const contextValue = useMemo(() => ({
    session,
    user,
    profile: profile || null,
    isLoading: isFullyLoading,
    isLocked: false, // Inactivity lock removed
    hasPermission,
    checkAccess,
    lockSession: () => {}, // Safe no-op for backward compatibility
    unlockSession: () => true, // Safe no-op for backward compatibility
    logout: () => logout(false),
    signOut: () => logout(false),
  }), [session, user, profile, isFullyLoading, hasPermission, checkAccess, logout]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthProvider;