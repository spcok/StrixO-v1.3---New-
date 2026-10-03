import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { format, startOfDay, endOfDay } from 'date-fns';
import { Clock, Check, X, AlertTriangle, Loader2 } from 'lucide-react';

interface DigitalMARProps {
  prescriptions: any[];
  isOnline: boolean;
}

// Determines how many empty boxes to render based on veterinary frequency
const getExpectedSlots = (freq: string) => {
  switch (freq) {
    case 'BID': return 2;
    case 'TID': return 3;
    case 'QID': return 4;
    default: return 1; // SID, EOD, WEEKLY, MONTHLY, STAT
  }
};

export default function DigitalMAR({ prescriptions, isOnline }: DigitalMARProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  
  // Modal State
  const [activeSlot, setActiveSlot] = useState<{ rx: any, slotIndex: number } | null>(null);
  const [adminStatus, setAdminStatus] = useState('GIVEN');
  const [adminTime, setAdminTime] = useState(format(new Date(), 'HH:mm'));
  const [adminStaffId, setAdminStaffId] = useState(user?.id || '');
  const [adminNotes, setAdminNotes] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fetch Staff Directory for the Dropdown
  const { data: staff = [] } = useQuery({
    queryKey: ['staff_directory_mar'],
    queryFn: async () => {
      const { data, error } = await supabase.from('users').select('id, name, initials').eq('is_deleted', false);
      if (error) throw error;
      return data;
    },
    networkMode: 'offlineFirst',
  });

  // Fetch today's administration events
  const { data: administrations = [], isLoading: loadingAdmins } = useQuery({
    queryKey: ['medication_administrations', format(selectedDate, 'yyyy-MM-dd')],
    queryFn: async () => {
      const start = startOfDay(selectedDate).toISOString();
      const end = endOfDay(selectedDate).toISOString();
      const { data, error } = await supabase
        .from('medication_administrations')
        .select('*')
        .gte('administered_at', start)
        .lte('administered_at', end)
        .order('administered_at', { ascending: true });
      if (error) throw error;
      return data;
    },
    networkMode: 'offlineFirst',
  });

  // Map user names in memory to avoid complex Foreign Key joins failing
  const staffMap = useMemo(() => {
    const map = new Map();
    staff.forEach((s: any) => map.set(s.id, s));
    return map;
  }, [staff]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeSlot) return;
      
      // Combine selected date with selected time
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const administeredAt = new Date(`${dateStr}T${adminTime}:00`).toISOString();

      const payload = {
        prescription_id: activeSlot.rx.id,
        animal_id: activeSlot.rx.animal_id,
        administered_at: administeredAt,
        status: adminStatus,
        administered_by: adminStaffId,
        notes: adminNotes || null,
        // Secretly log who ACTUALLY pushed the button for the audit trail
        created_by: user?.id 
      };

      const { error } = await supabase.from('medication_administrations').insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medication_administrations'] });
      closeModal();
    },
    onError: (err: any) => setSaveError(err.message || "Failed to log administration")
  });

  const closeModal = () => {
    setActiveSlot(null);
    setAdminStatus('GIVEN');
    setAdminTime(format(new Date(), 'HH:mm'));
    setAdminNotes('');
    setSaveError(null);
  };

  const handleOpenSlot = (rx: any, slotIndex: number) => {
    setActiveSlot({ rx, slotIndex });
    setAdminStaffId(user?.id || '');
    setAdminTime(format(new Date(), 'HH:mm'));
  };

  return (
    <div className="space-y-6">
      
      {/* Date Header */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center">
        <div>
          <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Daily Administration Grid</h2>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{format(selectedDate, 'EEEE, dd MMMM yyyy')}</p>
        </div>
        <input 
          type="date" 
          value={format(selectedDate, 'yyyy-MM-dd')} 
          onChange={(e) => setSelectedDate(new Date(e.target.value))}
          className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-500"
        />
      </div>

      {/* MAR Grid */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {prescriptions.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs font-black uppercase tracking-widest">No Active Prescriptions</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {prescriptions.map((rx) => {
              const expectedSlots = getExpectedSlots(rx.frequency);
              // Filter admins for this specific prescription chronologically
              const rxAdmins = administrations.filter((a: any) => a.prescription_id === rx.id);

              return (
                <div key={rx.id} className="p-4 flex flex-col md:flex-row md:items-center gap-6 hover:bg-slate-50 transition-colors">
                  
                  {/* Demographics & Drug Info */}
                  <div className="md:w-1/3 shrink-0">
                    <h3 className="font-black text-slate-900 text-base leading-tight">
                      {rx.drug_name} <span className="text-blue-600 ml-1">{rx.dosage}</span>
                    </h3>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                      {rx.animals?.name} ({rx.animals?.species}) • {rx.route} • {rx.frequency}
                    </p>
                    {rx.special_instructions && (
                      <p className="text-[10px] font-bold italic text-rose-600 mt-1">{rx.special_instructions}</p>
                    )}
                  </div>

                  {/* Pre-generated Slots */}
                  <div className="flex-1 flex flex-wrap gap-3">
                    {Array.from({ length: expectedSlots }).map((_, idx) => {
                      const completedAdmin = rxAdmins[idx];

                      if (completedAdmin) {
                        // Slot is Completed
                        const isGiven = completedAdmin.status === 'GIVEN';
                        const staffMember = staffMap.get(completedAdmin.administered_by);
                        const displayTime = format(new Date(completedAdmin.administered_at), 'HH:mm');

                        return (
                          <div key={idx} className={`relative flex items-center justify-between p-3 rounded-xl border-2 w-48 shrink-0 ${isGiven ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                            <div>
                              <p className={`text-xs font-black uppercase tracking-widest ${isGiven ? 'text-emerald-700' : 'text-rose-700'}`}>
                                {completedAdmin.status === 'GIVEN' ? 'Administered' : completedAdmin.status}
                              </p>
                              <p className="text-[10px] font-bold text-slate-500 mt-0.5">{displayTime} • {staffMember?.initials || 'UNK'}</p>
                            </div>
                            {isGiven ? <Check size={18} className="text-emerald-500" /> : <AlertTriangle size={18} className="text-rose-500" />}
                          </div>
                        );
                      }

                      // Slot is Empty / Pending
                      return (
                        <button 
                          key={idx} 
                          onClick={() => handleOpenSlot(rx, idx)}
                          disabled={!isOnline}
                          className="flex items-center justify-center p-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 text-slate-400 transition-all w-48 shrink-0 group disabled:opacity-50 disabled:hover:bg-slate-50 disabled:hover:border-slate-300 disabled:hover:text-slate-400"
                        >
                          <span className="text-[10px] font-black uppercase tracking-widest group-hover:scale-105 transition-transform flex items-center gap-1.5">
                            <Clock size={14} /> Sign Off Dose {idx + 1}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Administration Modal */}
      {activeSlot && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-slate-200">
            
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <div>
                <h3 className="font-black text-slate-900 uppercase tracking-tight">Log Administration</h3>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Dose {activeSlot.slotIndex + 1} • {activeSlot.rx.drug_name}</p>
              </div>
              <button onClick={closeModal} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl transition-colors"><X size={20} /></button>
            </div>

            <div className="p-5 space-y-5">
              {saveError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-bold">{saveError}</div>
              )}

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Clinical Status</label>
                <select value={adminStatus} onChange={(e) => setAdminStatus(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-blue-500">
                  <option value="GIVEN">Administered (Given)</option>
                  <option value="REFUSED">Refused (R)</option>
                  <option value="VOMITED">Vomited / Regurgitated (V)</option>
                  <option value="DROPPED">Spit Out / Dropped (S)</option>
                  <option value="UNAVAILABLE">Medication Not Available (N/A)</option>
                  <option value="OMITTED">Omitted (O)</option>
                  <option value="HOSPITALIZED">Hospitalized / Offsite (H)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Exact Time</label>
                  <input type="time" value={adminTime} onChange={(e) => setAdminTime(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-blue-500 shadow-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Administered By</label>
                  <select value={adminStaffId} onChange={(e) => setAdminStaffId(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-blue-500 shadow-sm">
                    {staff.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.initials})</option>)}
                  </select>
                </div>
              </div>

              {adminStatus !== 'GIVEN' && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                  <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[10px] font-bold text-amber-800">You must provide an explanatory note when a medication is not administered normally.</p>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Exception Notes</label>
                <textarea 
                  value={adminNotes} 
                  onChange={(e) => setAdminNotes(e.target.value)} 
                  placeholder="e.g., Hidden in food, patient ate half before dropping it."
                  rows={2} 
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-blue-500 shadow-sm resize-none custom-scrollbar" 
                />
              </div>

            </div>

            <div className="px-5 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
              <button onClick={closeModal} className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors">Cancel</button>
              <button 
                onClick={() => saveMutation.mutate()} 
                disabled={saveMutation.isPending || (adminStatus !== 'GIVEN' && adminNotes.trim() === '')}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-md flex items-center gap-2"
              >
                {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Sign Off Dose
              </button>
            </div>
            
          </div>
        </div>
      )}

    </div>
  );
}