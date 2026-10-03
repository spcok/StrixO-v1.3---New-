import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, queryOptions, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  Clock, CheckCircle2, AlertCircle, Loader2, Calendar, 
  Search, UserCircle, Users, User, Filter, ArrowRight 
} from 'lucide-react';
import { format, parseISO, differenceInMinutes } from 'date-fns';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { timesheetService } from '../services/timesheetService';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const staffMembersOptions = queryOptions({
  queryKey: ['staff_members'],
  queryFn: () => timesheetService.getStaffMembers(),
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

const timesheetsOptions = (userId: string) => queryOptions({
  queryKey: ['timesheets', userId],
  queryFn: () => timesheetService.getTimesheets(userId),
  enabled: !!userId,
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

// ------------------------------------------------------------------
// 2. ROUTE CONFIGURATION
// ------------------------------------------------------------------
export const Route = createFileRoute('/staff/timesheets')({
  loader: async ({ context: { queryClient } }) => {
    // @ts-ignore
    if (queryClient) await queryClient.ensureQueryData(staffMembersOptions);
  },
  component: TimesheetsPage,
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
export function TimesheetsPage() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const isMobile = useIsMobile();
  const scrollParentRef = useRef<HTMLDivElement>(null);
  
  const canViewAll = profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.role === 'HR';
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PENDING' | 'APPROVED'>('ALL');

  useEffect(() => {
    if (user?.id && !selectedUserId) {
      setSelectedUserId(user.id);
    }
  }, [user?.id, selectedUserId]);

  // Realtime Sync
  useEffect(() => {
    const channel = supabase
      .channel('timesheets-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'timesheets' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['timesheets'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data: timesheets = [], isLoading: loadingTimesheets } = useQuery(timesheetsOptions(selectedUserId));
  const { data: staffMembers = [], isLoading: loadingStaff } = useQuery(staffMembersOptions);

  const isLoading = loadingTimesheets || loadingStaff;
  const staffMap = useMemo(() => new Map(staffMembers.map((s: any) => [s.id, s])), [staffMembers]);

  // Client-Side Search and Tab Filtering
  const filteredTimesheets = useMemo(() => {
    let result = timesheets;

    if (statusFilter === 'ACTIVE') {
      result = result.filter((r: any) => !r.clock_out_time);
    } else if (statusFilter === 'PENDING') {
      result = result.filter((r: any) => r.clock_out_time && r.status !== 'APPROVED');
    } else if (statusFilter === 'APPROVED') {
      result = result.filter((r: any) => r.status === 'APPROVED');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((record: any) => {
        const staff = staffMap.get(record.user_id);
        const name = (staff?.name || '').toLowerCase();
        const email = (staff?.email || '').toLowerCase();
        const role = (staff?.role || '').toLowerCase();
        const status = (record.status || '').toLowerCase();

        return name.includes(q) || email.includes(q) || role.includes(q) || status.includes(q);
      });
    }

    return result;
  }, [timesheets, searchQuery, statusFilter, staffMap]);

  // Virtualizer Setup
  const rowVirtualizer = useVirtualizer({
    count: filteredTimesheets.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => isMobile ? 180 : 80,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const tableGridCols = "minmax(180px, 1.3fr) minmax(220px, 1.6fr) minmax(200px, 1.4fr) minmax(150px, 1.1fr) minmax(130px, 0.9fr)";

  const tabs = [
    { id: 'ALL', label: 'All Records' },
    { id: 'ACTIVE', label: 'On Duty (Active)' },
    { id: 'PENDING', label: 'Pending Approval' },
    { id: 'APPROVED', label: 'Approved' }
  ] as const;

  const formatDuration = (startIso: string, endIso: string | null) => {
    if (!endIso) return 'In Progress';
    const start = parseISO(startIso);
    const end = parseISO(endIso);
    const totalMinutes = differenceInMinutes(end, start);
    if (isNaN(totalMinutes) || totalMinutes < 0) return '--';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-5 lg:space-y-6 animate-in fade-in duration-500 w-full">
      
      {/* --- BLOCK A: HEADER RIBBON --- */}
      <div className="flex justify-between items-start w-full mb-2 lg:mb-4 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1.5 lg:gap-2">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
             Timesheets
           </h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
             Attendance, Shift Tracking & Hours Sign-Off
           </p>
        </div>
      </div>

      {/* --- BLOCK B: CONTROL DECK --- */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] lg:w-80 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search staff, role, status..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm placeholder:text-slate-400 font-medium"
          />
        </div>

        {/* Staff Member Selector Dropdown */}
        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end">
          <div className="flex items-center bg-white rounded-xl px-3 py-1.5 border border-slate-200 shadow-sm w-full sm:w-auto gap-2">
            <Filter size={14} className="text-slate-400 shrink-0" />
            <select 
              value={selectedUserId} 
              onChange={(e) => setSelectedUserId(e.target.value)} 
              disabled={!canViewAll} 
              className="bg-transparent text-xs font-bold text-slate-800 border-none focus:ring-0 cursor-pointer outline-none p-0 w-full sm:w-60 truncate disabled:opacity-50"
            >
              {canViewAll && <option value="ALL">All Staff Members</option>}
              {staffMembers.map((staff: any) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name || staff.email} {staff.id === user?.id ? '(Me)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* --- BLOCK C: CATEGORY TABS (Pill Design) --- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:flex lg:gap-2 w-full shrink-0 gap-1.5 overflow-x-auto pb-1 lg:pb-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setStatusFilter(tab.id as any)}
            className={`px-3 lg:px-4 py-1.5 lg:py-2 rounded-xl text-[9px] lg:text-xs font-black uppercase tracking-widest whitespace-nowrap lg:whitespace-normal transition-all shadow-sm flex items-center justify-center gap-1.5 ${
              statusFilter === tab.id 
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
              <Loader2 className="animate-spin text-indigo-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Syncing Timesheet Data...</span>
            </div>
          </div>
        )}

        <div ref={scrollParentRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50/30">
          
          {/* Desktop Table Header */}
          <div className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
            <div className="px-5 py-4 flex items-center justify-start text-left">Date Logged</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Staff Member</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Clock In → Clock Out</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Shift Duration</div>
            <div className="px-5 py-4 flex items-center justify-end text-right">Status</div>
          </div>

          <div className="p-3 lg:p-0">
            {filteredTimesheets.length === 0 && !isLoading ? (
              <div className="p-8 lg:p-12 text-center text-slate-500 flex flex-col items-center">
                <div className="w-12 h-12 lg:w-16 lg:h-16 bg-white rounded-xl lg:rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                  <Clock size={24} className="text-slate-400" />
                </div>
                <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">No timesheets found</p>
                <p className="text-[10px] lg:text-xs font-medium">Try adjusting your search terms or staff selection.</p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const record = filteredTimesheets[virtualRow.index];
                  const staff = staffMap.get(record.user_id);
                  const inTime = parseISO(record.clock_in_time);
                  const outTime = record.clock_out_time ? parseISO(record.clock_out_time) : null;
                  const isActive = !record.clock_out_time;

                  return (
                    <div 
                      key={record.id || virtualRow.index} 
                      className={`absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border border-slate-200 lg:border-none lg:border-b border-b-slate-100 rounded-xl lg:rounded-none p-3.5 lg:p-0 transition-colors shadow-sm lg:shadow-none gap-3 lg:gap-0 box-border ${
                        isActive ? 'bg-indigo-50/20 hover:bg-indigo-50/40' : 'bg-white hover:bg-slate-50'
                      }`}
                      style={{ 
                        gridTemplateColumns: isMobile ? '1fr' : tableGridCols,
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
                      {/* 1. Date Logged */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Date</div>}
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs font-bold text-slate-800 w-fit">
                          <Calendar size={12} className="text-slate-400 shrink-0" />
                          {format(inTime, 'dd MMM yyyy')}
                        </span>
                      </div>

                      {/* 2. Staff Identity Block */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-2 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Staff Member</div>}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-700 shrink-0">
                            <UserCircle size={18} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs lg:text-sm font-bold text-slate-900 truncate" title={staff?.name || staff?.email || 'Unknown User'}>
                              {staff?.name || staff?.email || 'Unknown User'}
                            </p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate">
                              {staff?.role ? staff.role.replace(/_/g, ' ') : 'Staff'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* 3. Clock In → Clock Out */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1.5 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Time Log</div>}
                        <div className="flex items-center gap-2 text-xs font-bold">
                          <span className="bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 text-slate-800">
                            {format(inTime, 'HH:mm')}
                          </span>
                          <ArrowRight size={12} className="text-slate-400 shrink-0" />
                          {outTime ? (
                            <span className="bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 text-slate-800">
                              {format(outTime, 'HH:mm')}
                            </span>
                          ) : (
                            <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest animate-pulse">
                              On Duty
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 4. Shift Duration */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Duration</div>}
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                          <Clock size={12} className="text-slate-400 shrink-0" />
                          <span>{formatDuration(record.clock_in_time, record.clock_out_time)}</span>
                        </div>
                      </div>

                      {/* 5. Status Badge */}
                      <div className={`w-full lg:px-5 lg:py-3.5 flex min-w-0 ${isMobile ? 'justify-end pt-2 border-t border-slate-100 mt-1' : 'items-center justify-end'}`}>
                        {record.status === 'APPROVED' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200">
                            <CheckCircle2 size={11} /> Approved
                          </span>
                        ) : isActive ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest text-indigo-700 bg-indigo-50 border border-indigo-200">
                            <Clock size={11} /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest text-amber-700 bg-amber-50 border border-amber-200">
                            <AlertCircle size={11} /> Pending
                          </span>
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

    </div>
  );
}

export default TimesheetsPage;