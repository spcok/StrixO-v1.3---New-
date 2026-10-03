import { createClient } from '@supabase/supabase-js';
import { get, set, del } from 'idb-keyval';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Critical Infrastructure Failure: Missing Supabase Environment Variables');
}

// Deterministic adapter: uses IndexedDB, falling back to localStorage only if IDB is disabled/blocked
let idbBlocked = false;

const customStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (!idbBlocked) {
      try {
        const val = await get(key);
        if (val !== undefined) return val;
      } catch {
        idbBlocked = true;
      }
    }
    try {
      return typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (!idbBlocked) {
      try {
        await set(key, value);
        return;
      } catch {
        idbBlocked = true;
      }
    }
    try {
      if (typeof window !== 'undefined') localStorage.setItem(key, value);
    } catch {}
  },
  removeItem: async (key: string): Promise<void> => {
    if (!idbBlocked) {
      try {
        await del(key);
        return;
      } catch {
        idbBlocked = true;
      }
    }
    try {
      if (typeof window !== 'undefined') localStorage.removeItem(key);
    } catch {}
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  },
});

export default supabase;