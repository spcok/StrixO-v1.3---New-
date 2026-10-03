import { supabase } from '../lib/supabase';

export interface MistLogPayload {
  id?: string;
  animal_id: string;
  recorded_by: string;
  recorded_at: string;
  created_by?: string | null;
  mist_level: 'LIGHT' | 'MEDIUM' | 'HEAVY';
  am_pm: 'AM' | 'PM';
  notes?: string | null;
  is_deleted?: boolean;
}

export const mistService = {
  /**
   * Fetch mist logs for a specific date window (excluding soft-deleted rows)
   */
  async getMistLogsByDate(startDateISO: string, endDateISO: string) {
    const { data, error } = await supabase
      .from('mist_logs')
      .select('*')
      .or('is_deleted.eq.false,is_deleted.is.null')
      .gte('recorded_at', startDateISO)
      .lte('recorded_at', endDateISO)
      .order('recorded_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * Fetch historical mist logs for an animal (excluding soft-deleted rows)
   */
  async getMistLogsByAnimal(animalId: string, startDate?: string, endDate?: string) {
    let query = supabase
      .from('mist_logs')
      .select('*')
      .eq('animal_id', animalId)
      .or('is_deleted.eq.false,is_deleted.is.null')
      .order('recorded_at', { ascending: false });

    if (startDate) query = query.gte('recorded_at', `${startDate}T00:00:00Z`);
    if (endDate) query = query.lte('recorded_at', `${endDate}T23:59:59.999Z`);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * Insert or update a mist log entry
   */
  async insertMistLog(payload: MistLogPayload) {
    const record: Record<string, any> = {
      animal_id: payload.animal_id,
      recorded_by: payload.recorded_by,
      recorded_at: payload.recorded_at,
      mist_level: payload.mist_level,
      am_pm: payload.am_pm,
      notes: payload.notes?.trim() || null,
      is_deleted: false,
    };

    if (payload.id) {
      record.id = payload.id;
    }

    if (payload.created_by) {
      record.created_by = payload.created_by;
    }

    const { data, error } = await supabase
      .from('mist_logs')
      .upsert(record)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Soft delete a mist log
   */
  async deleteMistLog(id: string) {
    const { error } = await supabase
      .from('mist_logs')
      .update({ is_deleted: true })
      .eq('id', id);

    if (error) {
      const { error: hardDeleteError } = await supabase
        .from('mist_logs')
        .delete()
        .eq('id', id);

      if (hardDeleteError) throw hardDeleteError;
    }

    return true;
  }
};

export default mistService;