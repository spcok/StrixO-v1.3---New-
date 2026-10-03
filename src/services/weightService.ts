import { supabase } from '../lib/supabase';
import type { WeightLog } from '../types';

export const weightService = {
  async insertWeightLog(payload: Partial<WeightLog> & { id?: string }): Promise<WeightLog> {
    const recordId = payload.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2));
    
    const { data, error } = await supabase
      .from('weight_logs')
      .upsert({
        ...payload,
        id: recordId,
      })
      .select()
      .single();

    if (error) throw error;
    return data as WeightLog;
  },

  async getLatestWeight(animalId: string): Promise<WeightLog | null> {
    if (!animalId) return null;

    const { data, error } = await supabase
      .from('weight_logs')
      .select('*')
      .eq('animal_id', animalId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching latest weight:', error.message);
      return null;
    }
    return (data || null) as WeightLog | null;
  },
};