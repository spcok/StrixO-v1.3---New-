import React, { useState, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { 
  Plus, Calendar, Clock, Users, 
  CheckCircle2, AlertTriangle, Loader2, X, Trash2, 
  Search, ShieldCheck
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { SafetyDrill } from '../types';

const safetyDrillsOptions = queryOptions({
  queryKey: ['safety_drills'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('safety_drills')
      .select('*')
      .order('drill_date', { ascending: false });
    if (error) throw error;
    return (data || []) as SafetyDrill[];
  },
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

export const Route = createFileRoute('/safety/drills')({
  loader: async ({ context }: any) => {
    if (context?.queryClient) {
      await context.queryClient.ensureQueryData(safetyDrillsOptions);
    }
  },
  component: SafetyDrillsPage,
});

const DRILL_TYPES = [
  'FIRE_EVACUATION',
  'ANIMAL_ESCAPE',
  'MEDICAL_EMERGENCY',
  'SEVERE_WEATHER',
  'POWER_OUTAGE',
  'INTRUDER_LOCKDOWN'
] as const;

export function SafetyDrillsPage() {
  const queryClient = useQueryClient();
  const { user, profile, hasPermission } = useAuth();
  const isManager = hasPermission('safety:write') || ['ADMIN', 'DIRECTOR', 'MANAGER'].includes(profile?.role || '');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedDate, setSelectedDate] = useState<string>('');

  const [form, setForm] = useState({
    drill_type: DRILL_TYPES[0],
    drill_date: format(new Date(), 'yyyy-MM-dd'),
    duration_minutes: 5,
    lead_evaluator: profile?.name || user?.email || '',
    notes: '',
    participants: [] as string[],
    newParticipant: ''
  });

  const { data: drills = [], isLoading } = useQuery(safetyDrillsOptions);

  const createDrillMutation = useMutation({
    mutationFn: async (newDrill: any) => {
      const { data, error } = await supabase
        .from('safety_drills')
        .insert([newDrill])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Safety drill record registered successfully.');
      queryClient.invalidateQueries({ queryKey: ['safety_drills'] });
      setIsModalOpen(false);
      setForm({
        drill_type: DRILL_TYPES[0],
        drill_date: format(new Date(), 'yyyy-MM-dd'),
        duration_minutes: 5,
        lead_evaluator: profile?.name || user?.email || '',
        notes: '',
        participants: [],
        newParticipant: ''
      });
    },
    onError: (err: any) => {
      toast.error(`Failed to record drill: ${err.message}`);
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const durationSeconds = Math.max(1, Number(form.duration_minutes || 0) * 60);

    createDrillMutation.mutate({
      drill_type: form.drill_type,
      drill_date: form.drill_date || format(new Date(), 'yyyy-MM-dd'),
      duration_seconds: durationSeconds,
      lead_evaluator: form.lead_evaluator || 'Staff Lead',
      notes: form.notes || null,
      participants: form.participants
    });
  };

  const handleAddParticipant = () => {
    const trimmed = form.newParticipant.trim();
    if (!trimmed) return;
    if (!form.participants.includes(trimmed)) {
      setForm(prev => ({
        ...prev,
        participants: [...prev.participants, trimmed],
        newParticipant: ''
      }));
    }
  };

  const handleRemoveParticipant = (name: string) => {
    setForm(prev => ({
      ...prev,
      participants: prev.participants.filter(p => p !== name)
    }));
  };

  const filteredDrills = useMemo(() => {
    return drills.filter(drill => {
      const matchesType = selectedType === 'ALL' || drill.drill_type === selectedType;
      
      let matchesDate = true;
      if (selectedDate && drill.drill_date) {
        matchesDate = drill.drill_date.startsWith(selectedDate);
      }

      const q = searchQuery.toLowerCase();
      const participantsList = Array.isArray(drill.participants) ? drill.participants : [];
      const matchesSearch = !q ||
        (drill.drill_type || '').toLowerCase().includes(q) ||
        (drill.lead_evaluator || '').toLowerCase().includes(q) ||
        (drill.notes || '').toLowerCase().includes(q) ||
        participantsList.some(p => p.toLowerCase().includes(q));

      return matchesType && matchesDate && matchesSearch;
    });
  }, [drills, selectedType, selectedDate, searchQuery]);

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-4 animate-in fade-in duration-300 w-full font-sans">
      
      {/* Header with Generous Spacing */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shrink-0 pb-1">
        <div className="flex flex-col space-y-1">
          <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-tight">
            Safety Drills & Emergency Protocols
          </h1>
          <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
            Statutory Zoo Licensing Act (ZLA) Evacuation & Emergency Readiness Ledger
          </p>
        </div>

        {isManager && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
          >
            <Plus size={14} className="text-emerald-400" />
            <span>Record Drill</span>
          </button>
        )}
      </div>

      {/* Control Bar with Date Selector & Pill Buttons */}
      <div className="bg-slate-50/90 p-3.5 rounded-2xl border border-slate-200 shadow-inner flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 shrink-0">
        
        {/* Pill Buttons */}
        <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-0.5">
          <button
            onClick={() => setSelectedType('ALL')}
            className={`px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all shadow-sm ${
              selectedType === 'ALL'
                ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
                : 'bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700 border border-slate-200'
            }`}
          >
            All Protocols
          </button>
          {DRILL_TYPES.map(type => (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              className={`px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all shadow-sm ${
                selectedType === type
                  ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
                  : 'bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700 border border-slate-200'
              }`}
            >
              {type.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        {/* Filters Group: Date Picker + Search */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center bg-white rounded-xl px-3 py-2 border border-slate-200 shadow-sm gap-2">
            <Calendar size={13} className="text-slate-400 shrink-0" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 border-none outline-none cursor-pointer p-0"
            />
            {selectedDate && (
              <button 
                onClick={() => setSelectedDate('')} 
                className="text-slate-400 hover:text-slate-600 p-0.5 rounded transition-colors"
                title="Clear date filter"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="relative w-full sm:w-60">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
            <input
              type="text"
              placeholder="Search notes, staff..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-slate-900 outline-none shadow-sm"
            />
          </div>
        </div>
      </div>

      {/* Drill Grid */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 bg-slate-50/30">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
              <Loader2 size={24} className="animate-spin text-slate-600" />
              <span className="text-xs font-black uppercase tracking-widest text-slate-600">Loading Drill Ledger...</span>
            </div>
          ) : filteredDrills.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2 p-8">
              <ShieldCheck size={36} className="opacity-20" />
              <span className="text-xs font-black uppercase tracking-widest">No Safety Drills Found</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {filteredDrills.map((drill) => {
                const totalSec = drill.duration_seconds ?? 0;
                const minutes = Math.floor(totalSec / 60);
                const seconds = totalSec % 60;
                const dateStr = drill.drill_date ? format(parseISO(drill.drill_date), 'dd MMM yyyy') : '-';
                const participantsList = Array.isArray(drill.participants) ? drill.participants : [];

                return (
                  <div key={drill.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                        <span className="px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-800 border border-slate-200">
                          {(drill.drill_type || 'SAFETY DRILL').replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
                          <Calendar size={12} className="text-slate-400" />
                          {dateStr}
                        </span>
                      </div>

                      <div className="mt-3 space-y-2 text-xs">
                        <div className="flex items-center justify-between text-slate-700">
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Duration</span>
                          <span className="font-mono font-bold">{minutes}m {seconds > 0 ? `${seconds}s` : ''}</span>
                        </div>
                        <div className="flex items-center justify-between text-slate-700">
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Lead Evaluator</span>
                          <span className="font-bold">{drill.lead_evaluator || 'Staff Lead'}</span>
                        </div>
                      </div>

                      {drill.notes && (
                        <p className="mt-3 p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs text-slate-600 font-medium leading-relaxed">
                          {drill.notes}
                        </p>
                      )}
                    </div>

                    <div>
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">
                        Personnel In Attendance ({participantsList.length})
                      </span>
                      <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto custom-scrollbar">
                        {participantsList.length === 0 ? (
                          <span className="text-[10px] text-slate-400 italic">No attendance list recorded</span>
                        ) : (
                          participantsList.map((person, pIdx) => (
                            <span key={pIdx} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-lg text-[9px] font-bold">
                              {person}
                            </span>
                          ))
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

      {/* Record Drill Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="font-black text-slate-900 uppercase tracking-widest text-xs">
                Record Emergency Safety Drill
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 overflow-y-auto custom-scrollbar space-y-4 text-xs font-medium">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Protocol Type *
                </label>
                <select
                  value={form.drill_type}
                  onChange={(e) => setForm({ ...form, drill_type: e.target.value as any })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                >
                  {DRILL_TYPES.map(type => (
                    <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Drill Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={form.drill_date}
                    onChange={(e) => setForm({ ...form, drill_date: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Duration (Minutes) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={form.duration_minutes}
                    onChange={(e) => setForm({ ...form, duration_minutes: parseInt(e.target.value) || 1 })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Lead Evaluator *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Charlotte Davis-Whytock"
                  value={form.lead_evaluator}
                  onChange={(e) => setForm({ ...form, lead_evaluator: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Personnel in Attendance
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter staff name..."
                    value={form.newParticipant}
                    onChange={(e) => setForm({ ...form, newParticipant: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddParticipant(); } }}
                    className="flex-1 p-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddParticipant}
                    className="px-3.5 py-2 bg-slate-900 text-white rounded-xl font-black uppercase tracking-widest text-[10px]"
                  >
                    Add
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar">
                  {form.participants.map((person) => (
                    <span key={person} className="px-2.5 py-1 bg-slate-100 border border-slate-200 text-slate-800 rounded-lg text-[10px] font-bold flex items-center gap-1.5">
                      {person}
                      <button type="button" onClick={() => handleRemoveParticipant(person)} className="text-slate-400 hover:text-rose-600">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Drill Notes & Observations
                </label>
                <textarea
                  rows={3}
                  placeholder="Record timeline, response observations, or deficiencies..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createDrillMutation.isPending}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-widest rounded-xl disabled:opacity-50 flex items-center gap-2 shadow-sm"
                >
                  {createDrillMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  <span>Save Record</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default SafetyDrillsPage;