import React, { useEffect, useMemo, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { X, Save, Loader2, Scale, Sun, Moon, Check, Feather } from 'lucide-react';
import { toast } from 'sonner'; 
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { weightService } from '../../services/weightService'; 
import { Animal } from '../../types';

const extractErrorText = (errors: any): string | null => {
  if (!errors) return null;
  const errArray = Array.isArray(errors) ? errors : [errors];
  if (errArray.length === 0) return null;
  
  const messages = errArray.map((e: any) => {
    if (typeof e === 'string') return e;
    if (e && typeof e.message === 'string') return e.message;
    return null;
  }).filter(Boolean);
  
  return messages.length > 0 ? messages.join(', ') : null;
};

const FieldError = ({ meta }: { meta: any }) => {
  if (!meta?.errors || meta.errors.length === 0) return null;
  const text = extractErrorText(meta.errors);
  if (!text) return null;
  return <p className="text-[10px] text-rose-500 mt-0.5 font-bold">{text}</p>;
};

const formatLocalDatetime = (dateString?: string) => {
  const d = dateString ? new Date(dateString) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 16);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const getDefaultDateTime = (selectedDate?: string) => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const localTimeStr = now.toISOString().slice(11, 16);
  return selectedDate ? `${selectedDate}T${localTimeStr}` : now.toISOString().slice(0, 16);
};

const GRAMS_PER_OZ = 28.349523125;

