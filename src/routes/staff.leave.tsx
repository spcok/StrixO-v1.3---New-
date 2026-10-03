import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  Umbrella, Plus, Loader2, CheckCircle2, XCircle, Trash2, 
  Calendar, Search, UserCircle, Check, X, Clock, AlertCircle 
} from 'lucide-react';
import { format, parseISO, formatISO, differenceInDays } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { leaveService } from '../services/leaveService';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const getLeaveRequestsOptions = (activeTab: 'MY_REQUESTS' | 'APPROVALS', userId: string | undefined, isManager: boolean) => queryOptions({
  queryKey: ['leave_requests', activeTab, userId],
  queryFn: () => activeTab === 'APPROVALS' && isManager 
    ? leaveService.getAllRequests() 
    : leaveService.getMyRequests(userId!),
  enabled: !!userId,
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

// ------------------------------------------------------------------
// 2. ROUTE CONFIGURATION
// ------------------------------------------------------------------
export const Route = createFileRoute('/staff/leave')({
  component: LeaveDashboardPage,
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
export function LeaveDashboardPage() {
  const queryClient = useQueryClient();
  const { user, profile, hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const scrollParentRef = useRef<HTMLDivElement>(null);
  
  const isManager = hasPermission('staff:manage') || profile?.role === 'ADMIN' || profile?.role === 'MANAGER' || profile?.role === 'HR';

  const [activeTab, setActiveTab] = useState<'MY_REQUESTS' | 'APPROVALS'>('MY_REQUESTS');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Supabase Realtime Sync
  useEffect(() => {
    const channel = supabase.channel('leave-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
        queryClient.invalidateQueries({ queryKey: ['leave_requests'] });
        queryClient.invalidateQueries({ queryKey: ['rota_matrix'] });
      }).subscribe();
      
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const { data: requests = [], isLoading } = useQuery(getLeaveRequestsOptions(activeTab, user?.id, isManager));

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string, status: 'APPROVED' | 'REJECTED' }) => leaveService.updateStatus(id, status, user!.id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['leave_requests'] });
      queryClient.invalidateQueries({ queryKey: ['rota_matrix'] }); 
      toast.success(`Request marked as ${variables.status.toLowerCase()}.`);
    },
    onError: (err: any) => {
      toast.error(`Status update failed: ${err.message}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => leaveService.deleteRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave_requests'] });
      queryClient.invalidateQueries({ queryKey: ['rota_matrix'] });
      toast.success('Leave request removed.');
    },
    onError: (err: any) => {
      toast.error(`Delete failed: ${err.message}`);
    }
  });

  const pendingCount = isManager && activeTab === 'APPROVALS' 
    ? requests.filter((r: any) => r.status === 'PENDING').length 
    : 0;

  // Filter Data
  const filteredRequests = useMemo(() => {
    let result = requests;

    if (statusFilter !== 'ALL') {
      result = result.filter((r: any) => r.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((r: any) => 
        (r.users?.name || '').toLowerCase().includes(q) ||
        (r.leave_type || '').toLowerCase().includes(q) ||
        (r.reason || '').toLowerCase().includes(q) ||
        (r.status || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [requests, statusFilter, searchQuery]);

  // Virtualizer Setup
  const rowVirtualizer = useVirtualizer({
    count: filteredRequests.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => isMobile ? 180 : 80,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  
  const tableGridCols = activeTab === 'APPROVALS'
    ? "minmax(220px, 1.6fr) minmax(200px, 1.4fr) minmax(180px, 1.2fr) minmax(200px, 1.4fr) minmax(110px, 0.8fr) minmax(120px, 0.9fr)"
    : "minmax(220px, 1.6fr) minmax(200px, 1.4fr) minmax(260px, 1.8fr) minmax(120px, 0.9fr) minmax(90px, 0.6fr)";

  const statusPills = ['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const;

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-5 lg:space-y-6 animate-in fade-in duration-500 w-full">
      
      {/* --- BLOCK A: HEADER RIBBON --- */}
      <div className="flex justify-between items-start w-full mb-2 lg:mb-4 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1.5 lg:gap-2">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
             Holiday & Absence
           </h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
             Staff Self-Service & Leave Management
           </p>
        </div>
        
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-3 lg:px-4 py-2 lg:py-2.5 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
        >
          <Plus size={14} className="text-indigo-400" />
          <span>Request Leave</span>
        </button>
      </div>

      {/* --- BLOCK B: CONTROL DECK --- */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] lg:w-80 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search by staff, leave type, reason..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm placeholder:text-slate-400 font-medium" 
          />
        </div>

        {/* View Switcher: My Requests vs Team Approvals */}
        {isManager && (
          <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200 shadow-sm w-full sm:w-auto">
            <button 
              onClick={() => setActiveTab('MY_REQUESTS')} 
              className={`flex-1 sm:flex-none px-3.5 py-1.5 text-[9px] lg:text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                activeTab === 'MY_REQUESTS' 
                  ? 'bg-slate-900 text-white shadow-sm' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              My Requests
            </button>
            <button 
              onClick={() => setActiveTab('APPROVALS')} 
              className={`flex-1 sm:flex-none px-3.5 py-1.5 text-[9px] lg:text-[10px] font-black uppercase tracking-widest rounded-lg transition-all relative ${
                activeTab === 'APPROVALS' 
                  ? 'bg-slate-900 text-white shadow-sm' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Team Inbox
              {pendingCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.2 text-[8px] bg-rose-500 text-white rounded-full font-black">
                  {pendingCount}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* --- BLOCK C: STATUS TABS (Pill Design) --- */}
      <div className="flex gap-1.5 w-full shrink-0 overflow-x-auto pb-1 lg:pb-0">
        {statusPills.map(status => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-3 lg:px-4 py-1.5 lg:py-2 rounded-xl text-[9px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm flex items-center justify-center gap-1.5 ${
              statusFilter === status 
                ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20' 
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* --- BLOCK D: CHAMELEON DATA GRID --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden relative mt-1">
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
            <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
              <Loader2 className="animate-spin text-indigo-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Syncing Leave Records...</span>
            </div>
          </div>
        )}

        <div ref={scrollParentRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50/30">
          
          {/* Desktop Table Header */}
          <div className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
            <div className="px-5 py-4 flex items-center justify-start text-left">Absence Type</div>
            {activeTab === 'APPROVALS' && <div className="px-5 py-4 flex items-center justify-start text-left">Staff Member</div>}
            <div className="px-5 py-4 flex items-center justify-start text-left">Dates & Duration</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Reason / Context</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Status</div>
            <div className="px-5 py-4 flex items-center justify-end text-right">Actions</div>
          </div>

          <div className="p-3 lg:p-0">
            {filteredRequests.length === 0 && !isLoading ? (
              <div className="p-8 lg:p-12 text-center text-slate-500 flex flex-col items-center">
                <div className="w-12 h-12 lg:w-16 lg:h-16 bg-white rounded-xl lg:rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                  <Umbrella size={24} className="text-slate-400" />
                </div>
                <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">No leave requests found</p>
                <p className="text-[10px] lg:text-xs font-medium">Use "Request Leave" above to log a new absence.</p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const req = filteredRequests[virtualRow.index];
                  const sDate = parseISO(req.start_date);
                  const eDate = parseISO(req.end_date);
                  const days = differenceInDays(eDate, sDate) + 1; 

                  return (
                    <div 
                      key={req.id || virtualRow.index} 
                      className="absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border border-slate-200 lg:border-none lg:border-b border-b-slate-100 rounded-xl lg:rounded-none bg-white p-3.5 lg:p-0 hover:bg-slate-50 transition-colors shadow-sm lg:shadow-none gap-3 lg:gap-0 box-border"
                      style={{ 
                        gridTemplateColumns: isMobile ? '1fr' : tableGridCols,
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
                      {/* 1. Absence Type */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Absence Type</div>}
                        <span className="px-2.5 py-1 rounded-lg text-[9px] lg:text-[10px] font-black uppercase tracking-widest bg-slate-100 border border-slate-200 text-slate-800 w-fit">
                          {req.leave_type.replace(/_/g, ' ')}
                        </span>
                      </div>

                      {/* 2. Staff Member (Only in Approvals View) */}
                      {activeTab === 'APPROVALS' && (
                        <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-2 lg:gap-0">
                          {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Staff Member</div>}
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-700 shrink-0">
                              <UserCircle size={18} />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs lg:text-sm font-bold text-slate-900 truncate" title={req.users?.name || 'Unknown'}>
                                {req.users?.name || 'Unknown'}
                              </p>
                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate">
                                {req.users?.role ? req.users.role.replace(/_/g, ' ') : 'Staff'}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 3. Dates & Duration */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Schedule</div>}
                        <div className="space-y-1 w-full">
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900">
                            <Calendar size={12} className="text-slate-400 shrink-0" />
                            {format(sDate, 'dd MMM yyyy')} – {format(eDate, 'dd MMM yyyy')}
                          </span>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                            Duration: <span className="text-slate-900 font-black">{days} Day{days > 1 ? 's' : ''}</span>
                          </p>
                        </div>
                      </div>

                      {/* 4. Reason / Context */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 pt-2 border-t border-slate-100">Reason / Notes</div>}
                        <p className="text-xs font-medium text-slate-600 line-clamp-2 leading-relaxed" title={req.reason || 'None provided'}>
                          {req.reason || <span className="text-slate-400 text-[10px] uppercase font-bold tracking-widest">No context provided</span>}
                        </p>
                      </div>

                      {/* 5. Status Badge */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Status</div>}
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border w-fit ${
                          req.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          req.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                          'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>
                          {req.status === 'APPROVED' ? <CheckCircle2 size={11} /> : req.status === 'REJECTED' ? <XCircle size={11} /> : <AlertCircle size={11} />}
                          {req.status}
                        </span>
                      </div>

                      {/* 6. Actions */}
                      <div className={`w-full lg:px-5 lg:py-3.5 flex min-w-0 ${isMobile ? 'justify-end pt-2 border-t border-slate-100 mt-1' : 'items-center justify-end'}`}>
                        {activeTab === 'APPROVALS' && req.status === 'PENDING' ? (
                          <div className="flex items-center gap-1.5 justify-end">
                            <button 
                              onClick={() => updateStatusMutation.mutate({ id: req.id, status: 'APPROVED' })} 
                              disabled={updateStatusMutation.isPending}
                              className="p-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white border border-emerald-200 rounded-xl transition-all shadow-sm"
                              title="Approve Request"
                            >
                              <Check size={14} />
                            </button>
                            <button 
                              onClick={() => updateStatusMutation.mutate({ id: req.id, status: 'REJECTED' })} 
                              disabled={updateStatusMutation.isPending}
                              className="p-1.5 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white border border-rose-200 rounded-xl transition-all shadow-sm"
                              title="Reject Request"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          (req.status === 'PENDING' || isManager) && (
                            <button 
                              onClick={() => {
                                if (window.confirm("Are you sure you want to delete/cancel this leave request?")) {
                                  deleteMutation.mutate(req.id);
                                }
                              }}
                              disabled={deleteMutation.isPending}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                              title="Cancel Request"
                            >
                              <Trash2 size={14} />
                            </button>
                          )
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

      {/* --- SUBMIT LEAVE MODAL --- */}
      {isModalOpen && (
        <LeaveRequestModal 
          onClose={() => setIsModalOpen(false)} 
          userId={user!.id} 
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. SUBMIT LEAVE MODAL (TANSTACK FORM)
// ---------------------------------------------------------------------------
function LeaveRequestModal({ onClose, userId }: { onClose: () => void, userId: string }) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => leaveService.submitRequest(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave_requests'] });
      toast.success('Leave request submitted successfully.');
    },
    onError: (err: any) => setErrorMsg(err.message || 'Failed to submit request.')
  });

  const form = useForm({
    defaultValues: {
      start_date: format(new Date(), 'yyyy-MM-dd'),
      end_date: format(new Date(), 'yyyy-MM-dd'),
      leave_type: 'ANNUAL_LEAVE',
      reason: ''
    },
    onSubmit: ({ value }) => {
      setErrorMsg(null);

      if (parseISO(value.end_date) < parseISO(value.start_date)) {
        setErrorMsg('End date cannot be before start date.');
        return;
      }

      const payload = {
        id: crypto.randomUUID(),
        user_id: userId,
        start_date: formatISO(parseISO(value.start_date), { representation: 'date' }),
        end_date: formatISO(parseISO(value.end_date), { representation: 'date' }),
        leave_type: value.leave_type,
        reason: value.reason,
        status: 'PENDING',
        is_deleted: false
      };

      saveMutation.mutate(payload);
      onClose();
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
              <Umbrella size={16} className="text-indigo-600"/> Submit Leave Request
            </h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Staff self-service absence application</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[75vh]">
          <form id="leave-request-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="space-y-4">
            {errorMsg && <div className="p-3 bg-rose-50 text-rose-700 text-xs font-bold rounded-xl border border-rose-200">{errorMsg}</div>}

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
                  <label className={labelClass}>Absence Category *</label>
                  <select required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass}>
                    <option value="ANNUAL_LEAVE">Annual Leave (Holiday)</option>
                    <option value="SICK">Sick Leave</option>
                    <option value="UNPAID">Unpaid Leave</option>
                    <option value="TRAINING">External Training</option>
                    <option value="COMPASSIONATE">Compassionate Leave</option>
                    <option value="OTHER">Other Absence</option>
                  </select>
                </div>
              )}
            </form.Field>

            <form.Field name="reason">
              {(field) => (
                <div>
                  <label className={labelClass}>Reason / Notes (Optional)</label>
                  <textarea value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} rows={3} className={`${inputClass} resize-none h-24`} placeholder="Provide any additional context or hand-over notes..." />
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
                form="leave-request-form"
                disabled={!canSubmit || isSubmitting as boolean} 
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95"
              >
                {isSubmitting && <Loader2 size={14} className="animate-spin"/>}
                <span>Submit Request</span>
              </button>
            )}
          </form.Subscribe>
        </div>
      </div>
    </div>
  );
}

export default LeaveDashboardPage;