import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, X, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { Animal, LogType } from '../../types';

interface DailyLogFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  animal: Animal;
  defaultType?: LogType;
}

const LOG_TYPES: LogType[] = [
  'OBSERVATION',
  'FEEDING',
  'WEIGHT',
  'MEDICATION',
  'CLINICAL',
  'BEHAVIOUR',
  'ENCLOSURE',
  'TEMPERATURE'
];

export function DailyLogFormModal({
  isOpen,
  onClose,
  animal,
  defaultType = 'OBSERVATION'
}: DailyLogFormModalProps) {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  const [form, setForm] = useState({
    log_type: defaultType,
    log_date: format(new Date(), 'yyyy-MM-dd HH:mm'),
    notes: '',
    weight_grams: '' as number | string,
    temperature_celsius: '' as number | string,
    food_item: '',
    quantity: 1,
    quantity_unit: 'item'
  });

  const createLogMutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      const timestamp = payload.log_date ? new Date(payload.log_date).toISOString() : new Date().toISOString();

      const feedDetails = payload.log_type === 'FEEDING' ? {
        meals: [{
          food_item: payload.food_item || 'Standard Diet',
          quantity: payload.quantity || 1,
          quantity_unit: payload.quantity_unit || 'item'
        }]
      } : null;

      const { data, error } = await supabase
        .from('daily_logs')
        .insert([{
          animal_id: animal.id,
          log_type: payload.log_type,
          log_date: timestamp,
          notes: payload.notes || null,
          weight_grams: payload.weight_grams !== '' ? Number(payload.weight_grams) : null,
          temperature_celsius: payload.temperature_celsius !== '' ? Number(payload.temperature_celsius) : null,
          feed_details: feedDetails,
          created_by: profile?.name || user?.email || 'Keeper'
        }])
        .select()
        .single();

      if (error) throw error;

      // If weight was recorded, also push to normalized weight_logs
      if (payload.log_type === 'WEIGHT' && payload.weight_grams !== '') {
        await supabase
          .from('weight_logs')
          .insert([{
            animal_id: animal.id,
            weight_grams: Number(payload.weight_grams),
            recorded_at: timestamp,
            recorded_by: user?.id || null,
            notes: payload.notes || null
          }]);
      }

      return data;
    },
    onSuccess: () => {
      toast.success(`Log recorded for ${animal.name}`);
      queryClient.invalidateQueries({ queryKey: ['daily_logs'] });
      queryClient.invalidateQueries({ queryKey: ['weight_logs'] });
      onClose();
    },
    onError: (err: any) => {
      toast.error(`Failed to record log: ${err.message}`);
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createLogMutation.mutate(form);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh] font-sans">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <h3 className="font-black text-slate-900 uppercase tracking-widest text-xs flex items-center gap-2">
            <ClipboardList size={15} className="text-slate-700" />
            Add Husbandry Log — <span className="text-emerald-600">{animal.name}</span>
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto custom-scrollbar space-y-4 text-xs font-medium">
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Log Type *
              </label>
              <select
                required
                value={form.log_type}
                onChange={(e) => setForm(prev => ({ ...prev, log_type: e.target.value as LogType }))}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
              >
                {LOG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Date & Time
              </label>
              <input
                type="datetime-local"
                required
                value={form.log_date}
                onChange={(e) => setForm(prev => ({ ...prev, log_date: e.target.value }))}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
              />
            </div>
          </div>

          {form.log_type === 'WEIGHT' && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Weight in Grams *
              </label>
              <input
                type="number"
                step="0.1"
                required
                placeholder="e.g. 385.0"
                value={form.weight_grams}
                onChange={(e) => setForm(prev => ({ ...prev, weight_grams: e.target.value ? Number(e.target.value) : '' }))}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
              />
            </div>
          )}

          {form.log_type === 'TEMPERATURE' && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Temperature (°C) *
              </label>
              <input
                type="number"
                step="0.1"
                required
                placeholder="e.g. 24.5"
                value={form.temperature_celsius}
                onChange={(e) => setForm(prev => ({ ...prev, temperature_celsius: e.target.value ? Number(e.target.value) : '' }))}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
              />
            </div>
          )}

          {form.log_type === 'FEEDING' && (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Diet Item *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Day-Old Chick"
                  value={form.food_item}
                  onChange={(e) => setForm(prev => ({ ...prev, food_item: e.target.value }))}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Qty</label>
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  value={form.quantity}
                  onChange={(e) => setForm(prev => ({ ...prev, quantity: parseFloat(e.target.value) || 1 }))}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
              Observations & Notes
            </label>
            <textarea
              rows={3}
              placeholder="Record behaviour, physical condition, appetite..."
              value={form.notes}
              onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl uppercase tracking-widest"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createLogMutation.isPending}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-widest rounded-xl disabled:opacity-50 flex items-center gap-2 shadow-sm"
            >
              {createLogMutation.isPending && <Loader2 size={14} className="animate-spin" />}
              <span>Save Log</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default DailyLogFormModal;