import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Animal } from '../../types';
import { Users, Scale, X, MapPin, Activity, ListOrdered, FileText, Edit2, User, Calendar, Loader2, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import AnimalFormModal from './AnimalFormModal';

interface MobProfileProps {
  isOpen?: boolean; 
  mob: Animal;
  members?: Animal[]; 
  onClose: () => void;
}

// --- HELPER: Accurate Age Calculator using schema's date_of_birth ---
const calculateAge = (dobString: string | null | undefined) => {
  if (!dobString) return null;
  const dob = new Date(dobString);
  if (isNaN(dob.getTime())) return null; 
  
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  let months = now.getMonth() - dob.getMonth();
  
  if (months < 0 || (months === 0 && now.getDate() < dob.getDate())) {
    years--;
    months += 12;
  }
  
  if (years === 0 && months === 0) return 'Newborn';
  if (years === 0) return `${months}m`;
  return months > 0 ? `${years}y ${months}m` : `${years}y`;
};

export function MobProfile({ isOpen = true, mob, members: passedMembers = [], onClose }: MobProfileProps) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // 1. Independent Member Fetching using the correct parent_group_id column
  const { data: fetchedMembers = [] } = useQuery({
    queryKey: ['mob_members', mob.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('animals')
        .select('*')
        .eq('parent_group_id', mob.id)
        .neq('status', 'DECEASED')
        .neq('status', 'ARCHIVED')
        .order('name');
      if (error) return [];
      return (data || []) as Animal[];
    },
    enabled: !!mob.id,
  });

  // Guarantee member list is populated even if parent component passed an unpopulated array
  const members = (passedMembers && passedMembers.length > 0) ? passedMembers : fetchedMembers;
  const memberIds = useMemo(() => members.map((m: any) => m.id), [members]);

  // 2. Query active feed_logs, feeding_schedules, and weight_logs (replacing legacy daily_logs)
  const { data: mobLogs = [], isLoading: isLogsLoading } = useQuery({
    queryKey: ['strict_logs', mob.id, memberIds],
    queryFn: async () => {
      const targetIds = [mob.id, ...memberIds];

      const [feedsRes, schedsRes, weightsRes] = await Promise.all([
        supabase
          .from('feed_logs')
          .select('*')
          .in('animal_id', targetIds)
          .or('is_deleted.eq.false,is_deleted.is.null')
          .order('recorded_at', { ascending: false })
          .limit(20),
        supabase
          .from('feeding_schedules')
          .select('*')
          .in('animal_id', targetIds)
          .in('status', ['COMPLETED', 'FASTING'])
          .or('is_deleted.eq.false,is_deleted.is.null')
          .order('scheduled_date', { ascending: false })
          .limit(10),
        supabase
          .from('weight_logs')
          .select('*')
          .in('animal_id', targetIds)
          .or('is_deleted.eq.false,is_deleted.is.null')
          .order('recorded_at', { ascending: false })
          .limit(15),
      ]);

      const memberMap = new Map<string, string>(members.map((m: any) => [m.id, m.name]));
      const feedItems: any[] = [];

      // Map direct feeds
      (feedsRes.data || []).forEach((f: any) => {
        const qty = f.quantity ? `${f.quantity}x ` : '';
        const item = f.food_item || 'Diet';
        const method = f.feed_method ? ` (${f.feed_method})` : '';
        const outcome = f.outcome && f.outcome !== 'EATEN' ? ` • ${f.outcome}` : '';
        const calci = f.calci_dust_added ? ' • +Calci-Dust' : '';
        const memberName = f.animal_id !== mob.id ? memberMap.get(f.animal_id) : null;
        const memberPrefix = memberName ? `[${memberName}] ` : '';

        feedItems.push({
          id: `feed_${f.id}`,
          log_type: 'FEEDING',
          recorded_at: f.recorded_at,
          notes: `${memberPrefix}${qty}${item}${method}${outcome}${calci}`.trim(),
        });
      });

      // Map resolved scheduled feeds
      (schedsRes.data || []).forEach((s: any) => {
        const alreadyExists = (feedsRes.data || []).some((f: any) => f.schedule_id === s.id);
        if (!alreadyExists) {
          const qty = s.quantity ? `${s.quantity}x ` : '';
          const item = s.food_type || 'Diet';
          const method = s.presentation_method ? ` (${s.presentation_method})` : '';
          const memberName = s.animal_id !== mob.id ? memberMap.get(s.animal_id) : null;
          const memberPrefix = memberName ? `[${memberName}] ` : '';

          feedItems.push({
            id: `sched_${s.id}`,
            log_type: 'FEEDING',
            recorded_at: s.scheduled_date ? `${s.scheduled_date}T15:00:00Z` : s.created_at,
            notes: `${memberPrefix}${qty}${item}${method} • ${s.status}`.trim(),
          });
        }
      });

      // Map individual member weights
      const weightItems = (weightsRes.data || []).map((w: any) => {
        const memberName = memberMap.get(w.animal_id);
        const prefix = memberName ? `${memberName}: ` : '';
        const notePart = w.notes ? ` • ${w.notes}` : '';
        return {
          id: `weight_${w.id}`,
          log_type: 'WEIGHT',
          recorded_at: w.recorded_at,
          notes: `${prefix}${w.weight_grams}g${w.am_pm ? ` [${w.am_pm}]` : ''}${notePart}`,
        };
      });

      return [...feedItems, ...weightItems]
        .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
        .slice(20);
    },
    staleTime: 0,
  });

  // ------------------------------------------------------------------
  // ROLL-UP AGGREGATION ENGINE (Schema Aligned)
  // ------------------------------------------------------------------
  const metrics = useMemo(() => {
    let males = 0;
    let females = 0;
    let unknowns = 0;
    let totalWeight = 0;
    let weighCount = 0;

    const validDobs = members
      .map((m: any) => m.date_of_birth)
      .filter(Boolean)
      .map(dob => new Date(dob as string).getTime())
      .filter(time => !isNaN(time));

    members.forEach(m => {
      if (m.gender === 'M' || m.gender === 'MALE') males++;
      else if (m.gender === 'F' || m.gender === 'FEMALE') females++;
      else unknowns++;

      if (m.flying_weight) {
        totalWeight += m.flying_weight;
        weighCount++;
      }
    });

    const avgWeight = weighCount > 0 ? Math.round(totalWeight / weighCount) : 0;
    const mfu = `${males}.${females}.${unknowns}`;

    let ageSpread = '--';
    if (validDobs.length > 0) {
      const oldestDate = new Date(Math.min(...validDobs)).toISOString();
      const youngestDate = new Date(Math.max(...validDobs)).toISOString();
      
      const oldestAge = calculateAge(oldestDate);
      const youngestAge = calculateAge(youngestDate);
      
      if (oldestAge && youngestAge) {
        if (oldestAge === youngestAge) {
          ageSpread = oldestAge;
        } else {
          ageSpread = `${youngestAge} - ${oldestAge}`;
        }
      }
    }

    return { 
      headcount: members.length, 
      mfu, 
      avgWeight, 
      unit: members[0]?.weight_unit || 'g',
      ageSpread
    };
  }, [members]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-slate-50 w-full max-w-5xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
        
        {/* Header */}
        <div className="bg-white px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center border border-blue-200 shadow-sm shrink-0">
              <Users size={24} />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight">{mob.name}</h2>
                <span className="bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border border-blue-200 hidden sm:inline-block">Colony / Mob</span>
              </div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-0.5">{mob.species || 'Unknown Species'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setIsEditModalOpen(true)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors cursor-pointer" title="Edit Mob Record">
              <Edit2 size={20} />
            </button>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer" title="Close Profile">
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6 custom-scrollbar">
          
          {/* Biometric Roll-Ups (4-Column Grid) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl shrink-0"><ListOrdered size={20} /></div>
              <div className="min-w-0">
                <p className="text-[9px] lg:text-[10px] font-black text-slate-500 uppercase tracking-widest truncate">Demographic</p>
                <p className="text-lg lg:text-xl font-black text-slate-900 mt-0.5">{metrics.mfu}</p>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
              <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl shrink-0"><Scale size={20} /></div>
              <div className="min-w-0">
                <p className="text-[9px] lg:text-[10px] font-black text-slate-500 uppercase tracking-widest truncate">Avg Weight</p>
                <p className="text-lg lg:text-xl font-black text-slate-900 mt-0.5">
                  {metrics.avgWeight > 0 ? `${metrics.avgWeight}${metrics.unit}` : '--'}
                </p>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3">
              <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl shrink-0"><Calendar size={20} /></div>
              <div className="min-w-0">
                <p className="text-[9px] lg:text-[10px] font-black text-slate-500 uppercase tracking-widest truncate">Age Spread</p>
                <p className="text-sm lg:text-md font-black text-slate-900 mt-0.5 lg:mt-1 truncate" title={metrics.ageSpread}>
                  {metrics.ageSpread}
                </p>
              </div>
            </div>

            {/* LOCATION CARD */}
            <div 
              onClick={() => setIsEditModalOpen(true)} 
              className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between gap-2 cursor-pointer group hover:border-blue-300 hover:shadow-md transition-all"
              title="Click to reassign Location"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2.5 bg-slate-100 text-slate-600 rounded-xl group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors shrink-0"><MapPin size={20} /></div>
                <div className="min-w-0">
                  <p className="text-[9px] lg:text-[10px] font-black text-slate-500 uppercase tracking-widest group-hover:text-blue-500 transition-colors truncate">Location</p>
                  <p className="text-sm font-bold text-slate-900 mt-0.5 lg:mt-1 truncate">{mob.location || 'Unassigned'}</p>
                </div>
              </div>
              <div className="text-slate-300 opacity-0 group-hover:opacity-100 group-hover:text-blue-500 transition-all shrink-0 hidden lg:block">
                <Edit2 size={16} />
              </div>
            </div>
          </div>

          {/* HORIZONTAL ROWS */}
          <div className="flex flex-col gap-6">
            
            {/* Row 1: Active Members Full-Width List */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col max-h-[400px]">
              <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                  <Activity size={14} className="text-blue-500" /> Active Members ({metrics.headcount})
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                {members.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">No active individuals assigned.</div>
                ) : (
                  <div className="space-y-1">
                    {members.map((m: any) => {
                      const photoUrl = m.profile_image_url;
                      const dobVal = m.date_of_birth;

                      return (
                        <div key={m.id} className="flex items-center p-3 hover:bg-slate-50 rounded-xl border border-transparent hover:border-slate-100 transition-colors gap-4">
                          
                          {/* 1. Avatar */}
                          {photoUrl ? (
                            <img src={photoUrl} alt={m.name} className="w-10 h-10 rounded-full object-cover shadow-sm border border-slate-200 shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 border border-slate-200 flex items-center justify-center shadow-sm shrink-0">
                              <User size={16} />
                            </div>
                          )}

                          {/* 2. Name & Species */}
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-sm font-bold text-slate-900 truncate">{m.name}</span>
                            <span className="text-[10px] font-medium text-slate-500 truncate">{m.species || 'Unknown Species'}</span>
                          </div>

                          {/* 3. Age & DOB */}
                          <div className="hidden sm:flex flex-col min-w-0 flex-1 px-4 border-l border-slate-100">
                            <span className="text-xs font-bold text-slate-700 truncate">
                              {dobVal ? calculateAge(dobVal) : 'No DOB recorded'}
                            </span>
                            <span className="text-[10px] font-medium text-slate-400 truncate mt-0.5">
                              {dobVal ? format(parseISO(dobVal), 'dd MMM yyyy') : '--'}
                            </span>
                          </div>

                          {/* 4. Gender & Weight */}
                          <div className="flex items-center gap-4 text-xs font-bold text-slate-500 shrink-0 border-l border-slate-100 pl-4">
                            <span className="bg-slate-100 px-2.5 py-1 rounded-lg text-slate-600 border border-slate-200/60 shadow-sm">
                              {m.gender === 'MALE' ? 'M' : m.gender === 'FEMALE' ? 'F' : m.gender || 'U'}
                            </span>
                            <span className="w-14 text-right tabular-nums">
                              {m.flying_weight ? `${m.flying_weight}${m.weight_unit || 'g'}` : '--'}
                            </span>
                          </div>

                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Row 2: Mob-Level Logs Full-Width List */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col max-h-[400px]">
              <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                  <FileText size={14} className="text-emerald-500" /> Group Husbandry Logs
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
                {isLogsLoading ? (
                  <div className="p-8 text-center text-slate-400 text-xs font-bold uppercase tracking-widest flex flex-col items-center gap-2">
                    <Loader2 size={20} className="animate-spin text-emerald-500" />
                    Loading logs...
                  </div>
                ) : mobLogs.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">No group-level logs found.</div>
                ) : (
                  <div className="space-y-3">
                    {mobLogs.map((log: any) => (
                      <div key={log.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row gap-4 sm:gap-6">
                        <div className="flex flex-col gap-1.5 min-w-[140px] shrink-0">
                          <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-100/50 px-2 py-1 rounded inline-block w-max">
                            {log.log_type}
                          </span>
                          {log.recorded_at && (
                            <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5 mt-1">
                              <Clock size={12} className="text-slate-400" />
                              {format(parseISO(log.recorded_at), 'dd MMM yyyy HH:mm')}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 border-t sm:border-t-0 sm:border-l border-slate-200/60 pt-3 sm:pt-0 sm:pl-6">
                          <p className="text-sm font-medium text-slate-700 leading-relaxed whitespace-pre-wrap">
                            {log.notes || 'No notes provided.'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>

        </div>
      </div>

      {isEditModalOpen && (
        <AnimalFormModal 
          isOpen={isEditModalOpen} 
          onClose={() => setIsEditModalOpen(false)} 
          initialData={mob} 
        />
      )}
    </div>
  );
}

export default MobProfile;