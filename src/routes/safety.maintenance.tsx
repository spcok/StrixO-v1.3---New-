import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  Wrench, Plus, X, Search, Save, Loader2, AlertCircle, 
  HardHat, Calendar, Clock, MapPin, CheckCircle2, AlertTriangle, UserCircle
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { maintenanceService } from '../services/maintenanceService';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const ticketsOptions = queryOptions({
  queryKey: ['maintenance_tickets'],
  queryFn: () => maintenanceService.getTickets(),
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

const staffOptions = queryOptions({
  queryKey: ['staff_members'],
  queryFn: () => maintenanceService.getStaffMembers(),
  staleTime: 1000 * 60 * 60,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

// ------------------------------------------------------------------
// 2. ROUTE CONFIGURATION
// ------------------------------------------------------------------
export const Route = createFileRoute('/safety/maintenance')({
  loader: async ({ context: { queryClient } }) => {
    if (queryClient) {
      // @ts-ignore
      await Promise.all([
        queryClient.ensureQueryData(ticketsOptions),
        queryClient.ensureQueryData(staffOptions)
      ]);
    }
  },
  component: MaintenanceTicketsPage,
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
export function MaintenanceTicketsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const scrollParentRef = useRef<HTMLDivElement>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_PARTS' | 'RESOLVED'>('ALL');

  // Supabase Realtime Sync
  useEffect(() => {
    const channel = supabase
      .channel('maintenance-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'maintenance_tickets' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['maintenance_tickets'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data: tickets = [], isLoading } = useQuery(ticketsOptions);
  const { data: staffMembers = [] } = useQuery(staffOptions);

  const staffMap = useMemo(() => new Map(staffMembers.map((s: any) => [s.id, s])), [staffMembers]);

  const filteredTickets = useMemo(() => {
    let result = tickets;

    if (statusFilter !== 'ALL') {
      result = result.filter((t: any) => t.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const lower = searchQuery.toLowerCase();
      result = result.filter((ticket: any) => 
        (ticket.title || '').toLowerCase().includes(lower) ||
        (ticket.location || '').toLowerCase().includes(lower) ||
        (ticket.category || '').toLowerCase().includes(lower) ||
        (ticket.description || '').toLowerCase().includes(lower)
      );
    }

    return result;
  }, [tickets, searchQuery, statusFilter]);

  const rowVirtualizer = useVirtualizer({
    count: filteredTickets.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => isMobile ? 220 : 90,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const tableGridCols = "minmax(260px, 1.8fr) minmax(180px, 1.2fr) minmax(120px, 0.8fr) minmax(160px, 1.1fr) minmax(140px, 0.9fr)";

  const tabs = [
    { id: 'ALL', label: 'All Tickets' },
    { id: 'OPEN', label: 'Open' },
    { id: 'IN_PROGRESS', label: 'In Progress' },
    { id: 'WAITING_ON_PARTS', label: 'Waiting Parts' },
    { id: 'RESOLVED', label: 'Resolved' },
  ] as const;

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'CRITICAL':
        return 'text-rose-700 bg-rose-50 border-rose-200';
      case 'HIGH':
        return 'text-orange-700 bg-orange-50 border-orange-200';
      case 'MEDIUM':
        return 'text-amber-700 bg-amber-50 border-amber-200';
      default:
        return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'RESOLVED':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'IN_PROGRESS':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'WAITING_ON_PARTS':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-5 lg:space-y-6 animate-in fade-in duration-500 w-full">
      
      {/* --- BLOCK A: HEADER RIBBON --- */}
      <div className="flex justify-between items-start w-full mb-2 lg:mb-4 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1.5 lg:gap-2">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
             Maintenance Log
           </h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
             Enclosure Repairs & Infrastructure
           </p>
        </div>
        
        {hasPermission('safety:write') && (
          <button 
            onClick={() => setIsModalOpen(true)} 
            className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-3 lg:px-4 py-2 lg:py-2.5 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
          >
            <Plus size={14} className="text-blue-400" />
            <span>Submit Ticket</span>
          </button>
        )}
      </div>

      {/* --- BLOCK B: CONTROL DECK --- */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="relative flex-1 min-w-[200px] lg:w-96 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search by title, location, category..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm placeholder:text-slate-400 font-medium"
          />
        </div>
      </div>

      {/* --- BLOCK C: CATEGORY TABS (Pill Design) --- */}
      <div className="grid grid-cols-2 sm:grid-cols-5 lg:flex lg:gap-2 w-full shrink-0 gap-1.5 overflow-x-auto pb-1 lg:pb-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setStatusFilter(tab.id as any)}
            className={`px-2 lg:px-4 py-1.5 lg:py-2 rounded-xl text-[9px] lg:text-xs font-black uppercase tracking-widest whitespace-nowrap lg:whitespace-normal transition-all shadow-sm flex items-center justify-center gap-1.5 ${
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
              <Loader2 className="animate-spin text-blue-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Syncing Maintenance Tickets...</span>
            </div>
          </div>
        )}

        <div ref={scrollParentRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50/30">
          
          {/* Desktop Table Header */}
          <div className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
            <div className="px-5 py-4 flex items-center justify-start text-left">Issue Title & Location</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Date Logged & Target Due</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Priority</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Assigned Technician</div>
            <div className="px-5 py-4 flex items-center justify-end text-right">Status</div>
          </div>

          <div className="p-3 lg:p-0">
            {filteredTickets.length === 0 && !isLoading ? (
              <div className="p-8 lg:p-12 text-center text-slate-500 flex flex-col items-center">
                <div className="w-12 h-12 lg:w-16 lg:h-16 bg-white rounded-xl lg:rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                  <Wrench size={24} className="text-slate-400" />
                </div>
                <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">No tickets found</p>
                <p className="text-[10px] lg:text-xs font-medium">Try adjusting your search terms or filter tabs.</p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const ticket = filteredTickets[virtualRow.index];
                  const dateObj = new Date(ticket.created_at);
                  const dueDateObj = ticket.due_date ? new Date(ticket.due_date) : null;
                  const staff = staffMap.get(ticket.assigned_to);

                  return (
                    <div 
                      key={ticket.id} 
                      className="absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border border-slate-200 lg:border-none lg:border-b border-b-slate-100 rounded-xl lg:rounded-none bg-white p-3.5 lg:p-0 hover:bg-slate-50 transition-colors shadow-sm lg:shadow-none gap-3 lg:gap-0 box-border"
                      style={{ 
                        gridTemplateColumns: isMobile ? '1fr' : tableGridCols,
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
                      {/* 1. Issue Title & Location */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1.5 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Issue</div>}
                        <div className="space-y-1.5 w-full">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded text-[8px] lg:text-[9px] font-black uppercase tracking-widest border bg-slate-100 text-slate-700 border-slate-200">
                              {ticket.category || 'GENERAL'}
                            </span>
                            {ticket.location && (
                              <span className="inline-flex items-center gap-1 text-[9px] lg:text-[10px] font-bold text-slate-500">
                                <MapPin size={11} className="text-slate-400 shrink-0" />
                                {ticket.location}
                              </span>
                            )}
                          </div>
                          <h3 className="text-xs lg:text-sm font-bold text-slate-900 line-clamp-1 leading-snug" title={ticket.title}>
                            {ticket.title}
                          </h3>
                          {ticket.description && (
                            <p className="text-[11px] font-medium text-slate-600 line-clamp-1 leading-relaxed" title={ticket.description}>
                              {ticket.description}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* 2. Date Logged & Target Due */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Timing</div>}
                        <div className="flex flex-col gap-1 w-full">
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700">
                            <Clock size={12} className="text-slate-400 shrink-0" />
                            {format(dateObj, 'dd MMM yyyy')} <span className="text-slate-400 font-medium">{format(dateObj, 'HH:mm')}</span>
                          </span>
                          {dueDateObj ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600">
                              <Calendar size={11} className="text-slate-400 shrink-0" />
                              Target: <span className="text-slate-900 font-black">{format(dueDateObj, 'dd MMM yyyy')}</span>
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium text-slate-400">No Target Date</span>
                          )}
                        </div>
                      </div>

                      {/* 3. Priority */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Priority</div>}
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border shadow-sm w-fit ${getPriorityBadge(ticket.priority)}`}>
                          <AlertCircle size={10} />
                          {ticket.priority || 'MEDIUM'}
                        </span>
                      </div>

                      {/* 4. Assigned Technician */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Assigned Technician</div>}
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                          <HardHat size={13} className="text-blue-600 shrink-0" />
                          <span className="truncate" title={staff ? (staff.name || staff.email) : 'Unassigned (Open Queue)'}>
                            {staff ? `${staff.name || staff.email} ${staff.initials ? `(${staff.initials})` : ''}` : 'Unassigned'}
                          </span>
                        </div>
                      </div>

                      {/* 5. Status */}
                      <div className={`w-full lg:px-5 lg:py-3.5 flex min-w-0 ${isMobile ? 'justify-end pt-2 border-t border-slate-100 mt-1' : 'items-center justify-end'}`}>
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${getStatusBadge(ticket.status)}`}>
                          {ticket.status === 'RESOLVED' && <CheckCircle2 size={11} className="text-emerald-600" />}
                          {(ticket.status || 'OPEN').replace(/_/g, ' ')}
                        </span>
                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {isModalOpen && (
        <MaintenanceModal 
          onClose={() => setIsModalOpen(false)} 
          staffMembers={staffMembers} 
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. NEW TICKET MODAL COMPONENT
// ---------------------------------------------------------------------------
function MaintenanceModal({ onClose, staffMembers }: { onClose: () => void, staffMembers: any[] }) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => maintenanceService.saveTicket(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance_tickets'] });
      toast.success('Maintenance ticket submitted successfully.');
      onClose();
    },
    onError: (err: any) => setErrorMsg(err.message || 'Failed to submit ticket.')
  });

  const form = useForm({
    defaultValues: {
      title: '', 
      location: '', 
      category: 'ENCLOSURE REPAIR', 
      priority: 'MEDIUM',
      due_date: '', 
      assigned_to: '', 
      description: '', 
      status: 'OPEN'
    },
    onSubmit: async ({ value }) => {
      setErrorMsg(null);
      await saveMutation.mutateAsync({
        title: value.title,
        location: value.location,
        category: value.category,
        priority: value.priority,
        due_date: value.due_date ? new Date(value.due_date).toISOString() : null,
        assigned_to: value.assigned_to || null,
        description: value.description,
        status: value.status
      });
    }
  });

  const inputClass = "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs lg:text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm placeholder:text-slate-400";
  const labelClass = "text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block";

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-sans overflow-y-auto custom-scrollbar">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl relative overflow-hidden my-auto animate-in zoom-in-95 duration-200">
        
        <div className="bg-slate-50 border-b border-slate-100 p-5 flex justify-between items-center z-20 shrink-0 rounded-t-2xl">
          <div>
            <h2 className="text-base lg:text-lg font-black text-slate-900 uppercase tracking-tight">
              Maintenance Request
            </h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Enclosure & infrastructure repair entry</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[75vh]">
          <form id="maintenance-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="space-y-5">
            {errorMsg && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-bold shadow-sm">
                {errorMsg}
              </div>
            )}

            <form.Field name="title">
              {(field) => (
                <div>
                  <label className={labelClass}>Issue Title *</label>
                  <input type="text" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} placeholder="E.g., Broken hinge on Aviary Gate 3" className={inputClass} />
                </div>
              )}
            </form.Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <form.Field name="location">
                {(field) => (
                  <div>
                    <label className={labelClass}>Location / Enclosure *</label>
                    <input type="text" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} placeholder="E.g., Aviary 4" className={inputClass} />
                  </div>
                )}
              </form.Field>

              <form.Field name="due_date">
                {(field) => (
                  <div>
                    <label className={labelClass}>Target Due Date (Optional)</label>
                    <input type="date" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                  </div>
                )}
              </form.Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <form.Field name="category">
                {(field) => (
                  <div>
                    <label className={labelClass}>Category *</label>
                    <select value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} required>
                      <option value="ENCLOSURE REPAIR">Enclosure Repair</option>
                      <option value="PLUMBING">Plumbing & Water Systems</option>
                      <option value="ELECTRICAL">Electrical & Heating</option>
                      <option value="LANDSCAPING">Landscaping & Fencing</option>
                      <option value="VEHICLE">Vehicle Maintenance</option>
                      <option value="GENERAL">General / Facility</option>
                    </select>
                  </div>
                )}
              </form.Field>

              <form.Field name="priority">
                {(field) => (
                  <div>
                    <label className={labelClass}>Priority Level *</label>
                    <select value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} required>
                      <option value="LOW">LOW (Cosmetic / Non-Urgent)</option>
                      <option value="MEDIUM">MEDIUM (Standard Repair)</option>
                      <option value="HIGH">HIGH (Affects Operations)</option>
                      <option value="CRITICAL">CRITICAL (Animal Security / Health Risk)</option>
                    </select>
                  </div>
                )}
              </form.Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <form.Field name="assigned_to">
                {(field) => (
                  <div>
                    <label className={labelClass}>Assign Technician</label>
                    <select value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass}>
                      <option value="">-- Unassigned (Open Queue) --</option>
                      {staffMembers
                        .filter((staff: any) => !staff.is_deleted && staff.is_active !== false)
                        .map((staff: any) => (
                          <option key={staff.id} value={staff.id}>
                            {staff.name || staff.email} {staff.initials ? `(${staff.initials})` : ''}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </form.Field>

              <form.Field name="status">
                {(field) => (
                  <div>
                    <label className={labelClass}>Status *</label>
                    <select value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} required>
                      <option value="OPEN">OPEN - New Ticket</option>
                      <option value="IN_PROGRESS">IN PROGRESS - Working</option>
                      <option value="WAITING_ON_PARTS">WAITING ON PARTS</option>
                      <option value="RESOLVED">RESOLVED - Completed</option>
                    </select>
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="description">
              {(field) => (
                <div>
                  <label className={labelClass}>Work Description *</label>
                  <textarea required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} rows={3} className={`${inputClass} resize-none h-24`} placeholder="Provide precise details of the required repair..." />
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
                form="maintenance-form" 
                disabled={!canSubmit || isSubmitting as boolean || saveMutation.isPending} 
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95"
              >
                {(isSubmitting || saveMutation.isPending) ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                <span>Submit Ticket</span>
              </button>
            )}
          </form.Subscribe>
        </div>
      </div>
    </div>
  );
}

export default MaintenanceTicketsPage;