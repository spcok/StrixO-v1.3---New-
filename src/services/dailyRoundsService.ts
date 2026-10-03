import { supabase } from '../lib/supabase';
import { DailyRound } from '../types';

export const dailyRoundsService = {
  async getRoundsByDateAndShift(date: string, shift: string): Promise<DailyRound[]> {
    const { data, error } = await supabase
      .from('daily_rounds')
      .select('*')
      .eq('date', date)
      .eq('shift', shift)
      .eq('is_deleted', false);

    if (error) throw error;
    return data as DailyRound[];
  },

  async bulkUpsertRounds(rounds: Partial<DailyRound>[]) {
    // 🚨 FIXED: Supabase will now safely use the Primary Key ('id') to determine 
    // whether to INSERT a new round or UPDATE an existing one.
    const { data, error } = await supabase
      .from('daily_rounds')
      .upsert(rounds, { onConflict: 'id' }) 
      .select();

    if (error) throw error;
    return data;
  },

  async updateRoundNotes(roundId: string, notes: string | null) {
    const { data, error } = await supabase
      .from('daily_rounds')
      .update({
        animal_issue_note: notes
      })
      .eq('id', roundId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
};