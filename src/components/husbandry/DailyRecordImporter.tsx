import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  UploadCloud, CheckCircle2, AlertTriangle, AlertCircle, 
  Edit3, Check, ArrowRight, Loader2, X, Clock, Scale, Utensils, UserCheck, ShieldAlert,
  Sun, Moon, Feather
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { 
  parseFacilitySheet, 
  ParsedFacilityRecord,
  getUserInitials,
  GRAMS_PER_OZ
} from '../../lib/parsers/facilityRecordParser';

// ------------------------------------------------------------------
// IMPERIAL / METRIC CONVERSION HELPERS (FROM WeightModal.tsx)
// ------------------------------------------------------------------
const toGrams = (values: any, unit: string): number => {
  const safeUnit = (unit || 'g').toLowerCase().trim();
  if (safeUnit === 'lb') {
    const totalOz = (values.weight_lb || 0) * 16 + (values.weight_oz || 0) + (values.weight_eighths || 0) / 8;
    return Math.round(totalOz * GRAMS_PER_OZ);
  }
  if (safeUnit === 'oz') {
    const totalOz = (values.weight_oz || 0) + (values.weight_eighths || 0) / 8;
    return Math.round(totalOz * GRAMS_PER_OZ);
  }
  if (safeUnit === 'kg') return Math.round((values.weight_kg || 0) * 1000);
  return Math.round(values.weight_g || 0);
};

const fromGrams = (grams: number | null | undefined, unit: string) => {
  if (!grams || grams <= 0) {
    return { weight_g: undefined, weight_kg: undefined, weight_lb: undefined, weight_oz: undefined, weight_eighths: undefined };
  }
  
  let weight_lb = 0, weight_oz = 0, weight_eighths = 0;
  const weight_g = Math.round(grams);
  const weight_kg = Number((grams / 1000).toFixed(3));
  
  const totalOunces = grams / GRAMS_PER_OZ;
  let totalOzInt = Math.floor(totalOunces);
  let e = Math.round((totalOunces - totalOzInt) * 8);
  
  if (e >= 8) {
    totalOzInt += 1;
    e = 0;
  }
  
  const safeUnit = (unit || 'g').toLowerCase().trim();
  if (safeUnit === 'lb') {
    weight_lb = Math.floor(totalOzInt / 16);
    weight_oz = totalOzInt % 16;
    weight_eighths = e;
  } else if (safeUnit === 'oz') {
    weight_oz = totalOzInt;
    weight_eighths = e;
  }
  
  return { weight_g, weight_kg, weight_lb, weight_oz, weight_eighths };
};

