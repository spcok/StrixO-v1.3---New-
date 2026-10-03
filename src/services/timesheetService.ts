import { supabase } from '../lib/supabase';

export const timesheetService = {
  async getTimesheets(userIdFilter?: string) {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    let query = supabase
      .from('timesheets')
      .select('*')
      .eq('is_deleted', false)
      // ENTERPRISE FIX: 14-day limit for offline payload size
      .gte('shift_date', fourteenDaysAgo.split('T')[0])
      .order('clock_in_time', { ascending: false });

    if (userIdFilter && userIdFilter !== 'ALL') {
      query = query.eq('user_id', userIdFilter);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async getStaffMembers() {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, initials, email, role')
      .eq('is_deleted', false)
      .order('name');

    if (error) throw error;
    return data;
  },

  async getMyActiveShift(userId: string) {
    if (!userId) return null;
    const { data, error } = await supabase
      .from('timesheets')
      .select('*')
      .eq('user_id', userId)
      .is('clock_out_time', null)
      .eq('is_deleted', false)
      .maybeSingle(); 
      
    if (error) throw error;
    return data;
  },

  async clockIn(payload: { id?: string; shift_date: string; clock_in_time: string }) {
    if (!payload.id) {
      payload.id = crypto.randomUUID();
    }

    const { data, error } = await supabase
      .from('timesheets')
      .insert([{
        ...payload,
        status: 'ACTIVE',
        is_deleted: false
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async clockOut(id: string, clockOutTime: string) {
    const { data, error } = await supabase
      .from('timesheets')
      .update({
        clock_out_time: clockOutTime,
        status: 'APPROVED' // <--- CHANGED FROM 'PENDING_APPROVAL'
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
};