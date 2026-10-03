import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { format, parseISO, formatISO } from 'date-fns';
import { toast } from 'sonner';
import { 
  ShieldAlert, Plus, X, Search, Save, Loader2, UserCircle, 
  Calendar, Lock, WifiOff, Users, User, CheckCircle2 
} from 'lucide-react';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS & 14-DAY RAM CAP
// ------------------------------------------------------------------
const isolationLogsOptions = queryOptions({
  queryKey: ['isolation_logs'],
  queryFn: async () => {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('isolation_logs')
      // Expanded join to power the Unified Identity Block
      .select('*, animals(id, name, species, ring_number, profile_image_url, record_type), users:authorized_by(name, initials)')
      .eq('is_deleted', false)
      .or(`end_date.is.null,start_date.gte.${fourteenDaysAgo}`)
      .order('start_date', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  staleTime: 1000 * 60 * 15,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

const activeAnimalsOptions = queryOptions({
  queryKey: ['active_animals'],
  queryFn: async () => {
    const { data, error } = await supabase.from('animals').select('id, name, species, record_type').eq('is_deleted', false).order('name');
    if (error) throw error;
    return data || [];
  },
  staleTime: 1000 * 60 * 60,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

const staffMembersOptions = queryOptions({
  queryKey: ['staff_members'],
  queryFn: async () => {
    const { data, error } = await supabase.from('users').select('id, name, initials, is_deleted, is_active').order('name');
    if (error) throw error;
    return data || [];
  },
  staleTime: 1000 * 60 * 60,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

// ------------------------------------------------------------------
// 2. ROUTE CONFIGURATION
// ------------------------------------------------------------------
export const Route = createFileRoute('/clinical/isolation')({
  loader: async ({ context: { queryClient } }) => {
    if (queryClient) {
      // @ts-ignore
      await Promise.all([ 
        queryClient.ensureQueryData(isolationLogsOptions), 
        queryClient.ensureQueryData(activeAnimalsOptions),
        queryClient.ensureQueryData(staffMembersOptions)
      ]);
    }
  },
  component: IsolationLogsPage,
});

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
export function IsolationLogsPage() {
  const queryClient = useQueryClient();
  const { user, hasPermission } = useAuth();
  const isMobile = useIsMobile();
  
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'ALL' | 'ACTIVE' | 'CLEARED'>('ACTIVE');
  
  const scrollParentRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const channel = supabase.channel('isolation-logs-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'isolation_logs' }, () => {
        queryClient.invalidateQueries({ queryKey: ['isolation_logs'], refetchType: 'active' });
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const { data: logs = [], isLoading } = useQuery(isolationLogsOptions);
  const { data: animals = [] } = useQuery(activeAnimalsOptions);
  const { data: staffMembers = [] } = useQuery(staffMembersOptions);

  const filteredLogs = useMemo(() => {
    let filtered = logs;
    if (activeTab !== 'ALL') {
      filtered = filtered.filter((l: any) => activeTab === 'ACTIVE' ? !l.end_date : !!l.end_date);
    }
    if (searchQuery) {
      const lower = searchQuery.toLowerCase();
      filtered = filtered.filter((l: any) => 
        (l.animals?.name || '').toLowerCase().includes(lower) ||
        (l.reason || '').toLowerCase().includes(lower) ||
        (l.users?.name || '').toLowerCase().includes(lower)
      );
    }
    return filtered;
  }, [logs, searchQuery, activeTab]);

  const rowVirtualizer = useWindowVirtualizer({
    count: filteredLogs.length,
    estimateSize: () => isMobile ? 180 : 80, 
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  const completeIsolationMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!isOnline) throw new Error("Must be online to clear isolation status.");
      const { error } = await supabase.from('isolation_logs').update({ 
        end_date: new Date().toISOString(),
        modified_by: user!.id 
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['isolation_logs'] });
      toast.success('Quarantine cleared successfully.');
    },
    onError: (err: any) => toast.error(`Action failed: ${err.message}`)
  });

  const tableGridCols = "minmax(220px, 1.5fr) minmax(250px, 2fr) minmax(180px, 1fr) minmax(140px, 1fr)";

  const tabs = [
    { id: 'ACTIVE', label: 'Currently Isolated' },
    { id: 'CLEARED', label: 'Cleared / Released' },
    { id: 'ALL', label: 'All Records' }
  ] as const;

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-5 lg:space-y-6 animate-in fade-in duration-500 w-full">
      
      {/* --- OFFLINE WARNING BANNER --- */}
      {!isOnline && (
        <div className="bg-rose-50 border-2 border-rose-300 p-4 rounded-2xl shadow-sm flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 text-rose-900">
            <WifiOff size={24} className="text-rose-600 shrink-0" />
            <div className="flex flex-col">
              <span className="font-black uppercase tracking-widest text-xs text-rose-600">Clinical Network Disconnected</span>
              <span className="text-sm font-bold mt-0.5">Biosecurity actions are locked to prevent sync conflicts. Please reconnect to WiFi.</span>
            </div>
          </div>
        </div>
      )}

      {/* --- BLOCK A: HEADER RIBBON --- */}
      <div className="flex justify-between items-start w-full mb-2 lg:mb-4 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1.5 lg:gap-2">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
             Quarantine & Isolation
           </h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
             Biosecurity Tracking
           </p>
        </div>
        
        {/* Action Button */}
        {hasPermission('clinical:write') && (
          <button 
            onClick={() => setIsModalOpen(true)} 
            className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-3 lg:px-4 py-2 lg:py-2.5 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
          >
            <Plus size={14} className="text-violet-400 hidden sm:block" />
            <ShieldAlert size={14} className="text-violet-400 sm:hidden" />
            <span className="hidden sm:block">Isolate Animal</span>
            <span className="sm:hidden">New Log</span>
          </button>
        )}
      </div>

      {/* --- BLOCK B: CONTROL DECK --- */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="relative flex-1 min-w-[200px] lg:w-96 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search records or staff..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all shadow-sm placeholder:text-slate-400"
          />
        </div>
        
        <div className="flex items-center gap-2 bg-teal-50 border border-teal-100 p-2 rounded-xl text-teal-800 shadow-sm shrink-0 w-full sm:w-auto">
          <CheckCircle2 size={16} className="text-teal-600 shrink-0" />
          <span className="text-[10px] font-bold leading-tight">14-Day rolling history limit engaged.</span>
        </div>
      </div>

      {/* --- BLOCK C: CATEGORY TABS --- */}
      <div className="grid grid-cols-3 lg:flex lg:gap-2 w-full shrink-0 gap-1.5 overflow-x-auto pb-1 lg:pb-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-1 lg:px-4 py-1.5 lg:py-2 rounded-xl text-[9px] lg:text-xs font-black uppercase tracking-widest whitespace-nowrap lg:whitespace-normal transition-all shadow-sm flex items-center justify-center gap-1.5 ${
              activeTab === tab.id 
                ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* --- BLOCK D: CHAMELEON DATA GRID --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden relative mt-1">
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
            <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
              <Loader2 className="animate-spin text-violet-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Syncing biosecurity logs...</span>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50/30" ref={scrollParentRef}>
          
          <div className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
            <div className="px-5 py-4 flex items-center justify-start text-left">Patient & Status</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Reason for Isolation</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Timeframe</div>
            <div className="px-5 py-4 flex items-center justify-end text-right">Action</div>
          </div>

          <div className="p-3 lg:p-0">
            {filteredLogs.length === 0 && !isLoading ? (
              <div className="p-8 lg:p-12 text-center text-slate-500 flex flex-col items-center">
                <div className="w-12 h-12 lg:w-16 lg:h-16 bg-white rounded-xl lg:rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                  <ShieldAlert size={24} className="text-slate-400" />
                </div>
                <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">No records found</p>
                <p className="text-[10px] lg:text-xs font-medium">Try adjusting your search or status filters.</p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const log = filteredLogs[virtualRow.index];
                  const startDateObj = new Date(log.start_date);
                  const endDateObj = log.end_date ? new Date(log.end_date) : null;
                  const isActive = !log.end_date;
                  const isGroup = log.animals?.record_type === 'GROUP';

                  return (
                    <div 
                      key={log.id} 
                      className="absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border border-slate-200 lg:border-none lg:border-b border-b-slate-100 rounded-xl lg:rounded-none bg-white p-3 lg:p-0 hover:bg-slate-50 transition-colors shadow-sm lg:shadow-none gap-3 lg:gap-0 box-border"
                      style={{ 
                        gridTemplateColumns: isMobile ? '1fr' : tableGridCols,
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
                      {/* 1. Identity Block */}
                      <div className="w-full lg:px-5 lg:py-3 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-2 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Patient & Status</div>}
                        <div className="flex items-center gap-3 min-w-0 py-1">
                          <div className={`w-8 h-8 lg:w-10 lg:h-10 rounded-full flex items-center justify-center shrink-0 border shadow-sm overflow-hidden ${!log.animals?.profile_image_url ? (isGroup ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-slate-50 text-slate-400 border-slate-200') : 'border-slate-200'}`}>
                            {log.animals?.profile_image_url ? (
                              <img src={log.animals.profile_image_url} alt={log.animals.name} className="w-full h-full object-cover" />
                            ) : (
                              isGroup ? <Users size={16} /> : <User size={16} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-slate-900 text-xs lg:text-sm tracking-tight truncate" title={log.animals?.name || 'Unknown'}>{log.animals?.name || 'Unknown'}</h3>
                              <span className={`px-2 py-0.5 rounded text-[8px] lg:text-[9px] font-black uppercase tracking-widest border shrink-0 ${isActive ? 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                                {isActive ? 'ACTIVE' : 'CLEARED'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[9px] lg:text-[10px] text-slate-500 truncate mt-0.5">
                              {log.animals?.ring_number && <span className="font-bold text-slate-400 uppercase tracking-widest">{log.animals.ring_number}</span>}
                              {log.animals?.ring_number && log.animals?.species && <span>•</span>}
                              {log.animals?.species && <span className="italic truncate">{log.animals.species}</span>}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 2. Reason & Details */}
                      <div className="w-full lg:px-5 lg:py-3 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Reason for Isolation</div>}
                        <div className="space-y-1.5 w-full">
                          <div className="flex items-center gap-1.5">
                             <ShieldAlert size={12} className={isActive ? 'text-rose-500' : 'text-slate-400'} />
                             <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded shadow-sm">
                               {log.isolation_type.replace(/_/g, ' ')}
                             </span>
                          </div>
                          <p className="text-xs font-bold text-slate-900 line-clamp-1">{log.reason}</p>
                          <p className="text-[10px] font-medium text-slate-600 line-clamp-2 leading-relaxed">{log.notes || 'No additional notes provided.'}</p>
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">
                            <UserCircle size={10} className="inline mr-1" /> Auth: {log.users?.name || 'Unknown'}
                          </p>
                        </div>
                      </div>

                      {/* 3. Timeframe */}
                      <div className="w-full lg:px-5 lg:py-3 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Timeframe</div>}
                        <div className="flex flex-col gap-1.5">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-[9px] lg:text-[10px] font-black text-slate-600 uppercase tracking-widest w-fit">
                            <Calendar size={12} /> Start: {format(startDateObj, 'dd MMM yyyy')}
                          </span>
                          {endDateObj ? (
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[9px] lg:text-[10px] font-black uppercase tracking-widest w-fit ${isActive ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                              <Calendar size={12} /> Cleared: {format(endDateObj, 'dd MMM yyyy')}
                            </span>
                          ) : (
                            <span className="text-[9px] lg:text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Indefinite Quarantine</span>
                          )}
                        </div>
                      </div>

                      {/* 4. Action */}
                      <div className={`w-full lg:px-5 lg:py-3 flex min-w-0 ${isMobile ? 'justify-end pt-2 border-t border-slate-100' : 'items-center justify-end'}`}>
                        {isActive ? (
                          hasPermission('clinical:write') && (
                            <button 
                              onClick={() => completeIsolationMutation.mutate(log.id)} 
                              disabled={completeIsolationMutation.isPending} 
                              className="px-4 py-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-black text-[10px] uppercase tracking-widest rounded-xl transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2 active:scale-95"
                            >
                              {completeIsolationMutation.isPending && <Loader2 size={12} className="animate-spin" />} Clear Quarantine
                            </button>
                          )
                        ) : (
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Completed</span>
                        )}
                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {isModalOpen && <IsolationModal onClose={() => setIsModalOpen(false)} animals={animals} staffMembers={staffMembers} userId={user!.id} />}
    </div>
  );
}

// ------------------------------------------------------------------
// ISOLATION MODAL
// ------------------------------------------------------------------
function IsolationModal({ onClose, animals, staffMembers, userId }: { onClose: () => void, animals: any[], staffMembers: any[], userId: string }) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      const { error } = await supabase.from('isolation_logs').insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['isolation_logs'] });
      toast.success('Isolation log initiated successfully.');
      onClose();
    },
    onError: (err: any) => setErrorMsg(err.message || 'Failed to save isolation log.')
  });

  const form = useForm({
    defaultValues: {
      animal_id: '',
      isolation_type: 'QUARANTINE',
      start_date: format(new Date(), 'yyyy-MM-dd'),
      end_date: '',
      reason: '',
      notes: '',
      authorized_by: ''
    },
    onSubmit: ({ value }) => {
      setErrorMsg(null);
      
      const parsedStartDate = formatISO(parseISO(value.start_date));
      const parsedEndDate = value.end_date ? formatISO(parseISO(value.end_date)) : null;

      const payload = {
        id: crypto.randomUUID(), 
        animal_id: value.animal_id,
        isolation_type: value.isolation_type,
        start_date: parsedStartDate,
        end_date: parsedEndDate,
        reason: value.reason,
        notes: value.notes || null,
        authorized_by: value.authorized_by || null,
        is_deleted: false,
        created_by: userId,
        modified_by: userId
      };

      saveMutation.mutate(payload);
    }
  });

  const inputClass = "w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all placeholder:text-slate-300";
  const labelClass = "text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block";

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto custom-scrollbar">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg flex flex-col shadow-2xl relative my-auto animate-in zoom-in-95 duration-200">
        <div className="bg-slate-50 border-b border-slate-100 p-5 flex justify-between items-center shrink-0 rounded-t-2xl">
          <div>
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
              <Lock size={20} className="text-violet-600" /> Initiate Quarantine
            </h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl transition-colors"><X size={20} /></button>
        </div>

        <form id="isolation-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="p-6 space-y-5">
          {errorMsg && <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-bold shadow-sm">{errorMsg}</div>}

          <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl flex items-start gap-3">
             <ShieldAlert size={20} className="text-rose-600 shrink-0 mt-0.5" />
             <div>
                <p className="text-xs font-black text-rose-900 uppercase tracking-tight">Biosecurity Alert</p>
                <p className="text-[10px] font-bold text-rose-700 mt-1">Initiating this log flags the animal across the entire StrixOS system as isolated. General keepers will be warned.</p>
             </div>
          </div>

          <form.Field name="animal_id">
            {(field) => (
              <div>
                <label className={labelClass}>Patient (Animal) *</label>
                <select required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass}>
                  <option value="">-- Select Patient --</option>
                  {animals.map((a: any) => <option key={a.id} value={a.id}>{a.name} ({a.species})</option>)}
                </select>
              </div>
            )}
          </form.Field>

          <form.Field name="isolation_type">
            {(field) => (
              <div>
                <label className={labelClass}>Isolation Protocol Type *</label>
                <select required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass}>
                  <option value="QUARANTINE">Full Quarantine (Inbound/Contagion)</option>
                  <option value="MEDICAL_OBSERVATION">Medical Observation</option>
                  <option value="BEHAVIORAL_SEPARATION">Behavioral Separation</option>
                  <option value="DIETARY_RESTRICTION">Dietary Restriction</option>
                </select>
              </div>
            )}
          </form.Field>

          <div className="grid grid-cols-2 gap-5">
            <form.Field name="start_date">
              {(field) => (
                <div>
                  <label className={labelClass}>Start Date *</label>
                  <input type="date" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                </div>
              )}
            </form.Field>
            <form.Field name="end_date">
              {(field) => (
                <div>
                  <label className={labelClass}>Target End (Optional)</label>
                  <input type="date" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                </div>
              )}
            </form.Field>
          </div>

          <form.Field name="reason">
            {(field) => (
              <div>
                <label className={labelClass}>Primary Reason *</label>
                <input type="text" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} placeholder="e.g. Suspected Avian Influenza" className={inputClass} />
              </div>
            )}
          </form.Field>

          <form.Field name="notes">
            {(field) => (
              <div>
                <label className={labelClass}>Additional Notes / Restrictions</label>
                <textarea value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} rows={3} className={`${inputClass} resize-none`} placeholder="e.g. Full PPE required. Foot dip must be used..." />
              </div>
            )}
          </form.Field>

          <form.Field name="authorized_by">
            {(field) => (
              <div>
                <label className={labelClass}>Authorized By (Manager/Vet)</label>
                <select value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass}>
                  <option value="">-- Select Authorizing Staff --</option>
                  {staffMembers
                    .filter((s: any) => !s.is_deleted && s.is_active !== false)
                    .map((s: any) => <option key={s.id} value={s.id}>{s.name} {s.initials ? `(${s.initials})` : ''}</option>)
                  }
                </select>
              </div>
            )}
          </form.Field>
        </form>

        <div className="p-5 border-t border-slate-100 bg-white rounded-b-2xl flex justify-end gap-3 shrink-0">
          <button type="button" onClick={onClose} className="px-6 py-2.5 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors">Cancel</button>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <button type="submit" form="isolation-form" disabled={!canSubmit || isSubmitting as boolean} className="px-8 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 flex items-center gap-2 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95">
                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Commit Isolation
              </button>
            )}
          </form.Subscribe>
        </div>
      </div>
    </div>
  );
}