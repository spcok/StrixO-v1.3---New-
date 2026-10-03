import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  BriefcaseMedical, Plus, X, Search, Activity, Save, Loader2, 
  Stethoscope, UserCircle, Ambulance, AlertTriangle, Users, User, CheckCircle2, ShieldAlert, Calendar
} from 'lucide-react';
import { format, parseISO, formatISO } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { firstAidService, StaffMember } from '../services/firstAidService';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const firstAidLogsOptions = queryOptions({
  queryKey: ['first_aid_logs'],
  queryFn: () => firstAidService.getFirstAidLogs(),
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
export const Route = createFileRoute('/safety/first-aid')({
  loader: async ({ context: { queryClient } }) => {
    if (queryClient) {
      // @ts-ignore
      await Promise.all([
        queryClient.ensureQueryData(firstAidLogsOptions),
        queryClient.ensureQueryData(staffMembersOptions)
      ]);
    }
  },
  component: FirstAidPage,
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
export function FirstAidPage() {
  const queryClient = useQueryClient();
  const { user, hasPermission } = useAuth();
  const isMobile = useIsMobile();
  const scrollParentRef = useRef<HTMLDivElement>(null);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'ALL' | 'KEEPER' | 'PUBLIC' | 'REFERRAL'>('ALL');

  // Supabase Realtime Cache Invalidation
  useEffect(() => {
    const channel = supabase
      .channel('first-aid-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'first_aid_logs' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['first_aid_logs'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data: logs = [], isLoading } = useQuery(firstAidLogsOptions);
  const { data: staffMembers = [] } = useQuery(staffMembersOptions);

  const staffMap = useMemo(() => new Map(staffMembers.map((s: StaffMember) => [s.id, s])), [staffMembers]);

  const filteredLogs = useMemo(() => {
    let result = logs;

    if (activeTab === 'KEEPER') {
      result = result.filter((l: any) => l.person_type === 'KEEPER');
    } else if (activeTab === 'PUBLIC') {
      result = result.filter((l: any) => l.person_type === 'PUBLIC');
    } else if (activeTab === 'REFERRAL') {
      result = result.filter((l: any) => l.referral_needed);
    }

    if (searchQuery.trim()) {
      const lower = searchQuery.toLowerCase();
      result = result.filter((log: any) => 
        (log.person_involved_name || '').toLowerCase().includes(lower) ||
        (log.treatment_provided || '').toLowerCase().includes(lower) ||
        (log.injury_description || '').toLowerCase().includes(lower) ||
        (log.person_type || '').toLowerCase().includes(lower)
      );
    }

    return result;
  }, [logs, searchQuery, activeTab]);

  // Virtualizer Setup
  const rowVirtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => isMobile ? 220 : 90,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const tableGridCols = "minmax(220px, 1.5fr) minmax(190px, 1.2fr) minmax(230px, 1.6fr) minmax(250px, 1.8fr) minmax(130px, 0.9fr)";

  const tabs = [
    { id: 'ALL', label: 'All Records' },
    { id: 'KEEPER', label: 'Staff / Keepers' },
    { id: 'PUBLIC', label: 'Public / Visitors' },
    { id: 'REFERRAL', label: 'External Referrals' }
  ] as const;

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-5 lg:space-y-6 animate-in fade-in duration-500 w-full">
      
      {/* --- BLOCK A: HEADER RIBBON --- */}
      <div className="flex justify-between items-start w-full mb-2 lg:mb-4 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1.5 lg:gap-2">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
             First Aid Register
           </h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
             Clinical Administration & Treatment Logging
           </p>
        </div>
        
        {hasPermission('safety:write') && (
          <button 
            onClick={() => setIsModalOpen(true)} 
            className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-3 lg:px-4 py-2 lg:py-2.5 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
          >
            <Plus size={14} className="text-emerald-400" />
            <span>Log Treatment</span>
          </button>
        )}
      </div>

      {/* --- BLOCK B: CONTROL DECK --- */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="relative flex-1 min-w-[200px] lg:w-96 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search patient, symptoms, treatment..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all shadow-sm placeholder:text-slate-400 font-medium"
          />
        </div>
      </div>

      {/* --- BLOCK C: CATEGORY TABS (Pill Design) --- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:flex lg:gap-2 w-full shrink-0 gap-1.5 overflow-x-auto pb-1 lg:pb-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-2 lg:px-4 py-1.5 lg:py-2 rounded-xl text-[9px] lg:text-xs font-black uppercase tracking-widest whitespace-nowrap lg:whitespace-normal transition-all shadow-sm flex items-center justify-center gap-1.5 ${
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
              <Loader2 className="animate-spin text-emerald-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Syncing Clinical Register...</span>
            </div>
          </div>
        )}

        <div ref={scrollParentRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50/30">
          
          {/* Desktop Table Header */}
          <div className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
            <div className="px-5 py-4 flex items-center justify-start text-left">Patient Details</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Date & Attending Staff</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Injury Assessment</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Treatment Administered</div>
            <div className="px-5 py-4 flex items-center justify-end text-right">Escalation</div>
          </div>

          <div className="p-3 lg:p-0">
            {filteredLogs.length === 0 && !isLoading ? (
              <div className="p-8 lg:p-12 text-center text-slate-500 flex flex-col items-center">
                <div className="w-12 h-12 lg:w-16 lg:h-16 bg-white rounded-xl lg:rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                  <BriefcaseMedical size={24} className="text-slate-400" />
                </div>
                <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">No medical records found</p>
                <p className="text-[10px] lg:text-xs font-medium">Try adjusting your search terms or filter tabs.</p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const log = filteredLogs[virtualRow.index];
                  const dateObj = new Date(log.incident_date);
                  const firstAider = staffMap.get(log.administered_by);
                  const isStaff = log.person_type === 'KEEPER';

                  return (
                    <div 
                      key={log.id} 
                      className="absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border border-slate-200 lg:border-none lg:border-b border-b-slate-100 rounded-xl lg:rounded-none bg-white p-3.5 lg:p-0 hover:bg-slate-50 transition-colors shadow-sm lg:shadow-none gap-3 lg:gap-0 box-border"
                      style={{ 
                        gridTemplateColumns: isMobile ? '1fr' : tableGridCols,
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
                      {/* 1. Patient Details */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-2 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Patient</div>}
                        <div className="flex items-center gap-3 min-w-0 py-1">
                          <div className={`w-8 h-8 lg:w-9 lg:h-9 rounded-full flex items-center justify-center shrink-0 border shadow-sm ${isStaff ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                            {isStaff ? <UserCircle size={18} /> : <User size={16} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-slate-900 text-xs lg:text-sm tracking-tight truncate" title={log.person_involved_name}>{log.person_involved_name}</h3>
                              <span className={`px-2 py-0.5 rounded text-[8px] lg:text-[9px] font-black uppercase tracking-widest border shrink-0 ${
                                isStaff ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}>
                                {log.person_type || 'OTHER'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 2. Date & Attending Staff */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Date & First Aider</div>}
                        <div className="space-y-1 w-full">
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700">
                            <Calendar size={12} className="text-slate-400 shrink-0" />
                            {format(dateObj, 'dd MMM yyyy')} <span className="text-slate-400 font-medium">{format(dateObj, 'HH:mm')}</span>
                          </span>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
                            By: <span className="text-slate-800">{firstAider ? `${firstAider.name} (${firstAider.initials})` : 'Attending Staff'}</span>
                          </p>
                        </div>
                      </div>

                      {/* 3. Injury Assessment */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Injury Assessment</div>}
                        <div className="space-y-1 w-full pr-2">
                          <p className="text-xs font-semibold text-slate-800 line-clamp-2 leading-relaxed" title={log.injury_description}>
                            {log.injury_description || 'No description provided.'}
                          </p>
                        </div>
                      </div>

                      {/* 4. Treatment Administered */}
                      <div className="w-full lg:px-5 lg:py-3.5 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Treatment Provided</div>}
                        <div className="flex items-start gap-1.5 text-emerald-800 w-full pr-2">
                          <Stethoscope size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                          <p className="text-xs font-bold leading-relaxed line-clamp-2" title={log.treatment_provided}>
                            {log.treatment_provided}
                          </p>
                        </div>
                      </div>

                      {/* 5. Escalation Badges */}
                      <div className={`w-full lg:px-5 lg:py-3.5 flex min-w-0 ${isMobile ? 'justify-end pt-2 border-t border-slate-100 mt-1' : 'items-center justify-end'}`}>
                        <div className="flex flex-wrap items-center gap-1.5 justify-end">
                          {log.referral_needed && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 text-[9px] font-black text-rose-700 uppercase tracking-widest shadow-sm">
                              <Ambulance size={11} /> Referral
                            </span>
                          )}
                          {log.incident_id && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-[9px] font-black text-amber-700 uppercase tracking-widest shadow-sm">
                              <AlertTriangle size={11} /> Incident
                            </span>
                          )}
                          {!log.referral_needed && !log.incident_id && (
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                              Isolated
                            </span>
                          )}
                        </div>
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
        <FirstAidModal 
          onClose={() => setIsModalOpen(false)} 
          userId={user?.id}
          staffMembers={staffMembers}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. COMPOUND MODAL COMPONENT 
// ---------------------------------------------------------------------------
function FirstAidModal({ onClose, userId, staffMembers }: { onClose: () => void, userId?: string, staffMembers: StaffMember[] }) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const saveCompoundMutation = useMutation({
    mutationFn: async (payloads: { firstAid: any, incident?: any }) => {
      await firstAidService.commitFirstAidLog(payloads.firstAid, payloads.incident);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['first_aid_logs'] });
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      toast.success('Clinical record saved successfully.');
      onClose();
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Failed to sync clinical record.');
    }
  });

  const form = useForm({
    defaultValues: {
      incident_date: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      person_involved_name: '',
      person_type: 'KEEPER',
      administered_by: userId || '',
      injury_description: '',
      treatment_provided: '',
      referral_needed: false,
      referral_details: '',
      escalate_to_incident: false,
      incident_title: '',
      incident_type: 'ANIMAL_BEHAVIOR',
      severity: 'MEDIUM',
      incident_description: '',
      immediate_action_taken: ''
    },
    onSubmit: async ({ value }) => {
      setErrorMsg(null);
      const parsedDate = formatISO(parseISO(value.incident_date));

      const firstAidPayload = {
        incident_date: parsedDate,
        person_involved_name: value.person_involved_name,
        person_type: value.person_type,
        administered_by: value.administered_by,
        injury_description: value.injury_description,
        treatment_provided: value.treatment_provided,
        referral_needed: value.referral_needed,
        referral_details: value.referral_needed ? value.referral_details : null,
      };

      let incidentPayload = undefined;

      if (value.escalate_to_incident) {
        incidentPayload = {
          title: value.incident_title,
          incident_date: parsedDate,
          incident_type: value.incident_type,
          severity: value.severity,
          description: value.incident_description,
          immediate_action_taken: value.immediate_action_taken
        };
      }

      await saveCompoundMutation.mutateAsync({ firstAid: firstAidPayload, incident: incidentPayload });
    }
  });

  const inputClass = "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs lg:text-sm font-bold text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all shadow-sm placeholder:text-slate-400";
  const labelClass = "text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block";

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 font-sans overflow-y-auto custom-scrollbar">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl relative overflow-hidden my-auto animate-in zoom-in-95 duration-200">
        
        <div className="bg-slate-50 border-b border-slate-100 p-5 flex justify-between items-center z-20 shrink-0 rounded-t-2xl">
          <div>
            <h2 className="text-base lg:text-lg font-black text-slate-900 uppercase tracking-tight">
              Clinical Assessment
            </h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">First aid treatment log</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[75vh]">
          <form id="compound-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="space-y-5">
            
            {errorMsg && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-bold shadow-sm">
                {errorMsg}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <form.Field name="incident_date">
                {(field) => (
                  <div>
                    <label className={labelClass}>Date & Time *</label>
                    <input type="datetime-local" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
                  </div>
                )}
              </form.Field>

              <form.Field name="person_type">
                {(field) => (
                  <div>
                    <label className={labelClass}>Patient Category *</label>
                    <select value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} required>
                      <option value="KEEPER">Staff / Keeper</option>
                      <option value="PUBLIC">Public / Visitor</option>
                      <option value="CONTRACTOR">Contractor</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="person_involved_name">
              {(field) => (
                <div>
                  <label className={labelClass}>Patient Full Name *</label>
                  <input type="text" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} placeholder="e.g. Jane Smith" className={inputClass} />
                </div>
              )}
            </form.Field>

            <form.Field name="injury_description">
              {(field) => (
                <div>
                  <label className={labelClass}>Nature of Injury / Symptoms *</label>
                  <textarea required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} rows={2} className={`${inputClass} resize-none h-20`} placeholder="Describe the physical injury or symptoms..." />
                </div>
              )}
            </form.Field>
            
            <form.Field name="treatment_provided">
              {(field) => (
                <div>
                  <label className={labelClass}>Treatment Administered & Kit Usage *</label>
                  <textarea required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} rows={3} className={`${inputClass} resize-none h-20`} placeholder="Cleaned wound with sterile wipe, applied dressing..." />
                </div>
              )}
            </form.Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <form.Field name="administered_by">
                {(field) => (
                  <div>
                    <label className={labelClass}>Attending First Aider *</label>
                    <select value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} required className={inputClass}>
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

              <div className="space-y-3 pt-6">
                <form.Field name="referral_needed">
                  {(field) => (
                    <label className="flex items-center gap-3 p-3 bg-rose-50 border border-rose-200 rounded-xl cursor-pointer hover:bg-rose-100 transition-colors shadow-sm">
                      <input type="checkbox" checked={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.checked)} className="w-4 h-4 rounded border-rose-300 text-rose-600 focus:ring-rose-500 bg-white" />
                      <span className="text-xs font-bold text-rose-800 uppercase tracking-widest flex items-center gap-1.5">
                        <Ambulance size={14} /> Hospital / External Care Needed
                      </span>
                    </label>
                  )}
                </form.Field>
              </div>
            </div>

            <form.Subscribe selector={(state) => state.values.referral_needed}>
              {(referralNeeded) => referralNeeded && (
                <form.Field name="referral_details">
                  {(field) => (
                    <div className="animate-in fade-in slide-in-from-top-2">
                      <label className={labelClass}>Referral / Paramedic Details *</label>
                      <input type="text" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} placeholder="E.g., Ambulance dispatched at 14:30..." className={`${inputClass} border-rose-200`} />
                    </div>
                  )}
                </form.Field>
              )}
            </form.Subscribe>

            <div className="pt-2 border-t border-slate-100">
              <form.Field name="escalate_to_incident">
                {(field) => (
                  <label className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer hover:bg-amber-100 transition-colors shadow-sm">
                    <input type="checkbox" checked={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.checked)} className="w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500 bg-white" />
                    <div>
                      <span className="text-xs font-bold text-amber-900 uppercase tracking-widest flex items-center gap-1.5">
                        <AlertTriangle size={14} /> Escalate to Incident Report?
                      </span>
                      <span className="text-[10px] text-amber-700 font-medium block mt-0.5">Check if related to an animal strike, breach, or compliance failure.</span>
                    </div>
                  </label>
                )}
              </form.Field>

              <form.Subscribe selector={(state) => state.values.escalate_to_incident}>
                {(escalate) => escalate && (
                  <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                      <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest">Linked Incident Entry</h3>
                    </div>

                    <form.Field name="incident_title">
                      {(field) => (
                        <div>
                          <label className={labelClass}>Incident Title *</label>
                          <input type="text" required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} placeholder="e.g. European Eagle Owl Strike in Aviary B" className={inputClass} />
                        </div>
                      )}
                    </form.Field>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <form.Field name="incident_type">
                        {(field) => (
                          <div>
                            <label className={labelClass}>Classification *</label>
                            <select value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} required>
                              <option value="ANIMAL_BEHAVIOR">Animal Attack / Strike</option>
                              <option value="ESCAPE">Animal Escape</option>
                              <option value="INFRASTRUCTURE">Facility Failure / Equipment</option>
                              <option value="SLIP_TRIP_FALL">Slip, Trip, or Fall</option>
                              <option value="OTHER">Other Operational Breach</option>
                            </select>
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
                              <option value="HIGH">HIGH - Severe incident</option>
                              <option value="CRITICAL">CRITICAL - Emergency protocols</option>
                            </select>
                          </div>
                        )}
                      </form.Field>
                    </div>

                    <form.Field name="incident_description">
                      {(field) => (
                        <div>
                          <label className={labelClass}>Operational Description *</label>
                          <textarea required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} rows={2} className={`${inputClass} resize-none`} placeholder="Detailed breakdown of how the operational incident occurred..." />
                        </div>
                      )}
                    </form.Field>

                    <form.Field name="immediate_action_taken">
                      {(field) => (
                        <div>
                          <label className={labelClass}>Immediate Actions Taken *</label>
                          <textarea required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} rows={2} className={`${inputClass} resize-none`} placeholder="Aviary locked down, birds secured..." />
                        </div>
                      )}
                    </form.Field>
                  </div>
                )}
              </form.Subscribe>
            </div>

          </form>
        </div>

        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 z-20 shrink-0 rounded-b-2xl">
          <button type="button" onClick={onClose} className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors">
            Cancel
          </button>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting, state.values.escalate_to_incident]}>
            {([canSubmit, isSubmitting, isEscalating]) => (
              <button 
                type="submit" 
                form="compound-form" 
                disabled={!canSubmit || isSubmitting as boolean || saveCompoundMutation.isPending} 
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95"
              >
                {isSubmitting || saveCompoundMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                <span>{isEscalating ? 'Commit Linked Reports' : 'Commit Record'}</span>
              </button>
            )}
          </form.Subscribe>
        </div>
      </div>
    </div>
  );
}

export default FirstAidPage;