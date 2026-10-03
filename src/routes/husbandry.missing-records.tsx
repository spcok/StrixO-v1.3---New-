import React, { useState, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  ShieldAlert, ShieldCheck, ChevronLeft, ChevronRight, 
  Calendar, Search, Loader2, Utensils, Scale, 
  Droplets, Thermometer, Check, Plus
} from 'lucide-react';
import { 
  format, startOfWeek, endOfWeek, eachDayOfInterval, 
  addWeeks, subWeeks, isSameDay, isFuture 
} from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Animal, DailyLog, FeedingSchedule, WeightLog, TemperatureLog } from '../types';
import { FeedModal } from '../components/husbandry/FeedModal';
import { WeightModal } from '../components/husbandry/WeightModal';
import { TemperatureModal } from '../components/husbandry/TemperatureModal';
import { MistModal } from '../components/husbandry/MistModal';

export const Route = createFileRoute('/husbandry/missing-records')({
  component: WeeklyComplianceAuditPage,
});

const CATEGORIES = ['OWL', 'RAPTOR', 'MAMMAL', 'EXOTIC'] as const;

export function WeeklyComplianceAuditPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  
  // Week State (Defaults to Current Week, Monday - Sunday)
  const [currentWeekDate, setCurrentWeekDate] = useState<Date>(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>(CATEGORIES[0]);

  // Modal Control States
  const [modalState, setModalState] = useState<{
    type: 'FEED' | 'WEIGHT' | 'MISTING' | 'TEMP' | null;
    animal: Animal | null;
    date: string;
  }>({
    type: null,
    animal: null,
    date: format(new Date(), 'yyyy-MM-dd')
  });

  const closeModal = () => {
    setModalState({ type: null, animal: null, date: '' });
    queryClient.invalidateQueries({ queryKey: ['weekly_compliance_audit'] });
  };

  const weekStart = startOfWeek(currentWeekDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentWeekDate, { weekStartsOn: 1 });
  const daysInWeek = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

  // Supabase Weekly Data Query (Includes mist_logs with fallback to daily_logs)
  const { data, isLoading } = useQuery({
    queryKey: ['weekly_compliance_audit', weekStartStr, weekEndStr],
    queryFn: async () => {
      const [
        animalsRes, 
        logsRes, 
        feedsRes, 
        weightsRes, 
        tempsRes, 
        feedLogsRes,
        mistsRes
      ] = await Promise.all([
        supabase
          .from('animals')
          .select('*')
          .eq('is_deleted', false)
          .neq('status', 'ARCHIVED')
          .neq('status', 'DECEASED')
          .neq('status', 'TRANSFERRED')
          .order('name', { ascending: true }),
        supabase
          .from('daily_logs')
          .select('*')
          .gte('log_date', `${weekStartStr}T00:00:00`)
          .lte('log_date', `${weekEndStr}T23:59:59`),
        supabase
          .from('feeding_schedules')
          .select('*')
          .gte('scheduled_date', weekStartStr)
          .lte('scheduled_date', weekEndStr)
          .eq('is_deleted', false),
        supabase
          .from('weight_logs')
          .select('*')
          .gte('recorded_at', `${weekStartStr}T00:00:00`)
          .lte('recorded_at', `${weekEndStr}T23:59:59`),
        supabase
          .from('temperature_logs')
          .select('*')
          .gte('recorded_at', `${weekStartStr}T00:00:00`)
          .lte('recorded_at', `${weekEndStr}T23:59:59`),
        supabase
          .from('feed_logs')
          .select('*')
          .gte('recorded_at', `${weekStartStr}T00:00:00`)
          .lte('recorded_at', `${weekEndStr}T23:59:59`),
        // Query mist_logs with resilient column fallback
        (async () => {
          const { data: mData, error: mErr } = await supabase
            .from('mist_logs')
            .select('*')
            .gte('recorded_at', `${weekStartStr}T00:00:00`)
            .lte('recorded_at', `${weekEndStr}T23:59:59`);
          
          if (mErr) {
            const { data: fallbackData } = await supabase
              .from('mist_logs')
              .select('*')
              .gte('created_at', `${weekStartStr}T00:00:00`)
              .lte('created_at', `${weekEndStr}T23:59:59`);
            return { data: fallbackData || [], error: null };
          }
          return { data: mData || [], error: null };
        })(),
      ]);

      if (animalsRes.error) throw animalsRes.error;

      return {
        animals: (animalsRes.data || []) as Animal[],
        logs: (logsRes.data || []) as DailyLog[],
        feeds: (feedsRes.data || []) as FeedingSchedule[],
        weights: (weightsRes.data || []) as WeightLog[],
        temps: (tempsRes.data || []) as TemperatureLog[],
        feedLogs: (feedLogsRes.data || []) as any[],
        mists: (mistsRes.data || []) as any[],
      };
    },
    staleTime: 1000 * 60 * 3,
  });

  // Calculate Grid Status per Animal
  const { auditMatrix, overallStats } = useMemo(() => {
    if (!data) return { auditMatrix: [], overallStats: { total: 0, compliantCount: 0, compliancePct: 100 } };

    const { animals, logs, feeds, weights, temps, feedLogs = [], mists = [] } = data;
    const today = new Date();

    const matrix = animals.map(animal => {
      const requiresTemp = animal.ambient_temp_only === false || animal.target_day_temp_c !== null || animal.category === 'EXOTIC';
      const requiresMisting = animal.target_humidity_min_percent !== null || animal.category === 'EXOTIC' || (animal as any).requires_misting === true;

      // 7-day status arrays
      const days = daysInWeek.map(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const isFutureDay = isFuture(day) && !isSameDay(day, today);

        // 1. Feeding Status (Checks feed_logs, feeding_schedules, and legacy daily_logs)
        const hasFeedLog = feedLogs.some(f => 
          f.animal_id === animal.id && 
          !f.is_deleted && 
          Boolean((f.recorded_at || f.created_at || f.date)?.startsWith(dateStr))
        );
        const feedSched = feeds.find(f => f.animal_id === animal.id && f.scheduled_date === dateStr);
        const hasFeed = hasFeedLog 
          || (feedSched 
            ? (feedSched.status === 'COMPLETED' || feedSched.status === 'FASTING') 
            : logs.some(l => l.animal_id === animal.id && l.log_type === 'FEEDING' && Boolean((l.log_date || l.created_at)?.startsWith(dateStr))));

        // 2. Weight Status
        const hasWeight = weights.some(w => 
          w.animal_id === animal.id && 
          !w.is_deleted &&
          Boolean((w.recorded_at || w.created_at || w.date)?.startsWith(dateStr))
        );

        // 3. Temp Status (if required)
        const hasTemp = temps.some(t => 
          t.animal_id === animal.id && 
          !t.is_deleted &&
          Boolean((t.recorded_at || t.created_at)?.startsWith(dateStr))
        ) || logs.some(l => 
          l.animal_id === animal.id && 
          l.log_type === 'TEMPERATURE' && 
          Boolean((l.log_date || l.created_at)?.startsWith(dateStr))
        );

        // 4. Misting Status (Checks mist_logs first, with fallback to daily_logs)
        const hasMistLog = mists.some(m =>
          m.animal_id === animal.id &&
          !m.is_deleted &&
          Boolean((m.recorded_at || m.created_at || m.date)?.startsWith(dateStr))
        );

        const hasDailyLogMist = logs.some(l => 
          l.animal_id === animal.id && 
          ((l.log_type as string) === 'MISTING' || (l.log_type as string) === 'HUMIDITY' || (l.notes && l.notes.toLowerCase().includes('mist'))) && 
          Boolean((l.log_date || l.created_at)?.startsWith(dateStr))
        );

        const hasMisting = hasMistLog || hasDailyLogMist;

        return {
          date: day,
          dateStr,
          isFutureDay,
          hasFeed,
          hasWeight,
          hasTemp,
          hasMisting,
        };
      });

      const pastDays = days.filter(d => !d.isFutureDay);
      const checksPerDay = 1 + (requiresTemp ? 1 : 0) + (requiresMisting ? 1 : 0);
      const totalChecksRequired = pastDays.length * checksPerDay + 1; // +1 for weekly weight
      
      let checksCompleted = 0;
      pastDays.forEach(d => {
        if (d.hasFeed) checksCompleted++;
        if (requiresTemp && d.hasTemp) checksCompleted++;
        if (requiresMisting && d.hasMisting) checksCompleted++;
      });
      const hasWeeklyWeight = days.some(d => d.hasWeight);
      if (hasWeeklyWeight) checksCompleted++;

      const animalCompliancePct = totalChecksRequired > 0 
        ? Math.round((checksCompleted / totalChecksRequired) * 100) 
        : 100;

      const isFullyCompliant = animalCompliancePct >= 100;

      return {
        animal,
        requiresTemp,
        requiresMisting,
        days,
        hasWeeklyWeight,
        animalCompliancePct,
        isFullyCompliant
      };
    });

    const compliantCount = matrix.filter(m => m.isFullyCompliant).length;
    const compliancePct = matrix.length > 0 ? Math.round((compliantCount / matrix.length) * 100) : 100;

    return {
      auditMatrix: matrix,
      overallStats: {
        total: matrix.length,
        compliantCount,
        compliancePct
      }
    };
  }, [data, daysInWeek]);

  const filteredMatrix = useMemo(() => {
    return auditMatrix.filter(row => {
      const matchesCategory = (row.animal.category || '').toUpperCase() === selectedCategory.toUpperCase();
      const q = searchQuery.toLowerCase();
      const matchesSearch = !q ||
        row.animal.name.toLowerCase().includes(q) ||
        (row.animal.species || '').toLowerCase().includes(q) ||
        (row.animal.location || '').toLowerCase().includes(q) ||
        (row.animal.ring_number || '').toLowerCase().includes(q);

      return matchesCategory && matchesSearch;
    });
  }, [auditMatrix, selectedCategory, searchQuery]);

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-3.5 animate-in fade-in duration-300 w-full font-sans text-left">
      
      {/* Header & Week Selector Ribbon */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 shrink-0 pb-1">
        <div className="flex flex-col space-y-0.5">
          <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-tight flex items-center gap-2.5">
            Weekly ZLA Compliance Matrix
          </h1>
          <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
            Statutory Zoo Licensing Act 7-Day Husbandry, Dietary, Temp &amp; Misting Audit
          </p>
        </div>

        {/* Week Navigator Controls */}
        <div className="flex items-center gap-2 w-full lg:w-auto justify-between lg:justify-end">
          <div className="flex items-center bg-white rounded-2xl p-1 border border-slate-200 shadow-sm">
            <button
              onClick={() => setCurrentWeekDate(prev => subWeeks(prev, 1))}
              className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
              title="Previous Week"
            >
              <ChevronLeft size={16} />
            </button>

            <div className="px-3 py-1 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-800">
              <Calendar size={13} className="text-slate-500" />
              <span>{format(weekStart, 'dd MMM')} – {format(weekEnd, 'dd MMM yyyy')}</span>
            </div>

            <button
              onClick={() => setCurrentWeekDate(prev => addWeeks(prev, 1))}
              className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
              title="Next Week"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <button
            onClick={() => setCurrentWeekDate(new Date())}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
          >
            Current Week
          </button>

          <span className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest border shadow-sm ${
            overallStats.compliancePct >= 90
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : overallStats.compliancePct >= 70
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}>
            {overallStats.compliancePct}% Compliant
          </span>
        </div>
      </div>

      {/* Control Bar: Categories & Search */}
      <div className="bg-slate-50/90 p-3 rounded-2xl border border-slate-200 shadow-inner flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar w-full sm:w-auto">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest whitespace-nowrap transition-all shadow-sm cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
                  : 'bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700 border border-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
          <input
            type="text"
            placeholder="Search specimen, location..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-slate-900 outline-none shadow-sm"
          />
        </div>
      </div>

      {/* Main 7-Day Compliance Grid */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 bg-slate-50/30 space-y-4">
          
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
              <Loader2 size={24} className="animate-spin text-slate-600" />
              <span className="text-xs font-black uppercase tracking-widest text-slate-600">
                Compiling 7-Day Statutory Matrix...
              </span>
            </div>
          ) : filteredMatrix.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2 p-8">
              <ShieldCheck size={40} className="text-emerald-500 opacity-80" />
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-800">No Specimens Found</h3>
              <p className="text-xs text-slate-500 font-medium">No specimens found in this category matching your search criteria.</p>
            </div>
          ) : (
            filteredMatrix.map(({ animal, requiresTemp, requiresMisting, days, hasWeeklyWeight, animalCompliancePct }) => (
              <div 
                key={animal.id}
                className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-slate-300 transition-all flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4"
              >
                {/* Animal Specimen Details */}
                <div className="w-full lg:w-64 shrink-0 space-y-1">
                  <div className="flex items-center justify-between lg:justify-start gap-2">
                    <h3 className="text-sm font-black text-slate-900 tracking-tight">{animal.name}</h3>
                    <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-700 border border-slate-200">
                      {animal.location || 'Enclosure'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium truncate">
                    {animal.species || animal.category} {animal.ring_number ? `• ${animal.ring_number}` : ''}
                  </p>
                  
                  {/* Specimen Compliance Pill */}
                  <div className="pt-1 flex flex-wrap items-center gap-1.5">
                    <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest border ${
                      animalCompliancePct >= 100 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                        : animalCompliancePct >= 70
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}>
                      {animalCompliancePct}% Audit Score
                    </span>
                    {requiresTemp && (
                      <span className="text-[9px] font-black text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">
                        Temp Tracked
                      </span>
                    )}
                    {requiresMisting && (
                      <span className="text-[9px] font-black text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded border border-cyan-200">
                        Misting Tracked
                      </span>
                    )}
                  </div>
                </div>

                {/* 7-Day Pill Matrix Rows */}
                <div className="w-full flex-1">
                  <div className="w-full space-y-1.5 sm:space-y-2">
                    
                    {/* Day Column Header */}
                    <div className="grid grid-cols-8 gap-1 sm:gap-1.5 text-center pb-1 border-b border-slate-100 items-center">
                      <div className="text-[8px] sm:text-[10px] lg:text-xs font-black uppercase tracking-tight sm:tracking-widest text-slate-400 text-left truncate">Protocol</div>
                      {days.map(d => (
                        <div key={d.dateStr} className="text-[8px] sm:text-[10px] lg:text-xs font-black uppercase tracking-tight sm:tracking-widest text-slate-500">
                          <span className="hidden sm:inline">{format(d.date, 'EEE dd')}</span>
                          <span className="sm:hidden">{format(d.date, 'EE d')}</span>
                        </div>
                      ))}
                    </div>

                    {/* Row 1: Feeding */}
                    <div className="grid grid-cols-8 gap-1 sm:gap-1.5 items-center">
                      <div className="flex items-center gap-1 text-[9px] sm:text-[10px] lg:text-xs font-bold text-slate-700 min-w-0">
                        <Utensils size={12} className="text-amber-500 shrink-0" />
                        <span className="truncate">Feeding</span>
                      </div>
                      {days.map(d => (
                        <button
                          key={d.dateStr}
                          disabled={d.isFutureDay}
                          onClick={() => setModalState({ type: 'FEED', animal, date: d.dateStr })}
                          className={`w-full py-1 sm:py-1.5 lg:py-2 px-0.5 sm:px-1.5 min-h-[26px] sm:min-h-[30px] lg:min-h-[36px] rounded-md sm:rounded-xl text-[8px] sm:text-[10px] lg:text-xs font-black transition-all flex items-center justify-center border cursor-pointer ${
                            d.isFutureDay
                              ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed opacity-50'
                              : d.hasFeed
                              ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                              : 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100 border-dashed'
                          }`}
                          title={d.hasFeed ? `Diet recorded on ${d.dateStr}` : `Log feeding for ${d.dateStr}`}
                        >
                          {d.hasFeed ? (
                            <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 lg:w-4 lg:h-4" />
                          ) : d.isFutureDay ? (
                            '-'
                          ) : (
                            <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5 lg:w-4 lg:h-4" />
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Row 2: Weight Verification */}
                    <div className="grid grid-cols-8 gap-1 sm:gap-1.5 items-center">
                      <div className="flex items-center gap-1 text-[9px] sm:text-[10px] lg:text-xs font-bold text-slate-700 min-w-0">
                        <Scale size={12} className="text-blue-500 shrink-0" />
                        <span className="truncate">Weight</span>
                      </div>
                      {days.map(d => (
                        <button
                          key={d.dateStr}
                          disabled={d.isFutureDay}
                          onClick={() => setModalState({ type: 'WEIGHT', animal, date: d.dateStr })}
                          className={`w-full py-1 sm:py-1.5 lg:py-2 px-0.5 sm:px-1.5 min-h-[26px] sm:min-h-[30px] lg:min-h-[36px] rounded-md sm:rounded-xl text-[8px] sm:text-[10px] lg:text-xs font-black transition-all flex items-center justify-center border cursor-pointer ${
                            d.isFutureDay
                              ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed opacity-50'
                              : d.hasWeight
                              ? 'bg-blue-500 text-white border-blue-600 shadow-sm'
                              : hasWeeklyWeight
                              ? 'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200'
                              : 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100 border-dashed'
                          }`}
                          title={d.hasWeight ? `Weight recorded on ${d.dateStr}` : `Record weight on ${d.dateStr}`}
                        >
                          {d.hasWeight ? (
                            <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 lg:w-4 lg:h-4" />
                          ) : d.isFutureDay ? (
                            '-'
                          ) : (
                            <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5 lg:w-4 lg:h-4" />
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Row 3: Temperature */}
                    {requiresTemp && (
                      <div className="grid grid-cols-8 gap-1 sm:gap-1.5 items-center">
                        <div className="flex items-center gap-1 text-[9px] sm:text-[10px] lg:text-xs font-bold text-slate-700 min-w-0">
                          <Thermometer size={12} className="text-purple-500 shrink-0" />
                          <span className="truncate">Temp</span>
                        </div>
                        {days.map(d => (
                          <button
                            key={d.dateStr}
                            disabled={d.isFutureDay}
                            onClick={() => setModalState({ type: 'TEMP', animal, date: d.dateStr })}
                            className={`w-full py-1 sm:py-1.5 lg:py-2 px-0.5 sm:px-1.5 min-h-[26px] sm:min-h-[30px] lg:min-h-[36px] rounded-md sm:rounded-xl text-[8px] sm:text-[10px] lg:text-xs font-black transition-all flex items-center justify-center border cursor-pointer ${
                              d.isFutureDay
                                ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed opacity-50'
                                : d.hasTemp
                                ? 'bg-purple-500 text-white border-purple-600 shadow-sm'
                                : 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100 border-dashed'
                            }`}
                            title={d.hasTemp ? `Temp recorded on ${d.dateStr}` : `Log temp check on ${d.dateStr}`}
                          >
                            {d.hasTemp ? (
                              <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 lg:w-4 lg:h-4" />
                            ) : d.isFutureDay ? (
                              '-'
                            ) : (
                              <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5 lg:w-4 lg:h-4" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Row 4: Misting (Now queries mist_logs and opens MistModal) */}
                    {requiresMisting && (
                      <div className="grid grid-cols-8 gap-1 sm:gap-1.5 items-center">
                        <div className="flex items-center gap-1 text-[9px] sm:text-[10px] lg:text-xs font-bold text-slate-700 min-w-0">
                          <Droplets size={12} className="text-cyan-500 shrink-0" />
                          <span className="truncate">Misting</span>
                        </div>
                        {days.map(d => (
                          <button
                            key={d.dateStr}
                            disabled={d.isFutureDay}
                            onClick={() => setModalState({ type: 'MISTING', animal, date: d.dateStr })}
                            className={`w-full py-1 sm:py-1.5 lg:py-2 px-0.5 sm:px-1.5 min-h-[26px] sm:min-h-[30px] lg:min-h-[36px] rounded-md sm:rounded-xl text-[8px] sm:text-[10px] lg:text-xs font-black transition-all flex items-center justify-center border cursor-pointer ${
                              d.isFutureDay
                                ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed opacity-50'
                                : d.hasMisting
                                ? 'bg-cyan-500 text-white border-cyan-600 shadow-sm'
                                : 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100 border-dashed'
                            }`}
                            title={d.hasMisting ? `Misting recorded on ${d.dateStr}` : `Log misting for ${d.dateStr}`}
                          >
                            {d.hasMisting ? (
                              <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 lg:w-4 lg:h-4" />
                            ) : d.isFutureDay ? (
                              '-'
                            ) : (
                              <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5 lg:w-4 lg:h-4" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                  </div>
                </div>
              </div>
            ))
          )}

        </div>
      </div>

      {/* Interactive Modals */}
      {modalState.animal && (
        <>
          {modalState.type === 'FEED' && (
            <FeedModal
              isOpen={true}
              onClose={closeModal}
              animalId={modalState.animal.id}
              selectedDate={modalState.date}
            />
          )}

          {modalState.type === 'WEIGHT' && (
            <WeightModal
              isOpen={true}
              onClose={closeModal}
              animalId={modalState.animal.id}
              selectedDate={modalState.date}
            />
          )}

          {modalState.type === 'TEMP' && (
            <TemperatureModal
              isOpen={true}
              onClose={closeModal}
              animalId={modalState.animal.id}
              selectedDate={modalState.date}
            />
          )}

          {modalState.type === 'MISTING' && (
            <MistModal
              isOpen={true}
              onClose={closeModal}
              animalId={modalState.animal.id}
              selectedDate={modalState.date}
            />
          )}
        </>
      )}

    </div>
  );
}

export default WeeklyComplianceAuditPage;