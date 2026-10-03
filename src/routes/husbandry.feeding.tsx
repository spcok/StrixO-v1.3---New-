import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  Plus, 
  Trash2, 
  Loader2, 
  Utensils, 
  Calendar as CalIcon, 
  Filter, 
  Search, 
  CheckCircle2, 
  History, 
  Pencil, 
  Check, 
  AlertTriangle,
  X 
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Animal, FeedingSchedule as FeedingScheduleType } from '../types';
import { feedingService } from '../services/feedingService';
import { FeedingScheduleModal, type RoutineManageData } from '../components/husbandry/FeedingScheduleModal';

// Schema-strict query options: Uses status, NOT archived
const getAnimalsOptions = () => queryOptions({
  queryKey: ['animals', 'active_feeding'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('animals')
      .select('*')
      .eq('is_deleted', false)
      .neq('status', 'ARCHIVED')
      .neq('status', 'DECEASED')
      .neq('status', 'TRANSFERRED');
    if (error) throw error;
    return (data || []) as Animal[];
  },
  staleTime: 1000 * 60 * 5,
  networkMode: 'offlineFirst',
});

const getSchedulesOptions = () => queryOptions({
  queryKey: ['feeding_schedules'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('feeding_schedules')
      .select('*')
      .eq('is_deleted', false)
      .order('scheduled_date', { ascending: true });
    if (error) throw error;
    return (data || []) as FeedingScheduleType[];
  },
  staleTime: 1000 * 60 * 2,
  networkMode: 'offlineFirst',
});

export const Route = createFileRoute('/husbandry/feeding')({
  component: FeedingSchedulePage,
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

function parseRoutineMeta(schedule: FeedingScheduleType, allSchedules: FeedingScheduleType[]) {
  const metaMatch = (schedule.notes || '').match(/\[ROUTINE_META:(\{.*?\})\]/);
  if (metaMatch && metaMatch[1]) {
    try {
      const parsed = JSON.parse(metaMatch[1]);
      return {
        routineId: parsed.routineId,
        mode: (parsed.mode || 'interval') as 'single' | 'interval' | 'specific_days',
        intervalValue: parsed.intervalVal || 1,
        intervalUnit: (parsed.intervalUnit || 'days') as 'days' | 'weeks',
        selectedDays: (parsed.days || []) as number[],
      };
    } catch {
      // Fallback below
    }
  }

  const legacyMatch = (schedule.notes || '').match(/\[ROUTINE:([a-f0-9-]+)\]/i);
  const routineId = legacyMatch 
    ? legacyMatch[1] 
    : `${schedule.animal_id}_${schedule.food_type}_${schedule.quantity}_${schedule.created_at?.split('T')[0] || schedule.scheduled_date}`;

  let mode: 'single' | 'interval' | 'specific_days' = 'single';
  let intervalValue = 1;
  let intervalUnit: 'days' | 'weeks' = 'days';
  let selectedDays: number[] = [];

  if (allSchedules.length > 1) {
    const sorted = [...allSchedules].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
    const d1 = parseISO(sorted[0].scheduled_date).getTime();
    const d2 = parseISO(sorted[1].scheduled_date).getTime();
    const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));

    if (diffDays === 7) {
      mode = 'interval';
      intervalValue = 1;
      intervalUnit = 'weeks';
    } else if (diffDays > 0 && diffDays < 30) {
      mode = 'interval';
      intervalValue = diffDays;
      intervalUnit = 'days';
    }

    const uniqueDays = Array.from(new Set(sorted.map(s => parseISO(s.scheduled_date).getDay())));
    if (uniqueDays.length > 1 && uniqueDays.length <= 4) {
      selectedDays = uniqueDays;
    }
  }

  return { routineId, mode, intervalValue, intervalUnit, selectedDays };
}

