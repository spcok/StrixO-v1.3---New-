import React, { useState, useMemo, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  Plus, X, Search, Loader2, Trash2, Calendar, Clock, 
  MapPin, UserCircle, Users, User, AlertTriangle, Sparkles 
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const shiftsQueryOptions = queryOptions({
  queryKey: ['shifts_data'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('shifts')
      .select('*, users:user_id(id, name, role)')
      .order('start_time', { ascending: true });
    
    if (error) throw new Error(error.message);
    return data || [];
  },
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 14,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

const staffListQueryOptions = queryOptions({
  queryKey: ['staff_list'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, role, is_deleted, is_active')
      .order('name');
    
    if (error) throw new Error(error.message);
    return data || [];
  },
  staleTime: 1000 * 60 * 60,
  gcTime: 1000 * 60 * 60 * 24 * 14,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

// ------------------------------------------------------------------
// 2. ROUTE CONFIGURATION
// ------------------------------------------------------------------
export const Route = createFileRoute('/staff/shifts')({
  loader: async ({ context: { queryClient } }) => {
    if (queryClient) {
      // @ts-ignore
      await Promise.all([
        queryClient.ensureQueryData(shiftsQueryOptions),
        queryClient.ensureQueryData(staffListQueryOptions)
      ]);
    }
  },
  component: ShiftsModule,
});

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  React.useEffect(() => {
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
export function ShiftsModule() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const scrollParentRef = useRef<HTMLDivElement>(null);
  
  const [viewMode, setViewMode] = useState<'INDIVIDUAL' | 'GROUPED'>('INDIVIDUAL');
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // In-app confirmation states
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmWipeId, setConfirmWipeId] = useState<string | null>(null);
  const [confirmGlobalWipe, setConfirmGlobalWipe] = useState(false);

  // 1. Data Fetching
  const { data: shifts = [], isLoading: loadingShifts } = useQuery(shiftsQueryOptions);
  const { data: staffMembers = [], isLoading: loadingStaff } = useQuery(staffListQueryOptions);

  const isLoading = loadingShifts || loadingStaff;

  // 2. Mutations
  const deleteIndividualShift = useMutation({
    mutationFn: async (shiftId: string) => {
      const { error, count } = await supabase
        .from('shifts')
        .delete({ count: 'exact' })
        .eq('id', shiftId);

      if (error) throw new Error(error.message);
      if (count === 0) throw new Error("0 rows deleted. Record not found or action blocked.");
      return true;
    },
    onSuccess: () => {
      toast.success('Shift permanently deleted.');
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ['shifts_data'] });
      queryClient.invalidateQueries({ queryKey: ['rota_matrix'] });
    },
    onError: (err: Error) => {
      toast.error(`Delete Failed: ${err.message}`);
      setConfirmDeleteId(null);
    }
  });

  const wipeFutureShifts = useMutation({
    mutationFn: async (userId: string) => {
      const rightNow = new Date().toISOString();
      const { error, count } = await supabase
        .from('shifts')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .gt('start_time', rightNow);

      if (error) throw new Error(error.message);
      if (count === 0) throw new Error("No upcoming shifts found for this user.");
      return count;
    },
    onSuccess: (count) => {
      toast.success(`${count} upcoming shifts deleted.`);
      setConfirmWipeId(null);
      queryClient.invalidateQueries({ queryKey: ['shifts_data'] });
      queryClient.invalidateQueries({ queryKey: ['rota_matrix'] });
    },
    onError: (err: Error) => {
      toast.error(`Bulk Delete Failed: ${err.message}`);
      setConfirmWipeId(null);
    }
  });

  const wipeGlobalFutureMutation = useMutation({
    mutationFn: async () => {
      const rightNow = new Date().toISOString();
      const { error, count } = await supabase
        .from('shifts')
        .delete({ count: 'exact' })
        .gt('start_time', rightNow);
        
      if (error) throw new Error(error.message);
      if (count === 0) throw new Error("No upcoming shifts found.");
      return count;
    },
    onSuccess: (count) => {
      toast.success(`Global Purge Complete: ${count} upcoming shifts deleted.`);
      setConfirmGlobalWipe(false);
      queryClient.invalidateQueries({ queryKey: ['shifts_data'] });
      queryClient.invalidateQueries({ queryKey: ['rota_matrix'] });
    },
    onError: (err: Error) => {
      toast.error(`Global Wipe Failed: ${err.message}`);
      setConfirmGlobalWipe(false);
    }
  });

  // 3. Filtered Data
  const filteredShifts = useMemo(() => {
    if (!searchQuery.trim()) return shifts;
    const q = searchQuery.toLowerCase();
    return shifts.filter((shift: any) => 
      (shift.users?.name || '').toLowerCase().includes(q) ||
      (shift.users?.role || '').toLowerCase().includes(q) ||
      (shift.assigned_area || '').toLowerCase().includes(q) ||
      (shift.notes || '').toLowerCase().includes(q)
    );
  }, [shifts, searchQuery]);

  const groupedByKeeper = useMemo(() => {
    const map = new Map<string, { user: any, shifts: any[] }>();
    filteredShifts.forEach(shift => {
      const uid = shift.user_id;
      if (!map.has(uid)) map.set(uid, { user: shift.users, shifts: [] });
      map.get(uid)?.shifts.push(shift);
    });
    return Array.from(map.values()).sort((a, b) => (a.user?.name || '').localeCompare(b.user?.name || ''));
  }, [filteredShifts]);

  // 4. Virtualizer
  const rowVirtualizer = useVirtualizer({
    count: filteredShifts.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => isMobile ? 180 : 80,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const tableGridCols = "minmax(200px, 1.4fr) minmax(220px, 1.6fr) minmax(180px, 1.2fr) minmax(240px, 1.8fr) minmax(110px, 0.8fr)";

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-5 lg:space-y-6 animate-in fade-in duration-500 w-full">
      
      {/* --- BLOCK A: HEADER RIBBON --- */}
      <div className="flex justify-between items-start w-full mb-2 lg:mb-4 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1.5 lg:gap-2">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
             Shift Matrix
           </h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
             Scheduling, Deployment & Shift Generation
           </p>
        </div>
        
        {hasPermission('staff:manage') && (
          <div className="flex items-center gap-2 shrink-0">
            <button 
              onClick={() => {
                if (confirmGlobalWipe) {
                  wipeGlobalFutureMutation.mutate();
                } else {
                  setConfirmGlobalWipe(true);
                  setTimeout(() => setConfirmGlobalWipe(false), 4000);
                }
              }}
              disabled={wipeGlobalFutureMutation.isPending}
              className="flex items-center justify-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-3 lg:px-4 py-2 lg:py-2.5 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 disabled:opacity-50"
            >
              {wipeGlobalFutureMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              <span>{confirmGlobalWipe ? 'Confirm Global Purge' : 'Global Purge'}</span>
            </button>

            <button 
              onClick={() => setIsGeneratorOpen(true)}
              className="flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3 lg:px-4 py-2 lg:py-2.5 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95"
            >
              <Sparkles size={14} className="text-indigo-400" />
              <span>Generate Pattern</span>
            </button>
          </div>
        )}
      </div>

      {/* --- BLOCK B: CONTROL DECK --- */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="relative flex-1 min-w-[200px] lg:w-96 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search by keeper name, role, area, or notes..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm placeholder:text-slate-400 font-medium"
          />
        </div>
      </div>

      {/* --- BLOCK C: VIEW TABS (Pill Design) --- */}
      <div className="flex gap-1.5 w-full shrink-0 overflow-x-auto pb-1 lg:pb-0">
        <button
          onClick={() => setViewMode('INDIVIDUAL')}
          className={`px-3 lg:px-4 py-1.5 lg:py-2 rounded-xl text-[9px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm flex items-center justify-center gap-1.5 ${
            viewMode === 'INDIVIDUAL'
              ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
              : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
          }`}
        >
          Individual Ledger
        </button>
        <button
          onClick={() => setViewMode('GROUPED')}
          className={`px-3 lg:px-4 py-1.5 lg:py-2 rounded-xl text-[9px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm flex items-center justify-center gap-1.5 ${
            viewMode === 'GROUPED'
              ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
              : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
          }`}
        >
          Grouped by Keeper
        </button>
      </div>

      {/* --- BLOCK D: MAIN DATA DISPLAY --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden relative mt-1">
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
            <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
              <Loader2 className="animate-spin text-indigo-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Syncing Shift Matrix...</span>
            </div>
          </div>
        )}

        {viewMode === 'INDIVIDUAL' ? (
          <div ref={scrollParentRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50/30">
            
            {/* Desktop Table Header */}
            <div className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
              <div className="px-5 py-4 flex items-center justify-start text-left">Date & Time</div>
              <div className="px-5 py-4 flex items-center justify-start text-left">Keeper</div>
              <div className="px-5 py-4 flex items-center justify-start text-left">Assignment</div>
              <div className="px-5 py-4 flex items-center justify-start text-left">Notes</div>
              <div className="px-5 py-4 flex items-center justify-end text-right">Actions</div>
            </div>

            <div className="p-3 lg:p-0">
              {filteredShifts.length === 0 && !isLoading ? (
                <div className="p-8 lg:p-12 text-center text-slate-500 flex flex-col items-center">
                  <div className="w-12 h-12 lg:w-16 lg:h-16 bg-white rounded-xl lg:rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                    <Calendar size={24} className="text-slate-400" />
                  </div>
                  <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">No shifts scheduled</p>
                  <p className="text-[10px] lg:text-xs font-medium">Use "Generate Pattern" or the Rota to schedule staff.</p>
                </div>
              ) : (
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                  {virtualItems.map((virtualRow) => {
                    const shift = filteredShifts[virtualRow.index];
                    const startObj = new Date(shift.start_time);
                    const endObj = new Date(shift.end_time);

                    return (
                      <div 
                        key={shift.id} 
                        className="absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border border-slate-200 lg:border-none lg:border-b border-b-slate-100 rounded-xl lg:rounded-none bg-white p-3.5 lg:p-0 hover:bg-slate-50 transition-colors shadow-sm lg:shadow-none gap-3 lg:gap-0 box-border"
                        style={{ 
                          gridTemplateColumns: isMobile ? '1fr' : tableGridCols,
                          transform: `translateY(${virtualRow.start}px)`
                        }}
                      >
                        {/* 1. Date & Time */}
                        <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                          {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Date & Time</div>}
                          <div className="space-y-1 w-full">
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900">
                              <Calendar size={12} className="text-slate-400 shrink-0" />
                              {format(startObj, 'dd MMM yyyy')}
                            </span>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
                              <Clock size={11} className="text-indigo-500 shrink-0" />
                              {format(startObj, 'HH:mm')} – {format(endObj, 'HH:mm')}
                            </p>
                          </div>
                        </div>

                        {/* 2. Keeper Identity */}
                        <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-2 lg:gap-0">
                          {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Keeper</div>}
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-700 shrink-0">
                              <UserCircle size={18} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs lg:text-sm font-bold text-slate-900 truncate" title={shift.users?.name || 'Unknown'}>
                                {shift.users?.name || 'Unknown'}
                              </p>
                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate">
                                {shift.users?.role ? shift.users.role.replace(/_/g, ' ') : 'Staff'}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* 3. Assignment */}
                        <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                          {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Assignment</div>}
                          <div className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 w-fit max-w-full">
                            <MapPin size={12} className="text-slate-400 shrink-0" />
                            <span className="text-xs font-bold text-slate-700 truncate" title={shift.assigned_area || 'General Duties'}>
                              {shift.assigned_area || 'General Duties'}
                            </span>
                          </div>
                        </div>

                        {/* 4. Notes */}
                        <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                          {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 pt-2 border-t border-slate-100">Notes</div>}
                          <p className="text-xs font-medium text-slate-600 line-clamp-1 leading-relaxed" title={shift.notes || 'None'}>
                            {shift.notes || <span className="text-slate-400 text-[10px] uppercase font-bold tracking-widest">No notes</span>}
                          </p>
                        </div>

                        {/* 5. Actions */}
                        <div className={`w-full lg:px-5 lg:py-3.5 flex min-w-0 ${isMobile ? 'justify-end pt-2 border-t border-slate-100 mt-1' : 'items-center justify-end'}`}>
                          {hasPermission('staff:manage') && (
                            <button 
                              onClick={() => {
                                if (confirmDeleteId === shift.id) {
                                  deleteIndividualShift.mutate(shift.id);
                                } else {
                                  setConfirmDeleteId(shift.id);
                                  setTimeout(() => setConfirmDeleteId(null), 3000);
                                }
                              }}
                              disabled={deleteIndividualShift.isPending}
                              className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border shadow-sm ${
                                confirmDeleteId === shift.id 
                                  ? 'bg-rose-600 text-white border-rose-700 animate-pulse' 
                                  : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                              } disabled:opacity-50 flex items-center gap-1.5`}
                            >
                              {deleteIndividualShift.isPending && deleteIndividualShift.variables === shift.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Trash2 size={12} />
                              )}
                              <span>{confirmDeleteId === shift.id ? 'Confirm Delete' : 'Delete'}</span>
                            </button>
                          )}
                        </div>

                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* GROUPED VIEW */
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 space-y-4 bg-slate-50/30">
            {groupedByKeeper.length === 0 && !isLoading ? (
              <div className="p-8 text-center text-slate-500 flex flex-col items-center">
                <Users size={32} className="text-slate-400 mb-2" />
                <p className="font-bold text-sm text-slate-700">No scheduled shifts grouped by keeper.</p>
              </div>
            ) : (
              groupedByKeeper.map(({ user, shifts: staffShifts }) => (
                <div key={user?.id || 'unknown'} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                  <div className="bg-slate-50 p-4 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                      <h3 className="font-black text-sm lg:text-base text-slate-900 uppercase tracking-tight flex items-center gap-2">
                        <UserCircle size={18} className="text-indigo-600" />
                        {user?.name || 'Unknown Keeper'}
                      </h3>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                        {staffShifts.length} scheduled shifts • {user?.role ? user.role.replace(/_/g, ' ') : 'Staff'}
                      </p>
                    </div>
                    
                    {hasPermission('staff:manage') && (
                      <button 
                        onClick={() => {
                          if (confirmWipeId === user.id) {
                            wipeFutureShifts.mutate(user.id);
                          } else {
                            setConfirmWipeId(user.id);
                            setTimeout(() => setConfirmWipeId(null), 3000);
                          }
                        }}
                        disabled={wipeFutureShifts.isPending}
                        className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border shadow-sm ${
                          confirmWipeId === user.id
                            ? 'bg-rose-600 text-white border-rose-700 animate-pulse'
                            : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                        } disabled:opacity-50 flex items-center gap-1.5`}
                      >
                        {wipeFutureShifts.isPending && wipeFutureShifts.variables === user.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Trash2 size={12} />
                        )}
                        <span>{confirmWipeId === user.id ? 'Confirm Wipe Future' : 'Wipe Future Shifts'}</span>
                      </button>
                    )}
                  </div>

                  <div className="overflow-x-auto max-h-80 custom-scrollbar">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/50 sticky top-0 border-b border-slate-100 text-[9px] font-black uppercase tracking-widest text-slate-500 backdrop-blur-md">
                        <tr>
                          <th className="py-2.5 px-4">Date</th>
                          <th className="py-2.5 px-4">Time</th>
                          <th className="py-2.5 px-4">Assignment</th>
                          <th className="py-2.5 px-4">Notes</th>
                          <th className="py-2.5 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {staffShifts.map((shift) => {
                          const startObj = new Date(shift.start_time);
                          const endObj = new Date(shift.end_time);

                          return (
                            <tr key={shift.id} className="hover:bg-slate-50/60 transition-colors">
                              <td className="py-2.5 px-4 font-bold text-slate-900">
                                {format(startObj, 'dd MMM yyyy')}
                              </td>
                              <td className="py-2.5 px-4 text-slate-600 font-medium">
                                {format(startObj, 'HH:mm')} – {format(endObj, 'HH:mm')}
                              </td>
                              <td className="py-2.5 px-4">
                                <span className="inline-flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded text-[10px] font-bold text-slate-700">
                                  <MapPin size={10} className="text-slate-400" />
                                  {shift.assigned_area || 'General Duties'}
                                </span>
                              </td>
                              <td className="py-2.5 px-4 text-slate-500 text-[11px] truncate max-w-xs">
                                {shift.notes || '--'}
                              </td>
                              <td className="py-2.5 px-4 text-right">
                                {hasPermission('staff:manage') && (
                                  <button 
                                    onClick={() => {
                                      if (confirmDeleteId === shift.id) {
                                        deleteIndividualShift.mutate(shift.id);
                                      } else {
                                        setConfirmDeleteId(shift.id);
                                        setTimeout(() => setConfirmDeleteId(null), 3000);
                                      }
                                    }}
                                    disabled={deleteIndividualShift.isPending}
                                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                    title="Delete Shift"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* --- GENERATOR MODAL --- */}
      {isGeneratorOpen && (
        <ShiftGeneratorModal 
          staffMembers={staffMembers} 
          onClose={() => setIsGeneratorOpen(false)} 
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// 4. GENERATOR MODAL
// ------------------------------------------------------------------
function ShiftGeneratorModal({ staffMembers, onClose }: { staffMembers: any[], onClose: () => void }) {
  const queryClient = useQueryClient();
  
  const [userId, setUserId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [area, setArea] = useState('');
  const [notes, setNotes] = useState('');

  const insertMutation = useMutation({
    mutationFn: async (payloads: any[]) => {
      const { data, error } = await supabase.from('shifts').insert(payloads).select();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts_data'] });
      queryClient.invalidateQueries({ queryKey: ['rota_matrix'] });
      toast.success('Shift pattern generated successfully.');
      onClose();
    },
    onError: (err: Error) => toast.error(`Generation Failed: ${err.message}`)
  });

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();

    if (!userId || !startDate || !endDate) return toast.error("Please fill out the staff member and date range.");
    if (selectedDays.length === 0) return toast.error("Please select at least one working day.");

    const startObj = new Date(startDate);
    const endObj = new Date(endDate);
    
    const diffTime = Math.abs(endObj.getTime() - startObj.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    if (diffDays > 90) return toast.error("Maximum generation span is 3 months (90 days).");
    if (endObj < startObj) return toast.error("End date cannot be before start date.");

    const payloads = [];
    let current = new Date(startObj);

    while (current <= endObj) {
      if (selectedDays.includes(current.getDay())) {
        const dateString = current.toISOString().split('T')[0];
        const startLocalIso = new Date(`${dateString}T${startTime}:00`).toISOString();
        const endLocalIso = new Date(`${dateString}T${endTime}:00`).toISOString();

        payloads.push({
          user_id: userId,
          start_time: startLocalIso,
          end_time: endLocalIso,
          assigned_area: area || null,
          notes: notes || null,
          status: 'SCHEDULED'
        });
      }
      current.setDate(current.getDate() + 1);
    }

    if (payloads.length === 0) return toast.error("No matching days found within that date range.");
    
    insertMutation.mutate(payloads);
  };

  const toggleDay = (dayIndex: number) => {
    setSelectedDays(prev => 
      prev.includes(dayIndex) ? prev.filter(d => d !== dayIndex) : [...prev, dayIndex]
    );
  };

  const DAYS = [
    { label: 'Mon', val: 1 },
    { label: 'Tue', val: 2 },
    { label: 'Wed', val: 3 },
    { label: 'Thu', val: 4 },
    { label: 'Fri', val: 5 },
    { label: 'Sat', val: 6 },
    { label: 'Sun', val: 0 }
  ];

  const inputClass = "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs lg:text-sm font-bold text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm placeholder:text-slate-400";
  const labelClass = "text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block";

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-sans overflow-y-auto custom-scrollbar">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg flex flex-col shadow-2xl relative overflow-hidden my-auto animate-in zoom-in-95 duration-200">
        
        <div className="bg-slate-50 border-b border-slate-100 p-5 flex justify-between items-center z-20 shrink-0 rounded-t-2xl">
          <div>
            <h2 className="text-base lg:text-lg font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
              <Sparkles size={18} className="text-indigo-600" /> Generate Shift Pattern
            </h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Automated batch scheduling (up to 90 days)</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[75vh]">
          <form id="generator-form" onSubmit={handleGenerate} className="space-y-4">
            <div>
              <label className={labelClass}>Target Staff Member *</label>
              <select required value={userId} onChange={e => setUserId(e.target.value)} className={inputClass}>
                <option value="">Select Staff Member...</option>
                {staffMembers
                  .filter((s: any) => !s.is_deleted && s.is_active !== false)
                  .map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.role?.replace(/_/g, ' ') || 'Staff'})</option>
                  ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Start Date *</label>
                <input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>End Date *</label>
                <input type="date" required value={endDate} onChange={e => setEndDate(e.target.value)} className={inputClass} />
              </div>
            </div>

            <div>
              <label className={labelClass}>Working Days *</label>
              <div className="grid grid-cols-7 gap-1.5">
                {DAYS.map(day => (
                  <button 
                    key={day.val}
                    type="button"
                    onClick={() => toggleDay(day.val)}
                    className={`py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm ${
                      selectedDays.includes(day.val)
                        ? 'bg-slate-900 text-white shadow-slate-900/20'
                        : 'bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Start Time *</label>
                <input type="time" required value={startTime} onChange={e => setStartTime(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>End Time *</label>
                <input type="time" required value={endTime} onChange={e => setEndTime(e.target.value)} className={inputClass} />
              </div>
            </div>

            <div>
              <label className={labelClass}>Assigned Area (Optional)</label>
              <input type="text" value={area} onChange={e => setArea(e.target.value)} placeholder="e.g. Flight Yard, Aviary Section" className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>Shift Notes (Optional)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${inputClass} resize-none h-16`} placeholder="General instructions for this shift pattern..." />
            </div>
          </form>
        </div>

        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 z-20 shrink-0 rounded-b-2xl">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors">
            Cancel
          </button>
          <button 
            type="submit" 
            form="generator-form"
            disabled={insertMutation.isPending} 
            className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95"
          >
            {insertMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} className="text-indigo-400" />}
            <span>{insertMutation.isPending ? 'Generating...' : 'Generate Matrix'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ShiftsModule;