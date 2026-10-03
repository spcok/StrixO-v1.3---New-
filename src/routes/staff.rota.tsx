import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  Calendar as CalendarIcon, Loader2, ChevronLeft, ChevronRight, 
  Search, Plus, Umbrella, X, Clock, MapPin, CheckCircle2, UserCircle 
} from 'lucide-react';
import { 
  format, addDays, startOfWeek, endOfWeek, startOfMonth, 
  endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, parseISO 
} from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { rotaService } from '../services/rotaService';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const getRotaOptions = (start: string, end: string) => queryOptions({
  queryKey: ['rota_matrix', start, end],
  queryFn: () => rotaService.getRotaData(start, end),
  staleTime: 1000 * 60 * 15,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

// ------------------------------------------------------------------
// 2. ROUTE CONFIGURATION
// ------------------------------------------------------------------
export const Route = createFileRoute('/staff/rota')({
  loader: async ({ context: { queryClient } }) => {
    const today = new Date();
    const start = startOfWeek(today, { weekStartsOn: 1 });
    const end = endOfWeek(today, { weekStartsOn: 1 });
    const queryBufferStart = format(addDays(start, -14), 'yyyy-MM-dd');
    const queryBufferEnd = format(addDays(end, 14), 'yyyy-MM-dd');
    
    // @ts-ignore
    if (queryClient) await queryClient.ensureQueryData(getRotaOptions(queryBufferStart, queryBufferEnd));
  },
  component: RotaPage,
});

// ------------------------------------------------------------------
// 3. MAIN COMPONENT
// ------------------------------------------------------------------
export function RotaPage() {
  const queryClient = useQueryClient();
  const { profile, hasPermission } = useAuth();
  const scrollParentRef = useRef<HTMLDivElement>(null);
  
  const isManager = hasPermission('staff:manage') || profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.role === 'HR';

  const [view, setView] = useState<'WEEKLY' | 'DAILY' | 'MONTHLY'>('WEEKLY');
  const [baseDate, setBaseDate] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [modalState, setModalState] = useState<'NONE' | 'SHIFT' | 'LEAVE'>('NONE');

  const dateRange = useMemo(() => {
    if (view === 'DAILY') return { start: baseDate, end: baseDate };
    if (view === 'WEEKLY') return { start: startOfWeek(baseDate, { weekStartsOn: 1 }), end: endOfWeek(baseDate, { weekStartsOn: 1 }) };
    return { start: startOfMonth(baseDate), end: endOfMonth(baseDate) };
  }, [view, baseDate]);

  const matrixDays = useMemo(() => eachDayOfInterval(dateRange), [dateRange]);
  
  const monthlyGridDays = useMemo(() => {
    return eachDayOfInterval({ start: startOfMonth(baseDate), end: endOfMonth(baseDate) });
  }, [baseDate]);

  const queryBufferStart = format(addDays(dateRange.start, -14), 'yyyy-MM-dd');
  const queryBufferEnd = format(addDays(dateRange.end, 14), 'yyyy-MM-dd');

  // Supabase Realtime Sync
  useEffect(() => {
    const shiftsChannel = supabase.channel('shifts-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, () => {
        queryClient.invalidateQueries({ queryKey: ['rota_matrix'] });
      }).subscribe();
      
    const leaveChannel = supabase.channel('leave-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave' }, () => {
        queryClient.invalidateQueries({ queryKey: ['rota_matrix'] });
      }).subscribe();

    return () => {
      supabase.removeChannel(shiftsChannel);
      supabase.removeChannel(leaveChannel);
    };
  }, [queryClient]);

  const { data, isLoading } = useQuery(getRotaOptions(queryBufferStart, queryBufferEnd));

  const { shiftMap, leaveMap } = useMemo(() => {
    if (!data) return { shiftMap: {}, leaveMap: {} };
    const sMap: Record<string, any> = {};
    const lMap: Record<string, any> = {};

    data.shifts.forEach((s: any) => {
      const dateKey = s.start_time.split('T')[0];
      sMap[`${s.user_id}_${dateKey}`] = s;
    });

    data.leave.forEach((l: any) => {
      eachDayOfInterval({ start: parseISO(l.start_date), end: parseISO(l.end_date) }).forEach(d => {
        lMap[`${l.user_id}_${format(d, 'yyyy-MM-dd')}`] = l;
      });
    });

    return { shiftMap: sMap, leaveMap: lMap };
  }, [data]);

  const filteredStaff = useMemo(() => {
    if (!data?.staff) return [];
    
    let visibleStaff = data.staff.filter((s: any) => {
      if (!s.is_deleted && s.is_active !== false) return true;
      
      return matrixDays.some(date => {
        const lookupKey = `${s.id}_${format(date, 'yyyy-MM-dd')}`;
        return shiftMap[lookupKey] || leaveMap[lookupKey];
      });
    });

    if (!searchQuery.trim()) return visibleStaff;
    
    const query = searchQuery.toLowerCase();
    return visibleStaff.filter((s: any) => 
      (s.name || '').toLowerCase().includes(query) || 
      (s.role || '').toLowerCase().includes(query)
    );
  }, [data?.staff, searchQuery, matrixDays, shiftMap, leaveMap]);

  const handlePrev = () => {
    if (view === 'DAILY') setBaseDate(addDays(baseDate, -1));
    if (view === 'WEEKLY') setBaseDate(addDays(baseDate, -7));
    if (view === 'MONTHLY') setBaseDate(addDays(startOfMonth(baseDate), -1));
  };

  const handleNext = () => {
    if (view === 'DAILY') setBaseDate(addDays(baseDate, 1));
    if (view === 'WEEKLY') setBaseDate(addDays(baseDate, 7));
    if (view === 'MONTHLY') setBaseDate(addDays(endOfMonth(baseDate), 1));
  };

  // Virtualizer for matrix rows
  const rowVirtualizer = useVirtualizer({
    count: filteredStaff.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 64, 
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0;

  const tabs = [
    { id: 'WEEKLY', label: 'Weekly Matrix' },
    { id: 'DAILY', label: 'Daily Schedule' },
    { id: 'MONTHLY', label: 'Monthly View' }
  ] as const;

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-5 lg:space-y-6 animate-in fade-in duration-500 w-full">
      
      {/* --- BLOCK A: HEADER RIBBON --- */}
      <div className="flex justify-between items-start w-full mb-2 lg:mb-4 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1.5 lg:gap-2">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
             Staff Rota
           </h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
             Workforce Scheduling & Absence Matrix
           </p>
        </div>
        
        {isManager && (
          <div className="flex items-center gap-2 shrink-0">
            <button 
              onClick={() => setModalState('SHIFT')} 
              className="flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3 lg:px-4 py-2 lg:py-2.5 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
            >
              <Plus size={14} className="text-indigo-400" />
              <span>Add Shift</span>
            </button>
            <button 
              onClick={() => setModalState('LEAVE')} 
              className="flex items-center justify-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-3 lg:px-4 py-2 lg:py-2.5 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
            >
              <Umbrella size={14} />
              <span>Absence</span>
            </button>
          </div>
        )}
      </div>

      {/* --- BLOCK B: CONTROL DECK --- */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] lg:w-80 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Filter staff by name or role..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm placeholder:text-slate-400 font-medium" 
          />
        </div>

        {/* Date Navigation */}
        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end">
          <div className="flex items-center bg-white rounded-xl p-1 border border-slate-200 shadow-sm w-full sm:w-auto">
            <button onClick={handlePrev} className="p-1.5 hover:bg-slate-50 text-slate-600 rounded-lg transition-colors active:scale-95">
              <ChevronLeft size={16} />
            </button>
            <div className="px-3 min-w-[130px] text-center border-l border-r border-slate-100">
              <span className="text-[10px] lg:text-xs font-black uppercase tracking-widest text-slate-800">
                {view === 'DAILY' ? format(baseDate, 'dd MMM yyyy') : view === 'WEEKLY' ? `W/C ${format(dateRange.start, 'dd MMM yyyy')}` : format(baseDate, 'MMMM yyyy')}
              </span>
            </div>
            <button onClick={handleNext} className="p-1.5 hover:bg-slate-50 text-slate-600 rounded-lg transition-colors active:scale-95">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* --- BLOCK C: CATEGORY TABS (Pill Design) --- */}
      <div className="grid grid-cols-3 lg:flex lg:gap-2 w-full shrink-0 gap-1.5 overflow-x-auto pb-1 lg:pb-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setView(tab.id as any)}
            className={`px-3 lg:px-4 py-1.5 lg:py-2 rounded-xl text-[9px] lg:text-xs font-black uppercase tracking-widest whitespace-nowrap lg:whitespace-normal transition-all shadow-sm flex items-center justify-center gap-1.5 ${
              view === tab.id 
                ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20' 
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* --- BLOCK D: DATA MATRIX --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden relative mt-1">
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-40 flex items-center justify-center rounded-2xl">
            <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
              <Loader2 className="animate-spin text-indigo-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Syncing Rota Matrix...</span>
            </div>
          </div>
        )}

        {view === 'MONTHLY' ? (
          <div className="flex-1 flex flex-col bg-slate-50 min-h-0">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-10 shadow-sm shrink-0">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                <div key={day} className="py-3 text-center border-r border-slate-200 last:border-0">{day}</div>
              ))}
            </div>
            
            <div className="grid grid-cols-7 flex-1 auto-rows-max overflow-y-auto custom-scrollbar content-start">
              {monthlyGridDays.map((date, i) => {
                const dateKey = format(date, 'yyyy-MM-dd');
                const isToday = isSameDay(date, new Date());
                
                const workingStaff = filteredStaff.filter(s => shiftMap[`${s.id}_${dateKey}`]);
                const absentStaff = filteredStaff.filter(s => leaveMap[`${s.id}_${dateKey}`]);

                let colStartClass = '';
                if (i === 0) {
                   const jsDay = date.getDay();
                   const cssCol = jsDay === 0 ? 7 : jsDay;
                   const classes = ['col-start-1', 'col-start-2', 'col-start-3', 'col-start-4', 'col-start-5', 'col-start-6', 'col-start-7'];
                   colStartClass = classes[cssCol - 1];
                }

                return (
                  <div key={i} className={`border-r border-b border-slate-200 p-2 flex flex-col gap-1.5 min-h-[110px] bg-white ${colStartClass} ${isToday ? 'ring-2 ring-inset ring-indigo-500 bg-indigo-50/10' : ''}`}>
                    <div className={`text-right text-[10px] font-black ${isToday ? 'text-indigo-600' : 'text-slate-400'}`}>
                      {format(date, 'd')}
                    </div>
                    
                    <div className="flex-1 flex flex-wrap content-start gap-1">
                      {absentStaff.map(staff => (
                        <div key={staff.id} className="text-[8px] font-bold px-1.5 py-0.5 rounded border text-rose-700 bg-rose-50 border-rose-200 truncate" title={`${staff.name} - Absent`}>
                          {staff.name.split(' ')[0]} (Abs)
                        </div>
                      ))}
                      
                      {workingStaff.map(staff => (
                        <div key={staff.id} className="text-[8px] font-bold px-1.5 py-0.5 rounded border text-indigo-700 bg-indigo-50 border-indigo-200 shadow-sm truncate">
                          {staff.name.split(' ')[0]}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Header Row */}
            <div className="flex border-b border-slate-200 bg-slate-50 shadow-sm shrink-0 sticky top-0 z-20">
              <div className="w-28 sm:w-36 md:w-48 lg:w-56 p-3 md:p-4 border-r border-slate-200 flex items-center shrink-0 min-w-0">
                <span className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest truncate w-full">Staff Member</span>
              </div>
              <div className="flex-1 flex min-w-0">
                {matrixDays.map(date => {
                  const isToday = isSameDay(date, new Date());
                  return (
                    <div key={date.toString()} className={`flex-1 p-2 md:p-3 text-center border-r border-slate-200 last:border-0 min-w-[70px] ${isToday ? 'bg-indigo-50/60 border-b-2 border-b-indigo-500' : ''}`}>
                      <p className={`text-[9px] md:text-[10px] font-black uppercase tracking-widest ${isToday ? 'text-indigo-600' : 'text-slate-400'}`}>{format(date, 'EEE')}</p>
                      <p className={`text-xs md:text-sm font-black mt-0.5 ${isToday ? 'text-indigo-900' : 'text-slate-700'}`}>{format(date, 'd MMM')}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Virtualized Matrix Body */}
            <div ref={scrollParentRef} className="flex-1 overflow-auto custom-scrollbar relative bg-slate-50/30">
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${paddingTop}px)` }}>
                  {virtualItems.map((virtualRow) => {
                    const staff = filteredStaff[virtualRow.index];
                    return (
                      <div key={staff.id} className="flex border-b border-slate-100 hover:bg-slate-50/70 transition-colors h-16 group bg-white" style={{ height: `${virtualRow.size}px` }}>
                        
                        {/* Staff Column */}
                        <div className="w-28 sm:w-36 md:w-48 lg:w-56 p-2 md:p-3 lg:p-4 border-r border-slate-200 flex flex-col justify-center bg-white shrink-0 min-w-0">
                           <div className="flex items-center gap-1.5 md:gap-2 min-w-0 w-full">
                             <div className={`w-2 h-2 rounded-full shrink-0 ${staff.is_active === false ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                             <p className="text-[11px] md:text-xs lg:text-sm font-bold text-slate-900 truncate flex-1 min-w-0">{staff.name}</p>
                           </div>
                           <p className="text-[8px] md:text-[9px] lg:text-[10px] text-slate-400 font-mono mt-0.5 uppercase ml-3.5 truncate w-full">{staff.role.replace(/_/g, ' ')}</p>
                        </div>
                        
                        {/* Shifts Cells */}
                        <div className="flex-1 flex min-w-0">
                           {matrixDays.map(date => {
                             const dateKey = format(date, 'yyyy-MM-dd');
                             const shift = shiftMap[`${staff.id}_${dateKey}`];
                             const leave = leaveMap[`${staff.id}_${dateKey}`];

                             return (
                               <div key={date.toString()} className="flex-1 border-r border-slate-100 last:border-0 p-1 md:p-1.5 relative group/cell min-w-[70px] flex items-center justify-center">
                                  {leave ? (
                                    <div className="w-full h-full rounded-xl bg-rose-50 border border-rose-200 flex flex-col items-center justify-center p-1 text-center min-w-0">
                                      <span className="text-rose-700 font-black text-[8px] md:text-[9px] uppercase tracking-widest leading-none truncate w-full">{leave.leave_type.substring(0,6)}</span>
                                      <span className="text-rose-400 font-bold text-[7px] md:text-[8px] uppercase leading-none mt-0.5 truncate w-full">{leave.status === 'APPROVED' ? 'Approved' : leave.status}</span>
                                    </div>
                                  ) : shift ? (
                                    <div className="w-full p-1.5 rounded-xl bg-white border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center relative hover:border-indigo-300 hover:shadow-md transition-all min-w-0">
                                      <span className="text-[9px] md:text-[10px] font-black text-slate-900 tracking-tight flex items-center justify-center gap-1 truncate w-full">
                                        <Clock size={10} className="text-indigo-600 shrink-0" /> <span className="truncate">Working</span>
                                      </span>
                                      {shift.assigned_area && (
                                        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mt-0.5 w-full flex justify-center items-center gap-0.5 truncate">
                                          <MapPin size={8} className="shrink-0 text-slate-400"/> <span className="truncate">{shift.assigned_area}</span>
                                        </span>
                                      )}
                                    </div>
                                  ) : null}
                               </div>
                             );
                           })}
                        </div>
                      </div>
                    );
                  })}
                  {paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {modalState === 'SHIFT' && <ShiftModal onClose={() => setModalState('NONE')} staff={data?.staff || []} />}
      {modalState === 'LEAVE' && <LeaveModal onClose={() => setModalState('NONE')} staff={data?.staff || []} />}
    </div>
  );
}

// ============================================================================
// MODAL: ADD AD-HOC SHIFT
// ============================================================================
function ShiftModal({ onClose, staff }: { onClose: () => void, staff: any[] }) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => rotaService.saveShift(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rota_matrix'] });
      toast.success('Shift added successfully.');
      onClose();
    },
    onError: (err: any) => setErrorMsg(err.message || 'Failed to save shift.')
  });

  const form = useForm({
    defaultValues: {
      user_id: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      start_time: '09:00',
      end_time: '17:00',
      assigned_area: '',
      notes: ''
    },
    onSubmit: async ({ value }) => {
      setErrorMsg(null);
      await saveMutation.mutateAsync({
        user_id: value.user_id,
        start_time: `${value.date}T${value.start_time}:00Z`,
        end_time: `${value.date}T${value.end_time}:00Z`,
        assigned_area: value.assigned_area,
        notes: value.notes,
        status: 'SCHEDULED'
      });
    }
  });

  const inputClass = "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs lg:text-sm font-bold text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm placeholder:text-slate-400";
  const labelClass = "text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block";

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-sans overflow-y-auto custom-scrollbar">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md flex flex-col shadow-2xl relative overflow-hidden my-auto animate-in zoom-in-95 duration-200">
        <div className="bg-slate-50 border-b border-slate-100 p-5 flex justify-between items-center z-20 shrink-0 rounded-t-2xl">
          <div>
            <h2 className="text-sm lg:text-base font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
              <Clock size={16} className="text-indigo-600"/> Add Ad-Hoc Shift
            </h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Direct rota scheduling entry</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[75vh]">
          <form id="shift-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="space-y-4">
            {errorMsg && <div className="p-3 bg-rose-50 text-rose-700 text-xs font-bold rounded-xl border border-rose-200">{errorMsg}</div>}
            
            <form.Field name="user_id">
              {(field) => (
                <div>
                  <label className={labelClass}>Staff Member *</label>
                  <select required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass}>
                    <option value="">Select Staff...</option>
                    {staff
                      .filter((s: any) => !s.is_deleted && s.is_active !== false)
                      .map((s: any) => <option key={s.id} value={s.id}>{s.name || s.email}</option>)}
                  </select>
                </div>
              )}
            </form.Field>

            <form.Field name="date">
              {(field) => (
                <div>
                  <label className={labelClass}>Shift Date *</label>
                  <input type="date" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                </div>
              )}
            </form.Field>

            <form.Field name="assigned_area">
              {(field) => (
                <div>
                  <label className={labelClass}>Assigned Area (Optional)</label>
                  <input type="text" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} placeholder="e.g. Birds of Prey Section" className={inputClass} />
                </div>
              )}
            </form.Field>

            <form.Field name="notes">
              {(field) => (
                <div>
                  <label className={labelClass}>Shift Notes (Optional)</label>
                  <textarea value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} rows={2} className={`${inputClass} resize-none h-20`} placeholder="Specific instructions for this shift..." />
                </div>
              )}
            </form.Field>
          </form>
        </div>

        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 z-20 shrink-0 rounded-b-2xl">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors">
            Cancel
          </button>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <button 
                type="submit" 
                form="shift-form"
                disabled={!canSubmit || isSubmitting as boolean || saveMutation.isPending} 
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95"
              >
                {(isSubmitting || saveMutation.isPending) ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14} />}
                <span>Save Shift</span>
              </button>
            )}
          </form.Subscribe>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MODAL: LOG ABSENCE
// ============================================================================
function LeaveModal({ onClose, staff }: { onClose: () => void, staff: any[] }) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => rotaService.saveLeave(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rota_matrix'] });
      toast.success('Absence logged successfully.');
      onClose();
    },
    onError: (err: any) => setErrorMsg(err.message || 'Failed to save absence.')
  });

  const form = useForm({
    defaultValues: {
      user_id: '',
      start_date: format(new Date(), 'yyyy-MM-dd'),
      end_date: format(new Date(), 'yyyy-MM-dd'),
      leave_type: 'ANNUAL_LEAVE',
      reason: ''
    },
    onSubmit: async ({ value }) => {
      setErrorMsg(null);
      await saveMutation.mutateAsync({
        user_id: value.user_id,
        start_date: value.start_date,
        end_date: value.end_date,
        leave_type: value.leave_type,
        reason: value.reason,
        status: 'APPROVED'
      });
    }
  });

  const inputClass = "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs lg:text-sm font-bold text-slate-900 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 transition-all shadow-sm placeholder:text-slate-400";
  const labelClass = "text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block";

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-sans overflow-y-auto custom-scrollbar">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md flex flex-col shadow-2xl relative overflow-hidden my-auto animate-in zoom-in-95 duration-200">
        <div className="bg-slate-50 border-b border-slate-100 p-5 flex justify-between items-center z-20 shrink-0 rounded-t-2xl">
          <div>
            <h2 className="text-sm lg:text-base font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
              <Umbrella size={16} className="text-rose-600"/> Log Absence
            </h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Leave & absence entry</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[75vh]">
          <form id="leave-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="space-y-4">
            {errorMsg && <div className="p-3 bg-rose-50 text-rose-700 text-xs font-bold rounded-xl border border-rose-200">{errorMsg}</div>}
            
            <form.Field name="user_id">
              {(field) => (
                <div>
                  <label className={labelClass}>Staff Member *</label>
                  <select required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass}>
                    <option value="">Select Staff...</option>
                    {staff
                      .filter((s: any) => !s.is_deleted && s.is_active !== false)
                      .map((s: any) => <option key={s.id} value={s.id}>{s.name || s.email}</option>)}
                  </select>
                </div>
              )}
            </form.Field>

            <div className="grid grid-cols-2 gap-4">
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
                    <label className={labelClass}>End Date *</label>
                    <input type="date" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="leave_type">
              {(field) => (
                <div>
                  <label className={labelClass}>Absence Type *</label>
                  <select required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass}>
                    <option value="ANNUAL_LEAVE">Annual Leave (Holiday)</option>
                    <option value="SICK">Sick Leave</option>
                    <option value="UNPAID">Unpaid Leave</option>
                    <option value="TRAINING">External Training</option>
                  </select>
                </div>
              )}
            </form.Field>

            <form.Field name="reason">
              {(field) => (
                <div>
                  <label className={labelClass}>Reason / Notes</label>
                  <textarea value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} rows={2} className={`${inputClass} resize-none h-20`} placeholder="Optional notes..." />
                </div>
              )}
            </form.Field>
          </form>
        </div>

        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 z-20 shrink-0 rounded-b-2xl">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors">
            Cancel
          </button>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <button 
                type="submit" 
                form="leave-form"
                disabled={!canSubmit || isSubmitting as boolean || saveMutation.isPending} 
                className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 flex items-center gap-2 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95"
              >
                {(isSubmitting || saveMutation.isPending) ? <Loader2 size={14} className="animate-spin"/> : <Umbrella size={14} />}
                <span>Save Absence</span>
              </button>
            )}
          </form.Subscribe>
        </div>
      </div>
    </div>
  );
}

export default RotaPage;