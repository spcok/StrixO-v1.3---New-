import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, getFilteredRowModel, getExpandedRowModel, useReactTable, SortingState, ExpandedState
} from '@tanstack/react-table';
import { 
  Search, Plus, ArrowUpDown, Loader2, Scale, ChevronRight, ChevronDown, Users, User, MapPin, Clock, ChevronLeft
} from 'lucide-react';
import { Animal } from '../../types';
import { supabase } from '../../lib/supabase';
import AnimalFormModal from '../animals/AnimalFormModal';
import { AnimalProfile } from '../animals/AnimalProfile';
import { MobProfile } from '../animals/MobProfile';

// ENGINE INJECTIONS
import { scheduledFeedingService } from '../../services/scheduledFeedingService';
import { FeedModal } from '../husbandry/FeedModal';

// --- THE IMMUTABLE FALLBACK ---
const EMPTY_ARRAY: any[] = [];

function useScreenSize() {
  const [screen, setScreen] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    isMobile: typeof window !== 'undefined' && window.innerWidth < 768,
    isTablet: typeof window !== 'undefined' && window.innerWidth >= 768 && window.innerWidth < 1024,
    isDesktop: typeof window !== 'undefined' && window.innerWidth >= 1024,
  });

  useEffect(() => {
    const handleResize = () => {
      setScreen({
        width: window.innerWidth,
        isMobile: window.innerWidth < 768,
        isTablet: window.innerWidth >= 768 && window.innerWidth < 1024,
        isDesktop: window.innerWidth >= 1024,
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return screen;
}

const getLocalDateString = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

const GRAMS_PER_OZ = 28.349523125;

// Bulletproof unit parsing
export const formatWeightDisplay = (grams: number | null | undefined, unit: string | null | undefined) => {
  if (grams === null || grams === undefined) return null;
  
  const numGrams = Number(grams);
  if (isNaN(numGrams)) return null;

  const safeUnit = String(unit || 'g').toLowerCase().trim();
  
  if (safeUnit === 'kg' || safeUnit === 'kilogram' || safeUnit === 'kilograms') {
    return `${(numGrams / 1000).toFixed(3)}kg`;
  }
  
  if (safeUnit === 'lb' || safeUnit === 'lbs' || safeUnit === 'pound' || safeUnit === 'pounds') {
    const totalOunces = numGrams / GRAMS_PER_OZ;
    let totalOzInt = Math.floor(totalOunces);
    let e = Math.round((totalOunces - totalOzInt) * 8);
    if (e >= 8) { totalOzInt += 1; e = 0; }
    const lb = Math.floor(totalOzInt / 16);
    const oz = totalOzInt % 16;
    let str = '';
    if (lb > 0) str += `${lb}lb `;
    if (oz > 0 || e > 0) str += `${oz}`;
    if (e > 0 && e !== 8) str += ` ${e}/8`;
    if (oz > 0 || e > 0) str += 'oz';
    return str.trim() || '0lb';
  }
  
  if (safeUnit === 'oz' || safeUnit === 'ounce' || safeUnit === 'ounces') {
    const totalOunces = numGrams / GRAMS_PER_OZ;
    let totalOzInt = Math.floor(totalOunces);
    let e = Math.round((totalOunces - totalOzInt) * 8);
    if (e >= 8) { totalOzInt += 1; e = 0; }
    let str = `${totalOzInt}`;
    if (e > 0 && e !== 8) str += ` ${e}/8`;
    return `${str}oz`;
  }
  
  return `${Math.round(numGrams)}g`;
};

const formatQty = (qty: number | null | undefined, unit: string | null | undefined) => {
  if (qty === null || qty === undefined || String(qty).trim() === '') return '';
  const safeUnit = String(unit || '').toLowerCase().trim();
  if (safeUnit.includes('item') || safeUnit === 'x' || safeUnit === '') {
    return `${qty}x `;
  }
  if (safeUnit === 'grams' || safeUnit === 'g') {
    return `${qty}g `;
  }
  return `${qty}${unit} `;
};

const columnHelper = createColumnHelper<Animal & { today_weight?: any; today_feed?: any; last_feed?: any; today_temp?: any; next_feed?: any; subRows?: any[] }>();

export default function Dashboard() {
  const queryClient = useQueryClient();
  const screen = useScreenSize(); 
  
  const [activeTab, setActiveTab] = useState('EXOTIC'); 
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  
  const [isCreateAnimalModalOpen, setIsCreateAnimalModalOpen] = useState(false);
  const [selectedAnimalId, setSelectedAnimalId] = useState<string | null>(null);

  const [feedActionAnimalId, setFeedActionAnimalId] = useState<string | null>(null);
  const [isFeedModalOpen, setIsFeedModalOpen] = useState(false);
  const [feedModalSchedule, setFeedModalSchedule] = useState<any>(null);

  const [activeDate, setActiveDate] = useState<string>(getLocalDateString());
  const [inputDate, setInputDate] = useState<string>(getLocalDateString());

  const { data: allAnimals = EMPTY_ARRAY, isLoading: loadingAnimals } = useQuery({
    queryKey: ['animals', 'dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase.from('animals').select('*').order('name');
      if (error) throw error;
      return data as Animal[];
    },
    staleTime: 0,
    gcTime: 1209600000,
    networkMode: 'offlineFirst',
    meta: { persist: true },
  });

  const { data: todayFeeds = EMPTY_ARRAY, isLoading: loadingFeeds } = useQuery({
    queryKey: ['feeds', activeDate],
    queryFn: async () => {
      const start = new Date(`${activeDate}T00:00:00`).toISOString();
      const end = new Date(`${activeDate}T23:59:59.999`).toISOString();
      const { data } = await supabase.from('feed_logs').select('*').gte('recorded_at', start).lte('recorded_at', end).order('recorded_at', { ascending: false });
      return data || [];
    },
    staleTime: 0,
    gcTime: 1209600000,
    networkMode: 'offlineFirst',
    meta: { persist: true }
  });

  const { data: todayWeights = EMPTY_ARRAY, isLoading: loadingWeights } = useQuery({
    queryKey: ['weights', activeDate],
    queryFn: async () => {
      const start = new Date(`${activeDate}T00:00:00`).toISOString();
      const end = new Date(`${activeDate}T23:59:59.999`).toISOString();
      const { data } = await supabase.from('weight_logs').select('*').gte('recorded_at', start).lte('recorded_at', end).order('recorded_at', { ascending: false });
      return data || [];
    },
    staleTime: 0,
    gcTime: 1209600000,
    networkMode: 'offlineFirst',
    meta: { persist: true }
  });

  const { data: todayTemps = EMPTY_ARRAY, isLoading: loadingTemps } = useQuery({
    queryKey: ['temperatures', activeDate],
    queryFn: async () => {
      const start = new Date(`${activeDate}T00:00:00`).toISOString();
      const end = new Date(`${activeDate}T23:59:59.999`).toISOString();
      const { data } = await supabase.from('temperature_logs').select('*').gte('recorded_at', start).lte('recorded_at', end).order('recorded_at', { ascending: false });
      return data || [];
    },
    staleTime: 0,
    gcTime: 1209600000,
    networkMode: 'offlineFirst',
    meta: { persist: true }
  });

  const { data: historicalFeeds = EMPTY_ARRAY } = useQuery({
    queryKey: ['feeds_historical_latest'],
    queryFn: async () => {
      const { data } = await supabase.from('latest_animal_feeds').select('*');
      return data || [];
    },
    staleTime: 0,
    gcTime: 1209600000,
    networkMode: 'offlineFirst',
    meta: { persist: true }
  });

  const { data: nextFeeds = EMPTY_ARRAY } = useQuery({
    queryKey: ['dashboard', 'next_feeds', activeTab],
    queryFn: () => scheduledFeedingService.getNextPendingFeeds(activeTab),
    enabled: activeTab === 'EXOTIC', 
    staleTime: 0, 
    gcTime: 1209600000, 
    networkMode: 'offlineFirst',
    meta: { persist: true },
    refetchOnWindowFocus: true,
  });

  const loadingLogs = loadingFeeds || loadingWeights || loadingTemps;
  const selectedAnimal = useMemo(() => selectedAnimalId ? allAnimals.find(a => a.id === selectedAnimalId) || null : null, [allAnimals, selectedAnimalId]);

  useEffect(() => {
    const animalChannel = supabase.channel('dashboard-animals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'animals' }, () => queryClient.invalidateQueries({ queryKey: ['animals'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_logs' }, () => { 
        queryClient.invalidateQueries({ queryKey: ['feeds'] }); 
        queryClient.invalidateQueries({ queryKey: ['feeds_historical_latest'] }); 
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'next_feeds'] }); 
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'weight_logs' }, () => queryClient.invalidateQueries({ queryKey: ['weights'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'temperature_logs' }, () => queryClient.invalidateQueries({ queryKey: ['temperatures'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feeding_schedules' }, () => queryClient.invalidateQueries({ queryKey: ['dashboard', 'next_feeds'] }))
      .subscribe();

    return () => { supabase.removeChannel(animalChannel); };
  }, [queryClient]);

  const updateDate = (newDate: string) => {
    setActiveDate(newDate);
    setInputDate(newDate);
  };

  const shiftDate = (days: number) => {
    const parts = activeDate.split('-');
    if (parts.length !== 3) return;
    const [y, m, d] = parts.map(Number);
    const dateObj = new Date(y, m - 1, d);
    dateObj.setDate(dateObj.getDate() + days);

    const newDateString = dateObj.getFullYear() + '-' +
      String(dateObj.getMonth() + 1).padStart(2, '0') + '-' +
      String(dateObj.getDate()).padStart(2, '0');

    updateDate(newDateString);
  };

  const hierarchicalData = useMemo(() => {
    const weightMap = new Map(); todayWeights.forEach((w: any) => { if (!weightMap.has(w.animal_id)) weightMap.set(w.animal_id, w); });
    const tempMap = new Map(); todayTemps.forEach((t: any) => { if (!tempMap.has(t.animal_id)) tempMap.set(t.animal_id, t); });
    
    const feedMap = new Map(); 
    todayFeeds.forEach((f: any) => { 
      if (!feedMap.has(f.animal_id)) feedMap.set(f.animal_id, []);
      feedMap.get(f.animal_id).push(f);
    });

    const lastFeedMap = new Map();
    historicalFeeds.forEach((f: any) => { if (!lastFeedMap.has(f.animal_id)) lastFeedMap.set(f.animal_id, f); });

    const nextFeedMap = new Map();
    nextFeeds.forEach((f: any) => { if (!nextFeedMap.has(f.animal_id)) nextFeedMap.set(f.animal_id, f); });

    let baseData = allAnimals.map(a => ({
      ...a,
      today_weight: weightMap.get(a.id),
      today_temp: tempMap.get(a.id),
      today_feed: feedMap.get(a.id) || [],
      last_feed: lastFeedMap.get(a.id),
      next_feed: nextFeedMap.get(a.id)
    }));

    if (activeTab === 'ARCHIVED') {
      baseData = baseData.filter(a => a.status === 'ARCHIVED');
    } else {
      baseData = baseData.filter(a => a.category === activeTab && a.status !== 'ARCHIVED');
    }

    const groups = baseData.filter(a => a.record_type === 'GROUP');
    const individuals = baseData.filter(a => a.record_type === 'INDIVIDUAL');

    groups.forEach(group => {
      group.subRows = individuals.filter(indiv => indiv.parent_group_id === group.id);
    });

    const standaloneIndividuals = individuals.filter(indiv => !indiv.parent_group_id);
    return [...groups, ...standaloneIndividuals];
  }, [allAnimals, todayWeights, todayTemps, todayFeeds, historicalFeeds, nextFeeds, activeTab]);

  const columns = useMemo(() => {
    const cols = [
      columnHelper.accessor('name', {
        id: 'name',
        header: 'Name', 
        cell: (info) => {
          const animal = info.row.original;
          const isGroup = animal.record_type === 'GROUP';
          const isIndivWithGroup = animal.record_type === 'INDIVIDUAL' && animal.parent_group_id;
          const photoUrl = animal.profile_image_url;

          return (
            <div className="flex items-center gap-1.5 lg:gap-3 py-0.5 w-full">
              <div className={`relative hidden lg:block ${isIndivWithGroup ? 'ml-6' : ''}`}>
                {photoUrl ? (
                  <img src={photoUrl} className="w-8 h-8 lg:w-10 lg:h-10 rounded-full object-cover shrink-0 shadow-sm border border-slate-200 mt-0.5" alt="" />
                ) : (
                  <div className={`p-2 lg:p-2.5 rounded-full shrink-0 shadow-sm mt-0.5 ${isGroup ? 'bg-blue-50 text-blue-600 border border-blue-100' : 'bg-slate-50 text-slate-400 border border-slate-200'}`}>
                    {isGroup ? <Users size={14} className="lg:w-4 lg:h-4" /> : <User size={14} className="lg:w-4 lg:h-4" />}
                  </div>
                )}
                {isGroup && (
                  <div className="absolute -bottom-1 -right-1 w-3 h-3 lg:w-4 lg:h-4 bg-blue-500 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                    <Users size={8} className="text-white" />
                  </div>
                )}
              </div>

              <div className={`flex flex-col min-w-0 flex-1 ${isIndivWithGroup ? 'ml-2 lg:ml-0' : ''}`}>
                <div className="flex items-center gap-1">
                  {isGroup && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation(); 
                        info.row.toggleExpanded();
                      }}
                      className="p-1 hover:bg-slate-200 rounded text-slate-500 shrink-0 transition-colors cursor-pointer"
                    >
                      {info.row.getIsExpanded() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  )}
                  <span 
                    className="font-bold text-slate-900 text-[11px] md:text-[12px] lg:text-[13px] truncate w-full hover:underline cursor-pointer" 
                    title={animal.name}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedAnimalId(animal.id);
                    }}
                  >
                    {animal.name}
                  </span>
                </div>
                {animal.ring_number && (
                  <span className="text-[8px] lg:text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1 mt-0.5 truncate">
                    <div className="w-1 h-1 lg:w-1.5 lg:h-1.5 rounded-full bg-slate-300 hidden lg:block"></div> {animal.ring_number}
                  </span>
                )}
              </div>
            </div>
          );
        },
      }),
    ];

    if (!screen.isMobile) {
      cols.push(
        columnHelper.accessor('species', {
          id: 'species',
          header: 'Species',
          cell: (info) => (
            <div className="flex flex-col justify-center min-w-0 py-0.5">
              <span className="text-[10px] md:text-[11px] lg:text-[12px] font-bold text-slate-700 leading-tight" title={info.getValue()}>{info.getValue() || 'Unknown'}</span>
            </div>
          ),
        })
      );
    }

    cols.push(
      columnHelper.accessor('location', {
        id: 'location',
        header: 'Location',
        cell: (info) => (
          <div className="flex items-center justify-center gap-1 lg:gap-1.5 py-0.5 min-w-0 w-full">
            <MapPin size={10} className="text-slate-400 shrink-0 hidden lg:block" />
            <span className="text-[9px] md:text-[10px] lg:text-[11px] font-bold text-slate-600 uppercase tracking-widest leading-tight text-center">
              {info.getValue() || 'Unassigned'}
            </span>
          </div>
        ),
      }),
      columnHelper.accessor('today_weight', {
        id: 'today_weight',
        header: 'Weight',
        cell: (info) => {
          const w = info.getValue();
          const animal = info.row.original as any; 
          
          if (!w) return <span className="text-slate-300 text-[10px] md:text-[11px] lg:text-[12px] font-medium py-0.5 block w-full text-center">-</span>;
          
          const preferredUnit = animal.preferred_weight_unit || animal.weight_unit || 'g';

          return (
            <div className="flex items-center justify-center gap-1 lg:gap-1.5 py-0.5 w-full">
              <Scale size={10} className="text-emerald-500 shrink-0 hidden lg:block" />
              {/* FIXED FONT: Standardized to font-bold and text-[12px] to match the rest of the table */}
              <span className="text-[10px] md:text-[11px] lg:text-[12px] font-bold text-slate-700">
                {formatWeightDisplay(w.weight_grams, preferredUnit)}
              </span>
            </div>
          );
        }
      }),

      columnHelper.accessor('today_feed', {
        id: 'today_feed',
        header: 'Today\'s Feed',
        cell: (info) => {
          const feeds = info.getValue() || [];
          if (feeds.length === 0) return <span className="text-slate-300 text-[10px] lg:text-[12px] font-medium py-0.5 block w-full text-center">-</span>;
          
          return (
            <div className="flex flex-col gap-1 w-full text-center">
              {feeds.map((f: any, i: number) => {
                const qty = f.quantity_offered ?? f.quantity;
                const unit = f.quantity_unit ?? f.unit;
                const qtyUnit = formatQty(qty, unit);
                const timeStr = new Date(f.recorded_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                const displayString = `${qtyUnit}${f.food_item || 'Diet'} @ ${timeStr}`;

                return (
                  <span key={i} className="text-[9px] md:text-[10px] lg:text-[11px] font-bold text-slate-700 break-words whitespace-normal w-full block" title={displayString}>
                    {displayString}
                  </span>
                );
              })}
            </div>
          );
        }
      }),

      columnHelper.accessor('last_feed', {
        id: 'last_feed',
        header: 'Last Feed',
        cell: (info) => {
          const lastMeal = info.getValue();
          if (!lastMeal) return <span className="text-slate-300 text-[10px] lg:text-[12px] font-medium py-0.5 block w-full text-center">No History</span>;
          
          const mealDate = new Date(lastMeal.recorded_at);
          const dateStr = mealDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          const timeStr = mealDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          
          const qty = lastMeal.quantity_offered ?? lastMeal.quantity;
          const unit = lastMeal.quantity_unit ?? lastMeal.unit;
          const qtyUnit = formatQty(qty, unit);

          const displayString = `${qtyUnit}${lastMeal.food_item || 'Diet'} @ ${dateStr} ${timeStr}`;

          return (
            <div className="w-full text-center">
              <span className="text-[9px] md:text-[10px] lg:text-[11px] font-bold text-slate-700 break-words whitespace-normal w-full block" title={displayString}>
                {displayString}
              </span>
            </div>
          );
        }
      }),

      columnHelper.accessor('next_feed', {
        id: 'next_feed',
        header: 'Next Feed',
        cell: (info) => {
          const nextFeed = info.getValue();
          if (!nextFeed) return <span className="text-slate-300 text-[10px] lg:text-[12px] font-medium py-0.5 block w-full text-center">-</span>;
          
          const todayStr = getLocalDateString();
          const isOverdue = nextFeed.scheduled_date < todayStr;
          const isToday = nextFeed.scheduled_date === todayStr;
          
          const [y, m, d] = nextFeed.scheduled_date.split('T')[0].split('-');
          const safeDate = new Date(Number(y), Number(m) - 1, Number(d));
          const dateStr = safeDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          
          const hasTime = nextFeed.scheduled_date.includes('T');
          const timeStr = hasTime ? ` ${safeDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '';
          
          const qty = nextFeed.quantity;
          const unit = nextFeed.quantity_unit ?? nextFeed.unit;
          const qtyUnit = formatQty(qty, unit);
          
          const displayString = `${qtyUnit}${nextFeed.food_type || 'Diet'} @ ${dateStr}${timeStr}`;
          
          if (isOverdue) {
            const diffTime = Math.abs(new Date(todayStr).getTime() - safeDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return (
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  setFeedActionAnimalId(info.row.original.id); 
                  setFeedModalSchedule(nextFeed); 
                  setIsFeedModalOpen(true); 
                }}
                className="bg-rose-600 text-white animate-pulse border-2 border-rose-900 px-1.5 md:px-2 lg:px-3 py-1 lg:py-1.5 rounded-lg lg:rounded-xl hover:scale-105 active:scale-95 transition-all shadow-sm w-full max-w-[160px] mx-auto flex flex-col items-center justify-center text-center gap-0.5"
              >
                <span className="text-[9px] md:text-[10px] lg:text-[11px] font-bold leading-tight break-words whitespace-normal w-full" title={displayString}>{displayString}</span>
                <span className="text-[7px] md:text-[8px] font-black tracking-widest uppercase text-rose-200">MISSED • {diffDays}D LATE</span>
              </button>
            );
          } else if (isToday) {
            return (
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  setFeedActionAnimalId(info.row.original.id); 
                  setFeedModalSchedule(nextFeed); 
                  setIsFeedModalOpen(true); 
                }}
                className="bg-emerald-400 text-slate-950 border-2 border-emerald-600 px-1.5 md:px-2 lg:px-3 py-1 lg:py-1.5 rounded-lg lg:rounded-xl hover:scale-105 active:scale-95 transition-all shadow-sm w-full max-w-[160px] mx-auto flex flex-col items-center justify-center text-center gap-0.5"
              >
                <span className="text-[9px] md:text-[10px] lg:text-[11px] font-bold leading-tight break-words whitespace-normal w-full" title={displayString}>{displayString}</span>
                <span className="text-[7px] md:text-[8px] font-black tracking-widest uppercase text-emerald-800">TODAY</span>
              </button>
            );
          } else {
            return (
              <div className="bg-slate-800 text-white px-1.5 md:px-2 lg:px-3 py-1.5 lg:py-2 rounded-lg lg:rounded-xl opacity-90 cursor-not-allowed w-full max-w-[160px] mx-auto flex items-center justify-center text-center">
                <span className="text-[9px] md:text-[10px] lg:text-[11px] font-bold leading-tight break-words whitespace-normal w-full text-slate-100" title={displayString}>
                  {displayString}
                </span>
              </div>
            );
          }
        }
      })
    );

    return cols;
  }, [screen.isMobile, screen.isTablet, activeTab]); 

  const columnVisibility = useMemo(() => {
    return {
      next_feed: activeTab === 'EXOTIC',
      location: !(activeTab === 'EXOTIC' && !screen.isDesktop) 
    };
  }, [activeTab, screen.isDesktop]);

  const table = useReactTable({
    data: hierarchicalData,
    columns,
    state: { globalFilter, sorting, expanded, columnVisibility },
    autoResetExpanded: false, 
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getSubRows: row => row.subRows,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  const categories = useMemo(() => Array.from(new Set(allAnimals.map(a => a.category).filter(Boolean))).sort(), [allAnimals]);
  const tabs = [...categories, 'ARCHIVED']; 

  // --- ADJUSTED COLUMN WIDTHS ---
  // Decreased desktop name column from 140px/1.5fr to 120px/1.1fr
  // Increased desktop weight column from 80px to 100px/0.8fr
  const tableGridCols = table.getVisibleLeafColumns().map(c => {
    if (c.id === 'name') return screen.isMobile ? 'minmax(90px, 1.2fr)' : screen.isTablet ? 'minmax(110px, 1.2fr)' : 'minmax(120px, 1.1fr)';
    if (c.id === 'species') return screen.isMobile || screen.isTablet ? 'minmax(70px, 0.8fr)' : 'minmax(90px, 0.8fr)';
    if (c.id === 'location') return screen.isMobile || screen.isTablet ? 'minmax(60px, 0.8fr)' : 'minmax(90px, 0.8fr)';
    if (c.id === 'today_weight') return screen.isMobile ? 'minmax(60px, 0.6fr)' : screen.isTablet ? 'minmax(70px, 0.6fr)' : 'minmax(100px, 0.8fr)';
    
    if (c.id === 'today_feed') return screen.isMobile || screen.isTablet ? 'minmax(110px, 1.2fr)' : 'minmax(160px, 1.5fr)';
    if (c.id === 'last_feed') return screen.isMobile || screen.isTablet ? 'minmax(120px, 1.2fr)' : 'minmax(170px, 1.5fr)';
    if (c.id === 'next_feed') return screen.isMobile ? 'minmax(110px, 1.2fr)' : screen.isTablet ? 'minmax(110px, 1.1fr)' : 'minmax(150px, 1.2fr)'; 
    
    return '1fr';
  }).join(' ');

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-3 lg:space-y-4 animate-in fade-in duration-500">
      
      <div className="flex justify-between items-center w-full portrait:flex landscape:hidden lg:landscape:flex">
        <div className="shrink-0 pr-4">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight">Dashboard</h1>
        </div>
        <button 
          onClick={() => setIsCreateAnimalModalOpen(true)}
          className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 lg:px-4 py-2 lg:py-2.5 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95 shrink-0"
        >
          <Plus size={14} /> <span>Add Animal</span>
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex">
        <div className="relative w-full lg:w-96 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search collections..." 
            value={globalFilter ?? ''}
            onChange={e => setGlobalFilter(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all shadow-sm placeholder:text-slate-400"
          />
        </div>

        <div className="flex items-center justify-between bg-white rounded-xl p-1 border border-slate-200 shadow-sm w-full lg:w-auto">
          <button onClick={() => shiftDate(-1)} className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-800 transition-all active:scale-95"><ChevronLeft size={16} /></button>
          <div className="flex-1 lg:flex-none relative flex justify-center border-l border-r border-slate-100 px-2 min-w-[120px]">
            <input 
              type="date" 
              value={inputDate}
              onChange={(e) => setInputDate(e.target.value)}
              onBlur={(e) => updateDate(e.target.value)}
              className="bg-transparent border-none text-[10px] lg:text-xs font-bold text-slate-700 focus:outline-none focus:ring-0 py-1 cursor-pointer w-full text-center"
            />
          </div>
          <button onClick={() => shiftDate(1)} className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-800 transition-all active:scale-95"><ChevronRight size={16} /></button>
        </div>
      </div>

      <div className="grid grid-cols-4 lg:flex lg:gap-2 w-full shrink-0 gap-1.5">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-1 lg:px-4 py-1.5 lg:py-2 rounded-xl text-[9px] lg:text-xs font-black uppercase tracking-widest whitespace-nowrap lg:whitespace-normal transition-all shadow-sm ${
              activeTab === tab 
                ? tab === 'ARCHIVED' 
                  ? 'bg-rose-500 text-white border border-rose-600 shadow-rose-500/20'
                  : 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden relative mt-1">
        {(loadingAnimals || loadingLogs) && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
              <Loader2 className="animate-spin text-emerald-500" size={24} />
              <span className="text-sm font-bold text-slate-700">Syncing telemetry...</span>
            </div>
          </div>
        )}
        
        <div className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar relative w-full">
          <div className="min-w-[450px] xl:min-w-[800px] w-full">
            <div className="grid border-b border-slate-200 bg-slate-50/80 text-[9px] lg:text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-20 backdrop-blur-md" style={{ gridTemplateColumns: tableGridCols }}>
              {table.getHeaderGroups().map(headerGroup => (
                <React.Fragment key={headerGroup.id}>
                  {headerGroup.headers.map(header => {
                    const isCentered = ['location', 'today_weight', 'today_feed', 'last_feed', 'next_feed'].includes(header.column.id);
                    return (
                      <div 
                        key={header.id} 
                        className={`px-1 sm:px-2 lg:px-4 py-2 lg:py-3 flex items-center gap-1 lg:gap-2 cursor-pointer hover:bg-slate-200/50 transition-colors ${isCentered ? 'justify-center text-center' : 'justify-start text-left'}`} 
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: <ArrowUpDown size={12} className="text-emerald-500" />, desc: <ArrowUpDown size={12} className="text-emerald-500 rotate-180" /> }[header.column.getIsSorted() as string] ?? null}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>

            <div className="divide-y divide-slate-100 bg-white">
              {table.getRowModel().rows.length === 0 && !(loadingAnimals || loadingLogs) ? (
                <div className="p-8 lg:p-12 text-center text-slate-500 flex flex-col items-center">
                  <div className="w-12 h-12 lg:w-16 lg:h-16 bg-slate-50 rounded-xl lg:rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                    <Search size={24} className="text-slate-400" />
                  </div>
                  <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">No collections found</p>
                  <p className="text-[10px] lg:text-xs font-medium">Adjust your search or category filters.</p>
                </div>
              ) : (
                table.getRowModel().rows.map(row => {
                  const isGroupHeader = row.original.record_type === 'GROUP';
                  const isExpanded = row.getIsExpanded();
                  
                  return (
                    <div 
                      key={row.id} 
                      className={`grid border-b border-slate-100 hover:bg-slate-50 transition-colors group cursor-pointer ${
                        isExpanded ? 'bg-emerald-50/30' : 'bg-white'
                      } ${isGroupHeader ? 'bg-slate-50' : ''}`}
                      style={{ gridTemplateColumns: tableGridCols }}
                      onClick={() => {
                        if (!isGroupHeader) {
                          setSelectedAnimalId(row.original.id);
                        }
                      }}
                    >
                      {row.getVisibleCells().map(cell => {
                        const isCentered = ['location', 'today_weight', 'today_feed', 'last_feed', 'next_feed'].includes(cell.column.id);
                        return (
                          <div key={cell.id} className={`px-1 sm:px-2 lg:px-4 py-1.5 lg:py-2 flex items-center min-w-0 ${isCentered ? 'justify-center text-center' : 'justify-start text-left'}`}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {isCreateAnimalModalOpen && (
        <AnimalFormModal isOpen={isCreateAnimalModalOpen} onClose={() => setIsCreateAnimalModalOpen(false)} />
      )}

      {selectedAnimal && selectedAnimal.record_type === 'INDIVIDUAL' && (
        <AnimalProfile
          onClose={() => setSelectedAnimalId(null)}
          animal={selectedAnimal}
        />
      )}

      {selectedAnimal && selectedAnimal.record_type === 'GROUP' && (
        <MobProfile
          onClose={() => setSelectedAnimalId(null)}
          mob={selectedAnimal}
          members={allAnimals.filter(a => a.parent_group_id === selectedAnimal.id)}
        />
      )}

      {isFeedModalOpen && feedActionAnimalId && (
        <FeedModal
          isOpen={isFeedModalOpen}
          onClose={() => {
            setIsFeedModalOpen(false);
            setFeedActionAnimalId(null);
            setFeedModalSchedule(null);
          }}
          animalId={feedActionAnimalId}
          scheduledFeed={feedModalSchedule}
        />
      )}
    </div>
  );
}