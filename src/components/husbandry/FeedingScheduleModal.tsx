import React, { useEffect, useMemo, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { CalendarClock, Loader2, Utensils, RefreshCw, X, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { format, addDays, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { Animal, FeedingSchedule as FeedingScheduleType, OperationalList } from '../../types';
import { feedingService } from '../../services/feedingService';

export interface RoutineManageData {
  routineId: string;
  animalId: string;
  animalName: string;
  foodType: string;
  quantity: number;
  supplements?: string | null;
  feedNotRequired: boolean;
  scheduleMode: 'single' | 'interval' | 'specific_days';
  intervalValue: number;
  intervalUnit: 'days' | 'weeks';
  selectedDays: number[];
  startDate: string;
  endDate: string;
  totalFeeds: number;
  completedFeeds: number;
  pendingFeeds: number;
  pendingIds: string[];
  allIds: string[];
}

interface FeedingScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCategory: string;
  manageRoutine?: RoutineManageData | null;
}

// Strictly excludes ARCHIVED, DECEASED, and TRANSFERRED specimens
const getAnimalsOptions = () => queryOptions({
  queryKey: ['animals', 'active_inventory'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('animals')
      .select('id, name, species, ring_number, status, category, is_deleted')
      .eq('is_deleted', false)
      .neq('status', 'ARCHIVED')
      .neq('status', 'DECEASED')
      .neq('status', 'TRANSFERRED')
      .order('name');
    if (error) throw error;
    return (data || []) as Animal[];
  },
  staleTime: 1000 * 60 * 5,
  networkMode: 'offlineFirst',
});

const getFoodOptions = () => queryOptions({
  queryKey: ['operational_lists', 'food_type'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('operational_lists')
      .select('*')
      .ilike('category', 'food_type')
      .eq('is_deleted', false)
      .order('name');
    if (error) throw error;
    return (data || []) as OperationalList[];
  },
  staleTime: 1000 * 60 * 5,
  networkMode: 'offlineFirst',
});

const getLocalDateString = () => format(new Date(), 'yyyy-MM-dd');

export const FeedingScheduleModal: React.FC<FeedingScheduleModalProps> = ({
  isOpen,
  onClose,
  activeCategory,
  manageRoutine,
}) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { data: animals = [], isLoading: loadingAnimals } = useQuery(getAnimalsOptions());
  const { data: foodOptions = [], isLoading: loadingFood } = useQuery(getFoodOptions());

  const filteredAnimals = useMemo(() => {
    return animals.filter(a => {
      if (manageRoutine?.animalId) return a.id === manageRoutine.animalId;
      return (a.category || '').toUpperCase() === activeCategory.toUpperCase();
    });
  }, [animals, activeCategory, manageRoutine]);

  const filteredFoodOptions = useMemo(() => {
    return foodOptions.filter((f: any) => 
      !f.animal_category || String(f.animal_category).toUpperCase().includes(activeCategory.toUpperCase())
    );
  }, [foodOptions, activeCategory]);

  // Continuation date for extension
  const nextContinuationDate = useMemo(() => {
    if (!manageRoutine?.endDate) return getLocalDateString();
    const lastDate = parseISO(manageRoutine.endDate);
    const multiplier = manageRoutine.intervalUnit === 'weeks' ? 7 : 1;
    return format(addDays(lastDate, (manageRoutine.intervalValue || 1) * multiplier), 'yyyy-MM-dd');
  }, [manageRoutine]);

  // Soft-delete routine mutation
  const deleteRoutineMutation = useMutation({
    mutationFn: async () => {
      if (!manageRoutine || !user?.id) return;
      await feedingService.deleteSchedules(manageRoutine.allIds, user.id);
    },
    onSuccess: () => {
      toast.success('Routine soft-deleted successfully.');
      queryClient.invalidateQueries({ queryKey: ['feeding_schedules'] });
      setShowDeleteConfirm(false);
      onClose();
    },
    onError: (err: any) => {
      toast.error(`Delete failed: ${err.message}`);
    },
  });

  // TanStack Form v1 Instance
  const form = useForm({
    defaultValues: {
      animal_id: manageRoutine?.animalId || '',
      food_type: manageRoutine?.foodType || '',
      quantity: manageRoutine?.quantity || (1 as number | ''),
      calci_dust: Boolean(manageRoutine?.supplements?.includes('Calci-Dust')),
      feed_not_required: Boolean(manageRoutine?.feedNotRequired),
      schedule_mode: (manageRoutine?.scheduleMode || 'single') as 'single' | 'interval' | 'specific_days',
      target_date: manageRoutine ? nextContinuationDate : getLocalDateString(),
      interval_value: (manageRoutine?.intervalValue || 1) as number | '',
      interval_unit: (manageRoutine?.intervalUnit || 'days') as 'days' | 'weeks',
      selected_days: (manageRoutine?.selectedDays || []) as number[],
      target_remaining_feeds: (manageRoutine ? manageRoutine.pendingFeeds : 5) as number | '',
    },
    onSubmit: async ({ value }) => {
      try {
        if (!user?.id) throw new Error('Authentication required.');
        if (!value.animal_id) throw new Error('Please select an Animal / Mob.');
        if (!value.feed_not_required && !String(value.food_type).trim()) {
          throw new Error('Please specify a food item.');
        }

        const quantityNum = value.feed_not_required ? 0 : Number(value.quantity) || 1;
        const intervalValNum = Number(value.interval_value) || 1;
        const targetRemainingNum = Number(value.target_remaining_feeds) || 0;
        const routineId = manageRoutine?.routineId || crypto.randomUUID();

        // 1. Guard against reducing feeds in manage mode
        if (manageRoutine && targetRemainingNum < manageRoutine.pendingFeeds) {
          throw new Error(`Cannot reduce remaining feeds below ${manageRoutine.pendingFeeds}. Delete the routine instead.`);
        }

        // 2. If managing an existing routine, update diet on all pending future feeds
        if (manageRoutine && manageRoutine.pendingIds.length > 0) {
          await feedingService.updatePendingDiet(
            manageRoutine.pendingIds,
            {
              food_type: value.feed_not_required ? 'NOT REQUIRED' : String(value.food_type).trim(),
              quantity: quantityNum,
              supplements: value.calci_dust ? 'Calci-Dust' : null,
            },
            user.id
          );
        }

        // 3. Calculate additional feeds to append
        const additionalFeedsCount = manageRoutine
          ? targetRemainingNum - manageRoutine.pendingFeeds
          : targetRemainingNum;

        if (additionalFeedsCount > 0) {
          const datesToSchedule: string[] = [];

          if (value.schedule_mode === 'single') {
            datesToSchedule.push(value.target_date);
          } else if (value.schedule_mode === 'interval') {
            const startDate = parseISO(value.target_date);
            const multiplier = value.interval_unit === 'weeks' ? 7 : 1;
            for (let i = 0; i < additionalFeedsCount; i++) {
              const nextDate = addDays(startDate, i * intervalValNum * multiplier);
              datesToSchedule.push(format(nextDate, 'yyyy-MM-dd'));
            }
          } else if (value.schedule_mode === 'specific_days') {
            const startDate = parseISO(value.target_date);
            if (value.selected_days.length === 0) {
              throw new Error('Please select at least one day of the week.');
            }

            let current = startDate;
            let added = 0;
            let iterations = 0;

            while (added < additionalFeedsCount && iterations < 365) {
              if (value.selected_days.includes(current.getDay())) {
                datesToSchedule.push(format(current, 'yyyy-MM-dd'));
                added++;
              }
              current = addDays(current, 1);
              iterations++;
            }
          }

          const metaPayload = {
            routineId,
            mode: value.schedule_mode,
            intervalVal: intervalValNum,
            intervalUnit: value.interval_unit,
            days: value.selected_days || [],
          };
          const metaString = `[ROUTINE_META:${JSON.stringify(metaPayload)}]`;

          const newSchedules: Partial<FeedingScheduleType>[] = datesToSchedule.map((date) => ({
            animal_id: value.animal_id,
            scheduled_date: date,
            food_type: value.feed_not_required ? 'NOT REQUIRED' : String(value.food_type).trim(),
            quantity: quantityNum,
            quantity_unit: 'item',
            status: 'PENDING',
            supplements: value.calci_dust ? 'Calci-Dust' : null,
            notes: value.feed_not_required ? `${metaString} FAST DAY / NOT REQUIRED` : metaString,
            presentation_method: null,
            is_deleted: false,
            created_by: user.id,
          }));

          await feedingService.bulkCreateSchedules(newSchedules as any, user.id);
        }

        queryClient.invalidateQueries({ queryKey: ['feeding_schedules'] });

        if (manageRoutine) {
          if (additionalFeedsCount > 0) {
            toast.success(`Diet updated & routine extended by ${additionalFeedsCount} feeds.`);
          } else {
            toast.success('Remaining future feeds updated with new diet.');
          }
        } else {
          toast.success('Feeding schedule routine created.');
        }

        form.reset();
        onClose();
      } catch (err: any) {
        toast.error(`Operation failed: ${err.message}`);
      }
    },
  });

  // Re-sync form default values when opening modal
  useEffect(() => {
    if (isOpen) {
      setShowDeleteConfirm(false);
      form.reset({
        animal_id: manageRoutine?.animalId || '',
        food_type: manageRoutine?.foodType || '',
        quantity: manageRoutine?.quantity ?? 1,
        calci_dust: Boolean(manageRoutine?.supplements?.includes('Calci-Dust')),
        feed_not_required: Boolean(manageRoutine?.feedNotRequired),
        schedule_mode: manageRoutine?.scheduleMode || 'single',
        target_date: manageRoutine ? nextContinuationDate : getLocalDateString(),
        interval_value: manageRoutine?.intervalValue ?? 1,
        interval_unit: manageRoutine?.intervalUnit || 'days',
        selected_days: manageRoutine?.selectedDays || [],
        target_remaining_feeds: manageRoutine ? manageRoutine.pendingFeeds : 5,
      });
    }
  }, [isOpen, manageRoutine, nextContinuationDate]);

  if (!isOpen) return null;

  const inputClass = "w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all shadow-xs";

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200 font-sans text-left">
      <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-xl border border-slate-100 flex flex-col my-8">
        
        {/* Header */}
        <div className="p-4 md:p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
              <Utensils size={18} className="text-emerald-400" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm md:text-base tracking-tight">
                {manageRoutine ? `Manage Routine • ${manageRoutine.animalName}` : 'Generate Diet Routine'}
              </h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-0.5">
                Category: {activeCategory} {manageRoutine ? `• ${manageRoutine.pendingFeeds} feeds currently remaining` : ''}
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Delete Confirmation Banner */}
        {showDeleteConfirm && manageRoutine && (
          <div className="p-4 bg-rose-50 border-b border-rose-200 space-y-2 animate-in fade-in duration-150">
            <div className="flex items-center gap-2 text-rose-800 font-bold text-xs">
              <AlertCircle size={16} className="text-rose-600 shrink-0" />
              <span>Confirm Permanent Routine Cancellation</span>
            </div>
            <p className="text-[11px] text-rose-700 leading-relaxed">
              This will soft-delete all <strong>{manageRoutine.pendingFeeds} remaining feeds</strong> in this routine. Past completed feeds in animal records will remain preserved.
            </p>
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1.5 bg-white border border-rose-200 text-rose-800 rounded-lg text-xs font-bold hover:bg-rose-50 cursor-pointer"
              >
                Keep Routine
              </button>
              <button
                type="button"
                onClick={() => deleteRoutineMutation.mutate()}
                disabled={deleteRoutineMutation.isPending}
                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {deleteRoutineMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                <span>Confirm Soft Delete</span>
              </button>
            </div>
          </div>
        )}

        {/* TanStack Form Body */}
        <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="p-4 md:p-6 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar">
          
          {/* Status Overview Banner */}
          {manageRoutine && !showDeleteConfirm && (
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
              <div>
                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-800 block">Intake Quota Progress</span>
                <p className="text-xs font-bold text-emerald-950">
                  {manageRoutine.pendingFeeds} feeds remaining • {manageRoutine.completedFeeds} completed in records
                </p>
              </div>
              <span className="text-[10px] font-mono font-bold bg-white text-emerald-800 px-2 py-0.5 rounded border border-emerald-200">
                {format(parseISO(manageRoutine.startDate), 'd MMM')} &ndash; {format(parseISO(manageRoutine.endDate), 'd MMM')}
              </span>
            </div>
          )}

          {/* Animal / Mob Selector */}
          <form.Field name="animal_id">
            {(field) => (
              <div>
                <label htmlFor={field.name} className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">
                  Animal / Mob *
                </label>
                <select
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className={inputClass}
                  disabled={loadingAnimals || Boolean(manageRoutine)}
                  required
                >
                  <option value="">{loadingAnimals ? 'Loading active roster...' : 'Select Animal / Mob...'}</option>
                  {filteredAnimals.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.species}{a.ring_number ? ` • ${a.ring_number}` : ''})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </form.Field>

          {/* Fast Day / Not Required Toggle */}
          <form.Field name="feed_not_required">
            {(field) => (
              <div
                className="flex items-center gap-3 bg-rose-50/80 p-3 rounded-xl border border-rose-200 cursor-pointer"
                onClick={() => field.handleChange(!field.state.value)}
              >
                <input
                  type="checkbox"
                  id={field.name}
                  name={field.name}
                  checked={field.state.value}
                  onChange={(e) => field.handleChange(e.target.checked)}
                  className="w-4 h-4 text-rose-600 bg-white rounded border-rose-300 focus:ring-rose-500/50 cursor-pointer"
                />
                <span className="text-xs font-bold text-rose-700 uppercase tracking-widest">Fast Day / Not Required</span>
              </div>
            )}
          </form.Field>

          {/* Diet and Quantity Inputs */}
          <form.Subscribe selector={(state) => state.values.feed_not_required}>
            {(notRequired) =>
              !notRequired ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <form.Field name="food_type">
                      {(field) => (
                        <div>
                          <label htmlFor={field.name} className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">
                            Food Item *
                          </label>
                          {filteredFoodOptions.length > 0 ? (
                            <select
                              id={field.name}
                              name={field.name}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => field.handleChange(e.target.value)}
                              className={inputClass}
                              disabled={loadingFood}
                              required
                            >
                              <option value="">{loadingFood ? 'Loading...' : 'Select Diet...'}</option>
                              {filteredFoodOptions.map((f) => (
                                <option key={f.id} value={f.name}>{f.name}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id={field.name}
                              name={field.name}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => field.handleChange(e.target.value)}
                              className={inputClass}
                              placeholder="e.g. Day-Old Chick"
                              required
                            />
                          )}
                        </div>
                      )}
                    </form.Field>

                    <form.Field name="quantity">
                      {(field) => (
                        <div>
                          <label htmlFor={field.name} className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">
                            Ration Quantity *
                          </label>
                          <input
                            id={field.name}
                            name={field.name}
                            type="number"
                            step="0.5"
                            min="0.5"
                            value={field.state.value === '' ? '' : field.state.value}
                            onBlur={() => {
                              field.handleBlur();
                              if (field.state.value === '' || Number(field.state.value) <= 0) {
                                field.handleChange(1);
                              }
                            }}
                            onChange={(e) => {
                              const val = e.target.value;
                              field.handleChange(val === '' ? ('' as any) : parseFloat(val));
                            }}
                            className={inputClass}
                            required
                          />
                        </div>
                      )}
                    </form.Field>
                  </div>

                  <form.Field name="calci_dust">
                    {(field) => (
                      <div
                        className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 cursor-pointer"
                        onClick={() => field.handleChange(!field.state.value)}
                      >
                        <input
                          type="checkbox"
                          id={field.name}
                          name={field.name}
                          checked={field.state.value}
                          onChange={(e) => field.handleChange(e.target.checked)}
                          className="w-4 h-4 text-emerald-600 bg-white rounded border-slate-300 focus:ring-emerald-500/50 cursor-pointer"
                        />
                        <span className="text-xs font-bold text-slate-700 uppercase tracking-widest">Include Calci-Dust Supplement</span>
                      </div>
                    )}
                  </form.Field>
                </>
              ) : null
            }
          </form.Subscribe>

          {/* Schedule Cadence Controls */}
          <div className="pt-3 border-t border-slate-100">
            <form.Field name="schedule_mode">
              {(field) => (
                <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/80 mb-4">
                  <button
                    type="button"
                    onClick={() => field.handleChange('single')}
                    className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all cursor-pointer ${
                      field.state.value === 'single' ? 'bg-white text-slate-900 shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Single
                  </button>
                  <button
                    type="button"
                    onClick={() => field.handleChange('interval')}
                    className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      field.state.value === 'interval' ? 'bg-white text-slate-900 shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    <RefreshCw size={12} /> Interval
                  </button>
                  <button
                    type="button"
                    onClick={() => field.handleChange('specific_days')}
                    className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      field.state.value === 'specific_days' ? 'bg-white text-slate-900 shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    <CalendarClock size={12} /> Set Days
                  </button>
                </div>
              )}
            </form.Field>

            <form.Subscribe selector={(state) => state.values.schedule_mode}>
              {(mode) => (
                <div className="space-y-4 bg-slate-50/80 p-4 rounded-xl border border-slate-200/80">
                  <form.Field name="target_date">
                    {(field) => (
                      <div>
                        <label htmlFor={field.name} className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 ml-1">
                          {manageRoutine ? 'Extension Appends Starting From' : mode === 'single' ? 'Target Date' : 'Routine Start Date'} *
                        </label>
                        <input
                          id={field.name}
                          name={field.name}
                          type="date"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          className={inputClass}
                          required
                        />
                      </div>
                    )}
                  </form.Field>

                  {mode === 'interval' && (
                    <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-200/50">
                      <div className="col-span-2 flex gap-3">
                        <form.Field name="interval_value">
                          {(field) => (
                            <div className="flex-1">
                              <label htmlFor={field.name} className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 ml-1">Repeat Every</label>
                              <input
                                id={field.name}
                                name={field.name}
                                type="number"
                                min="1"
                                value={field.state.value === '' ? '' : field.state.value}
                                onBlur={() => {
                                  field.handleBlur();
                                  if (!field.state.value || Number(field.state.value) < 1) {
                                    field.handleChange(1);
                                  }
                                }}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  field.handleChange(val === '' ? ('' as any) : parseInt(val, 10));
                                }}
                                className={inputClass}
                                required
                              />
                            </div>
                          )}
                        </form.Field>
                        <form.Field name="interval_unit">
                          {(field) => (
                            <div className="flex-[2]">
                              <label htmlFor={field.name} className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 ml-1">Unit</label>
                              <select
                                id={field.name}
                                name={field.name}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(e.target.value as any)}
                                className={inputClass}
                              >
                                <option value="days">Days</option>
                                <option value="weeks">Weeks</option>
                              </select>
                            </div>
                          )}
                        </form.Field>
                      </div>
                    </div>
                  )}

                  {mode === 'specific_days' && (
                    <div className="pt-1 border-t border-slate-200/50">
                      <form.Field name="selected_days">
                        {(field) => {
                          const days = [
                            { label: 'M', value: 1 }, { label: 'T', value: 2 }, { label: 'W', value: 3 },
                            { label: 'T', value: 4 }, { label: 'F', value: 5 }, { label: 'S', value: 6 }, { label: 'S', value: 0 }
                          ];

                          const toggleDay = (val: number) => {
                            const current = (field.state.value || []) as number[];
                            if (current.includes(val)) {
                              field.handleChange(current.filter((d) => d !== val));
                            } else {
                              field.handleChange([...current, val]);
                            }
                          };

                          return (
                            <div className="mb-4">
                              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Select Feed Days *</label>
                              <div className="flex gap-1.5 justify-between">
                                {days.map((d, i) => {
                                  const isSelected = ((field.state.value || []) as number[]).includes(d.value);
                                  return (
                                    <button
                                      key={i}
                                      type="button"
                                      onClick={() => toggleDay(d.value)}
                                      className={`w-10 h-10 rounded-xl font-black text-xs transition-all border cursor-pointer ${
                                        isSelected ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                                      }`}
                                    >
                                      {d.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        }}
                      </form.Field>
                    </div>
                  )}

                  {/* Target Feeds Remaining Input */}
                  <form.Field name="target_remaining_feeds">
                    {(field) => {
                      const currentRemaining = manageRoutine ? manageRoutine.pendingFeeds : 0;
                      const enteredVal = field.state.value;
                      const isReductionError = manageRoutine && enteredVal !== '' && Number(enteredVal) < currentRemaining;

                      return (
                        <div>
                          <label htmlFor={field.name} className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 ml-1">
                            {manageRoutine ? 'Feeds Remaining in Routine *' : 'Total Feeds to Schedule *'}
                          </label>
                          <input
                            id={field.name}
                            name={field.name}
                            type="number"
                            min="1"
                            max="300"
                            placeholder={manageRoutine ? String(currentRemaining) : 'e.g. 10'}
                            value={field.state.value === '' ? '' : field.state.value}
                            onBlur={() => {
                              field.handleBlur();
                              if (field.state.value === '' || Number(field.state.value) < 1) {
                                field.handleChange(manageRoutine ? currentRemaining : 1);
                              }
                            }}
                            onChange={(e) => {
                              const val = e.target.value;
                              field.handleChange(val === '' ? ('' as any) : parseInt(val, 10));
                            }}
                            className={`${inputClass} ${isReductionError ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200' : ''}`}
                            required
                          />

                          {/* Error State when keeper enters less than current remaining */}
                          {isReductionError && (
                            <div className="mt-2 p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-2 animate-in fade-in duration-150">
                              <div className="flex items-start gap-2">
                                <AlertCircle size={15} className="text-rose-600 shrink-0 mt-0.5" />
                                <p className="text-[11px] text-rose-800 font-medium leading-relaxed">
                                  Cannot reduce remaining feeds from <strong>{currentRemaining}</strong> down to <strong>{enteredVal}</strong>. To shorten or cancel this routine, delete the routine instead of editing.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setShowDeleteConfirm(true)}
                                className="w-full py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-black uppercase tracking-widest flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                              >
                                <Trash2 size={13} />
                                <span>Delete Routine Instead</span>
                              </button>
                            </div>
                          )}

                          {manageRoutine && !isReductionError && enteredVal !== '' && Number(enteredVal) > currentRemaining && (
                            <p className="text-[10px] text-emerald-700 font-bold mt-1.5 flex items-center gap-1">
                              <Plus size={11} /> Will append {Number(enteredVal) - currentRemaining} new feeds to sequence.
                            </p>
                          )}
                        </div>
                      );
                    }}
                  </form.Field>

                </div>
              )}
            </form.Subscribe>
          </div>

          {/* Form Submit & Cancel Controls */}
          <div className="pt-2 flex items-center justify-between gap-2.5">
            {manageRoutine ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="p-2.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                title="Soft delete entire routine"
              >
                <Trash2 size={16} />
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors uppercase tracking-widest cursor-pointer"
              >
                Cancel
              </button>
            )}

            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting, state.values]}>
              {([canSubmit, isSubmitting, values]) => {
                const enteredCount = Number((values as any).target_remaining_feeds);
                const currentRemaining = manageRoutine ? manageRoutine.pendingFeeds : 0;
                const isReductionBlocked = manageRoutine && (enteredCount < currentRemaining || isNaN(enteredCount));

                const disableSubmit =
                  !canSubmit ||
                  (isSubmitting as boolean) ||
                  isReductionBlocked ||
                  ((values as any).schedule_mode === 'specific_days' && ((values as any).selected_days || []).length === 0);

                return (
                  <button
                    type="submit"
                    disabled={disableSubmit}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs flex items-center justify-center gap-2 active:scale-[0.99] cursor-pointer"
                  >
                    {isSubmitting ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <CalendarClock size={16} />
                    )}
                    <span>
                      {isSubmitting
                        ? 'PROCESSING...'
                        : isReductionBlocked
                        ? 'REDUCTION NOT ALLOWED'
                        : manageRoutine
                        ? enteredCount > currentRemaining
                          ? `UPDATE & EXTEND (+${enteredCount - currentRemaining})`
                          : 'UPDATE REMAINING FEEDS'
                        : 'CONFIRM ROUTINE'}
                    </span>
                  </button>
                );
              }}
            </form.Subscribe>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FeedingScheduleModal;