import React, { useEffect, useMemo } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { X, Save, Loader2, ThermometerSun } from 'lucide-react';
import { toast } from 'sonner'; 
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { temperatureService } from '../../services/temperatureService'; 
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
  if (!meta.errors || meta.errors.length === 0) return null;
  const text = extractErrorText(meta.errors);
  if (!text) return null;
  return <p className="text-xs text-red-500 mt-1 font-bold">{text}</p>;
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

// --- UNIFIED INPUT COMPONENTS ---
function FormInput({ field, label, type = 'text', placeholder, hasError, rightAddon, step }: { field: any; label: string; type?: string; placeholder?: string; hasError?: boolean; rightAddon?: React.ReactNode; step?: string }) {
  const baseClasses = `w-full p-2.5 bg-slate-50 border rounded-xl outline-none text-sm md:text-xs font-bold text-slate-800 transition-all focus:bg-white focus:ring-4 ${
    hasError ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/10' : 'border-slate-200 focus:border-slate-400 focus:ring-slate-900/5'
  }`;

  return (
    <div className="flex flex-col gap-1 w-full">
      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">{label}</label>
      <div className="relative w-full">
        <input
          type={type === 'number' ? 'number' : type}
          inputMode={type === 'number' ? 'decimal' : undefined}
          step={step}
          value={field.state.value ?? ''}
          onBlur={field.handleBlur}
          onChange={(e) => {
            if (type === 'number') field.handleChange(e.target.value === '' ? undefined : parseFloat(e.target.value));
            else field.handleChange(e.target.value);
          }}
          placeholder={placeholder}
          className={baseClasses}
          style={rightAddon ? { paddingRight: '2.5rem' } : undefined}
        />
        {rightAddon && <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center pointer-events-none">{rightAddon}</div>}
      </div>
    </div>
  );
}

function FormSelect({ field, label, options, placeholder, hasError }: { field: any; label: string; options: { value: string | number, label: string }[], placeholder?: string; hasError?: boolean }) {
  return (
    <div className="flex flex-col gap-1 w-full">
      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">{label}</label>
      <select
        value={field.state.value ?? ''}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        className={`w-full p-2.5 bg-slate-50 border rounded-xl outline-none text-sm md:text-xs font-bold text-slate-800 transition-all focus:bg-white focus:ring-4 cursor-pointer appearance-none ${
          hasError ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/10' : 'border-slate-200 focus:border-slate-400 focus:ring-slate-900/5'
        }`}
      >
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map((opt, i) => (
          <option key={i} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

const temperatureSchema = z.object({
  recorded_by: z.string().uuid("ZLA COMPLIANCE: An active staff member must be selected."),
  recorded_at: z.string().min(1, 'Date and time required'),
  temp_ambient: z.number().optional(),
  temp_basking: z.number().optional(),
  temp_cool: z.number().optional(),
}).refine((data) => {
  return data.temp_ambient !== undefined || data.temp_basking !== undefined || data.temp_cool !== undefined;
}, {
  message: "Please enter a valid temperature reading.",
  path: ["temp_ambient"] 
});

type TemperatureFormValues = z.infer<typeof temperatureSchema>;

interface TemperatureModalProps { 
  isOpen: boolean; 
  onClose: () => void; 
  animalId: string; 
  ambientOnly: boolean; 
  initialData?: any; 
  selectedDate?: string; 
}

export function TemperatureModal({ isOpen, onClose, animalId, ambientOnly, initialData, selectedDate }: TemperatureModalProps) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  const { data: activeStaff = [] } = useQuery({
    queryKey: ['active-staff'],
    queryFn: async () => {
      const { data, error } = await supabase.from('users').select('id, name, initials').eq('is_active', true).eq('is_deleted', false);
      if (error) throw error;
      return data || [];
    },
    staleTime: 0, gcTime: 1209600000, networkMode: 'offlineFirst', meta: { persist: true }
  });

  const animal = useMemo(() => {
    const cachedAnimals = queryClient.getQueryData<Animal[]>(['animals', 'dashboard']) || [];
    return cachedAnimals.find(a => a.id === animalId);
  }, [queryClient, animalId]);

  const insertTempMutation = useMutation({
    mutationFn: async (values: TemperatureFormValues) => {
      let tempAverage = null;
      if (values.temp_basking !== undefined && values.temp_cool !== undefined) {
        tempAverage = Math.round(((values.temp_basking + values.temp_cool) / 2) * 10) / 10;
      }

      const payload = {
        id: initialData?.id || crypto.randomUUID(), 
        animal_id: animalId,
        recorded_by: values.recorded_by,
        recorded_at: new Date(values.recorded_at).toISOString(),
        created_by: profile?.id,
        temp_ambient: values.temp_ambient ?? null,
        temp_basking: values.temp_basking ?? null,
        temp_cool: values.temp_cool ?? null,
        temp_average: tempAverage,
      };
      return await temperatureService.insertTemperatureLog(payload);
    },
    onSuccess: () => {
      toast.success(initialData ? 'Temperature updated successfully' : 'Temperature logged successfully');
      queryClient.invalidateQueries({ queryKey: ['temperatures'] });
      onClose();
    },
    onError: (error) => toast.error(`Failed to log temperature: ${error.message}`),
  });

  const form = useForm<TemperatureFormValues>({
    defaultValues: {
      recorded_by: initialData?.recorded_by || '', 
      recorded_at: initialData?.recorded_at ? formatLocalDatetime(initialData.recorded_at) : getDefaultDateTime(selectedDate),
      temp_ambient: initialData?.temp_ambient ?? initialData?.temperature_c ?? undefined,
      temp_basking: initialData?.temp_basking ?? initialData?.basking_temp_c ?? undefined,
      temp_cool: initialData?.temp_cool ?? initialData?.cool_temp_c ?? undefined,
    },
    validators: { onSubmit: temperatureSchema },
    onSubmit: async ({ value }) => insertTempMutation.mutate(value),
  });

  useEffect(() => {
    if (isOpen && !initialData) {
      form.reset();
      form.setFieldValue('recorded_at', getDefaultDateTime(selectedDate));
    }
  }, [isOpen, form, initialData, selectedDate]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center p-0 md:p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white w-full h-[100dvh] md:h-auto md:max-h-[90vh] md:max-w-xl md:rounded-3xl shadow-2xl overflow-hidden flex flex-col border-0 md:border md:border-slate-200 relative">
        
        {/* HEADER */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-orange-50">
              <ThermometerSun size={18} className="text-orange-600" />
            </div>
            <div>
              <h2 className="text-[15px] font-black text-slate-900 uppercase tracking-widest leading-tight">
                {initialData ? 'Edit Temperature' : 'Log Temperature'}
              </h2>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider leading-tight">
                {animal?.name || 'Unknown Animal'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="p-5 overflow-y-auto custom-scrollbar bg-white flex-1 relative space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form.Field name="recorded_at">{(field) => <FormInput field={field} label="Date & Time" type="datetime-local" />}</form.Field>
            <form.Field name="recorded_by">
              {(field) => (
                <FormSelect 
                  field={field} 
                  label="Conducted By *" 
                  placeholder="-- Select Keeper --"
                  options={activeStaff.map((s: any) => ({ value: s.id, label: `${s.name} (${s.initials || '?'})` }))} 
                />
              )}
            </form.Field>
          </div>

          <hr className="border-slate-100" />

          {/* TEMPERATURE INPUTS */}
          <div className="space-y-4">
            {ambientOnly ? (
              <form.Field name="temp_ambient">
                {(field) => <FormInput field={field} label="Ambient Enclosure (°C)" type="number" step="0.1" rightAddon={<span className="text-slate-400 font-bold text-xs">°C</span>} />}
              </form.Field>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <form.Field name="temp_basking">
                    {(field) => <FormInput field={field} label="Basking Spot (°C)" type="number" step="0.1" rightAddon={<span className="text-orange-400 font-bold text-xs">°C</span>} />}
                  </form.Field>
                  <form.Field name="temp_cool">
                    {(field) => <FormInput field={field} label="Cool End (°C)" type="number" step="0.1" rightAddon={<span className="text-blue-400 font-bold text-xs">°C</span>} />}
                  </form.Field>
                </div>

                {/* CALCULATED AVERAGE */}
                <form.Subscribe
                  selector={(state) => ({ basking: state.values.temp_basking, cool: state.values.temp_cool })}
                  children={({ basking, cool }) => {
                    const hasBoth = basking !== undefined && cool !== undefined;
                    const avg = hasBoth ? ((basking + cool) / 2).toFixed(1) : '--';
                    return (
                      <div className="pt-2 flex justify-between items-center">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Calculated Gradient Average</span>
                        <span className={`text-xl font-black ${hasBoth ? 'text-slate-800' : 'text-slate-300'}`}>{avg} <span className="text-sm text-slate-400">°C</span></span>
                      </div>
                    );
                  }}
                />
              </div>
            )}
            
            <form.Subscribe selector={(state) => state.errorMap} children={(errorMap) => {
               const text = extractErrorText(errorMap?.onSubmit);
               return text ? <div className="pt-1"><p className="text-xs text-rose-500 font-bold">{text}</p></div> : null;
            }} />
          </div>

        </form>

        {/* FOOTER */}
        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end bg-white gap-3 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors">
            Cancel
          </button>
          <form.Subscribe selector={(state) => [state.isSubmitting]}>
            {([isSubmitting]) => (
              <button
                onClick={form.handleSubmit}
                disabled={insertTempMutation.isPending}
                className="flex items-center justify-center gap-2 px-8 py-2.5 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-md disabled:opacity-50 bg-orange-600 hover:bg-orange-500"
              >
                {(isSubmitting || insertTempMutation.isPending) ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {initialData ? 'Update Temp' : 'Log Temp'}
              </button>
            )}
          </form.Subscribe>
        </div>

      </div>
    </div>
  );
}