import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual'; 
import { 
  CheckCircle2, AlertCircle, Droplets, Lock, HeartPulse, 
  ChevronLeft, ChevronRight, Loader2, Edit3, X, Save, Search, 
  Users, User, ChevronDown, CornerDownRight
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { dailyRoundsService } from '../services/dailyRoundsService';
import { Animal, DailyRound } from '../types';

// ------------------------------------------------------------------
// 1. SAFE UUID POLYFILL (For offline queueing on non-HTTPS networks)
// ------------------------------------------------------------------
const generateOfflineUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// ------------------------------------------------------------------
// 2. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const getAnimalsOptions = () => queryOptions({
  queryKey: ['animals', 'dashboard'],
  queryFn: async () => {
    const { data, error } = await supabase.from('animals').select('*').order('name');
    if (error) throw error;
    return data as Animal[];
  },
  staleTime: 0,
  gcTime: 1209600000,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

const getRoundsOptions = (date: string, shift: 'MORNING' | 'AFTERNOON') => queryOptions({
  queryKey: ['rounds', date, shift],
  queryFn: () => dailyRoundsService.getRoundsByDateAndShift(date, shift),
  staleTime: 0,
  gcTime: 1209600000,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

// ------------------------------------------------------------------
// 3. ROUTE DEFINITION
// ------------------------------------------------------------------
export const Route = createFileRoute('/husbandry/rounds')({
  loader: async ({ context: { queryClient } }) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const shift = new Date().getHours() < 12 ? 'MORNING' : 'AFTERNOON';
    
    queryClient.prefetchQuery(getAnimalsOptions());
    queryClient.prefetchQuery(getRoundsOptions(today, shift));
  },
  component: DailyRounds
});

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768); 
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  return isMobile;
}

interface DisplayAnimalRow extends Animal {
  isGroupParent?: boolean;
  isChildMember?: boolean;
  childCount?: number;
  parentGroupId?: string;
  parentGroupName?: string;
}