export function FeedingSchedulePage() {
  const queryClient = useQueryClient();
  const { user, profile, hasPermission } = useAuth();
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  
  const canManage = hasPermission('husbandry:write') || 
                    hasPermission('husbandry:delete') || 
                    ['DIRECTOR', 'ADMIN', 'MANAGER', 'SENIOR_KEEPER'].includes(profile?.role || '');

  const [activeTab, setActiveTab] = useState<string>('OWL');
  const categories = ['OWL', 'RAPTOR', 'MAMMAL', 'EXOTIC'];

  const [filterAnimalId, setFilterAnimalId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewLayout, setViewLayout] = useState<'grouped' | 'individual' | 'past'>('grouped');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [managingRoutine, setManagingRoutine] = useState<RoutineManageData | null>(null);

  // Soft-Delete Confirmation State
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    isOpen: boolean;
    type: 'single' | 'group';
    ids: string[];
    title: string;
    description: string;
  } | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel('feeding-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feeding_schedules' }, () => {
        queryClient.invalidateQueries({ queryKey: ['feeding_schedules'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data: animals = [] } = useQuery(getAnimalsOptions());
  const { data: schedules = [], isLoading: loadingSchedules } = useQuery(getSchedulesOptions());

  // Mutations
  const deleteSingleMutation = useMutation({
    mutationFn: async (scheduleId: string) => {
      await feedingService.deleteSchedule(scheduleId, user?.id || '');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeding_schedules'] });
      toast.success('Scheduled feed deleted.');
      setDeleteConfirmation(null);
    },
    onError: (err: any) => toast.error(`Deletion failed: ${err.message}`),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (scheduleIds: string[]) => {
      await feedingService.deleteSchedules(scheduleIds, user?.id || '');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeding_schedules'] });
      toast.success('Routine series soft-deleted successfully.');
      setDeleteConfirmation(null);
    },
    onError: (err: any) => toast.error(`Group deletion failed: ${err.message}`),
  });

  const fulfillMutation = useMutation({
    mutationFn: async (schedule: FeedingScheduleType) => {
      if (!user?.id) throw new Error('Unauthorized');
      await feedingService.fulfillSchedule({
        scheduleId: schedule.id!,
        animalId: schedule.animal_id,
        foodItem: schedule.food_type,
        quantity: schedule.quantity,
        unit: schedule.quantity_unit || 'item',
        notes: schedule.supplements ? `Supplements: ${schedule.supplements}` : undefined,
        userId: user.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeding_schedules'] });
      queryClient.invalidateQueries({ queryKey: ['feed_logs'] });
      toast.success('Feed committed to animal intake record.');
    },
    onError: (err: any) => toast.error(`Intake logging failed: ${err.message}`),
  });

  // Filter schedules
  const displayedSchedules = useMemo(() => {
    let filtered = schedules.filter(s => {
      const animal = animals.find(a => a.id === s.animal_id);
      return (animal?.category || '').toUpperCase() === activeTab.toUpperCase();
    });

    if (filterAnimalId !== 'ALL') {
      filtered = filtered.filter(s => s.animal_id === filterAnimalId);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(s => {
        const animal = animals.find(a => a.id === s.animal_id);
        return (
          animal?.name?.toLowerCase().includes(q) ||
          animal?.species?.toLowerCase().includes(q) ||
          s.food_type?.toLowerCase().includes(q)
        );
      });
    }
    return filtered;
  }, [schedules, animals, activeTab, filterAnimalId, searchQuery]);

  // Group routines
  const groupedRoutines = useMemo(() => {
    const routineMap = new Map<string, RoutineManageData>();

    displayedSchedules.forEach((schedule) => {
      const { routineId, mode, intervalValue, intervalUnit, selectedDays } = parseRoutineMeta(schedule, displayedSchedules);
      const isCompleted = schedule.status === 'COMPLETED';
      const isPending = schedule.status === 'PENDING' || !schedule.status;
      const animal = animals.find(a => a.id === schedule.animal_id);

      if (!routineMap.has(routineId)) {
        routineMap.set(routineId, {
          routineId,
          animalId: schedule.animal_id,
          animalName: animal?.name || 'Specimen',
          foodType: schedule.food_type,
          quantity: schedule.quantity,
          supplements: schedule.supplements || null,
          feedNotRequired: schedule.food_type === 'NOT REQUIRED',
          scheduleMode: mode,
          intervalValue,
          intervalUnit,
          selectedDays,
          startDate: schedule.scheduled_date,
          endDate: schedule.scheduled_date,
          totalFeeds: 1,
          completedFeeds: isCompleted ? 1 : 0,
          pendingFeeds: isPending ? 1 : 0,
          pendingIds: isPending ? [schedule.id!] : [],
          allIds: [schedule.id!],
        });
      } else {
        const entry = routineMap.get(routineId)!;
        entry.totalFeeds += 1;
        if (isCompleted) entry.completedFeeds += 1;
        if (isPending) {
          entry.pendingFeeds += 1;
          entry.pendingIds.push(schedule.id!);
        }
        entry.allIds.push(schedule.id!);

        if (schedule.scheduled_date < entry.startDate) entry.startDate = schedule.scheduled_date;
        if (schedule.scheduled_date > entry.endDate) entry.endDate = schedule.scheduled_date;
      }
    });

    return Array.from(routineMap.values());
  }, [displayedSchedules, animals]);

  const activeRoutines = useMemo(() => groupedRoutines.filter(r => r.pendingFeeds > 0), [groupedRoutines]);
  const concludedRoutines = useMemo(() => groupedRoutines.filter(r => r.pendingFeeds === 0), [groupedRoutines]);

  const activeList = useMemo(() => {
    if (viewLayout === 'grouped') return activeRoutines;
    if (viewLayout === 'past') return concludedRoutines;
    return displayedSchedules;
  }, [viewLayout, activeRoutines, concludedRoutines, displayedSchedules]);

  const rowVirtualizer = useVirtualizer({
    count: activeList.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => (isMobile ? 120 : 68),
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const tableGridCols = "minmax(180px, 1.4fr) minmax(180px, 1.4fr) minmax(260px, 2fr) minmax(210px, 1.3fr)";

  const triggerDeleteRoutine = (routine: RoutineManageData) => {
    setDeleteConfirmation({
      isOpen: true,
      type: 'group',
      ids: routine.allIds,
      title: `Delete Routine for ${routine.animalName}?`,
      description: `This will soft-delete all ${routine.allIds.length} feeds scheduled for this routine (${routine.pendingFeeds} remaining, ${routine.completedFeeds} completed). Feeds already completed in animal records remain preserved.`,
    });
  };

  const triggerDeleteSingle = (schedule: FeedingScheduleType, animalName: string) => {
    setDeleteConfirmation({
      isOpen: true,
      type: 'single',
      ids: [schedule.id!],
      title: `Delete Feed for ${animalName}?`,
      description: `This will soft-delete the ${schedule.quantity}x ${schedule.food_type} scheduled for ${format(parseISO(schedule.scheduled_date), 'dd MMM yyyy')}.`,
    });
  };

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-3 lg:space-y-4 animate-in fade-in duration-300 w-full font-sans text-left pb-4">
      
      {/* Header Ribbon */}
      <div className="flex justify-between items-center w-full mb-1 shrink-0">
        <div>
          <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
            Feeding &amp; Nutrition Schedules
          </h1>
          <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">
            Dynamic Intake Progress &amp; Kitchen Prep Ledgers
          </p>
        </div>
        
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setManagingRoutine(null);
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-xs active:scale-95 cursor-pointer"
          >
            <Plus size={15} className="text-emerald-400" />
            <span>Schedule Routine</span>
          </button>
        )}
      </div>

      {/* Control Deck */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2.5 w-full bg-slate-50/80 p-2 rounded-2xl border border-slate-200 shrink-0 text-left">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input 
            type="text" 
            placeholder="Search specimen name, species, diet item..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-4 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-xs"
          />
        </div>

        <div className="flex items-center gap-2 bg-white px-3 py-1 rounded-xl border border-slate-200 shadow-xs shrink-0 w-full sm:w-auto">
          <Filter size={13} className="text-slate-400 shrink-0" />
          <select 
            value={filterAnimalId} 
            onChange={(e) => setFilterAnimalId(e.target.value)}
            className="bg-transparent text-[10px] lg:text-xs font-bold text-slate-700 uppercase tracking-wider outline-none py-0.5 pr-2 w-full sm:w-48 truncate cursor-pointer"
          >
            <option value="ALL">All Animals ({animals.length})</option>
            {animals.filter(a => (a.category || '').toUpperCase() === activeTab.toUpperCase()).map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.species})</option>
            ))}
          </select>
        </div>

        <div className="bg-slate-200/60 p-1 rounded-xl flex border border-slate-200 shrink-0 w-full sm:w-auto">
          <button 
            type="button"
            onClick={() => setViewLayout('grouped')} 
            className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${viewLayout === 'grouped' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
          >
            Active Routines ({activeRoutines.length})
          </button>
          <button 
            type="button"
            onClick={() => setViewLayout('individual')} 
            className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${viewLayout === 'individual' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
          >
            Daily Queue
          </button>
          <button 
            type="button"
            onClick={() => setViewLayout('past')} 
            className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer flex items-center gap-1 ${viewLayout === 'past' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <History size={11} />
            <span>Past ({concludedRoutines.length})</span>
          </button>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="grid grid-cols-4 lg:flex lg:gap-2 w-full shrink-0 gap-1.5 overflow-x-auto">
        {categories.map(cat => (
          <button
            key={cat}
            type="button"
            onClick={() => { setActiveTab(cat); setFilterAnimalId('ALL'); }}
            className={`px-3 lg:px-6 py-2 rounded-xl text-[10px] lg:text-xs font-black uppercase tracking-widest whitespace-nowrap transition-all shadow-xs cursor-pointer ${
              activeTab === cat 
                ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20' 
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Main Data View */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col flex-1 min-h-0 relative overflow-hidden mt-1 text-left">
        <div className="p-3.5 bg-slate-50/80 border-b border-slate-100 flex justify-between items-center shrink-0">
          <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
            <Utensils size={14} className="text-emerald-600"/> 
            {viewLayout === 'grouped' ? 'Routines with Feeds Remaining' : viewLayout === 'past' ? 'Completed & Concluded Routines' : 'Individual Scheduled Feeds'}
          </h4>
          <span className="text-[10px] font-mono font-bold bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-600">
            {activeList.length} Entries
          </span>
        </div>

        <div ref={scrollParentRef} className="flex-1 overflow-auto custom-scrollbar w-full">
          {loadingSchedules && (
            <div className="p-16 flex flex-col items-center justify-center gap-2 text-slate-400">
              <Loader2 className="animate-spin text-slate-800" size={24} />
              <span className="text-xs font-bold uppercase tracking-widest">Loading schedules...</span>
            </div>
          )}

          {!loadingSchedules && activeList.length === 0 ? (
            <div className="p-16 text-center text-slate-400">
              <p className="text-xs font-black uppercase tracking-widest">No matching schedules found.</p>
            </div>
          ) : (
            <div className="min-w-full lg:min-w-[850px]">
              <div className="hidden lg:grid border-b border-slate-200 bg-slate-50 text-[9px] font-black text-slate-400 uppercase tracking-widest sticky top-0 z-10" style={{ gridTemplateColumns: tableGridCols }}>
                <div className="px-5 py-3 text-left">{viewLayout === 'individual' ? 'Target Date' : 'Routine Window'}</div>
                <div className="px-5 py-3 text-left">Specimen / Mob</div>
                <div className="px-5 py-3 text-left">Diet Intake &amp; Routine Progress</div>
                <div className="px-5 py-3 text-right">Actions</div>
              </div>

              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const item = activeList[virtualRow.index];

                  // Active & Past Routine View
                  if (viewLayout === 'grouped' || viewLayout === 'past') {
                    const routine = item as RoutineManageData;
                    const pctComplete = Math.round((routine.completedFeeds / (routine.totalFeeds || 1)) * 100);

                    return (
                      <div 
                        key={routine.routineId} 
                        ref={rowVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        className="absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border-b border-slate-100 hover:bg-slate-50 transition-colors p-3 lg:p-0 items-center"
                        style={{ gridTemplateColumns: isMobile ? '1fr' : tableGridCols, transform: `translateY(${virtualRow.start}px)` }}
                      >
                        {/* Dates */}
                        <div className="lg:px-5 lg:py-3 space-y-1">
                          <span className="text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200 inline-block">
                            {format(parseISO(routine.startDate), 'dd MMM')} &ndash; {format(parseISO(routine.endDate), 'dd MMM yyyy')}
                          </span>
                        </div>

                        {/* Animal / Mob */}
                        <div className="lg:px-5 lg:py-3">
                          <h4 className="font-bold text-xs text-slate-900 uppercase tracking-tight truncate">{routine.animalName}</h4>
                          <span className="text-[10px] text-slate-400 font-medium block truncate">
                            {routine.scheduleMode === 'interval' 
                              ? `Every ${routine.intervalValue} ${routine.intervalUnit}` 
                              : routine.scheduleMode === 'specific_days' 
                              ? 'Set Days' 
                              : 'Single'}
                          </span>
                        </div>

                        {/* Diet & Intake Quota Progress */}
                        <div className="lg:px-5 lg:py-3 space-y-1.5">
                          <div className="flex items-center justify-between text-xs font-bold text-slate-900 pr-4">
                            <span>{routine.quantity}x {routine.foodType}</span>
                            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                              {routine.pendingFeeds > 0 
                                ? `${routine.pendingFeeds} of ${routine.totalFeeds} feeds remaining` 
                                : `Fulfilled (${routine.completedFeeds}/${routine.totalFeeds})`}
                            </span>
                          </div>
                          
                          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${pctComplete}%` }} />
                          </div>

                          {routine.supplements && (
                            <span className="text-[9px] font-bold text-amber-700 block">+ {routine.supplements}</span>
                          )}
                        </div>

                        {/* Actions: Side-by-Side Manage and Delete Buttons */}
                        <div className="lg:px-5 lg:py-3 flex items-center justify-end gap-2">
                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setManagingRoutine(routine);
                                  setIsModalOpen(true);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 cursor-pointer shadow-xs"
                                title="Manage routine diet, interval, or extend remaining feeds"
                              >
                                <Pencil size={12} className="text-emerald-400" />
                                <span>Manage</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => triggerDeleteRoutine(routine)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 cursor-pointer shadow-xs"
                                title="Soft delete entire routine series"
                              >
                                <Trash2 size={12} className="text-rose-600" />
                                <span>Delete</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  }

                  // Individual Queue View
                  const schedule = item as FeedingScheduleType;
                  const animal = animals.find(a => a.id === schedule.animal_id);
                  const isCompleted = schedule.status === 'COMPLETED';

                  return (
                    <div 
                      key={schedule.id} 
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      className="absolute top-0 left-0 w-full grid grid-cols-1 lg:grid border-b border-slate-100 hover:bg-slate-50 transition-colors p-3 lg:p-0 items-center"
                      style={{ gridTemplateColumns: isMobile ? '1fr' : tableGridCols, transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <div className="lg:px-5 lg:py-3">
                        <span className="font-mono text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <CalIcon size={12} className="text-slate-400" />
                          {format(parseISO(schedule.scheduled_date), 'dd MMM yyyy')}
                        </span>
                      </div>

                      <div className="lg:px-5 lg:py-3">
                        <h4 className="font-bold text-xs text-slate-900 uppercase truncate">{animal?.name || 'Specimen'}</h4>
                        <span className="text-[10px] text-slate-400 font-medium block truncate">{animal?.species}</span>
                      </div>

                      <div className="lg:px-5 lg:py-3">
                        <span className="font-bold text-xs text-slate-900">{schedule.quantity}x {schedule.food_type}</span>
                        {schedule.supplements && <span className="text-[9px] text-amber-700 font-bold block">+ {schedule.supplements}</span>}
                      </div>

                      <div className="lg:px-5 lg:py-3 flex items-center justify-end gap-2">
                        {isCompleted ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                            <Check size={10} /> Fulfilled
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => fulfillMutation.mutate(schedule)}
                            disabled={fulfillMutation.isPending}
                            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[9px] font-black uppercase tracking-widest shadow-xs active:scale-95 cursor-pointer disabled:opacity-50"
                          >
                            <CheckCircle2 size={11} />
                            <span>Mark Fed</span>
                          </button>
                        )}

                        {canManage && (
                          <button
                            type="button"
                            onClick={() => triggerDeleteSingle(schedule, animal?.name || 'Specimen')}
                            className="flex items-center gap-1 px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer"
                            title="Soft delete this feed"
                          >
                            <Trash2 size={11} />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Dialog */}
      {deleteConfirmation && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 font-sans text-left animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight leading-tight">
                  {deleteConfirmation.title}
                </h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                  Confirmation Required
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 font-medium leading-relaxed">
              {deleteConfirmation.description}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteConfirmation(null)}
                disabled={deleteSingleMutation.isPending || deleteGroupMutation.isPending}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (deleteConfirmation.type === 'group') {
                    deleteGroupMutation.mutate(deleteConfirmation.ids);
                  } else {
                    deleteSingleMutation.mutate(deleteConfirmation.ids[0]);
                  }
                }}
                disabled={deleteSingleMutation.isPending || deleteGroupMutation.isPending}
                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-xs active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {deleteSingleMutation.isPending || deleteGroupMutation.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Trash2 size={13} />
                )}
                <span>Confirm Soft Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TanStack Form v1 Unified Modal */}
      <FeedingScheduleModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setManagingRoutine(null);
        }}
        activeCategory={activeTab}
        manageRoutine={managingRoutine}
      />

    </div>
  );
}

export default FeedingSchedulePage;