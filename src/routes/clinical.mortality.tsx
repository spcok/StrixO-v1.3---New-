import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, queryOptions } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { supabase } from '../lib/supabase';
import { 
  Search, Calendar, AlertTriangle, 
  Loader2, BookOpen, Users, User
} from 'lucide-react';
import { format } from 'date-fns';

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const deathLogsOptions = queryOptions({
  queryKey: ['death_logs'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('death_logs')
      .select('*')
      .order('date_of_death', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  staleTime: 1000 * 60 * 15,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

const allAnimalsOptions = queryOptions({
  queryKey: ['animals', 'all'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('animals')
      .select('id, name, species, ring_number, profile_image_url, record_type');
    if (error) throw error;
    return data || [];
  },
  staleTime: 1000 * 60 * 60,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

const staffDirectoryOptions = queryOptions({
  queryKey: ['staff_directory'],
  queryFn: async () => {
    const { data, error } = await supabase.from('users').select('id, name, role');
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
export const Route = createFileRoute('/clinical/mortality')({
  loader: async ({ context: { queryClient } }) => {
    if (queryClient) {
      // @ts-ignore
      await Promise.all([
        queryClient.ensureQueryData(deathLogsOptions),
        queryClient.ensureQueryData(allAnimalsOptions),
        queryClient.ensureQueryData(staffDirectoryOptions)
      ]);
    }
  },
  component: MortalityLedger,
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
export function MortalityLedger() {
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState('');
  const scrollParentRef = useRef<HTMLDivElement>(null);

  // 1. Fetch Data
  const { data: deathLogs = [], isLoading: loadingLogs } = useQuery(deathLogsOptions);
  const { data: animals = [], isLoading: loadingAnimals } = useQuery(allAnimalsOptions);
  const { data: staff = [], isLoading: loadingStaff } = useQuery(staffDirectoryOptions);

  const isLoading = loadingLogs || loadingAnimals || loadingStaff;

  // 2. Stitch and Filter Data
  const ledgerData = useMemo(() => {
    let stitched = deathLogs.map((log: any) => {
      const animal = animals.find((a: any) => a.id === log.animal_id);
      const logger = staff.find((s: any) => s.id === log.logged_by);
      return {
        ...log,
        animalDetails: animal,
        loggedByName: logger?.name || 'System'
      };
    });

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      stitched = stitched.filter((row: any) => 
        (row.animalDetails?.name || '').toLowerCase().includes(query) ||
        (row.animalDetails?.species || '').toLowerCase().includes(query) ||
        (row.animalDetails?.ring_number || '').toLowerCase().includes(query) ||
        (row.cause_of_death && row.cause_of_death.toLowerCase().includes(query))
      );
    }

    return stitched;
  }, [deathLogs, animals, staff, searchQuery]);

  // 3. Mobile-First Virtualizer
  const rowVirtualizer = useWindowVirtualizer({
    count: ledgerData.length,
    estimateSize: () => isMobile ? 180 : 80, 
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const tableGridCols = "minmax(250px, 2fr) minmax(180px, 1fr) minmax(250px, 2fr) minmax(180px, 1fr)";

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-5 lg:space-y-6 animate-in fade-in duration-500 w-full">
      
      {/* --- BLOCK A: HEADER RIBBON --- */}
      <div className="flex justify-between items-start w-full mb-2 lg:mb-4 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1.5 lg:gap-2">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
             Mortality Ledger
           </h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
             ZLA Clinical Post-Mortem Records
           </p>
        </div>
      </div>

      {/* --- BLOCK B: CONTROL DECK --- */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="relative flex-1 min-w-[200px] lg:w-96 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search by animal name, ring number, or cause..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all shadow-sm placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* --- BLOCK D: CHAMELEON DATA GRID --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden relative mt-1">
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
            <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
              <Loader2 className="animate-spin text-rose-600" size={24} />
              <span className="text-sm font-bold text-slate-700">Syncing Ledger...</span>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50/30" ref={scrollParentRef}>
          
          <div className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
            <div className="px-5 py-4 flex items-center justify-start text-left">Animal ID & Species</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Date & Manner</div>
            <div className="px-5 py-4 flex items-center justify-start text-left">Cause & Post-Mortem</div>
            <div className="px-5 py-4 flex items-center justify-end text-right">Authorizing Vet/Staff</div>
          </div>

          <div className="p-3 lg:p-0">
            {ledgerData.length === 0 && !isLoading ? (
              <div className="p-8 lg:p-12 text-center text-slate-500 flex flex-col items-center">
                <div className="w-12 h-12 lg:w-16 lg:h-16 bg-white rounded-xl lg:rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                  <BookOpen size={24} className="text-slate-400" />
                </div>
                <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">Ledger is Empty</p>
                <p className="text-[10px] lg:text-xs font-medium">No mortality records found in the database.</p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const row = ledgerData[virtualRow.index];
                  const animal = row.animalDetails || {};
                  const isGroup = animal.record_type === 'GROUP';

                  return (
                    <div 
                      key={row.id} 
                      className="absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border border-slate-200 lg:border-none lg:border-b border-b-slate-100 rounded-xl lg:rounded-none bg-white p-3 lg:p-0 hover:bg-slate-50 transition-colors shadow-sm lg:shadow-none gap-3 lg:gap-0 box-border"
                      style={{ 
                        gridTemplateColumns: isMobile ? '1fr' : tableGridCols,
                        transform: `translateY(${virtualRow.start}px)`
                      }}
                    >
                      {/* 1. Identity Block */}
                      <div className="w-full lg:px-5 lg:py-3 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-2 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Patient</div>}
                        <div className="flex items-center gap-3 min-w-0 py-1">
                          <div className={`w-8 h-8 lg:w-10 lg:h-10 rounded-full flex items-center justify-center shrink-0 border shadow-sm overflow-hidden ${!animal.profile_image_url ? (isGroup ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-slate-50 text-slate-400 border-slate-200') : 'border-slate-200'}`}>
                            {animal.profile_image_url ? (
                              <img src={animal.profile_image_url} alt={animal.name} className="w-full h-full object-cover" />
                            ) : (
                              isGroup ? <Users size={16} /> : <User size={16} />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="font-bold text-slate-900 text-xs lg:text-sm tracking-tight truncate" title={animal.name || 'Unknown'}>{animal.name || 'Unknown Animal'}</h3>
                            <div className="flex items-center gap-1.5 text-[9px] lg:text-[10px] text-slate-500 truncate mt-0.5">
                              {animal.ring_number && <span className="font-bold text-slate-400 uppercase tracking-widest">{animal.ring_number}</span>}
                              {animal.ring_number && animal.species && <span>•</span>}
                              {animal.species && <span className="italic truncate">{animal.species}</span>}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 2. Date & Manner */}
                      <div className="w-full lg:px-5 lg:py-3 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Time & Manner</div>}
                        <div className="space-y-1.5 w-full">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-[9px] lg:text-[10px] font-black text-slate-600 uppercase tracking-widest w-fit">
                            <Calendar size={12} /> {format(new Date(row.date_of_death), 'dd MMM yyyy')} <span className="text-slate-400 font-bold ml-1">{format(new Date(row.date_of_death), 'HH:mm')}</span>
                          </span>
                          <span className={`block w-fit text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border ${row.manner_of_death === 'Euthanasia' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                            {row.manner_of_death}
                          </span>
                        </div>
                      </div>

                      {/* 3. Cause & Notes */}
                      <div className="w-full lg:px-5 lg:py-3 flex lg:items-center justify-start min-w-0 flex-col lg:flex-row gap-1 lg:gap-0">
                        {isMobile && <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 pt-2 border-t border-slate-100">Cause of Death</div>}
                        <div className="space-y-1 w-full pr-4">
                          <span className="text-[11px] lg:text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            <AlertTriangle size={12} className={row.cause_of_death ? "text-rose-500 shrink-0" : "text-slate-300 shrink-0"}/> 
                            <span className="truncate">{row.cause_of_death || 'Pending Post-Mortem'}</span>
                          </span>
                          {row.necropsy_notes && (
                            <span className="block text-[10px] font-medium text-slate-500 mt-1 line-clamp-2 leading-relaxed" title={row.necropsy_notes}>
                              {row.necropsy_notes}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 4. Logged By */}
                      <div className={`w-full lg:px-5 lg:py-3 flex min-w-0 ${isMobile ? 'justify-between pt-2 border-t border-slate-100 mt-1' : 'items-center justify-end'}`}>
                        {isMobile && <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Logged By</span>}
                        <span className="text-[10px] lg:text-xs font-bold text-slate-700 text-right">{row.loggedByName}</span>
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

export default MortalityLedger;