import React, { useState, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient, queryOptions, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Pill, Activity, WifiOff, FileText, Plus, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

import DigitalMAR from '../components/medical/DigitalMAR';
import PrescriptionList from '../components/medical/PrescriptionList';
import PrescriptionFormModal from '../components/medical/PrescriptionFormModal';
import MedicationHistory from '../components/medical/MedicationHistory';
import { marExportService } from '../services/marExportService';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS (14-Day Failover)
// ------------------------------------------------------------------
const getActivePrescriptionsOptions = () => queryOptions({
  queryKey: ['prescriptions', 'active'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('prescriptions')
      .select('*, animals(id, name, species, location, gender, flying_weight, weight_unit, special_requirements, date_of_birth, status)')
      .eq('status', 'ACTIVE')
      .order('start_date', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 14,
  networkMode: 'offlineFirst',
  meta: { persist: true },
});

// ------------------------------------------------------------------
// 2. ROUTE CONFIGURATION
// ------------------------------------------------------------------
export const Route = createFileRoute('/clinical/medications')({
  loader: async ({ context: { queryClient } }) => {
    if (queryClient) {
      // @ts-ignore
      await queryClient.ensureQueryData(getActivePrescriptionsOptions());
    }
  },
  component: MedicationsModule,
});

// ------------------------------------------------------------------
// 3. MAIN COMPONENT
// ------------------------------------------------------------------
function MedicationsModule() {
  const queryClient = useQueryClient();
  const { user, profile, hasPermission } = useAuth();
  
  const [activeTab, setActiveTab] = useState<'DIGITAL_MAR' | 'PRESCRIPTIONS' | 'HISTORY'>('DIGITAL_MAR');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = useState(false);
  const [editingPrescription, setEditingPrescription] = useState<any>(null);

  // Network State Listeners
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

  // Realtime Cache Invalidation for MAR events
  useEffect(() => {
    const channel = supabase
      .channel('medication_administrations_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'medication_administrations' }, () => {
        queryClient.invalidateQueries({ queryKey: ['medication_administrations'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Fetch Prescriptions using the strict offline engine
  const { data: prescriptions = [], isLoading: loadingRx } = useQuery({
    ...getActivePrescriptionsOptions(),
    placeholderData: keepPreviousData,
  });

  const handleOpenNewOrder = () => {
    setEditingPrescription(null);
    setIsPrescriptionModalOpen(true);
  };

  const handleEditOrder = (rx: any) => {
    setEditingPrescription(rx);
    setIsPrescriptionModalOpen(true);
  };

  const handlePrintUnifiedMar = async (rx: any, setLoading: (b: boolean) => void) => {
    if (!isOnline) {
      toast.error("Offline: Document generation requires an active network connection.");
      return;
    }
    
    setLoading(true);
    try {
      const patientPrescriptions = prescriptions.filter((p: any) => p.animal_id === rx.animal_id);
      await marExportService.exportUnifiedMAR(
        rx.animals, 
        patientPrescriptions, 
        profile?.name || 'Staff', 
        user?.id || 'Unknown-ID'
      );
    } catch (error: any) {
      console.error(error);
      toast.error(`Failed to generate DOCX MAR chart: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: 'DIGITAL_MAR', label: 'Today\'s MAR', icon: Activity },
    { id: 'PRESCRIPTIONS', label: 'Active Orders', icon: Pill },
    { id: 'HISTORY', label: 'Medication History', icon: FileText }
  ] as const;

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-5 lg:space-y-6 animate-in fade-in duration-500 w-full">
      
      {/* --- OFFLINE WARNING BANNER --- */}
      {!isOnline && (
        <div className="bg-rose-50 border-2 border-rose-300 p-4 rounded-2xl shadow-sm flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 text-rose-900">
            <ShieldAlert size={24} className="text-rose-600 shrink-0" />
            <div className="flex flex-col">
              <span className="font-black uppercase tracking-widest text-xs text-rose-600">Clinical Network Disconnected</span>
              <span className="text-sm font-bold mt-0.5">Medication administration is locked to prevent double-dosing. Please reconnect to WiFi.</span>
            </div>
          </div>
        </div>
      )}

      {/* --- BLOCK A: HEADER RIBBON --- */}
      <div className="flex justify-between items-start w-full mb-2 lg:mb-4 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        
        {/* Module Title & Subheading - No icon, cleanly spaced */}
        <div className="shrink-0 pr-4 flex flex-col gap-1.5 lg:gap-2">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
             Clinical Dispensary
           </h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
             Prescription Management & Digital MAR
           </p>
        </div>
        
        {/* Action Button */}
        {hasPermission('clinical:write') && (
          <button 
            onClick={handleOpenNewOrder} 
            className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-3 lg:px-4 py-2 lg:py-2.5 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
          >
            <Plus size={14} className="text-blue-400 hidden sm:block" />
            <Pill size={14} className="text-blue-400 sm:hidden" />
            <span className="hidden sm:block">Provision Order</span>
            <span className="sm:hidden">New Rx</span>
          </button>
        )}
      </div>

      {/* --- BLOCK B: CATEGORY TABS (Unified Pill Design) --- */}
      <div className="grid grid-cols-3 lg:flex lg:gap-3 w-full shrink-0 gap-2 overflow-x-auto pb-1 lg:pb-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-2 lg:px-5 py-2 lg:py-2.5 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest whitespace-nowrap lg:whitespace-normal transition-all shadow-sm flex items-center justify-center gap-2 ${
              activeTab === tab.id 
                ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
            }`}
          >
            <tab.icon size={16} className={activeTab === tab.id ? "text-blue-400" : "text-slate-400 hidden lg:block"} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* --- BLOCK C: MAIN CONTENT AREA --- */}
      <div className="flex flex-col flex-1 min-h-0 relative">
        {loadingRx && (
          <div className="absolute inset-0 bg-slate-50/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
            <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
              <Loader2 className="animate-spin text-blue-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Syncing Prescriptions...</span>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar rounded-2xl pb-6">
          {activeTab === 'DIGITAL_MAR' && <DigitalMAR prescriptions={prescriptions} isOnline={isOnline} />}
          {activeTab === 'PRESCRIPTIONS' && <PrescriptionList prescriptions={prescriptions} onEditOrder={handleEditOrder} onPrintMar={handlePrintUnifiedMar} />}
          {activeTab === 'HISTORY' && <MedicationHistory />}
        </div>
      </div>

      {/* --- MODAL --- */}
      {isPrescriptionModalOpen && (
        <PrescriptionFormModal 
          isOpen={isPrescriptionModalOpen} 
          onClose={() => setIsPrescriptionModalOpen(false)} 
          initialData={editingPrescription} 
        />
      )}
    </div>
  );
}

export default MedicationsModule;