export function DailyRecordImporter() {
  const queryClient = useQueryClient();
  const { session, profile } = useAuth();
  const [sheetDate, setSheetDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [stagedData, setStagedData] = useState<ParsedFacilityRecord[]>([]);
  const [editingRow, setEditingRow] = useState<ParsedFacilityRecord | null>(null);

  // 1. Fetch animals including section category
  const { data: animals = [], isLoading: isLoadingAnimals } = useQuery({
    queryKey: ['animals', 'lookup'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('animals')
        .select('id, name, ring_number, species, category, preferred_weight_unit, weight_unit')
        .order('name');
      if (error) {
        const fallback = await supabase.from('animals').select('*');
        return fallback.data || [];
      }
      return data || [];
    },
  });

  // 2. Fetch active staff users
  const { data: activeStaff = [], isLoading: isLoadingUsers } = useQuery({
    queryKey: ['active-staff'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, initials')
        .eq('is_active', true)
        .eq('is_deleted', false)
        .order('name');
      if (error) {
        const fallback = await supabase.from('users').select('id, name, email').order('name');
        return fallback.data || [];
      }
      return data || [];
    },
  });

  // 3. Fetch operational lists for food items and feed methods
  const { data: opLists = [] } = useQuery({
    queryKey: ['operational_lists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_lists')
        .select('name, category, animal_category')
        .eq('is_deleted', false);
      if (error) return [];
      return data || [];
    },
  });

  // 4. File upload & parsing with operational lists check
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const buffer = evt.target?.result as ArrayBuffer;
        const parsed = parseFacilitySheet(buffer, file.name, animals, activeStaff, opLists);

        if (parsed.length > 0) {
          setSheetDate(parsed[0].sheetDate);
        }

        setStagedData(parsed);
        toast.success(`Loaded ${parsed.length} specimen records from ${file.name}`);
      } catch (err: any) {
        toast.error(`Error reading file: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // 5. Commit Staged Batch strictly matching production schemas
  const commitMutation = useMutation({
    mutationFn: async () => {
      const validRows = stagedData.filter((r) => r.matchedAnimalId);
      if (validRows.length === 0) throw new Error('No matched animals to import.');

      const currentUserId = profile?.id || session?.user?.id || (activeStaff.length > 0 ? activeStaff[0].id : null);
      if (!currentUserId) {
        throw new Error('Authentication required: No active user session detected.');
      }

      const weightInserts: any[] = [];
      const feedInserts: any[] = [];

      for (const row of validRows) {
        const assignedKeeperId = row.matchedKeeperId || currentUserId;

        // Weight payload strictly aligned with WeightModal schema
        if (row.weight && row.weight.grams > 0) {
          weightInserts.push({
            id: crypto.randomUUID(),
            animal_id: row.matchedAnimalId,
            weight_grams: row.weight.grams,
            recorded_at: `${sheetDate}T${row.weight.time || '10:00'}:00.000Z`,
            recorded_by: assignedKeeperId,
            created_by: currentUserId,
            am_pm: row.weight.am_pm || (row.cast === 'PM' ? 'PM' : 'AM'),
            has_cast: Boolean(row.weight.has_cast || row.cast),
            notes: [
              `Facility sheet import (Raw: ${row.weight.raw})`,
              row.keeperInitials && `Sign Off: ${row.keeperInitials}`,
              row.activity && `Activity: ${row.activity}`,
              row.training && `Training: ${row.training}`,
            ].filter(Boolean).join(' | ') || null,
          });
        }

        // Feed payload strictly aligned with FeedModal schema (NO notes column)
        if (row.feed && (row.feed.foodItem || row.feed.outcome !== 'EATEN')) {
          feedInserts.push({
            id: crypto.randomUUID(),
            animal_id: row.matchedAnimalId,
            food_item: row.feed.foodItem || (row.feed.outcome === 'FASTING' ? 'Fasting' : 'Diet Component'),
            feed_method: row.feed.feedMethod || null,
            quantity: row.feed.quantity || 0,
            unit: row.feed.unit === 'grams' ? 'grams' : 'whole_item',
            recorded_at: `${sheetDate}T${row.feed.time || '15:00'}:00.000Z`,
            recorded_by: assignedKeeperId,
            created_by: currentUserId,
            outcome: row.feed.outcome || 'EATEN',
            calci_dust_added: Boolean(row.feed.calci_dust_added),
            schedule_id: null,
          });
        }
      }

      // Execute weight inserts
      if (weightInserts.length > 0) {
        const { error: wErr } = await supabase.from('weight_logs').insert(weightInserts);
        if (wErr) {
          console.error('Weight log insert error:', wErr);
          throw new Error(`Weight insert failed: ${wErr.message} ${wErr.details || ''}`);
        }
      }

      // Execute feed inserts
      if (feedInserts.length > 0) {
        const { error: fErr } = await supabase.from('feed_logs').insert(feedInserts);
        if (fErr) {
          console.error('Feed log insert error:', fErr);
          throw new Error(`Feed insert failed: ${fErr.message} ${fErr.details || ''}`);
        }
      }

      return {
        weightsCount: weightInserts.length,
        feedsCount: feedInserts.length,
      };
    },
    onSuccess: ({ weightsCount, feedsCount }) => {
      toast.success(`Import complete: ${weightsCount} weights and ${feedsCount} feeds successfully logged.`);
      queryClient.invalidateQueries({ queryKey: ['weights'] });
      queryClient.invalidateQueries({ queryKey: ['feeds'] });
      queryClient.invalidateQueries({ queryKey: ['feed_logs'] });
      queryClient.invalidateQueries({ queryKey: ['strict_logs'] });
      queryClient.invalidateQueries({ queryKey: ['weekly_compliance_audit'] });
      setStagedData([]);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Import failed', { duration: 10000 });
    },
  });

  const handleSaveEdit = (updated: ParsedFacilityRecord) => {
    setStagedData((prev) =>
      prev.map((r) => {
        if (r.id !== updated.id) return r;
        const warnings: string[] = [];
        if (!updated.matchedAnimalId) warnings.push('Unmatched specimen name');
        if (!updated.matchedKeeperId && updated.keeperInitials) {
          warnings.push(`Unmatched keeper initials (${updated.keeperInitials})`);
        }
        if (updated.feed && !updated.feed.foodItem && updated.feed.outcome === 'EATEN') {
          warnings.push('Food item selection required');
        }
        if (updated.feed?.isEstimatedTime) warnings.push('Feed time estimated (15:00)');
        return {
          ...updated,
          warnings,
          status: !updated.matchedAnimalId ? 'error' : warnings.length > 0 ? 'warning' : 'valid',
        };
      })
    );
    setEditingRow(null);
  };

  const summary = useMemo(() => {
    const total = stagedData.length;
    const errors = stagedData.filter((r) => r.status === 'error').length;
    const warnings = stagedData.filter((r) => r.status === 'warning').length;
    const ready = stagedData.filter((r) => r.status === 'valid').length;
    return { total, errors, warnings, ready };
  }, [stagedData]);

  return (
    <div className="space-y-4 font-sans max-w-7xl mx-auto pb-16">
      
      {/* HEADER BAR */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
            <UploadCloud className="text-emerald-600" size={24} />
            Daily Facility Record Ingestion
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Parse daily facility sheets, review normalized values, and verify before committing to logs.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1">
              Log Date
            </label>
            <input 
              type="date"
              value={sheetDate}
              onChange={(e) => setSheetDate(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800"
            />
          </div>

          <label className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-widest cursor-pointer transition-all shadow-sm active:scale-95 mt-4 md:mt-0">
            <UploadCloud size={16} />
            Select Sheet (.ods / .xlsx)
            <input type="file" accept=".ods,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>
      </div>

      {/* SUMMARY BANNER */}
      {stagedData.length > 0 && (
        <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center gap-6 text-xs font-bold">
            <span className="text-slate-500">Total Specimens: <strong>{summary.total}</strong></span>
            <span className="text-emerald-600 flex items-center gap-1.5">
              <CheckCircle2 size={16} /> {summary.ready} Ready
            </span>
            {summary.warnings > 0 && (
              <span className="text-amber-600 flex items-center gap-1.5">
                <AlertTriangle size={16} /> {summary.warnings} Warnings
              </span>
            )}
            {summary.errors > 0 && (
              <span className="text-rose-600 flex items-center gap-1.5">
                <AlertCircle size={16} /> {summary.errors} Unmatched
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStagedData([])}
              className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => commitMutation.mutate()}
              disabled={commitMutation.isPending || summary.errors > 0}
              className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm disabled:opacity-50 cursor-pointer"
            >
              {commitMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              Commit Batch
            </button>
          </div>
        </div>
      )}

      {/* VERIFICATION STAGING TABLE */}
      {stagedData.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Specimen</th>
                  <th className="py-3 px-4">Weight Recorded</th>
                  <th className="py-3 px-4">Feed Component</th>
                  <th className="py-3 px-4">Feed Time</th>
                  <th className="py-3 px-4">Conducted By</th>
                  <th className="py-3 px-4">Activity / Notes</th>
                  <th className="py-3 px-4 text-center">Adjust</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stagedData.map((row) => (
                  <tr 
                    key={row.id}
                    onClick={() => setEditingRow(row)}
                    className="hover:bg-slate-50/80 cursor-pointer transition-colors group"
                  >
                    <td className="py-3 px-4">
                      {row.status === 'valid' && (
                        <span className="p-1 rounded-full bg-emerald-100 text-emerald-600 inline-block">
                          <CheckCircle2 size={15} />
                        </span>
                      )}
                      {row.status === 'warning' && (
                        <span className="p-1 rounded-full bg-amber-100 text-amber-600 inline-block" title={row.warnings.join(', ')}>
                          <AlertTriangle size={15} />
                        </span>
                      )}
                      {row.status === 'error' && (
                        <span className="p-1 rounded-full bg-rose-100 text-rose-600 inline-block" title={row.warnings.join(', ')}>
                          <AlertCircle size={15} />
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{row.rawName}</div>
                      {row.matchedAnimalName ? (
                        <div className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                          <ArrowRight size={10} /> {row.matchedAnimalName}
                        </div>
                      ) : (
                        <div className="text-[10px] text-rose-500 font-black uppercase tracking-wider">
                          Click to Match Specimen
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {row.weight ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-800 font-mono text-xs">{row.weight.raw}</span>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                            {row.weight.am_pm}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-300 italic text-[11px]">No weight</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {row.feed ? (
                        <div>
                          <span className="font-bold text-slate-800">
                            {row.feed.quantity}x {row.feed.foodItem}
                          </span>
                          {row.feed.feedMethod && (
                            <span className="text-[10px] text-slate-500 ml-1 font-semibold">
                              ({row.feed.feedMethod})
                            </span>
                          )}
                          <div className="text-[10px] text-slate-400 truncate max-w-xs">{row.feed.raw}</div>
                        </div>
                      ) : (
                        <span className="text-slate-300 italic text-[11px]">No feed</span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {row.feed && (
                        <div className="flex items-center gap-1">
                          <Clock size={12} className={row.feed.isEstimatedTime ? 'text-amber-500' : 'text-slate-400'} />
                          <span className={`font-mono ${row.feed.isEstimatedTime ? 'text-amber-600 font-bold' : 'text-slate-600'}`}>
                            {row.feed.time}
                          </span>
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {row.matchedKeeperName ? (
                        <div>
                          <div className="font-bold text-slate-800 flex items-center gap-1">
                            <UserCheck size={12} className="text-emerald-500" />
                            {row.matchedKeeperName}
                          </div>
                          {row.keeperInitials && (
                            <div className="text-[10px] font-mono text-slate-400">
                              Initials: {row.keeperInitials}
                            </div>
                          )}
                        </div>
                      ) : row.keeperInitials ? (
                        <span className="text-amber-600 font-bold flex items-center gap-1" title="Unmatched keeper initials">
                          <ShieldAlert size={12} /> {row.keeperInitials}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">-</span>
                      )}
                    </td>

                    <td className="py-3 px-4 max-w-xs truncate text-[11px] text-slate-500">
                      {[row.activity, row.training, row.cast, row.notes].filter(Boolean).join(' | ') || '-'}
                    </td>

                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingRow(row);
                        }}
                        className="p-1 text-slate-400 group-hover:text-slate-900 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
                      >
                        <Edit3 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AMALGAMATED ADJUSTMENT MODAL */}
      {editingRow && (
        <AmalgamatedAdjustmentModal
          row={editingRow}
          animals={animals}
          activeStaff={activeStaff}
          opLists={opLists}
          sheetDate={sheetDate}
          isLoadingAnimals={isLoadingAnimals}
          isLoadingUsers={isLoadingUsers}
          onSave={handleSaveEdit}
          onClose={() => setEditingRow(null)}
        />
      )}
    </div>
  );
}

function AmalgamatedAdjustmentModal({
  row,
  animals,
  activeStaff,
  opLists,
  sheetDate,
  isLoadingAnimals,
  isLoadingUsers,
  onSave,
  onClose,
}: {
  row: ParsedFacilityRecord;
  animals: any[];
  activeStaff: any[];
  opLists: any[];
  sheetDate: string;
  isLoadingAnimals: boolean;
  isLoadingUsers: boolean;
  onSave: (updated: ParsedFacilityRecord) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ParsedFacilityRecord>({ ...row });

  const selectedAnimal = animals.find((a: any) => a.id === form.matchedAnimalId);
  const animalUnit = (selectedAnimal?.preferred_weight_unit || selectedAnimal?.weight_unit || form.animalUnit || 'oz').toLowerCase();
  const animalCat = (selectedAnimal?.category || form.animalCategory || '').toUpperCase().trim();

  const foodOptions = useMemo(() => {
    return opLists
      .filter((l: any) => {
        if (l.category?.toLowerCase() !== 'food_type') return false;
        const targetCategory = l.animal_category?.toUpperCase().trim();
        return targetCategory && animalCat ? targetCategory.includes(animalCat) : true;
      })
      .map((f: any) => ({ value: f.name, label: f.name }));
  }, [opLists, animalCat]);

  const methodOptions = useMemo(() => {
    return opLists
      .filter((l: any) => {
        if (l.category?.toLowerCase() !== 'feed_method') return false;
        const targetCategory = l.animal_category?.toUpperCase().trim();
        return targetCategory && animalCat ? targetCategory.includes(animalCat) : true;
      })
      .map((f: any) => ({ value: f.name, label: f.name }));
  }, [opLists, animalCat]);

  // Weight State
  const [weightFields, setWeightFields] = useState(() => fromGrams(form.weight?.grams, animalUnit));
  const [amPm, setAmPm] = useState<'AM' | 'PM'>(form.weight?.am_pm || (form.cast === 'PM' ? 'PM' : 'AM'));
  const [hasCast, setHasCast] = useState<boolean>(Boolean(form.weight?.has_cast || form.cast));
  const [weightTime, setWeightTime] = useState<string>(form.weight?.time || '10:00');
  const [weightNotes, setWeightNotes] = useState<string>(form.notes || '');

  // Feed State
  const [feedOutcome, setFeedOutcome] = useState<'EATEN' | 'REFUSED' | 'FASTING' | 'NOT_CAST' | 'REGURGITATED'>(
    form.feed?.outcome || 'EATEN'
  );
  const [foodItem, setFoodItem] = useState<string>(form.feed?.foodItem || '');
  const [feedMethod, setFeedMethod] = useState<string>(form.feed?.feedMethod || '');
  const [feedQty, setFeedQty] = useState<number>(form.feed?.quantity ?? 1);
  const [feedUnit, setFeedUnit] = useState<'whole_item' | 'grams'>(form.feed?.unit || 'whole_item');
  const [calciDust, setCalciDust] = useState<boolean>(Boolean(form.feed?.calci_dust_added));
  const [feedTime, setFeedTime] = useState<string>(form.feed?.time || '15:00');

  const QUICK_FOODS = ['DOC (Yolked)', 'DOC (Whole)', 'DOC (Skinned)', 'Quail', 'Mouse', 'Rat'];

  useEffect(() => {
    const totalG = toGrams(weightFields, animalUnit);
    if (totalG > 0) {
      setForm((prev) => ({
        ...prev,
        weight: {
          raw: prev.weight?.raw || `${totalG}g`,
          grams: totalG,
          detectedUnit: animalUnit as any,
          am_pm: amPm,
          has_cast: hasCast,
          time: weightTime,
        },
      }));
    }
  }, [weightFields, animalUnit, amPm, hasCast, weightTime]);

  const handleAnimalChange = (animalId: string) => {
    const selected = animals.find((a: any) => a.id === animalId);
    setForm((prev) => ({
      ...prev,
      matchedAnimalId: selected?.id || null,
      matchedAnimalName: selected?.name || null,
      animalCategory: (selected?.category || '').toUpperCase().trim(),
    }));
  };

  const handleKeeperChange = (userId: string) => {
    const selected = activeStaff.find((u: any) => u.id === userId);
    setForm((prev) => ({
      ...prev,
      matchedKeeperId: selected?.id || null,
      matchedKeeperName: selected?.name || null,
      keeperInitials: selected ? (selected.initials || getUserInitials(selected.name)) : prev.keeperInitials,
    }));
  };

  const handleQuickFoodSelect = (preset: string) => {
    let target = '';
    if (preset.includes('DOC (Yolked)')) {
      const found = foodOptions.find(f => f.value.toLowerCase().includes('yolk'));
      if (found) target = found.value;
    } else if (preset.includes('DOC (Skinned)')) {
      const found = foodOptions.find(f => f.value.toLowerCase().includes('skin'));
      if (found) target = found.value;
    } else if (preset.includes('DOC (Whole)')) {
      const found = foodOptions.find(f => f.value.toLowerCase().includes('whole') && (f.value.toLowerCase().includes('chick') || f.value.toLowerCase().includes('doc')));
      if (found) target = found.value;
    } else if (preset === 'Quail') {
      const found = foodOptions.find(f => f.value.toLowerCase().includes('quail'));
      if (found) target = found.value;
    } else if (preset === 'Mouse') {
      const found = foodOptions.find(f => f.value.toLowerCase().includes('mouse') || f.value.toLowerCase().includes('mice'));
      if (found) target = found.value;
    } else if (preset === 'Rat') {
      const found = foodOptions.find(f => f.value.toLowerCase().includes('rat'));
      if (found) target = found.value;
    }

    if (target) {
      setFoodItem(target);
    }
  };

  const handleApply = () => {
    const totalG = toGrams(weightFields, animalUnit);

    const updatedWeight: ParsedWeightRecord | null = totalG > 0
      ? {
          raw: form.weight?.raw || `${totalG}g`,
          grams: totalG,
          detectedUnit: animalUnit as any,
          am_pm: amPm,
          has_cast: hasCast,
          time: weightTime,
        }
      : null;

    const updatedFeed: ParsedFeedItem | null = (foodItem || feedOutcome !== 'EATEN')
      ? {
          raw: form.feed?.raw || `${feedQty}x ${foodItem}`,
          foodItem,
          feedMethod,
          quantity: feedQty,
          unit: feedUnit,
          outcome: feedOutcome,
          calci_dust_added: calciDust,
          time: feedTime,
          isEstimatedTime: false,
        }
      : null;

    onSave({
      ...form,
      weight: updatedWeight,
      feed: updatedFeed,
      cast: hasCast ? amPm : null,
      notes: weightNotes || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-md font-sans">
      <div className="bg-white rounded-3xl max-w-xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200 shadow-2xl">
        
        {/* HEADER BAR */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
          <div>
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight leading-none">
              Adjust Facility Log • {form.rawName}
            </h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              Specimen Target • <span className="text-emerald-600 font-mono font-black">{animalUnit.toUpperCase()}</span>
              {animalCat && <span className="text-slate-400 ml-2">• Section: {animalCat}</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>

        {/* SCROLLABLE FORM BODY */}
        <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar flex-1 bg-white">
          
          {/* SECTION 1: SPECIMEN & CONDUCTED BY STAFF */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
            <div>
              <label className="block text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Matched Specimen {isLoadingAnimals && '(Loading...)'}
              </label>
              <select
                value={form.matchedAnimalId || ''}
                onChange={(e) => handleAnimalChange(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl p-2 font-bold text-xs text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 cursor-pointer"
              >
                <option value="">-- Select Animal ({animals.length}) --</option>
                {animals.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {a.species ? `(${a.species})` : ''} {a.ring_number ? `• ${a.ring_number}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Conducted By * {isLoadingUsers && '(Loading...)'}
              </label>
              <select
                value={form.matchedKeeperId || ''}
                onChange={(e) => handleKeeperChange(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl p-2 font-bold text-xs text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 cursor-pointer"
              >
                <option value="">-- Select Keeper ({activeStaff.length}) --</option>
                {activeStaff.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.initials || getUserInitials(s.name)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* SECTION 2: WEIGHT INPUT CARD (FROM WeightModal.tsx) */}
          <div className="space-y-3 bg-emerald-50/40 p-4 rounded-2xl border border-emerald-100">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black uppercase tracking-widest text-emerald-800 flex items-center gap-1.5">
                <Scale size={14} className="text-emerald-600" />
                Measured Scale Reading
              </label>
              <span className="text-[9px] font-mono bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                {toGrams(weightFields, animalUnit)}g
              </span>
            </div>

            {/* Shift Weigh Window Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAmPm('AM')}
                className={`py-1.5 px-2.5 rounded-xl border-2 font-black text-[10px] sm:text-xs uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  amPm === 'AM'
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                }`}
              >
                <Sun size={12} className={amPm === 'AM' ? 'text-emerald-600' : 'text-slate-400'} />
                AM Weight
              </button>
              <button
                type="button"
                onClick={() => setAmPm('PM')}
                className={`py-1.5 px-2.5 rounded-xl border-2 font-black text-[10px] sm:text-xs uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  amPm === 'PM'
                    ? 'bg-indigo-50 border-indigo-500 text-indigo-800 shadow-xs'
                    : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                }`}
              >
                <Moon size={12} className={amPm === 'PM' ? 'text-indigo-600' : 'text-slate-400'} />
                PM Weight
              </button>
            </div>

            {/* Unit-Specific Inputs */}
            {animalUnit === 'lb' && (
              <div className="grid grid-cols-3 gap-2">
                <div className="relative">
                  <input
                    type="number"
                    step="1"
                    value={weightFields.weight_lb ?? ''}
                    onChange={(e) => setWeightFields(prev => ({ ...prev, weight_lb: e.target.value === '' ? undefined : parseFloat(e.target.value) }))}
                    className="w-full bg-white pl-2 pr-6 py-2 border border-emerald-200 rounded-xl text-sm font-black text-slate-900 text-center outline-none focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="0"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-[10px] uppercase">lb</span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="1"
                    max="15"
                    value={weightFields.weight_oz ?? ''}
                    onChange={(e) => setWeightFields(prev => ({ ...prev, weight_oz: e.target.value === '' ? undefined : parseFloat(e.target.value) }))}
                    className="w-full bg-white pl-2 pr-6 py-2 border border-emerald-200 rounded-xl text-sm font-black text-slate-900 text-center outline-none focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="0"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-[10px] uppercase">oz</span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="1"
                    max="7"
                    value={weightFields.weight_eighths ?? ''}
                    onChange={(e) => setWeightFields(prev => ({ ...prev, weight_eighths: e.target.value === '' ? undefined : parseFloat(e.target.value) }))}
                    className="w-full bg-white pl-2 pr-6 py-2 border border-emerald-200 rounded-xl text-sm font-black text-slate-900 text-center outline-none focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="0"
                  />
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 font-black text-[9px]">1/8</span>
                </div>
              </div>
            )}

            {animalUnit === 'oz' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <input
                    type="number"
                    step="1"
                    value={weightFields.weight_oz ?? ''}
                    onChange={(e) => setWeightFields(prev => ({ ...prev, weight_oz: e.target.value === '' ? undefined : parseFloat(e.target.value) }))}
                    className="w-full bg-white pl-2 pr-7 py-2 border border-emerald-200 rounded-xl text-sm font-black text-slate-900 text-center outline-none focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="0"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-[10px] uppercase">oz</span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="1"
                    max="7"
                    value={weightFields.weight_eighths ?? ''}
                    onChange={(e) => setWeightFields(prev => ({ ...prev, weight_eighths: e.target.value === '' ? undefined : parseFloat(e.target.value) }))}
                    className="w-full bg-white pl-2 pr-7 py-2 border border-emerald-200 rounded-xl text-sm font-black text-slate-900 text-center outline-none focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="0"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 font-black text-[9px]">1/8</span>
                </div>
              </div>
            )}

            {animalUnit === 'g' && (
              <div className="relative">
                <input
                  type="number"
                  step="1"
                  value={weightFields.weight_g ?? ''}
                  onChange={(e) => setWeightFields(prev => ({ ...prev, weight_g: e.target.value === '' ? undefined : parseFloat(e.target.value) }))}
                  className="w-full bg-white pl-3 pr-8 py-2 border border-emerald-200 rounded-xl text-base font-black text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/20"
                  placeholder="0"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs uppercase">g</span>
              </div>
            )}

            {animalUnit === 'kg' && (
              <div className="relative">
                <input
                  type="number"
                  step="0.001"
                  value={weightFields.weight_kg ?? ''}
                  onChange={(e) => setWeightFields(prev => ({ ...prev, weight_kg: e.target.value === '' ? undefined : parseFloat(e.target.value) }))}
                  className="w-full bg-white pl-3 pr-9 py-2 border border-emerald-200 rounded-xl text-base font-black text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/20"
                  placeholder="0.000"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs uppercase">kg</span>
              </div>
            )}

            {/* Cast Pellet Checkbox Card */}
            <label className="flex items-center gap-2.5 p-2 bg-white border border-emerald-200 rounded-xl cursor-pointer hover:bg-emerald-50/50 transition-colors">
              <input
                type="checkbox"
                checked={hasCast}
                onChange={(e) => setHasCast(e.target.checked)}
                className="w-3.5 h-3.5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer shrink-0"
              />
              <span className="text-[10px] sm:text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                <Feather size={12} className="text-slate-400 shrink-0" />
                Bird has cast pellet prior to weighing
              </span>
            </label>
          </div>

          {/* SECTION 3: DIET COMPONENT (STRICT OPERATIONAL LIST DROPDOWNS) */}
          <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-600 flex items-center gap-1.5">
                <Utensils size={14} className="text-amber-600" />
                Diet Outcome &amp; Component
              </span>
            </div>

            {/* Outcome Segmented Buttons */}
            <div className="flex bg-slate-200/70 p-1 rounded-xl gap-1">
              {[
                { value: 'EATEN', label: 'Eaten', color: 'bg-emerald-500 text-white' },
                { value: 'REFUSED', label: 'Refused', color: 'bg-rose-500 text-white' },
                { value: 'FASTING', label: 'Fasting', color: 'bg-amber-500 text-white' },
                { value: 'NOT_CAST', label: 'Not Cast', color: 'bg-purple-500 text-white' }
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFeedOutcome(opt.value as any)}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer ${
                    feedOutcome === opt.value ? `${opt.color} shadow-xs scale-100` : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200 scale-95'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Quick Item Presets */}
            <div>
              <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1">
                Quick Diet Presets
              </label>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_FOODS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => handleQuickFoodSelect(item)}
                    className="px-2.5 py-1 bg-white hover:bg-amber-50 text-slate-700 hover:text-amber-700 border border-slate-200 hover:border-amber-300 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                  >
                    + {item}
                  </button>
                ))}
              </div>
            </div>

            {/* Dropdowns for Food Item & Feed Method (from operational list) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">
                  Food Item * ({animalCat || 'Section List'})
                </label>
                <select
                  value={foodItem}
                  onChange={(e) => setFoodItem(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl p-2 font-bold text-xs text-slate-900 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 cursor-pointer"
                >
                  <option value="">-- Select Food Item ({foodOptions.length}) --</option>
                  {foodOptions.map((opt: any) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                  {foodItem && !foodOptions.some((o: any) => o.value === foodItem) && (
                    <option value={foodItem}>{foodItem} (From Sheet)</option>
                  )}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">
                  Feed Method
                </label>
                <select
                  value={feedMethod}
                  onChange={(e) => setFeedMethod(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl p-2 font-bold text-xs text-slate-900 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 cursor-pointer"
                >
                  <option value="">-- Standard / None --</option>
                  {methodOptions.map((opt: any) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                  {feedMethod && !methodOptions.some((o: any) => o.value === feedMethod) && (
                    <option value={feedMethod}>{feedMethod} (From Sheet)</option>
                  )}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">
                  Quantity
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={feedQty}
                  onChange={(e) => setFeedQty(parseFloat(e.target.value) || 0)}
                  className="w-full bg-white border border-slate-200 rounded-xl p-2 font-bold text-xs text-center text-slate-800 outline-none focus:ring-2 focus:ring-amber-500/20"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">
                  Unit
                </label>
                <select
                  value={feedUnit}
                  onChange={(e) => setFeedUnit(e.target.value as any)}
                  className="w-full bg-white border border-slate-200 rounded-xl p-2 font-bold text-xs text-slate-800 cursor-pointer outline-none focus:ring-2 focus:ring-amber-500/20"
                >
                  <option value="whole_item">Items</option>
                  <option value="grams">Grams</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">
                  Time Fed
                </label>
                <input
                  type="time"
                  value={feedTime}
                  onChange={(e) => setFeedTime(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl p-2 font-bold text-xs text-slate-800 outline-none focus:ring-2 focus:ring-amber-500/20"
                />
              </div>
            </div>

            {/* Calci-Dust Toggle */}
            <label className="flex items-center gap-2 cursor-pointer group/toggle w-fit pt-1">
              <input
                type="checkbox"
                checked={calciDust}
                onChange={(e) => setCalciDust(e.target.checked)}
                className="w-4 h-4 text-amber-600 border-slate-300 rounded focus:ring-amber-500 cursor-pointer"
              />
              <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 group-hover/toggle:text-slate-800 uppercase tracking-wide transition-colors">
                Add Calci-Dust Supplement
              </span>
            </label>
          </div>

          {/* SECTION 4: TRAINING & ACTIVITIES */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">
                Flying / Training Note
              </label>
              <input
                type="text"
                value={form.training || ''}
                onChange={(e) => setForm(prev => ({ ...prev, training: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="e.g. Manned"
              />
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">
                Activities &amp; Public Demonstrations
              </label>
              <input
                type="text"
                value={form.activity || ''}
                onChange={(e) => setForm(prev => ({ ...prev, activity: e.target.value }))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="e.g. used for 13:00 owl encounter"
              />
            </div>
          </div>
        </div>

        {/* FOOTER ACTIONS */}
        <div className="px-5 py-3.5 border-t border-slate-100 flex items-center justify-end bg-white gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs uppercase tracking-wider cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="flex items-center gap-1.5 px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-xs uppercase tracking-widest cursor-pointer shadow-md active:scale-95 transition-all"
          >
            <Check size={14} />
            Apply Adjustment
          </button>
        </div>
      </div>
    </div>
  );
}

export default DailyRecordImporter;