import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  ShieldCheck, UserPlus, Key, Mail, Loader2, X, AlertTriangle, 
  WifiOff, Phone, MapPin, Calendar, HeartPulse, CheckCircle2, Lock, 
  Edit2, Save, Search, UserCircle, ShieldAlert, Check
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { createClient } from '@supabase/supabase-js';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const systemUsersOptions = queryOptions({
  queryKey: ['system_users'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('name');
    if (error) throw error;
    return data || [];
  },
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

export const Route = createFileRoute('/settings/access')({
  loader: async ({ context: { queryClient } }) => {
    // @ts-ignore
    if (queryClient) await queryClient.ensureQueryData(systemUsersOptions);
  },
  component: AccessControlPage,
});

// ------------------------------------------------------------------
// 2. GRANULAR RBAC DEFINITIONS (5-Tier)
// ------------------------------------------------------------------
const ROLE_PERMISSIONS: Record<string, { desc: string, grants: string[], restrictions: string[] }> = {
  VOLUNTEER: {
    desc: "Entry-level operational access. Primarily read-only with basic logging capabilities.",
    grants: ["Read Daily Logs", "Read Feeding Records", "View Staff Rotas"],
    restrictions: ["Cannot write clinical records", "Cannot alter animal profiles", "Cannot access HR or financial records"]
  },
  KEEPER: {
    desc: "Standard operational staff. Focused on daily animal husbandry, feeding, and maintenance.",
    grants: ["Read/Write Daily Logs", "Read/Write Feeding Records", "View Animal Profiles", "Log Enclosure Maintenance"],
    restrictions: ["Cannot alter clinical medical records", "Cannot access staff HR records", "Cannot approve animal transfers"]
  },
  SENIOR_KEEPER: {
    desc: "Elevated operational supervisor. Manages husbandry teams, clinical logs, and shift rosters.",
    grants: ["All Keeper Permissions", "Approve Internal Movements", "Create Rotas & Assign Shifts", "Access Clinical Records"],
    restrictions: ["Cannot manage user provisioning", "Cannot alter ZLA statutory settings"]
  },
  DIRECTOR: {
    desc: "Facility Director / Owner. Complete operational, financial, and logistical oversight.",
    grants: ["All Senior Keeper Permissions", "Financial & Audit Logs", "Alter ZLA Organization Profile", "Approve External Transfers"],
    restrictions: ["Cannot alter core database schemas directly"]
  },
  ADMIN: {
    desc: "System Administrator. Unrestricted root control over the StrixOS instance.",
    grants: ["Provision & Suspend Accounts", "Configure RBAC Matrices", "Access Raw Security Audits", "Bypass System Constraints"],
    restrictions: ["None (Root Level Access)"]
  }
};

const ROLE_TABS = ['ALL', 'ADMIN', 'DIRECTOR', 'SENIOR_KEEPER', 'KEEPER', 'VOLUNTEER'] as const;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  return isMobile;
}

// ------------------------------------------------------------------
// 3. MAIN COMPONENT
// ------------------------------------------------------------------
export function AccessControlPage() {
  const queryClient = useQueryClient();
  const { profile, hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const scrollParentRef = useRef<HTMLDivElement>(null);
  
  const [modalState, setModalState] = useState<{ isOpen: boolean, userToEdit?: any }>({ isOpen: false });
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Supabase Realtime Sync
  useEffect(() => {
    const channel = supabase.channel('system-users-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        queryClient.invalidateQueries({ queryKey: ['system_users'] });
      }).subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data: users = [], isLoading } = useQuery(systemUsersOptions);

  const filteredUsers = useMemo(() => {
    let result = users;

    if (roleFilter !== 'ALL') {
      result = result.filter((u: any) => u.role === roleFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((u: any) => 
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.role || '').toLowerCase().includes(q) ||
        (u.phone || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [users, roleFilter, searchQuery]);

  const rowVirtualizer = useVirtualizer({
    count: filteredUsers.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => isMobile ? 190 : 80,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const tableGridCols = "minmax(240px, 1.8fr) minmax(200px, 1.4fr) minmax(150px, 1fr) minmax(130px, 0.9fr) minmax(100px, 0.7fr)";

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'ADMIN': return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'DIRECTOR': return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'SENIOR_KEEPER': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'KEEPER': return 'bg-blue-50 text-blue-700 border-blue-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const isDirectorOrAdmin = ['DIRECTOR', 'ADMIN'].includes(profile?.role || '') || hasPermission('users:manage');

  if (!isDirectorOrAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <ShieldAlert size={48} className="mb-4 opacity-20 text-slate-500" />
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-800">Restricted Access Area</h2>
        <p className="text-xs font-medium text-slate-500 mt-1 max-w-sm text-center">Only Directors and Administrators hold provisioning permissions for StrixOS user credentials.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col space-y-4 animate-in fade-in duration-300 relative">
      
      {!isOnline && (
        <div className="bg-rose-50 border border-rose-200 p-3.5 rounded-xl flex items-center gap-3 text-rose-800 text-xs font-bold shrink-0 shadow-sm">
          <WifiOff size={16} className="text-rose-600 shrink-0" />
          <span>Offline Mode: Managing secure user identities requires an active network connection to Supabase Auth.</span>
        </div>
      )}

      {/* --- CONTROLS BAR --- */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shrink-0">
        <div className="relative flex-1 min-w-[200px] w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
          <input 
            type="text" 
            placeholder="Search staff by name, email, phone, role..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all shadow-sm placeholder:text-slate-400"
          />
        </div>

        <button 
          onClick={() => setModalState({ isOpen: true, userToEdit: null })}
          disabled={!isOnline}
          className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0 w-full sm:w-auto"
        >
          <UserPlus size={14} className="text-emerald-400" />
          <span>Provision Account</span>
        </button>
      </div>

      {/* --- ROLE PILL TABS --- */}
      <div className="flex gap-1.5 w-full shrink-0 overflow-x-auto pb-1 custom-scrollbar">
        {ROLE_TABS.map((role) => (
          <button
            key={role}
            onClick={() => setRoleFilter(role)}
            className={`px-3 py-1.5 rounded-xl text-[9px] lg:text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all shadow-sm flex items-center justify-center gap-1.5 shrink-0 ${
              roleFilter === role 
                ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20' 
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
            }`}
          >
            {role.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* --- DATA GRID --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden relative">
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
            <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
              <Loader2 className="animate-spin text-slate-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Syncing Staff Identities...</span>
            </div>
          </div>
        )}

        <div ref={scrollParentRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50/30">
          
          {/* Desktop Table Header */}
          <div className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
            <div className="px-5 py-3.5 flex items-center justify-start text-left">Staff Member</div>
            <div className="px-5 py-3.5 flex items-center justify-start text-left">Contact</div>
            <div className="px-5 py-3.5 flex items-center justify-start text-left">System Role</div>
            <div className="px-5 py-3.5 flex items-center justify-start text-left">Offline PIN</div>
            <div className="px-5 py-3.5 flex items-center justify-end text-right">Actions</div>
          </div>

          <div className="p-3 lg:p-0">
            {filteredUsers.length === 0 && !isLoading ? (
              <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center h-full">
                <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mb-3 border border-slate-200 shadow-sm">
                  <ShieldCheck size={24} className="text-slate-400" />
                </div>
                <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">No staff profiles found</p>
                <p className="text-[10px] font-medium text-slate-400">Try adjusting your search query or role filter.</p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const u = filteredUsers[virtualRow.index];
                  const isSuspended = u.is_active === false;

                  return (
                    <div 
                      key={u.id} 
                      className={`absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border border-slate-200 lg:border-none lg:border-b border-b-slate-100 rounded-xl lg:rounded-none p-3.5 lg:p-0 transition-colors shadow-sm lg:shadow-none gap-3 lg:gap-0 box-border ${
                        isSuspended ? 'bg-rose-50/20 hover:bg-rose-50/40' : 'bg-white hover:bg-slate-50'
                      }`}
                      style={{ 
                        gridTemplateColumns: isMobile ? '1fr' : tableGridCols,
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
                      {/* 1. Staff Identity Block */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-2 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Staff Member</div>}
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-black text-slate-700 uppercase shrink-0 shadow-sm">
                            {u.initials || u.name?.substring(0, 2) || 'U'}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-xs lg:text-sm font-bold text-slate-900 truncate" title={u.name}>
                                {u.name}
                              </p>
                              {isSuspended && (
                                <span className="px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 text-[8px] uppercase tracking-widest font-black shrink-0 border border-rose-200">
                                  Suspended
                                </span>
                              )}
                            </div>
                            <p className="text-[9px] font-bold text-slate-400 font-mono tracking-wide mt-0.5">
                              UID: {u.id?.substring(0, 8)}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* 2. Contact Details */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Contact</div>}
                        <div className="space-y-0.5 min-w-0 w-full pr-2">
                          <p className="text-xs font-medium text-slate-700 truncate" title={u.email}>
                            {u.email || <span className="text-slate-400 italic text-[10px]">No email</span>}
                          </p>
                          <p className="text-[10px] font-bold text-slate-500 truncate" title={u.phone}>
                            {u.phone || <span className="text-slate-400 font-normal text-[10px]">No phone</span>}
                          </p>
                        </div>
                      </div>

                      {/* 3. System Role */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Role</div>}
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border shadow-sm w-fit ${getRoleBadge(u.role)}`}>
                          {u.role ? u.role.replace(/_/g, ' ') : 'VOLUNTEER'}
                        </span>
                      </div>

                      {/* 4. Offline PIN */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Tablet PIN</div>}
                        <div className="flex items-center gap-1.5">
                          <Key size={12} className={u.pin ? "text-emerald-600 shrink-0" : "text-slate-300 shrink-0"} />
                          <span className="font-mono text-xs font-bold text-slate-700 tracking-widest">
                            {u.pin ? '••••' : <span className="text-[10px] text-slate-400 uppercase font-sans tracking-normal">Unset</span>}
                          </span>
                        </div>
                      </div>

                      {/* 5. Actions */}
                      <div className={`w-full lg:px-5 lg:py-3.5 flex min-w-0 ${isMobile ? 'justify-end pt-2 border-t border-slate-100 mt-1' : 'items-center justify-end'}`}>
                        <button 
                          onClick={() => setModalState({ isOpen: true, userToEdit: u })}
                          className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
                          title="Edit User Profile & Permissions"
                        >
                          <Edit2 size={15} />
                        </button>
                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {modalState.isOpen && (
        <UnifiedUserModal 
          existingUser={modalState.userToEdit}
          onClose={() => setModalState({ isOpen: false })} 
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// 4. UNIFIED MODAL (CREATE & EDIT)
// ------------------------------------------------------------------
function UnifiedUserModal({ existingUser, onClose }: { existingUser?: any, onClose: () => void }) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const isEditing = !!existingUser;

  const mutation = useMutation({
    mutationFn: async (payload: any) => {
      let targetUserId = existingUser?.id;

      // SCENARIO 1: NEW USER PROVISIONING VIA SUPABASE AUTH
      if (!isEditing) {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

        if (!supabaseUrl || !supabaseAnonKey) {
          throw new Error('Critical Infrastructure Failure: Missing Supabase Environment Variables');
        }

        const authClient = createClient(supabaseUrl, supabaseAnonKey, { 
          auth: { persistSession: false, autoRefreshToken: false } 
        });

        const { data: authData, error: authError } = await authClient.auth.signUp({
          email: payload.email,
          password: payload.password,
        });

        if (authError) throw authError;
        if (!authData.user) throw new Error("Authentication identity creation failed.");
        targetUserId = authData.user.id;
      }

      // SCENARIO 2: DATABASE UPSERT
      const initials = payload.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();
      
      const dbPayload = {
        id: targetUserId,
        email: payload.email, 
        name: payload.name,
        initials: initials,
        role: payload.role,
        pin: payload.pin || null,
        phone: payload.phone || null,
        address: payload.address || null,
        dob: payload.dob || null,
        emergency_contact_name: payload.emergency_contact_name || null,
        emergency_contact_phone: payload.emergency_contact_phone || null,
        start_date: payload.start_date || null,
        hr_notes: payload.hr_notes || null,
        is_active: payload.is_active
      };

      const { error: dbError } = await supabase.from('users').upsert([dbPayload]);
      if (dbError) throw dbError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system_users'] });
      toast.success(isEditing ? 'Staff profile updated.' : 'New account provisioned successfully.');
      onClose();
    },
    onError: (err: any) => setErrorMsg(err.message || `Failed to ${isEditing ? 'update' : 'provision'} account.`)
  });

  const form = useForm({
    defaultValues: { 
      name: existingUser?.name || '', 
      email: existingUser?.email || '', 
      password: '', 
      role: existingUser?.role || 'KEEPER', 
      pin: existingUser?.pin || '',
      phone: existingUser?.phone || '', 
      address: existingUser?.address || '', 
      dob: existingUser?.dob || '', 
      emergency_contact_name: existingUser?.emergency_contact_name || '', 
      emergency_contact_phone: existingUser?.emergency_contact_phone || '', 
      start_date: existingUser?.start_date || new Date().toISOString().split('T')[0], 
      hr_notes: existingUser?.hr_notes || '',
      is_active: existingUser?.is_active ?? true
    },
    onSubmit: async ({ value }) => {
      setErrorMsg(null);
      if (value.pin && value.pin.length !== 4) {
        setErrorMsg("Offline PIN must be exactly 4 numeric digits.");
        return;
      }
      if (!isEditing && (!value.password || value.password.length < 6)) {
        setErrorMsg("New accounts require a temporary password (min 6 characters).");
        return;
      }
      await mutation.mutateAsync(value);
    }
  });

  const inputClass = "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs lg:text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/20 transition-all shadow-sm placeholder:text-slate-400";
  const disabledClass = "opacity-60 bg-slate-100 cursor-not-allowed";
  const labelClass = "block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5";
  const sectionTitleClass = "text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2 mb-3 pb-1.5 border-b border-slate-100";

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-sans overflow-y-auto custom-scrollbar">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-5xl flex flex-col shadow-2xl relative overflow-hidden my-auto animate-in zoom-in-95 duration-200 max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="bg-slate-50 border-b border-slate-100 p-5 flex justify-between items-center z-20 shrink-0 rounded-t-2xl">
          <div>
            <h2 className="text-base lg:text-lg font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
              {isEditing ? <Edit2 size={18} className="text-slate-700" /> : <UserPlus size={18} className="text-slate-700" />}
              {isEditing ? 'Edit Staff Profile' : 'Comprehensive Staff Onboarding'}
            </h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
              {isEditing ? `Managing UID: ${existingUser.id.substring(0, 8)}` : 'Guided account generation & HR profile setup'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        
        {/* Modal Body: Form Left + RBAC Inspector Right */}
        <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-hidden">
          
          {/* LEFT: The Form */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-white">
            <form id="provisioning-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="space-y-6">
              
              {errorMsg && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-bold flex items-center gap-2 shadow-sm">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* 1. Authentication */}
              <div>
                <h3 className={sectionTitleClass}>
                  <Lock size={14} className="text-slate-400" /> Authentication Credentials
                </h3>
                {isEditing && (
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-3 bg-amber-50 p-2 rounded-lg border border-amber-200">
                    Primary login credentials are locked by Supabase Auth security policies.
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <form.Field name="email" children={(field) => (
                    <div>
                      <label className={labelClass}>Login Email *</label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input type="email" required disabled={isEditing} placeholder="staff@kentowlacademy.com" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={`${inputClass} pl-9 ${isEditing ? disabledClass : ''}`} />
                      </div>
                    </div>
                  )} />
                  <form.Field name="password" children={(field) => (
                    <div>
                      <label className={labelClass}>{isEditing ? 'Password (Locked)' : 'Temporary Password *'}</label>
                      <div className="relative">
                        <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input type="password" required={!isEditing} disabled={isEditing} placeholder={isEditing ? '••••••••' : 'Min. 6 characters'} value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={`${inputClass} pl-9 font-mono ${isEditing ? disabledClass : ''}`} />
                      </div>
                    </div>
                  )} />
                  <form.Field name="pin" children={(field) => (
                    <div className="md:col-span-2">
                      <label className={labelClass}>Offline Tablet PIN (Optional 4 Digits)</label>
                      <input type="password" maxLength={4} placeholder="e.g. 1234" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value.replace(/\D/g, ''))} className={`${inputClass} font-mono tracking-widest`} />
                    </div>
                  )} />
                </div>
              </div>

              {/* 2. Personal Details */}
              <div>
                <h3 className={sectionTitleClass}>
                  <UserCircle size={14} className="text-slate-400" /> Personal Identity
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <form.Field name="name" children={(field) => (
                    <div className="md:col-span-2">
                      <label className={labelClass}>Full Legal Name *</label>
                      <input required placeholder="e.g. Jane Smith" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                    </div>
                  )} />
                  <form.Field name="phone" children={(field) => (
                    <div>
                      <label className={labelClass}>Mobile Number</label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input type="tel" placeholder="+44 7000 000000" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={`${inputClass} pl-9`} />
                      </div>
                    </div>
                  )} />
                  <form.Field name="dob" children={(field) => (
                    <div>
                      <label className={labelClass}>Date of Birth</label>
                      <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input type="date" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={`${inputClass} pl-9`} />
                      </div>
                    </div>
                  )} />
                  <form.Field name="address" children={(field) => (
                    <div className="md:col-span-2">
                      <label className={labelClass}>Home Address</label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-3 text-slate-400" size={14} />
                        <textarea rows={2} placeholder="Full physical residential address..." value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={`${inputClass} pl-9 py-2 resize-none h-16`} />
                      </div>
                    </div>
                  )} />
                </div>
              </div>

              {/* 3. Emergency & HR */}
              <div>
                <h3 className={sectionTitleClass}>
                  <HeartPulse size={14} className="text-slate-400" /> Emergency Contact & Employment Status
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <form.Field name="emergency_contact_name" children={(field) => (
                    <div>
                      <label className={labelClass}>Emergency Contact Name</label>
                      <input type="text" placeholder="e.g. John Smith (Partner)" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                    </div>
                  )} />
                  <form.Field name="emergency_contact_phone" children={(field) => (
                    <div>
                      <label className={labelClass}>Emergency Contact Phone</label>
                      <input type="tel" placeholder="Primary emergency phone" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                    </div>
                  )} />
                  <form.Field name="start_date" children={(field) => (
                    <div>
                      <label className={labelClass}>Employment Start Date *</label>
                      <input type="date" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                    </div>
                  )} />
                  {isEditing && (
                    <form.Field name="is_active" children={(field) => (
                      <div>
                        <label className={labelClass}>Account Status</label>
                        <select value={field.state.value ? 'true' : 'false'} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value === 'true')} className={inputClass}>
                          <option value="true">ACTIVE (Operational)</option>
                          <option value="false">SUSPENDED (Access Revoked)</option>
                        </select>
                      </div>
                    )} />
                  )}
                  <form.Field name="hr_notes" children={(field) => (
                    <div className="md:col-span-2">
                      <label className={labelClass}>HR Notes / Medical Disclosures</label>
                      <textarea rows={2} placeholder="Allergies, relevant health conditions, or confidential HR records..." value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={`${inputClass} resize-none h-16`} />
                    </div>
                  )} />
                </div>
              </div>

            </form>
          </div>

          {/* RIGHT: Granular RBAC Visualizer */}
          <div className="w-full lg:w-88 bg-slate-50/80 border-t lg:border-t-0 lg:border-l border-slate-200 p-5 flex flex-col shrink-0 justify-between">
            <div className="space-y-4">
              <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                <ShieldCheck size={16} className="text-slate-700" /> RBAC Permission Scope
              </h3>

              <form.Subscribe selector={(state) => state.values.role}>
                {(selectedRole) => {
                  const matrix = ROLE_PERMISSIONS[selectedRole] || ROLE_PERMISSIONS['KEEPER'];

                  return (
                    <div className="space-y-4">
                      <form.Field name="role" children={(field) => (
                        <div>
                          <label className={labelClass}>Assigned System Role *</label>
                          <select required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none shadow-sm cursor-pointer uppercase">
                            <option value="VOLUNTEER">VOLUNTEER</option>
                            <option value="KEEPER">KEEPER</option>
                            <option value="SENIOR_KEEPER">SENIOR KEEPER</option>
                            <option value="DIRECTOR">DIRECTOR</option>
                            <option value="ADMIN">SYSTEM ADMIN</option>
                          </select>
                        </div>
                      )} />

                      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-3.5 space-y-3.5 text-xs">
                        <p className="text-[11px] font-medium text-slate-600 leading-relaxed border-b border-slate-100 pb-3">
                          {matrix.desc}
                        </p>

                        <div>
                          <h4 className="text-[9px] font-black text-emerald-700 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                            <CheckCircle2 size={11} className="text-emerald-600" /> Standard Capabilities
                          </h4>
                          <ul className="space-y-1">
                            {matrix.grants.map((grant, idx) => (
                              <li key={idx} className="text-[10px] font-bold text-slate-700 flex items-start gap-1.5">
                                <span className="text-emerald-500 font-black">•</span> {grant}
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div>
                          <h4 className="text-[9px] font-black text-rose-700 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                            <Lock size={11} className="text-rose-600" /> Hard Restrictions
                          </h4>
                          <ul className="space-y-1">
                            {matrix.restrictions.map((restriction, idx) => (
                              <li key={idx} className="text-[10px] font-bold text-slate-500 flex items-start gap-1.5">
                                <span className="text-rose-500 font-black">×</span> {restriction}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  );
                }}
              </form.Subscribe>
            </div>

            {/* Footer Form Action */}
            <div className="pt-4 border-t border-slate-200/80 mt-4">
              <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                {([canSubmit, isSubmitting]) => (
                  <button 
                    type="submit" 
                    form="provisioning-form" 
                    disabled={!canSubmit || isSubmitting as boolean || mutation.isPending} 
                    className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-5 py-3 rounded-xl font-black uppercase text-xs tracking-widest transition-all shadow-md active:scale-95"
                  >
                    {(isSubmitting || mutation.isPending) ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : isEditing ? (
                      <><Save size={14} className="text-emerald-400" /> Save Profile</>
                    ) : (
                      <><UserPlus size={14} className="text-emerald-400" /> Provision Account</>
                    )}
                  </button>
                )}
              </form.Subscribe>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

export default AccessControlPage;