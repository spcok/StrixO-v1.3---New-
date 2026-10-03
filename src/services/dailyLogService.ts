import { supabase } from '../lib/supabase';

export const dailyLogService = {
  // ------------------------------------------------------------------
  // CASCADING READ: Fetches logs for the individual AND its parent mob
  // ------------------------------------------------------------------
  async getCascadedLogs(animalId: string, parentGroupId?: string | null) {
    let query = supabase
      .from('daily_logs')
      .select('*, animals(name, species, record_type)')
      .eq('is_deleted', false)
      .order('log_date', { ascending: false });

    // If the animal belongs to a group, pull logs attached to both UUIDs
    if (parentGroupId) {
      query = query.or(`animal_id.eq.${animalId},animal_id.eq.${parentGroupId}`);
    } else {
      query = query.eq('animal_id', animalId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  // ------------------------------------------------------------------
  // STRICT READ: Fetches logs exclusively for the provided UUID
  // ------------------------------------------------------------------
  async getStrictLogs(animalId: string) {
    const { data, error } = await supabase
      .from('daily_logs')
      .select('*, animals(name, species)')
      .eq('animal_id', animalId)
      .eq('is_deleted', false)
      .order('log_date', { ascending: false });
      
    if (error) throw error;
    return data || [];
  },

  // ------------------------------------------------------------------
  // WRITE: Single Log Insertion
  // ------------------------------------------------------------------
  async insertLog(logData: any) {
    const { data, error } = await supabase
      .from('daily_logs')
      .insert([logData])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // ------------------------------------------------------------------
  // BATCH WRITE: Husbandry Multi-Insert (STRICTLY NO MEDICAL)
  // ------------------------------------------------------------------
  async batchInsertHusbandryLogs(logArray: any[]) {
    // Security check to prevent accidental clinical batching
    const isMedicalAttempt = logArray.some(log => log.log_type === 'MEDICAL' || log.log_type === 'PRESCRIPTION');
    if (isMedicalAttempt) {
      throw new Error("Compliance Violation: Medical interventions cannot be batched. They must be logged individually.");
    }

    const { data, error } = await supabase
      .from('daily_logs')
      .insert(logArray)
      .select();

    if (error) throw error;
    return data;
  },

  // ------------------------------------------------------------------
  // LEGACY READ ALIAS
  // ------------------------------------------------------------------
  async getLogsByAnimal(animalId: string, parentGroupId?: string | null) {
    return this.getCascadedLogs(animalId, parentGroupId);
  },

  // ------------------------------------------------------------------
  // WRITE: Commit Log (Optimistic Insertion)
  // ------------------------------------------------------------------
  async commitLog(logData: any) {
    return this.insertLog(logData);
  },

  // ------------------------------------------------------------------
  // WRITE: Update Specific Log Direct
  // ------------------------------------------------------------------
  async updateLogDirect(id: string, updates: any) {
    const { data, error } = await supabase
      .from('daily_logs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}; 