import { supabase } from '../lib/supabase';

export const safetyDrillService = {
  async getDrills() {
    const { data, error } = await supabase
      .from('safety_drills')
      .select('*')
      .eq('is_deleted', false)
      .order('drill_date', { ascending: false });

    if (error) throw error;
    return data;
  },

  async getStaffMembers() {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, initials, email')
      .eq('is_deleted', false);

    if (error) throw error;
    return data;
  },

  async getActiveTimesheets() {
    const { data, error } = await supabase
      .from('timesheets')
      .select('user_id')
      .is('clock_out_time', null) 
      .eq('is_deleted', false);
      
    if (error) throw error;
    return data;
  },

  async saveDrill(payload: any) {
    // ENTERPRISE FIX: Lock UUID for offline retries
    if (!payload.id) {
      payload.id = crypto.randomUUID();
    }

    const { data, error } = await supabase
      .from('safety_drills')
      .insert([{
        ...payload,
        is_deleted: false
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  }
};