const toGrams = (values: any, unit: string) => {
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
  if (!grams) return { weight_g: undefined, weight_kg: undefined, weight_lb: undefined, weight_oz: undefined, weight_eighths: undefined };
  
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

const weightSchema = z.object({
  weight_g: z.number().min(0).optional(),
  weight_kg: z.number().min(0).optional(),
  weight_lb: z.number().min(0).optional(),
  weight_oz: z.number().min(0).max(15, 'Max 15').optional(),
  weight_eighths: z.number().min(0).max(7, 'Max 7').optional(),
  am_pm: z.enum(['AM', 'PM']),
  has_cast: z.boolean().default(false),
  recorded_by: z.string().uuid("ZLA COMPLIANCE: An active staff member must be selected."),
  recorded_at: z.string().min(1, 'Date and time required'),
  notes: z.string().optional(),
}).refine((data) => {
  return toGrams(data, 'lb') > 0 || toGrams(data, 'oz') > 0 || toGrams(data, 'g') > 0 || toGrams(data, 'kg') > 0;
}, {
  message: "Total calculated weight must be greater than 0"
});

type WeightFormValues = z.infer<typeof weightSchema>;

interface WeightModalProps { 
  isOpen: boolean; 
  onClose: () => void; 
  animalId: string; 
  initialData?: any; 
  selectedDate?: string;
}

export function WeightModal({ isOpen, onClose, animalId, initialData, selectedDate }: WeightModalProps) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  // Fraction selector denomination state ('1/8' | '1/4' | '1/2')
  const [fractionDenom, setFractionDenom] = useState<'1/8' | '1/4' | '1/2'>('1/8');

  const { data: activeStaff = [] } = useQuery({
    queryKey: ['active-staff'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, initials')
        .eq('is_active', true)
        .eq('is_deleted', false)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    staleTime: 0,
    gcTime: 1209600000,
    networkMode: 'offlineFirst',
  });

  const animalUnit = useMemo(() => {
    const cachedAnimals = queryClient.getQueryData<Animal[]>(['animals', 'dashboard']) || [];
    const animal = cachedAnimals.find(a => a.id === animalId);
    return animal?.preferred_weight_unit || animal?.weight_unit || 'g'; 
  }, [queryClient, animalId]);

  const insertWeightMutation = useMutation({
    mutationFn: async (values: WeightFormValues) => {
      const payload = {
        id: initialData?.id || crypto.randomUUID(), 
        animal_id: animalId,
        recorded_by: values.recorded_by,
        recorded_at: new Date(values.recorded_at).toISOString(),
        created_by: profile?.id,
        weight_grams: toGrams(values, animalUnit),
        am_pm: values.am_pm,
        has_cast: values.has_cast,
        notes: values.notes || null,
      };
      return await weightService.insertWeightLog(payload);
    },
    onSuccess: () => {
      toast.success(initialData ? 'Bio-weight updated successfully' : 'Bio-weight logged successfully');
      queryClient.invalidateQueries({ queryKey: ['weights'] });
      queryClient.invalidateQueries({ queryKey: ['strict_logs'] });
      queryClient.invalidateQueries({ queryKey: ['weekly_compliance_audit'] });
      onClose();
    },
    onError: (error: any) => toast.error(`Failed to log weight: ${error.message}`),
  });

  const form = useForm<WeightFormValues>({
    defaultValues: {
      ...fromGrams(initialData?.weight_grams, animalUnit),
      am_pm: initialData?.am_pm || (new Date().getHours() < 12 ? 'AM' : 'PM'),
      has_cast: initialData?.has_cast || false,
      recorded_by: initialData?.recorded_by || (initialData as any)?.weighed_by || profile?.id || '',
      recorded_at: initialData?.recorded_at ? formatLocalDatetime(initialData.recorded_at) : getDefaultDateTime(selectedDate),
      notes: initialData?.notes || '',
    },
    validators: { onSubmit: weightSchema },
    onSubmit: async ({ value }) => insertWeightMutation.mutate(value),
  });

  // Calculate displayed value in the box based on active denominator
  const getFractionDisplayValue = (eighths: number | undefined | null) => {
    if (eighths === undefined || eighths === null || eighths === 0) return '';
    if (fractionDenom === '1/2') {
      const val = eighths / 4;
      return Number.isInteger(val) ? val : parseFloat(val.toFixed(2));
    }
    if (fractionDenom === '1/4') {
      const val = eighths / 2;
      return Number.isInteger(val) ? val : parseFloat(val.toFixed(2));
    }
    return eighths;
  };

  // Convert input value into exact integer eighths (0 - 7) for form storage
  const handleFractionInputChange = (rawInput: string, fieldChange: (val: number | undefined) => void) => {
    if (rawInput === '') {
      fieldChange(undefined);
      return;
    }
    const num = parseFloat(rawInput);
    if (isNaN(num)) {
      fieldChange(undefined);
      return;
    }

    if (fractionDenom === '1/2') {
      const halves = Math.min(1, Math.max(0, num));
      fieldChange(Math.round(halves * 4));
    } else if (fractionDenom === '1/4') {
      const quarters = Math.min(3, Math.max(0, num));
      fieldChange(Math.round(quarters * 2));
    } else {
      const e = Math.min(7, Math.max(0, num));
      fieldChange(Math.round(e));
    }
  };

  // Human-readable equivalent label
  const getFractionEquivalentText = (eighths: number | undefined | null) => {
    if (!eighths || eighths <= 0) return null;
    if (eighths === 4) return '1/2 oz (= 4/8 oz)';
    if (eighths === 2) return '1/4 oz (= 2/8 oz)';
    if (eighths === 6) return '3/4 oz (= 6/8 oz)';
    return `${eighths}/8 oz`;
  };

  useEffect(() => {
    if (initialData?.weight_grams) {
      const parsed = fromGrams(initialData.weight_grams, animalUnit);
      if (parsed.weight_eighths === 4) {
        setFractionDenom('1/2');
      } else if (parsed.weight_eighths === 2 || parsed.weight_eighths === 6) {
        setFractionDenom('1/4');
      } else {
        setFractionDenom('1/8');
      }
    } else if (isOpen && !initialData) {
      setFractionDenom('1/8');
      form.reset();
      form.setFieldValue('am_pm', new Date().getHours() < 12 ? 'AM' : 'PM');
      form.setFieldValue('recorded_at', getDefaultDateTime(selectedDate));
      if (profile?.id) {
        form.setFieldValue('recorded_by', profile.id);
      }
    }
  }, [isOpen, form, initialData, selectedDate, profile?.id, animalUnit]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200 font-sans">
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-sm sm:max-w-md max-h-[92vh] flex flex-col overflow-hidden border border-slate-200/80">
        
        {/* Header Bar */}
        <div className="px-4 py-3 sm:px-6 sm:py-3.5 border-b border-slate-100 bg-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl sm:rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center font-black shadow-sm shrink-0">
              <Scale size={16} className="sm:w-5 sm:h-5" />
            </div>
            <div>
              <h2 className="text-xs sm:text-sm font-black text-slate-900 uppercase tracking-tight leading-none">
                {initialData ? 'Edit Bio-Weight' : 'Log Specimen Weight'}
              </h2>
              <p className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 sm:mt-1">
                Protocol Target • <span className="text-emerald-600 font-mono font-black">{animalUnit.toUpperCase()}</span>
              </p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X size={16} className="sm:w-4 sm:h-4" />
          </button>
        </div>

        {/* Form Body - Responsive Scrollable Container */}
        <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="p-4 sm:p-5 space-y-3.5 sm:space-y-4 overflow-y-auto custom-scrollbar flex-1">
          
          {/* Shift Time of Day Selector */}
          <form.Field name="am_pm">
            {(field) => (
              <div className="space-y-1">
                <label className="block text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Shift Weigh Window
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => field.handleChange('AM')}
                    className={`py-2 px-2.5 rounded-xl border-2 font-black text-[10px] sm:text-xs uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      field.state.value === 'AM'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-800 shadow-sm'
                        : 'border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                    }`}
                  >
                    <Sun size={12} className={field.state.value === 'AM' ? 'text-emerald-600' : 'text-slate-400'} />
                    AM Weight
                  </button>
                  <button
                    type="button"
                    onClick={() => field.handleChange('PM')}
                    className={`py-2 px-2.5 rounded-xl border-2 font-black text-[10px] sm:text-xs uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      field.state.value === 'PM'
                        ? 'bg-indigo-50 border-indigo-500 text-indigo-800 shadow-sm'
                        : 'border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                    }`}
                  >
                    <Moon size={12} className={field.state.value === 'PM' ? 'text-indigo-600' : 'text-slate-400'} />
                    PM Weight
                  </button>
                </div>
              </div>
            )}
          </form.Field>

          {/* Conducted By & Recorded At */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
            <form.Field name="recorded_by">
              {(field) => (
                <div className="space-y-1">
                  <label className="block text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Conducted By *
                  </label>
                  <select
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 sm:px-3 sm:py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 cursor-pointer"
                  >
                    <option value="" disabled>-- Select Keeper --</option>
                    {activeStaff.map((staff: any) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name} {staff.initials ? `(${staff.initials})` : ''}
                      </option>
                    ))}
                  </select>
                  <FieldError meta={field.state.meta} />
                </div>
              )}
            </form.Field>

            <form.Field name="recorded_at">
              {(field) => (
                <div className="space-y-1">
                  <label className="block text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Date &amp; Time
                  </label>
                  <input
                    type="datetime-local"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 sm:px-3 sm:py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <FieldError meta={field.state.meta} />
                </div>
              )}
            </form.Field>
          </div>

          {/* Unit-Specific Weight Input Cards */}
          <div className="space-y-1 bg-emerald-50/40 p-3 sm:p-3.5 rounded-xl sm:rounded-2xl border border-emerald-100">
            <div className="flex items-center justify-between mb-1">
              <span className="block text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-emerald-800">
                Measured Scale Reading
              </span>
              
              <div className="flex items-center gap-1.5">
                {/* Fraction Denomination Selector for Imperial Units */}
                {(animalUnit === 'lb' || animalUnit === 'oz') && (
                  <div className="flex items-center bg-white rounded-lg p-0.5 border border-emerald-200/80 shadow-2xs">
                    <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 px-1">Frac:</span>
                    {(['1/8', '1/4', '1/2'] as const).map((denom) => (
                      <button
                        key={denom}
                        type="button"
                        onClick={() => setFractionDenom(denom)}
                        className={`px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-black transition-all cursor-pointer ${
                          fractionDenom === denom
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                        title={`Input fraction as ${denom === '1/2' ? 'Halves' : denom === '1/4' ? 'Quarters' : 'Eighths'}`}
                      >
                        {denom}
                      </button>
                    ))}
                  </div>
                )}
                
                <span className="text-[8px] sm:text-[9px] font-mono bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold">
                  {animalUnit.toUpperCase()}
                </span>
              </div>
            </div>
              
            {animalUnit === 'lb' && (
              <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                <form.Field name="weight_lb">
                  {(field) => (
                    <div className="relative">
                      <input 
                        type="number" 
                        step="1" 
                        value={field.state.value ?? ''} 
                        onChange={(e) => field.handleChange(e.target.value === '' ? undefined : parseFloat(e.target.value))} 
                        className="w-full bg-white pl-2 pr-6 py-2 border border-emerald-200 rounded-lg sm:rounded-xl text-sm sm:text-base font-black text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-center" 
                        placeholder="0" 
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-[10px] uppercase pointer-events-none">lb</span>
                    </div>
                  )}
                </form.Field>

                <form.Field name="weight_oz">
                  {(field) => (
                    <div className="relative">
                      <input 
                        type="number" 
                        step="1" 
                        max="15" 
                        value={field.state.value ?? ''} 
                        onChange={(e) => field.handleChange(e.target.value === '' ? undefined : parseFloat(e.target.value))} 
                        className="w-full bg-white pl-2 pr-6 py-2 border border-emerald-200 rounded-lg sm:rounded-xl text-sm sm:text-base font-black text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-center" 
                        placeholder="0" 
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-[10px] uppercase pointer-events-none">oz</span>
                    </div>
                  )}
                </form.Field>

                <form.Field name="weight_eighths">
                  {(field) => (
                    <div className="relative">
                      <input 
                        type="number" 
                        step="1" 
                        min="0"
                        max={fractionDenom === '1/2' ? 1 : fractionDenom === '1/4' ? 3 : 7} 
                        value={getFractionDisplayValue(field.state.value)} 
                        onChange={(e) => handleFractionInputChange(e.target.value, field.handleChange)} 
                        className="w-full bg-white pl-2 pr-6 py-2 border border-emerald-200 rounded-lg sm:rounded-xl text-sm sm:text-base font-black text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-center" 
                        placeholder="0" 
                      />
                      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 font-black text-[9px] pointer-events-none">
                        {fractionDenom}
                      </span>
                    </div>
                  )}
                </form.Field>
              </div>
            )}

            {animalUnit === 'oz' && (
              <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                <form.Field name="weight_oz">
                  {(field) => (
                    <div className="relative">
                      <input 
                        type="number" 
                        step="1" 
                        value={field.state.value ?? ''} 
                        onChange={(e) => field.handleChange(e.target.value === '' ? undefined : parseFloat(e.target.value))} 
                        className="w-full bg-white pl-2 pr-7 py-2 border border-emerald-200 rounded-lg sm:rounded-xl text-sm sm:text-base font-black text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-center" 
                        placeholder="0" 
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-[10px] uppercase pointer-events-none">oz</span>
                    </div>
                  )}
                </form.Field>

                <form.Field name="weight_eighths">
                  {(field) => (
                    <div className="relative">
                      <input 
                        type="number" 
                        step="1" 
                        min="0"
                        max={fractionDenom === '1/2' ? 1 : fractionDenom === '1/4' ? 3 : 7} 
                        value={getFractionDisplayValue(field.state.value)} 
                        onChange={(e) => handleFractionInputChange(e.target.value, field.handleChange)} 
                        className="w-full bg-white pl-2 pr-7 py-2 border border-emerald-200 rounded-lg sm:rounded-xl text-sm sm:text-base font-black text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-center" 
                        placeholder="0" 
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 font-black text-[9px] pointer-events-none">
                        {fractionDenom}
                      </span>
                    </div>
                  )}
                </form.Field>
              </div>
            )}

            {/* Live conversion confirmation helper */}
            {(animalUnit === 'lb' || animalUnit === 'oz') && (
              <form.Subscribe
                selector={(state) => state.values.weight_eighths}
                children={(eighths) => {
                  const text = getFractionEquivalentText(eighths);
                  if (!text) return null;
                  return (
                    <div className="flex items-center justify-end gap-1.5 pt-1 text-[9px] font-bold text-emerald-700">
                      <span>Equivalent:</span>
                      <span className="font-black bg-emerald-100/90 px-1.5 py-0.5 rounded text-emerald-900">{text}</span>
                    </div>
                  );
                }}
              />
            )}

            {animalUnit === 'g' && (
              <form.Field name="weight_g">
                {(field) => (
                  <div className="relative">
                    <input 
                      type="number" 
                      step="1" 
                      value={field.state.value ?? ''} 
                      onChange={(e) => field.handleChange(e.target.value === '' ? undefined : parseFloat(e.target.value))} 
                      className="w-full bg-white pl-3 pr-8 py-2 border border-emerald-200 rounded-lg sm:rounded-xl text-base sm:text-lg font-black text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" 
                      placeholder="0" 
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs uppercase pointer-events-none">g</span>
                  </div>
                )}
              </form.Field>
            )}
              
            {animalUnit === 'kg' && (
              <form.Field name="weight_kg">
                {(field) => (
                  <div className="relative">
                    <input 
                      type="number" 
                      step="0.001" 
                      value={field.state.value ?? ''} 
                      onChange={(e) => field.handleChange(e.target.value === '' ? undefined : parseFloat(e.target.value))} 
                      className="w-full bg-white pl-3 pr-9 py-2 border border-emerald-200 rounded-lg sm:rounded-xl text-base sm:text-lg font-black text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20" 
                      placeholder="0.000" 
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs uppercase pointer-events-none">kg</span>
                  </div>
                )}
              </form.Field>
            )}
              
            <form.Subscribe
              selector={(state) => state.errorMap}
              children={(errorMap) => {
                const text = extractErrorText(errorMap?.onSubmit);
                if (!text) return null;
                return (
                  <div className="pt-0.5">
                    <p className="text-[10px] text-rose-500 font-bold">{text}</p>
                  </div>
                );
              }}
            />
          </div>

          {/* Cast Pellet Checkbox Card */}
          <form.Field name="has_cast">
            {(field) => (
              <label className="flex items-center gap-2.5 p-2.5 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-100/80 transition-colors">
                <input
                  type="checkbox"
                  checked={field.state.value}
                  onChange={(e) => field.handleChange(e.target.checked)}
                  className="w-3.5 h-3.5 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer shrink-0"
                />
                <span className="text-[11px] sm:text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                  <Feather size={12} className="text-slate-400 shrink-0" />
                  Bird has cast pellet prior to weighing
                </span>
              </label>
            )}
          </form.Field>

          {/* Husbandry Notes */}
          <form.Field name="notes">
            {(field) => (
              <div className="space-y-1">
                <label className="block text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Notes / Observations
                </label>
                <textarea
                  rows={2}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-medium text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 resize-none"
                  placeholder="Flying performance, condition, keeling..."
                />
              </div>
            )}
          </form.Field>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 sm:gap-3 border-t border-slate-100">
            <button 
              type="button" 
              onClick={onClose} 
              className="px-3.5 py-2 bg-slate-100 text-slate-700 font-bold text-[10px] sm:text-xs uppercase tracking-widest rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <form.Subscribe
              selector={(state) => [state.isSubmitting]}
              children={([isSubmitting]) => (
                <button 
                  type="submit" 
                  disabled={insertWeightMutation.isPending || isSubmitting} 
                  className="flex items-center gap-1.5 px-4 sm:px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] sm:text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {insertWeightMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 
                  {initialData ? 'Update' : 'Confirm'}
                </button>
              )}
            />
          </div>
        </form>
      </div>
    </div>
  );
}

export default WeightModal;