// ------------------------------------------------------------------
// 4. MAIN COMPONENT
// ------------------------------------------------------------------
function DailyRounds() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  
  // -- Local State --
  const [activeDate, setActiveDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [inputDate, setInputDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [activeShift, setActiveShift] = useState<'MORNING' | 'AFTERNOON'>(
    new Date().getHours() < 12 ? 'MORNING' : 'AFTERNOON'
  );
  
  // -- Unified Control Deck State --
  const [activeTab, setActiveTab] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedMobs, setExpandedMobs] = useState<Set<string>>(new Set());

  const [draftRounds, setDraftRounds] = useState<Record<string, Partial<DailyRound>>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<{type: 'success' | 'error', message: string} | null>(null);
  
  // -- Modal State --
  const [noteModalState, setNoteModalState] = useState<{
    isOpen: boolean;
    animal: Animal | null;
    round: DailyRound | null;
    currentNote: string;
  }>({
    isOpen: false,
    animal: null,
    round: null,
    currentNote: ''
  });

  const parentRef = useRef<HTMLDivElement>(null);

  const { data: animals = [], isLoading: loadingAnimals } = useQuery(getAnimalsOptions());
  const { data: rounds = [], isLoading: loadingRounds } = useQuery(getRoundsOptions(activeDate, activeShift));

  const isLoading = loadingAnimals || loadingRounds;

  // ==========================================
  // O(1) HASH MAP OPTIMIZATION 
  // ==========================================
  const roundsMap = useMemo(() => {
    const map = new Map<string, DailyRound>();
    rounds.forEach(r => map.set(r.animal_id, r));
    return map;
  }, [rounds]);

  const categories = useMemo(() => Array.from(new Set(animals.map(a => a.category).filter(Boolean))).sort(), [animals]);
  const tabs = ['ALL', ...categories];

  const toggleMob = (mobId: string) => {
    setExpandedMobs(prev => {
      const next = new Set(prev);
      if (next.has(mobId)) {
        next.delete(mobId);
      } else {
        next.add(mobId);
      }
      return next;
    });
  };

  // AUTO-EXPAND MOBS ON SEARCH
  useEffect(() => {
    if (!searchQuery.trim()) return;
    const q = searchQuery.toLowerCase();
    
    const mobsToExpand = new Set<string>();
    animals.forEach(a => {
      if (a.parent_group_id) {
        const matches = 
          a.name.toLowerCase().includes(q) ||
          (a.species && a.species.toLowerCase().includes(q)) ||
          (a.ring_number && a.ring_number.toLowerCase().includes(q));
        
        if (matches) {
          mobsToExpand.add(a.parent_group_id);
        }
      }
    });

    if (mobsToExpand.size > 0) {
      setExpandedMobs(prev => {
        const next = new Set(prev);
        mobsToExpand.forEach(id => next.add(id));
        return next;
      });
    }
  }, [searchQuery, animals]);

  // ==========================================
  // HIERARCHICAL FLATTENED DATA ENGINE
  // ==========================================
  const displayAnimals = useMemo<DisplayAnimalRow[]>(() => {
    const activeAnimals = animals.filter(a => a.status !== 'ARCHIVED');

    const childrenByParent = new Map<string, Animal[]>();
    const parentGroups: Animal[] = [];
    const standaloneIndividuals: Animal[] = [];

    activeAnimals.forEach(a => {
      if (a.record_type === 'GROUP') {
        parentGroups.push(a);
      } else if (a.parent_group_id) {
        const existing = childrenByParent.get(a.parent_group_id) || [];
        existing.push(a);
        childrenByParent.set(a.parent_group_id, existing);
      } else {
        standaloneIndividuals.push(a);
      }
    });

    const topLevelEntities = [...parentGroups, ...standaloneIndividuals];
    topLevelEntities.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.name.localeCompare(b.name));

    const q = searchQuery.toLowerCase().trim();

    const matchesFilter = (a: Animal) => {
      if (activeTab !== 'ALL' && a.category !== activeTab) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        (a.species && a.species.toLowerCase().includes(q)) ||
        (a.ring_number && a.ring_number.toLowerCase().includes(q))
      );
    };

    const flattenedRows: DisplayAnimalRow[] = [];

    topLevelEntities.forEach(entity => {
      const isGroup = entity.record_type === 'GROUP';
      const children = isGroup ? (childrenByParent.get(entity.id) || []) : [];
      children.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.name.localeCompare(b.name));

      const groupMatches = matchesFilter(entity);
      const matchingChildren = children.filter(matchesFilter);
      const hasMatchingChild = matchingChildren.length > 0;

      if (!isGroup) {
        if (groupMatches) {
          flattenedRows.push({
            ...entity,
            isGroupParent: false,
            isChildMember: false,
          });
        }
      } else {
        if (groupMatches || hasMatchingChild) {
          flattenedRows.push({
            ...entity,
            isGroupParent: true,
            isChildMember: false,
            childCount: children.length,
          });

          if (expandedMobs.has(entity.id)) {
            const visibleChildren = q ? matchingChildren : children;
            visibleChildren.forEach(child => {
              flattenedRows.push({
                ...child,
                isGroupParent: false,
                isChildMember: true,
                parentGroupId: entity.id,
                parentGroupName: entity.name,
              });
            });
          }
        }
      }
    });

    return flattenedRows;
  }, [animals, activeTab, searchQuery, expandedMobs]);

  // ==========================================
  // BULLETPROOF DYNAMIC VIRTUALIZER
  // ==========================================
  const virtualizer = useVirtualizer({
    count: displayAnimals.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => isMobile ? 110 : 70, 
    overscan: 5,
  });

  useEffect(() => {
    const channel = supabase.channel('rounds_sync')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'daily_rounds',
        filter: `date=eq.${activeDate}` 
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['rounds', activeDate, activeShift] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeDate, activeShift, queryClient]);

  const handleDateChange = (newDate: string) => {
    setActiveDate(newDate);
    setInputDate(newDate);
    setDraftRounds({});
    setHasUnsavedChanges(false);
    setSubmissionStatus(null);
  };

  const shiftDate = (days: number) => {
    const parts = activeDate.split('-');
    if (parts.length !== 3) return;
    const [y, m, d] = parts.map(Number);
    const dateObj = new Date(y, m - 1, d, 12, 0, 0); 
    dateObj.setDate(dateObj.getDate() + days);

    const newDateString = dateObj.getFullYear() + '-' +
      String(dateObj.getMonth() + 1).padStart(2, '0') + '-' +
      String(dateObj.getDate()).padStart(2, '0');

    handleDateChange(newDateString);
  };

  // ==========================================
  // CASCADE TOGGLE (Parent Mob -> All Members)
  // ==========================================
  const handleToggle = (targetAnimal: Animal, field: keyof DailyRound) => {
    const animalId = targetAnimal.id;
    const isGroup = targetAnimal.record_type === 'GROUP';

    setDraftRounds(prev => {
      const existingDraft = prev[animalId];
      const dbRound = roundsMap.get(animalId); 
      
      const currentState = existingDraft?.[field] !== undefined 
        ? existingDraft[field] 
        : (dbRound?.[field] ?? (field === 'is_alive' ? true : false));

      const newState = !currentState;

      const updated: Record<string, Partial<DailyRound>> = {
        ...prev,
        [animalId]: {
          ...prev[animalId],
          animal_id: animalId,
          [field]: newState
        }
      };

      // If toggling a parent Mob, cascade the check to ALL child specimens
      if (isGroup) {
        const childAnimals = animals.filter(a => a.parent_group_id === animalId);
        childAnimals.forEach(child => {
          const childDraft = prev[child.id];
          const childDb = roundsMap.get(child.id);

          updated[child.id] = {
            ...prev[child.id],
            animal_id: child.id,
            is_alive: childDraft?.is_alive !== undefined ? childDraft.is_alive : (childDb?.is_alive ?? true),
            water_checked: childDraft?.water_checked !== undefined ? childDraft.water_checked : (childDb?.water_checked ?? false),
            locks_secured: childDraft?.locks_secured !== undefined ? childDraft.locks_secured : (childDb?.locks_secured ?? false),
            animal_issue_note: childDraft?.animal_issue_note !== undefined ? childDraft.animal_issue_note : childDb?.animal_issue_note,
            [field]: newState
          };
        });
      }

      return updated;
    });

    setHasUnsavedChanges(true);
    setSubmissionStatus(null);
  };

  const handleSubmit = async () => {
    if (!user) return setSubmissionStatus({ type: 'error', message: 'You must be logged in to submit rounds.' });

    try {
      setIsSubmitting(true);
      setSubmissionStatus(null);

      const roundsToSubmit: Partial<DailyRound>[] = Object.values(draftRounds).map(draft => {
        const dbRound = roundsMap.get(draft.animal_id!); 
        const isEdit = !!dbRound?.id;
        
        return {
          id: dbRound?.id || generateOfflineUUID(), 
          animal_id: draft.animal_id,
          date: activeDate,             
          shift: activeShift,
          is_alive: draft.is_alive !== undefined ? draft.is_alive : (dbRound?.is_alive ?? true),
          water_checked: draft.water_checked !== undefined ? draft.water_checked : (dbRound?.water_checked ?? false),
          locks_secured: draft.locks_secured !== undefined ? draft.locks_secured : (dbRound?.locks_secured ?? false),
          animal_issue_note: draft.animal_issue_note !== undefined ? draft.animal_issue_note : dbRound?.animal_issue_note,
          
          status: 'COMPLETED',          
          completed_by: user.id,        
          created_by: isEdit ? dbRound.created_by : user.id,
          modified_by: isEdit ? user.id : null,
        };
      });

      await dailyRoundsService.bulkUpsertRounds(roundsToSubmit);
      
      setDraftRounds({});
      setHasUnsavedChanges(false);
      setSubmissionStatus({ type: 'success', message: 'Rounds successfully saved.' });
      
    } catch (error) {
      console.error("Error submitting rounds:", error);
      setSubmissionStatus({ type: 'error', message: 'Failed to save rounds. They will sync when online.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-3 lg:space-y-4 animate-in fade-in duration-500 w-full font-sans">
      
      {/* Block A: Header Ribbon */}
      <div className="flex justify-between items-center w-full mb-1 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight uppercase">Daily Rounds</h1>
        </div>
      </div>

      {/* Block B: Control Deck */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-2 lg:gap-3 w-full bg-slate-50/80 p-2 lg:p-3 rounded-2xl border border-slate-200 shadow-inner portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        
        <div className="relative flex-1 min-w-[200px] lg:w-96 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search animals or mobs..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs lg:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all shadow-sm placeholder:text-slate-400"
          />
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-2 sm:ml-auto w-full sm:w-auto">
          <div className="flex items-center justify-between bg-white rounded-xl p-1 border border-slate-200 shadow-sm w-full sm:w-auto shrink-0">
            <button type="button" onClick={() => shiftDate(-1)} className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-800 transition-all active:scale-95 cursor-pointer">
              <ChevronLeft size={16} />
            </button>
            <div className="flex-1 sm:flex-none relative flex justify-center border-l border-r border-slate-100 px-2 min-w-[120px]">
              <input 
                type="date" 
                value={inputDate}
                onChange={(e) => setInputDate(e.target.value)}
                onBlur={(e) => handleDateChange(e.target.value)}
                className="text-[10px] lg:text-xs font-black text-slate-700 uppercase tracking-widest bg-transparent border-none focus:ring-0 text-center py-1 cursor-pointer w-full"
              />
            </div>
            <button type="button" onClick={() => shiftDate(1)} className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-800 transition-all active:scale-95 cursor-pointer">
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="flex bg-slate-200/50 p-1 rounded-xl w-full sm:w-auto shrink-0">
            <button
              type="button"
              onClick={() => setActiveShift('MORNING')}
              className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                activeShift === 'MORNING' 
                  ? 'bg-white text-emerald-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
              }`}
            >
              AM Shift
            </button>
            <button
              type="button"
              onClick={() => setActiveShift('AFTERNOON')}
              className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-[10px] lg:text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                activeShift === 'AFTERNOON' 
                  ? 'bg-white text-emerald-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
              }`}
            >
              PM Shift
            </button>
          </div>
        </div>
      </div>

      {/* Block C: Category Tabs */}
      <div className="grid grid-cols-4 lg:flex lg:gap-2 w-full shrink-0 gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
        {tabs.map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-1 lg:px-4 py-1.5 lg:py-2 rounded-xl text-[9px] lg:text-xs font-black uppercase tracking-widest whitespace-nowrap lg:whitespace-normal transition-all shadow-sm cursor-pointer ${
              activeTab === tab 
                ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Block D: Data List */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col flex-1 overflow-hidden min-h-0 relative mt-1">
        
        <div className="flex-1 overflow-hidden relative bg-white">
          
          {isLoading && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
              <Loader2 className="animate-spin text-emerald-500 mb-4" size={32} />
              <p className="text-slate-500 font-medium animate-pulse text-sm">Syncing offline queue...</p>
            </div>
          )}

          <div ref={parentRef} className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar pb-24">
            
            {displayAnimals.length === 0 && !isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500">
                <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                  <Search size={24} className="text-slate-400" />
                </div>
                <p className="font-bold text-slate-700 mb-1 text-sm">No specimens matched</p>
                <p className="text-xs">Adjust your search or category filters.</p>
              </div>
            ) : (
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const animal = displayAnimals[virtualItem.index];
                  const dbRound = roundsMap.get(animal.id);
                  const draft = draftRounds[animal.id];
                  const mergedRound = draft ? { ...dbRound, ...draft } : dbRound;

                  const isGroup = animal.isGroupParent;
                  const isChild = animal.isChildMember;
                  const isExpanded = isGroup && expandedMobs.has(animal.id);

                  const isAlive = mergedRound?.is_alive !== undefined ? mergedRound.is_alive : true;
                  const waterChecked = mergedRound?.water_checked !== undefined ? mergedRound.water_checked : false;
                  const locksSecured = mergedRound?.locks_secured !== undefined ? mergedRound.locks_secured : false;
                  const hasNote = !!mergedRound?.animal_issue_note;

                  return (
                    <div
                      key={animal.id}
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      className={`absolute top-0 left-0 w-full border-b transition-colors box-border ${
                        isChild 
                          ? 'bg-slate-50/70 hover:bg-slate-100/70 border-slate-200' 
                          : isGroup
                          ? 'bg-blue-50/20 hover:bg-blue-50/40 border-blue-200'
                          : 'hover:bg-slate-50/50 border-slate-100'
                      }`}
                      style={{
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <div className="w-full px-4 py-2 lg:py-2.5 flex flex-col lg:flex-row gap-3 lg:gap-4 lg:items-center">
                        
                        {/* IDENTITY BLOCK */}
                        <div className={`flex items-center gap-3 min-w-0 w-full lg:w-[35%] py-1 shrink-0 ${isChild ? 'pl-6 lg:pl-8 relative' : ''}`}>
                          
                          {isGroup && (
                            <button
                              type="button"
                              onClick={() => toggleMob(animal.id)}
                              className="p-1 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-200/60 transition-colors shrink-0 cursor-pointer"
                            >
                              {isExpanded ? <ChevronDown size={18} className="text-blue-600" /> : <ChevronRight size={18} />}
                            </button>
                          )}

                          {isChild && (
                            <div className="absolute left-2 lg:left-3 top-1/2 -translate-y-1/2 text-slate-300">
                              <CornerDownRight size={14} />
                            </div>
                          )}

                          <div className={`w-8 h-8 lg:w-10 lg:h-10 rounded-full flex items-center justify-center shrink-0 border shadow-sm overflow-hidden ${
                            isGroup 
                              ? 'bg-blue-100 text-blue-700 border-blue-200' 
                              : isChild
                              ? 'bg-slate-50 text-slate-400 border-slate-200'
                              : !animal.profile_image_url 
                              ? 'bg-slate-50 text-slate-400 border-slate-200' 
                              : 'border-slate-200'
                          }`}>
                            {animal.profile_image_url ? (
                              <img src={animal.profile_image_url} alt={animal.name} className="w-full h-full object-cover" />
                            ) : (
                              isGroup ? <Users size={16} /> : <User size={16} />
                            )}
                          </div>
                          
                          <div className="flex flex-col min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h3 
                                onClick={() => isGroup && toggleMob(animal.id)}
                                className={`font-bold text-slate-900 text-[11px] md:text-[12px] lg:text-[13px] tracking-tight truncate ${isGroup ? 'cursor-pointer hover:text-blue-600 font-black' : ''}`} 
                                title={animal.name}
                              >
                                {animal.name}
                              </h3>
                              {isGroup && (
                                <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider shrink-0">
                                  Mob ({animal.childCount})
                                </span>
                              )}
                              {hasNote && <AlertCircle size={12} className="text-amber-500 shrink-0 lg:w-3.5 lg:h-3.5" />}
                            </div>
                            <div className="flex items-center gap-1.5 text-[9px] md:text-[10px] lg:text-[11px] text-slate-500 truncate mt-0.5">
                              {animal.ring_number && <span className="font-mono font-bold text-slate-400 uppercase tracking-widest">{animal.ring_number}</span>}
                              {animal.ring_number && (animal.species || animal.gender) && <span>•</span>}
                              {isChild && animal.gender && <span className="uppercase text-slate-400">{animal.gender}</span>}
                              {!isChild && animal.species && <span className="italic truncate" title={animal.species}>{animal.species}</span>}
                            </div>
                          </div>
                        </div>

                        {/* ACTIONS BLOCK */}
                        <div className="grid grid-cols-2 lg:flex lg:flex-row flex-1 gap-2 lg:gap-3 lg:justify-end">
                          <button
                            type="button"
                            onClick={() => handleToggle(animal, 'is_alive')}
                            className={`flex items-center justify-center lg:justify-start gap-1.5 lg:gap-2 py-1.5 px-2.5 lg:py-2 lg:px-3 rounded-lg lg:rounded-xl border shadow-sm transition-all lg:w-[130px] cursor-pointer ${
                              isAlive 
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' 
                                : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                            }`}
                          >
                            {isAlive ? <HeartPulse size={12} className="shrink-0 lg:w-3.5 lg:h-3.5" /> : <AlertCircle size={12} className="shrink-0 lg:w-3.5 lg:h-3.5" />}
                            <span className="text-[9px] lg:text-[10px] font-black uppercase tracking-widest truncate">{isAlive ? 'Visual: OK' : 'Visual: ISSUE'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggle(animal, 'water_checked')}
                            className={`flex items-center justify-center lg:justify-start gap-1.5 lg:gap-2 py-1.5 px-2.5 lg:py-2 lg:px-3 rounded-lg lg:rounded-xl border shadow-sm transition-all lg:w-[130px] cursor-pointer ${
                              waterChecked 
                                ? 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100' 
                                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <Droplets size={12} className={`shrink-0 lg:w-3.5 lg:h-3.5 ${!waterChecked ? 'text-slate-400' : ''}`} />
                            <span className="text-[9px] lg:text-[10px] font-black uppercase tracking-widest truncate">{waterChecked ? 'Water: OK' : 'Check Water'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggle(animal, 'locks_secured')}
                            className={`flex items-center justify-center lg:justify-start gap-1.5 lg:gap-2 py-1.5 px-2.5 lg:py-2 lg:px-3 rounded-lg lg:rounded-xl border shadow-sm transition-all lg:w-[130px] cursor-pointer ${
                              locksSecured 
                                ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' 
                                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <Lock size={12} className={`shrink-0 lg:w-3.5 lg:h-3.5 ${!locksSecured ? 'text-slate-400' : ''}`} />
                            <span className="text-[9px] lg:text-[10px] font-black uppercase tracking-widest truncate">{locksSecured ? 'Locks: OK' : 'Check Locks'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setNoteModalState({ isOpen: true, animal, round: mergedRound as DailyRound, currentNote: mergedRound?.animal_issue_note || '' })}
                            className={`flex items-center justify-center lg:justify-start gap-1.5 lg:gap-2 py-1.5 px-2.5 lg:py-2 lg:px-3 rounded-lg lg:rounded-xl border shadow-sm transition-all lg:w-[120px] cursor-pointer ${
                              hasNote 
                                ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' 
                                : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {hasNote ? <AlertCircle size={12} className="shrink-0 lg:w-3.5 lg:h-3.5" /> : <Edit3 size={12} className="shrink-0 lg:w-3.5 lg:h-3.5 text-slate-400" />}
                            <span className="text-[9px] lg:text-[10px] font-black uppercase tracking-widest truncate">{hasNote ? 'Note Logged' : 'Add Note'}</span>
                          </button>
                        </div>

                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* --- FIXED BOTTOM SUBMIT BAR --- */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-slate-200 bg-white/95 backdrop-blur p-3 md:p-4 flex items-center justify-between z-20 shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <div className="flex-1 min-w-0 pr-4">
             {hasUnsavedChanges ? (
               <div className="flex items-center gap-2 text-amber-600">
                 <AlertCircle size={16} className="shrink-0" />
                 <span className="text-[10px] md:text-xs font-bold truncate">Unsaved checks detected</span>
               </div>
             ) : submissionStatus ? (
               <div className={`flex items-center gap-2 ${submissionStatus.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                 <CheckCircle2 size={16} className="shrink-0" />
                 <span className="text-[10px] md:text-xs font-bold truncate">{submissionStatus.message}</span>
               </div>
             ) : (
               <span className="text-[10px] md:text-xs text-slate-500 truncate block">All checks synced to database.</span>
             )}
          </div>
          
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!hasUnsavedChanges || isSubmitting}
            className={`px-6 py-2.5 lg:py-3 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 shrink-0 shadow-sm cursor-pointer ${
              hasUnsavedChanges && !isSubmitting
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white hover:shadow-md active:scale-95'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Submit Rounds
          </button>
        </div>
      </div>

      {/* --- NOTE MODAL --- */}
      {noteModalState.isOpen && noteModalState.animal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-xl border border-slate-100 flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h3 className="font-bold text-slate-900 text-sm tracking-tight">{noteModalState.animal.name}</h3>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-0.5">Round Issue Note</p>
              </div>
              <button 
                type="button"
                onClick={() => setNoteModalState({ isOpen: false, animal: null, round: null, currentNote: '' })}
                className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-4">
              <textarea
                value={noteModalState.currentNote}
                onChange={(e) => setNoteModalState(prev => ({ ...prev, currentNote: e.target.value }))}
                placeholder="Enter details about broken locks, empty water, or animal condition..."
                className="w-full h-32 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none resize-none shadow-inner"
              />
            </div>
            
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex gap-2">
              <button
                type="button"
                onClick={() => setNoteModalState({ isOpen: false, animal: null, round: null, currentNote: '' })}
                className="flex-1 py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold uppercase tracking-widest rounded-xl transition-colors shadow-sm active:scale-95 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const animalId = noteModalState.animal!.id;
                  const trimmed = noteModalState.currentNote.trim();
                  
                  setDraftRounds(prev => {
                    const existingDraft = prev[animalId];
                    const dbRound = roundsMap.get(animalId);
                    const merged = existingDraft ? { ...dbRound, ...existingDraft } : dbRound;

                    return {
                      ...prev,
                      [animalId]: {
                        ...prev[animalId],
                        animal_id: animalId,
                        is_alive: merged?.is_alive !== undefined ? merged.is_alive : true,
                        water_checked: merged?.water_checked !== undefined ? merged.water_checked : false,
                        locks_secured: merged?.locks_secured !== undefined ? merged.locks_secured : false,
                        animal_issue_note: trimmed
                      }
                    };
                  });
                  setHasUnsavedChanges(true);
                  setSubmissionStatus(null);
                  setNoteModalState({ isOpen: false, animal: null, round: null, currentNote: '' });
                }}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold uppercase tracking-widest rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
              >
                <Save size={16} />
                Save Draft Note
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default DailyRounds;