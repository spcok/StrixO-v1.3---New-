import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Animal } from '../../types';

interface HusbandryLogsProps {
  animalId: string;
  weightUnit?: string;
  animal?: Animal | null;
}

const getLocalDateString = (dateObj: Date) => {
  return dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + String(dateObj.getDate()).padStart(2, '0');
};

export default function HusbandryLogs({ animalId, weightUnit = 'g', animal }: HusbandryLogsProps) {
  const [endDate, setEndDate] = useState<string>(getLocalDateString(new Date()));
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90); // Default to 90 days to avoid clipping recent batch imports
    return getLocalDateString(d);
  });
  
  const [logFilter, setLogFilter] = useState<'ALL' | 'FEEDING' | 'WEIGHT' | 'TEMP' | 'MIST'>('ALL');

  // 1. Resolve animal hierarchy using the database schema: parent_group_id & weight_unit
  const { data: currentAnimal } = useQuery({
    queryKey: ['animal_hierarchy_context', animalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('animals')
        .select('id, name, record_type, parent_group_id, weight_unit')
        .eq('id', animalId)
        .single();
      if (error) return null;
      return data;
    },
    initialData: animal || undefined,
    enabled: !!animalId,
  });

  const isMob = currentAnimal?.record_type === 'GROUP' || animal?.record_type === 'GROUP';
  const parentMobId = currentAnimal?.parent_group_id || (animal as any)?.parent_group_id;

  // 2. If viewing a Mob, fetch all linked members using parent_group_id
  const { data: mobMembers = [] } = useQuery({
    queryKey: ['mob_member_animals', animalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('animals')
        .select('id, name')
        .eq('parent_group_id', animalId)
        .neq('status', 'DECEASED')
        .neq('status', 'ARCHIVED');
      if (error) return [];
      return data || [];
    },
    enabled: Boolean(isMob),
  });

  // Target IDs for feeds:
  // - On an individual Meerkat: queries both meerkat.id AND parentMobId (so group feeds appear on the individual)
  // - On a Mob: queries mob.id and all member IDs
  const targetFeedIds = useMemo(() => {
    const ids = [animalId];
    if (isMob && mobMembers.length > 0) {
      mobMembers.forEach((m: any) => {
        if (m.id && !ids.includes(m.id)) ids.push(m.id);
      });
    }
    if (parentMobId && !ids.includes(parentMobId)) {
      ids.push(parentMobId);
    }
    return ids;
  }, [animalId, isMob, mobMembers, parentMobId]);

  // Target IDs for weights:
  // - On an individual Meerkat: ONLY queries the individual's weight
  // - On a Mob: queries mob.id and all member IDs (so all member weights roll up onto the mob profile)
  const targetWeightIds = useMemo(() => {
    const ids = [animalId];
    if (isMob && mobMembers.length > 0) {
      mobMembers.forEach((m: any) => {
        if (m.id && !ids.includes(m.id)) ids.push(m.id);
      });
    }
    return ids;
  }, [animalId, isMob, mobMembers]);

  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    mobMembers.forEach((m: any) => map.set(m.id, m.name));
    return map;
  }, [mobMembers]);

  // Feeds Query (combines feed_logs and completed feeding_schedules)
  const { data: feeds = [], isLoading: loadingFeeds, error: feedsError } = useQuery({
    queryKey: ['feed_logs', targetFeedIds, startDate, endDate],
    queryFn: async () => {
      const [directRes, schedRes] = await Promise.all([
        supabase
          .from('feed_logs')
          .select('*')
          .in('animal_id', targetFeedIds)
          .or('is_deleted.eq.false,is_deleted.is.null')
          .gte('recorded_at', `${startDate}T00:00:00Z`)
          .lte('recorded_at', `${endDate}T23:59:59.999Z`),
        supabase
          .from('feeding_schedules')
          .select('*')
          .in('animal_id', targetFeedIds)
          .in('status', ['COMPLETED', 'FASTING'])
          .or('is_deleted.eq.false,is_deleted.is.null')
          .gte('scheduled_date', startDate)
          .lte('scheduled_date', endDate),
      ]);

      if (directRes.error) throw directRes.error;

      const combinedFeeds = [...(directRes.data || [])];
      (schedRes.data || []).forEach((sf: any) => {
        const alreadyExists = combinedFeeds.some((df: any) => df.schedule_id === sf.id);
        if (!alreadyExists) {
          combinedFeeds.push({
            id: `sched_${sf.id}`,
            animal_id: sf.animal_id,
            food_item: sf.food_type,
            quantity: sf.quantity,
            unit: sf.quantity_unit,
            feed_method: sf.presentation_method,
            recorded_at: sf.scheduled_date ? `${sf.scheduled_date}T15:00:00Z` : sf.created_at,
            notes: sf.notes,
            outcome: sf.status === 'FASTING' ? 'FASTING' : 'EATEN',
          });
        }
      });

      return combinedFeeds;
    },
    enabled: targetFeedIds.length > 0,
  });

  // Weights Query
  const { data: weights = [], isLoading: loadingWeights, error: weightsError } = useQuery({
    queryKey: ['weight_logs', targetWeightIds, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('weight_logs')
        .select('*')
        .in('animal_id', targetWeightIds)
        .or('is_deleted.eq.false,is_deleted.is.null')
        .gte('recorded_at', `${startDate}T00:00:00Z`)
        .lte('recorded_at', `${endDate}T23:59:59.999Z`);
      if (error) throw error; 
      return data || [];
    },
    enabled: targetWeightIds.length > 0,
  });

  // Temperatures Query
  const { data: temps = [], isLoading: loadingTemps, error: tempsError } = useQuery({
    queryKey: ['temperature_logs', animalId, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('temperature_logs')
        .select('*')
        .eq('animal_id', animalId)
        .or('is_deleted.eq.false,is_deleted.is.null')
        .gte('recorded_at', `${startDate}T00:00:00Z`)
        .lte('recorded_at', `${endDate}T23:59:59.999Z`);
      if (error) throw error; 
      return data || [];
    },
    enabled: !!animalId,
  });

  // Misting Query
  const { data: mists = [], isLoading: loadingMists, error: mistsError } = useQuery({
    queryKey: ['mist_logs', animalId, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mist_logs')
        .select('*')
        .eq('animal_id', animalId)
        .or('is_deleted.eq.false,is_deleted.is.null')
        .gte('recorded_at', `${startDate}T00:00:00Z`)
        .lte('recorded_at', `${endDate}T23:59:59.999Z`);
      if (error) throw error; 
      return data || [];
    },
    enabled: !!animalId,
  });

  const unifiedTimeline = useMemo(() => {
    let combined: any[] = [];

    if (logFilter === 'ALL' || logFilter === 'FEEDING') {
      feeds.forEach(f => {
        const isFromParentMob = Boolean(parentMobId && f.animal_id === parentMobId);
        combined.push({ 
          id: `feed_${f.id}`, 
          type: 'FEEDING', 
          timestamp: new Date(f.recorded_at).getTime(), 
          dateObj: new Date(f.recorded_at), 
          data: f,
          isMobFeed: isFromParentMob || (isMob && f.animal_id === animalId)
        });
      });
    }
    if (logFilter === 'ALL' || logFilter === 'WEIGHT') {
      weights.forEach(w => {
        const memberName = isMob && w.animal_id !== animalId ? memberNameMap.get(w.animal_id) : undefined;
        combined.push({ 
          id: `weight_${w.id}`, 
          type: 'WEIGHT', 
          timestamp: new Date(w.recorded_at).getTime(), 
          dateObj: new Date(w.recorded_at), 
          data: w,
          memberName
        });
      });
    }
    if (logFilter === 'ALL' || logFilter === 'TEMP') {
      temps.forEach(t => combined.push({ id: `temp_${t.id}`, type: 'TEMP', timestamp: new Date(t.recorded_at).getTime(), dateObj: new Date(t.recorded_at), data: t }));
    }
    if (logFilter === 'ALL' || logFilter === 'MIST') {
      mists.forEach(m => combined.push({ id: `mist_${m.id}`, type: 'MIST', timestamp: new Date(m.recorded_at).getTime(), dateObj: new Date(m.recorded_at), data: m }));
    }

    return combined.sort((a, b) => b.timestamp - a.timestamp);
  }, [feeds, weights, temps, mists, logFilter, isMob, animalId, parentMobId, memberNameMap]);

  const isLoading = loadingFeeds || loadingWeights || loadingTemps || loadingMists;
  const hasError = feedsError || weightsError || tempsError || mistsError;
  const preferredUnit = animal?.weight_unit || currentAnimal?.weight_unit || weightUnit || 'g';

  return (
    <div className="space-y-4 animate-in fade-in duration-300 pb-12">
      
      {/* FILTER BAR */}
      <div className="flex flex-col sm:flex-row gap-4 items-end">
        <div className="flex gap-4 w-full sm:w-auto">
          <div className="flex-1 sm:w-36">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">From</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div className="flex-1 sm:w-36">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">To</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
        </div>
        <div className="w-full sm:w-48 sm:ml-auto">
           <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Log Type</label>
           <select value={logFilter} onChange={(e) => setLogFilter(e.target.value as any)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer">
             <option value="ALL">All Logs</option>
             <option value="FEEDING">Feeds</option>
             <option value="WEIGHT">Weights</option>
             <option value="TEMP">Temperatures</option>
             <option value="MIST">Misting</option>
           </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="animate-spin text-emerald-500 w-8 h-8" />
          <span className="text-xs font-black uppercase tracking-widest text-slate-400">Compiling Telemetry...</span>
        </div>
      ) : hasError ? (
        <div className="flex flex-col items-center justify-center py-20 text-rose-500 gap-3">
          <AlertCircle size={32} />
          <span className="text-xs font-black uppercase tracking-widest">Error fetching logs.</span>
        </div>
      ) : unifiedTimeline.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
          <ClipboardList size={32} className="opacity-40" />
          <p className="text-[10px] font-bold uppercase tracking-widest mt-1">No telemetry matched these filters.</p>
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">Date &amp; Time</th>
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">Type</th>
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 min-w-[200px]">Recorded Values</th>
                  <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 min-w-[200px]">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {unifiedTimeline.map((item) => {
                  const dateStr = item.dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                  const timeStr = item.dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

                  let typeBadge = null;
                  let details = null;

                  if (item.type === 'FEEDING') {
                    typeBadge = <span className="text-[9px] font-black uppercase tracking-widest text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-100">Feed</span>;
                    const qty = item.data.quantity_offered ?? item.data.quantity ?? '';
                    const unit = item.data.quantity_unit ?? item.data.unit ?? '';
                    const food = item.data.food_item || item.data.food_type || 'Standard Diet';
                    const qtyDisplay = qty ? `(${qty}${unit ? ` ${unit}` : ''})` : '';
                    details = (
                      <span className="text-sm font-bold text-slate-800">
                        {food} {qtyDisplay}
                        {item.isMobFeed && (
                          <span className="ml-1.5 text-[9px] font-black uppercase tracking-wider text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                            Mob Feed
                          </span>
                        )}
                      </span>
                    );
                  } 
                  else if (item.type === 'WEIGHT') {
                    typeBadge = <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100">Weight</span>;
                    const memberPrefix = item.memberName ? `${item.memberName}: ` : '';
                    details = (
                      <span className="text-sm font-black text-emerald-600">
                        {memberPrefix}{item.data.weight_grams}{preferredUnit}
                      </span>
                    );
                  } 
                  else if (item.type === 'TEMP') {
                    typeBadge = <span className="text-[9px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100">Env</span>;
                    const tempDisplay = item.data.temp_ambient ? `Amb: ${item.data.temp_ambient}°C` : `Bask: ${item.data.temp_basking}°C | Cool: ${item.data.temp_cool}°C`;
                    const humDisplay = item.data.humidity_percent ? ` | Hum: ${item.data.humidity_percent}%` : '';
                    details = <span className="text-sm font-bold text-slate-800">{tempDisplay}{humDisplay}</span>;
                  }
                  else if (item.type === 'MIST') {
                    typeBadge = <span className="text-[9px] font-black uppercase tracking-widest text-cyan-600 bg-cyan-50 px-2 py-1 rounded border border-cyan-100">Mist</span>;
                    const level = item.data.mist_level ? `${item.data.mist_level.charAt(0).toUpperCase() + item.data.mist_level.slice(1).toLowerCase()} Spray` : 'Enclosure Misted';
                    const shift = item.data.am_pm ? ` (${item.data.am_pm})` : '';
                    details = <span className="text-sm font-bold text-slate-800">{level}{shift}</span>;
                  }

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-xs font-bold text-slate-900 block">{dateStr}</span>
                        <span className="text-[10px] font-bold text-slate-400">{timeStr}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{typeBadge}</td>
                      <td className="px-4 py-3">{details}</td>
                      <td className="px-4 py-3">
                        {item.data.notes 
                          ? <span className="text-xs font-medium text-slate-600 italic">"{item.data.notes}"</span> 
                          : <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">--</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}