import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  ShieldAlert, Plus, X, Search, Save, Loader2, AlertTriangle, 
  CheckCircle2, FileText, Clock, BriefcaseMedical, UserCircle, 
  Activity, Ambulance, AlertOctagon, CheckCircle
} from 'lucide-react';
import { format, parseISO, formatISO } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { incidentService } from '../services/incidentService';
import { firstAidService, StaffMember } from '../services/firstAidService';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const incidentsOptions = queryOptions({
  queryKey: ['incidents'],
  queryFn: () => incidentService.getIncidents(),
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

const staffMembersOptions = queryOptions({
  queryKey: ['staff_members'],
  queryFn: () => firstAidService.getStaffMembers(),
  staleTime: 1000 * 60 * 60,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

// ------------------------------------------------------------------
// 2. ROUTE CONFIGURATION
// ------------------------------------------------------------------
export const Route = createFileRoute('/safety/incidents')({
  loader: async ({ context: { queryClient } }) => {
    if (queryClient) {
      // @ts-ignore
      await Promise.all([
        queryClient.ensureQueryData(incidentsOptions),
        queryClient.ensureQueryData(staffMembersOptions)
      ]);
    }
  },
  component: IncidentsPage,
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
export function IncidentsPage() {
  const queryClient = useQueryClient();
  const { user, hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const scrollParentRef = useRef<HTMLDivElement>(null);
  
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [resolvingIncident, setResolvingIncident] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'RESOLVED'>('ALL');

  useEffect(() => {
    const channel = supabase.channel('incidents-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, () => {
        queryClient.invalidateQueries({ queryKey: ['incidents'] });
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const { data: incidents = [], isLoading } = useQuery(incidentsOptions);
  const { data: staffMembers = [] } = useQuery(staffMembersOptions);

  const filteredIncidents = useMemo(() => {
    let result = incidents;
    if (statusFilter !== 'ALL') {
      result = result.filter((inc: any) => inc.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const lower = searchQuery.toLowerCase();
      result = result.filter((inc: any) => 
        (inc.title || '').toLowerCase().includes(lower) ||
        (inc.description || '').toLowerCase().includes(lower) ||
        (inc.incident_type || '').toLowerCase().includes(lower) ||
        (inc.immediate_action_taken || '').toLowerCase().includes(lower) ||
        (inc.resolution_notes || '').toLowerCase().includes(lower)
      );
    }
    return result;
  }, [incidents, searchQuery, statusFilter]);

  const rowVirtualizer = useVirtualizer({
    count: filteredIncidents.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => isMobile ? 220 : 90,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  const resolveMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string, notes: string }) => {
      await incidentService.resolveIncident(id, notes);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      toast.success('Incident marked as resolved.');
      setResolvingIncident(null);
    },
    onError: (err: any) => {
      toast.error(`Failed to resolve incident: ${err.message}`);
    }
  });

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'HIGH':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'MEDIUM':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const tableGridCols = "minmax(280px, 2fr) minmax(180px, 1.2fr) minmax(260px, 1.8fr) minmax(160px, 1fr)";

  const tabs = [
    { id: 'ALL', label: 'All Breaches' },
    { id: 'OPEN', label: 'Open Actions' },
    { id: 'RESOLVED', label: 'Resolved' }
  ] as const;

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-5 lg:space-y-6 animate-in fade-in duration-500 w-full">
      
      {/* --- BLOCK A: HEADER RIBBON --- */}
      <div className="flex justify-between items-start w-full mb-2 lg:mb-4 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1.5 lg:gap-2">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
             Operational Incidents
           </h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
             ZLA Compliance & Breach Logging
           </p>
        </div>
        
        {hasPermission('safety:write') && (
          <button 
            onClick={() => setIsNewModalOpen(true)} 
            className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-3 lg:px-4 py-2 lg:py-2.5 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
          >
            <Plus size={14} className="text-amber-400" />
            <span>Log Incident</span>
          </button>
        )}
      </div>

      {/* --- BLOCK B: CONTROL DECK --- */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="relative flex-1 min-w-[200px] lg:w-96 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search breach titles, descriptions, actions..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all shadow-sm placeholder:text-slate-400 font-medium"
          />
        </div>
      </div>

      {/* --- BLOCK C: CATEGORY TABS (Pill Design) --- */}
      <div className="grid grid-cols-3 lg:flex lg:gap-2 w-full shrink-0 gap-1.5 overflow-x-auto pb-1 lg:pb-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setStatusFilter(tab.id as any)}
            className={`px-1 lg:px-4 py-1.5 lg:py-2 rounded-xl text-[9px] lg:text-xs font-black uppercase tracking-widest whitespace-nowrap lg:whitespace-normal transition-all shadow-sm flex items-center justify-center gap-1.5 ${
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
              <Loader2 className="animate-spin text-amber-500" size={24} />
              <span className="text-sm font-bold text-slate-700">Syncing Incident Records...</span>
            </div>
          </div>
        )}

        <div ref={scrollParentRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50/30">
          
          {/* Desktop Table Header */}
          <div className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
            <div className="px-5 py-4 flex items-center justify-start text-left">Incident & Severity</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Date & Discovery</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Operational Details & Actions</div>
            <div className="px-5 py-4 flex items-center justify-end text-right">Status & Resolution</div>
          </div>

          <div className="p-3 lg:p-0">
            {filteredIncidents.length === 0 && !isLoading ? (
              <div className="p-8 lg:p-12 text-center text-slate-500 flex flex-col items-center">
                <div className="w-12 h-12 lg:w-16 lg:h-16 bg-white rounded-xl lg:rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                  <ShieldAlert size={24} className="text-slate-400" />
                </div>
                <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">No operational breaches found</p>
                <p className="text-[10px] lg:text-xs font-medium">Try adjusting your search query or status filters.</p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const inc = filteredIncidents[virtualRow.index];
                  const dateObj = new Date(inc.incident_date);
                  const isOpen = inc.status === 'OPEN';

                  return (
                    <div 
                      key={inc.id} 
                      className="absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border border-slate-200 lg:border-none lg:border-b border-b-slate-100 rounded-xl lg:rounded-none bg-white p-3.5 lg:p-0 hover:bg-slate-50 transition-colors shadow-sm lg:shadow-none gap-3 lg:gap-0 box-border"
                      style={{ 
                        gridTemplateColumns: isMobile ? '1fr' : tableGridCols,
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
                      {/* 1. Incident & Severity */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1.5 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Breach Classification</div>}
                        <div className="space-y-1.5 w-full">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] lg:text-[9px] font-black uppercase tracking-widest border ${getSeverityBadge(inc.severity)}`}>
                              <AlertOctagon size={10} />
                              {inc.severity}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[8px] lg:text-[9px] font-black uppercase tracking-widest border bg-slate-100 text-slate-700 border-slate-200">
                              {(inc.incident_type || 'OTHER').replace(/_/g, ' ')}
                            </span>
                          </div>
                          <h3 className="text-xs lg:text-sm font-bold text-slate-900 line-clamp-1 leading-snug" title={inc.title}>
                            {inc.title}
                          </h3>
                        </div>
                      </div>

                      {/* 2. Date & Discovery */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Date & Time</div>}
                        <div className="flex flex-col gap-1 w-full">
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700">
                            <Clock size={12} className="text-slate-400 shrink-0" />
                            {format(dateObj, 'dd MMM yyyy')} <span className="text-slate-400 font-medium">{format(dateObj, 'HH:mm')}</span>
                          </span>
                        </div>
                      </div>

                      {/* 3. Operational Details & Actions */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 pt-2 border-t border-slate-100">Operational Breakdown</div>}
                        <div className="space-y-1 w-full pr-2">
                          <p className="text-xs font-medium text-slate-600 line-clamp-2 leading-relaxed" title={inc.description}>
                            {inc.description}
                          </p>
                          {inc.immediate_action_taken && (
                            <p className="text-[10px] font-bold text-amber-800 line-clamp-1 flex items-center gap-1" title={inc.immediate_action_taken}>
                              <AlertTriangle size={11} className="text-amber-600 shrink-0" />
                              <span className="text-slate-500 uppercase tracking-widest text-[9px]">Action:</span> {inc.immediate_action_taken}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* 4. Status & Action */}
                      <div className={`w-full lg:px-5 lg:py-3.5 flex min-w-0 ${isMobile ? 'justify-end pt-2 border-t border-slate-100 mt-1' : 'items-center justify-end'}`}>
                        {isOpen ? (
                          hasPermission('safety:write') && (
                            <button 
                              onClick={() => setResolvingIncident(inc)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-200 bg-amber-50 text-[10px] font-black text-amber-700 uppercase tracking-widest hover:bg-amber-100 transition-colors shadow-sm active:scale-95"
                            >
                              <FileText size={13} /> Resolve & Close
                            </button>
                          )
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-[9px] font-black text-emerald-700 uppercase tracking-widest shadow-sm">
                              <CheckCircle2 size={11} className="text-emerald-600" /> Resolved
                            </span>
                            {inc.resolution_notes && (
                              <span className="text-[9px] font-medium text-slate-500 max-w-[150px] text-right truncate" title={inc.resolution_notes}>
                                {inc.resolution_notes}
                              </span>
                            )}
                          </div>
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

      {isNewModalOpen && (
        <CompoundIncidentModal onClose={() => setIsNewModalOpen(false)} userId={user?.id} staffMembers={staffMembers} />
      )}
      
      {resolvingIncident && (
        <ResolutionModal incident={resolvingIncident} onClose={() => setResolvingIncident(null)} mutation={resolveMutation} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. COMPOUND INCIDENT MODAL 
// ---------------------------------------------------------------------------
function CompoundIncidentModal({ onClose, userId, staffMembers }: { onClose: () => void, userId?: string, staffMembers: StaffMember[] }) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (payloads: { incident: any, firstAid?: any }) => {
      await incidentService.commitIncident(payloads.incident, payloads.firstAid);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['first_aid_logs'] });
      toast.success('Incident logged successfully.');
      onClose();
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Failed to sync incident record.');
    }
  });

  const form = useForm({
    defaultValues: {
      incident_date: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      title: '', incident_type: 'ESCAPE', severity: 'MEDIUM', description: '', immediate_action_taken: '',
      requires_first_aid: false, person_involved_name: '', person_type: 'KEEPER', administered_by: userId || '',
      injury_description: '', treatment_provided: '', referral_needed: false, referral_details: ''
    },
    onSubmit: async ({ value }) => {
      setErrorMsg(null);
      const parsedDate = formatISO(parseISO(value.incident_date));

      const incidentPayload = {
        title: value.title, incident_date: parsedDate, incident_type: value.incident_type,
        severity: value.severity, description: value.description, immediate_action_taken: value.immediate_action_taken, status: 'OPEN'
      };

      let firstAidPayload = undefined;
      if (value.requires_first_aid) {
        firstAidPayload = {
          incident_date: parsedDate, person_involved_name: value.person_involved_name, person_type: value.person_type,
          administered_by: value.administered_by, injury_description: value.injury_description, treatment_provided: value.treatment_provided,
          referral_needed: value.referral_needed, referral_details: value.referral_needed ? value.referral_details : null,
        };
      }
      await saveMutation.mutateAsync({ incident: incidentPayload, firstAid: firstAidPayload });
    }
  });

  const inputClass = "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs lg:text-sm font-bold text-slate-900 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all shadow-sm placeholder:text-slate-400";
  const labelClass = "text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block";

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-sans overflow-y-auto custom-scrollbar">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl relative overflow-hidden my-auto animate-in zoom-in-95 duration-200">
        <div className="bg-slate-50 border-b border-slate-100 p-5 flex justify-between items-center shrink-0 rounded-t-2xl">
          <div>
            <h2 className="text-base lg:text-lg font-black text-slate-900 uppercase tracking-tight">
              Log Operational Breach
            </h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">ZLA compliance & facility safety entry</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[75vh]">
          <form id="incident-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="space-y-5">
            {errorMsg && <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-bold shadow-sm">{errorMsg}</div>}

            <form.Field name="title">
              {(field) => (
                <div>
                  <label className={labelClass}>Incident Title *</label>
                  <input type="text" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} placeholder="e.g. Sub-adult Eagle Owl Enclosure Breach" className={inputClass} />
                </div>
              )}
            </form.Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <form.Field name="incident_date">
                {(field) => (
                  <div>
                    <label className={labelClass}>Date & Time of Discovery *</label>
                    <input type="datetime-local" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                  </div>
                )}
              </form.Field>

              <form.Field name="severity">
                {(field) => (
                  <div>
                    <label className={labelClass}>Severity Matrix *</label>
                    <select value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} required>
                      <option value="LOW">LOW - Minor disruption</option>
                      <option value="MEDIUM">MEDIUM - Controlled breach</option>
                      <option value="HIGH">HIGH - Severe incident / Escape</option>
                      <option value="CRITICAL">CRITICAL - Emergency protocol initiated</option>
                    </select>
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="incident_type">
              {(field) => (
                <div>
                  <label className={labelClass}>Incident Classification *</label>
                  <div className="flex bg-slate-50 border border-slate-200 rounded-xl p-1 shadow-sm flex-wrap gap-1">
                    {['ESCAPE', 'ANIMAL_BEHAVIOR', 'INFRASTRUCTURE', 'SLIP_TRIP_FALL', 'OTHER'].map((type) => (
                      <button key={type} type="button" onClick={() => field.handleChange(type)} className={`flex-1 min-w-[100px] py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${field.state.value === type ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-200/60'}`}>
                        {type.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </form.Field>

            <form.Field name="description">
              {(field) => (
                <div>
                  <label className={labelClass}>Operational Description *</label>
                  <textarea required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} rows={3} className={`${inputClass} resize-none h-20`} placeholder="Detailed breakdown of how the breach occurred..." />
                </div>
              )}
            </form.Field>

            <form.Field name="immediate_action_taken">
              {(field) => (
                <div>
                  <label className={labelClass}>Immediate Corrective Actions Taken *</label>
                  <textarea required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} rows={2} className={`${inputClass} resize-none h-20`} placeholder="E.g., Aviary locked down, birds secured, perimeter inspected..." />
                </div>
              )}
            </form.Field>

            <div className="pt-2 border-t border-slate-100">
              <form.Field name="requires_first_aid">
                {(field) => (
                  <label className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl cursor-pointer hover:bg-emerald-100 transition-colors shadow-sm">
                    <input type="checkbox" checked={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.checked)} className="w-4 h-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500 bg-white" />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-emerald-900 uppercase tracking-widest flex items-center gap-1.5">
                        <BriefcaseMedical size={14} /> Human Injury Sustained (Link First Aid)
                      </span>
                      <span className="text-[10px] text-emerald-700 font-medium mt-0.5">Check this if the incident resulted in an injury requiring clinical treatment.</span>
                    </div>
                  </label>
                )}
              </form.Field>

              <form.Subscribe selector={(state) => state.values.requires_first_aid}>
                {(needsFirstAid) => needsFirstAid && (
                  <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest">Linked Clinical Entry</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <form.Field name="person_type">
                        {(field) => (
                          <div>
                            <label className={labelClass}>Patient Category *</label>
                            <select value={field.state.value} onChange={e => field.handleChange(e.target.value)} className={inputClass} required>
                              <option value="KEEPER">Staff / Keeper</option>
                              <option value="PUBLIC">Public / Visitor</option>
                              <option value="CONTRACTOR">Contractor</option>
                              <option value="OTHER">Other</option>
                            </select>
                          </div>
                        )}
                      </form.Field>

                      <form.Field name="person_involved_name">
                        {(field) => (
                          <div>
                            <label className={labelClass}>Patient Full Name *</label>
                            <input type="text" required value={field.state.value} onChange={e => field.handleChange(e.target.value)} placeholder="e.g. John Doe" className={inputClass} />
                          </div>
                        )}
                      </form.Field>
                    </div>

                    <form.Field name="injury_description">
                      {(field) => (
                        <div>
                          <label className={labelClass}>Nature of Injury / Symptoms *</label>
                          <textarea required value={field.state.value} onChange={e => field.handleChange(e.target.value)} rows={2} className={`${inputClass} resize-none h-16`} placeholder="E.g., Laceration on left index finger..." />
                        </div>
                      )}
                    </form.Field>

                    <form.Field name="treatment_provided">
                      {(field) => (
                        <div>
                          <label className={labelClass}>Treatment Administered *</label>
                          <textarea required value={field.state.value} onChange={e => field.handleChange(e.target.value)} rows={2} className={`${inputClass} resize-none h-16`} placeholder="E.g., Cleaned wound with sterile wipe, applied dressing..." />
                        </div>
                      )}
                    </form.Field>

                    <form.Field name="administered_by">
                      {(field) => (
                        <div>
                          <label className={labelClass}>Attending First Aider *</label>
                          <select value={field.state.value} onChange={e => field.handleChange(e.target.value)} required className={inputClass}>
                            <option value="">-- Select First Aider --</option>
                            {staffMembers.map((staff: StaffMember) => (
                              <option key={staff.id} value={staff.id}>
                                {staff.name || staff.email} {staff.initials ? `(${staff.initials})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </form.Field>

                    <div className="space-y-3 pt-2">
                      <form.Field name="referral_needed">
                        {(field) => (
                          <label className="flex items-center gap-3 p-3 bg-rose-50 border border-rose-200 rounded-xl cursor-pointer hover:bg-rose-100 transition-colors shadow-sm">
                            <input type="checkbox" checked={field.state.value} onChange={e => field.handleChange(e.target.checked)} className="w-4 h-4 rounded border-rose-300 text-rose-600 focus:ring-rose-500 bg-white" />
                            <span className="text-xs font-bold text-rose-800 uppercase tracking-widest flex items-center gap-1.5">
                              <Ambulance size={14} /> Hospital / External Care Needed
                            </span>
                          </label>
                        )}
                      </form.Field>

                      <form.Subscribe selector={(state) => state.values.referral_needed}>
                        {(referralNeeded) => referralNeeded && (
                          <form.Field name="referral_details">
                            {(field) => (
                              <div className="animate-in fade-in slide-in-from-top-2">
                                <label className={labelClass}>Hospital / Paramedic Details *</label>
                                <input type="text" required value={field.state.value} onChange={e => field.handleChange(e.target.value)} placeholder="E.g., Ambulance dispatched at 14:30..." className={`${inputClass} border-rose-200`} />
                              </div>
                            )}
                          </form.Field>
                        )}
                      </form.Subscribe>
                    </div>
                  </div>
                )}
              </form.Subscribe>
            </div>
          </form>
        </div>
        
        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 shrink-0 rounded-b-2xl">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors">
            Cancel
          </button>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting, state.values.requires_first_aid]}>
            {([canSubmit, isSubmitting, hasFirstAid]) => (
              <button 
                type="submit" 
                form="incident-form" 
                disabled={!canSubmit || isSubmitting as boolean || saveMutation.isPending} 
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95"
              >
                {(isSubmitting || saveMutation.isPending) ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                <span>{hasFirstAid ? 'Commit Linked Reports' : 'Commit Incident'}</span>
              </button>
            )}
          </form.Subscribe>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. RESOLUTION MODAL COMPONENT
// ---------------------------------------------------------------------------
function ResolutionModal({ incident, onClose, mutation }: { incident: any, onClose: () => void, mutation: any }) {
  const form = useForm({
    defaultValues: { notes: '' },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({ id: incident.id, notes: value.notes });
    }
  });

  const inputClass = "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs lg:text-sm font-bold text-slate-900 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all shadow-sm placeholder:text-slate-400";
  const labelClass = "text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block";

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-sans overflow-y-auto custom-scrollbar">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md flex flex-col shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="bg-slate-50 border-b border-slate-100 p-5 flex justify-between items-center rounded-t-2xl">
          <div>
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600" /> Resolve Action
            </h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Sign off & close compliance breach</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        <form id="resolution-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="p-5 space-y-4">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <p className="text-xs font-bold text-slate-900 line-clamp-1">{incident.title}</p>
            <p className="text-[10px] text-slate-500 font-medium mt-0.5">Provide formal sign-off notes to close this compliance record.</p>
          </div>

          <form.Field name="notes">
            {(field) => (
              <div>
                <label className={labelClass}>Resolution Sign-Off Notes *</label>
                <textarea 
                  required 
                  value={field.state.value} 
                  onBlur={field.handleBlur}
                  onChange={e => field.handleChange(e.target.value)} 
                  rows={4} 
                  className={`${inputClass} resize-none h-24`} 
                  placeholder="E.g., Padlock replaced on Aviary B, perimeter deemed secure. Protocols re-briefed to keepers..." 
                />
              </div>
            )}
          </form.Field>
        </form>

        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors">
            Cancel
          </button>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <button 
                type="submit" 
                form="resolution-form"
                disabled={!canSubmit || isSubmitting as boolean || mutation.isPending} 
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-sm active:scale-95"
              >
                {isSubmitting || mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                <span>Close Incident</span>
              </button>
            )}
          </form.Subscribe>
        </div>
      </div>
    </div>
  );
}

export default IncidentsPage;