import { supabase } from '../lib/supabase';
import { addDays, format, parseISO, getDay } from 'date-fns';

export const rotaService = {
  async getRotaData(startStr: string, endStr: string) {
    const [shifts, leave, staff] = await Promise.all([
      supabase
        .from('shifts')
        .select('*')
        .gte('start_time', `${startStr}T00:00:00Z`)
        .lte('start_time', `${endStr}T23:59:59Z`)
        .eq('is_deleted', false),
      supabase
        .from('leave_requests')
        .select('*')
        .gte('start_date', startStr)
        .lte('end_date', endStr)
        .eq('is_deleted', false),
      supabase
        .from('users')
        // ENTERPRISE FIX: Fetch all staff so historical shift grids render correctly
        .select('id, name, initials, role, is_deleted, is_active')
        .order('name')
    ]);
    
    if (shifts.error) throw shifts.error;
    if (leave.error) throw leave.error;
    if (staff.error) throw staff.error;

    return { shifts: shifts.data || [], leave: leave.data || [], staff: staff.data || [] };
  },

  async getStaffRoster() {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, initials, role, is_deleted, is_active')
      .order('name');
    if (error) throw error;
    return data;
  },

  async getShiftPatterns() {
    const { data, error } = await supabase
      .from('shift_patterns')
      .select('*')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async saveShift(payload: any) {
    const { data, error } = await supabase
      .from('shifts')
      .insert([{ ...payload, is_deleted: false }])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteShift(id: string) {
    // 1. Attempt soft-delete first and explicitly check returned rows
    const { data: softData, error: softError } = await supabase
      .from('shifts')
      .update({ is_deleted: true })
      .eq('id', id)
      .select('id');

    if (!softError && softData && softData.length > 0) {
      return true;
    }

    // 2. Fallback to hard delete if soft delete didn't modify rows or errored
    const { data: hardData, error: hardError } = await supabase
      .from('shifts')
      .delete()
      .eq('id', id)
      .select('id');

    if (!hardError && hardData && hardData.length > 0) {
      return true;
    }

    if (softError || hardError) {
      const msg = softError?.message || hardError?.message || 'Database permissions (RLS) prevented shift deletion.';
      throw new Error(msg);
    }

    throw new Error('Shift could not be deleted. Check database permissions or RLS policies.');
  },

  async deleteShifts(ids: string[]) {
    if (!ids || ids.length === 0) return 0;

    // 1. Try bulk soft delete
    const { data: softData, error: softError } = await supabase
      .from('shifts')
      .update({ is_deleted: true })
      .in('id', ids)
      .select('id');

    let deletedCount = softData?.length || 0;
    const deletedIds = new Set((softData || []).map((d: any) => d.id));
    const remainingIds = ids.filter(id => !deletedIds.has(id));

    // 2. If any remaining, try bulk hard delete
    if (remainingIds.length > 0) {
      const { data: hardData } = await supabase
        .from('shifts')
        .delete()
        .in('id', remainingIds)
        .select('id');

      deletedCount += (hardData?.length || 0);
    }

    // 3. If still zero deleted, attempt row-by-row fallback
    if (deletedCount === 0 && ids.length > 0) {
      for (const id of ids) {
        try {
          await this.deleteShift(id);
          deletedCount++;
        } catch (err) {
          console.warn(`Failed individual shift deletion for ${id}:`, err);
        }
      }
    }

    return deletedCount;
  },

  async saveLeave(payload: any) {
    const { data, error } = await supabase
      .from('leave_requests')
      .insert([{ ...payload, is_deleted: false, status: payload.status || 'APPROVED' }])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async savePattern(payload: any) {
    const { data, error } = await supabase
      .from('shift_patterns')
      .insert([{ ...payload, is_deleted: false }])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deployPattern(patternId: string, userId: string, pattern: any, startDateStr: string, days: number = 28) {
    const startDate = parseISO(startDateStr);
    const shifts = [];
    const daysMap = [pattern.sunday, pattern.monday, pattern.tuesday, pattern.wednesday, pattern.thursday, pattern.friday, pattern.saturday];
    const deploymentHorizon = Math.min(days, 90);

    for (let i = 0; i < deploymentHorizon; i++) {
      const date = addDays(startDate, i);
      const dayConfig = daysMap[getDay(date)]; 
      
      if (dayConfig && dayConfig.start && dayConfig.end) {
        const dStr = format(date, 'yyyy-MM-dd');
        shifts.push({
          user_id: userId,
          start_time: `${dStr}T${dayConfig.start}:00Z`,
          end_time: `${dStr}T${dayConfig.end}:00Z`,
          status: 'SCHEDULED',
          is_deleted: false
        });
      }
    }
    
    if (shifts.length === 0) return true; 

    const { error } = await supabase.from('shifts').insert(shifts);
    if (error) throw error;
    return true;
  }
};