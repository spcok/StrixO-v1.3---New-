import { supabase } from '../lib/supabase';

export const temperatureService = {
  // Keeping the function name 'insertTemperatureLog' so we don't break UI imports
  insertTemperatureLog: async (payload: any) => {
    try {
      // FIX: Changed .insert() to .upsert() to handle edits
      const { data, error } = await supabase
        .from('temperature_logs')
        .upsert(payload) 
        .select()
        .single();
        
      if (error) throw error;
      return data;
      
    } catch (error: any) {
      console.warn("Network unreachable or upsert failed. Queueing offline...", error);
      throw error; 
    }
  }
};