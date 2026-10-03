import { supabase } from '../lib/supabase';

export interface FulfillSchedulePayload {
  scheduleId: string;
  animalId: string;
  foodItem: string;
  quantity: number;
  unit?: string;
  feedMethod?: string;
  notes?: string;
  userId: string;
}

export const feedingService = {
  insertFeedLog: async (payload: any | any[]) => {
    try {
      const { data, error } = await supabase
        .from('feed_logs')
        .upsert(payload)
        .select();

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.warn('[Feeding Service] Log insert notice:', error);
      throw error;
    }
  },

  bulkCreateSchedules: async (schedules: any[], userId: string) => {
    try {
      const payload = schedules.map(schedule => ({
        ...schedule,
        created_by: userId,
        modified_by: userId,
      }));

      const { data, error } = await supabase
        .from('feeding_schedules')
        .insert(payload)
        .select();

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('[Feeding Service] Bulk schedule insert failed:', error);
      throw error;
    }
  },

  // Fulfills a specific scheduled feed: marks it COMPLETED and records the intake log
  fulfillSchedule: async ({
    scheduleId,
    animalId,
    foodItem,
    quantity,
    unit = 'item',
    feedMethod = 'Scatter',
    notes,
    userId,
  }: FulfillSchedulePayload) => {
    try {
      // 1. Mark schedule row as COMPLETED
      const { error: scheduleError } = await supabase
        .from('feeding_schedules')
        .update({
          status: 'COMPLETED',
          modified_by: userId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', scheduleId);

      if (scheduleError) throw scheduleError;

      // 2. Commit log entry into feed_logs
      const { data: logData, error: logError } = await supabase
        .from('feed_logs')
        .insert([
          {
            animal_id: animalId,
            date: new Date().toISOString().split('T')[0],
            food_item: foodItem,
            amount_offered: quantity,
            amount_consumed: quantity,
            unit,
            feed_method: feedMethod,
            notes: notes ? `[Scheduled Routine] ${notes}` : '[Scheduled Routine]',
            created_by: userId,
            recorded_by: userId,
          },
        ])
        .select()
        .single();

      if (logError) throw logError;
      return logData;
    } catch (error: any) {
      console.error('[Feeding Service] Fulfill schedule failed:', error);
      throw error;
    }
  },

  // Updates diet for remaining pending feeds in a routine without altering completed feeds
  updatePendingDiet: async (
    scheduleIds: string[],
    newDiet: { food_type: string; quantity: number; supplements?: string | null },
    userId: string
  ) => {
    try {
      const { data, error } = await supabase
        .from('feeding_schedules')
        .update({
          food_type: newDiet.food_type.trim(),
          quantity: Number(newDiet.quantity),
          supplements: newDiet.supplements ? newDiet.supplements.trim() : null,
          modified_by: userId,
          updated_at: new Date().toISOString(),
        })
        .in('id', scheduleIds)
        .eq('status', 'PENDING');

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('[Feeding Service] Update pending diet failed:', error);
      throw error;
    }
  },

  deleteSchedule: async (scheduleId: string, userId: string) => {
    try {
      const { error } = await supabase
        .from('feeding_schedules')
        .update({
          is_deleted: true,
          modified_by: userId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', scheduleId);

      if (error) {
        const { error: hardErr } = await supabase
          .from('feeding_schedules')
          .delete()
          .eq('id', scheduleId);
        if (hardErr) throw hardErr;
      }
      return true;
    } catch (error: any) {
      console.error(`[Feeding Service] Delete failed on ${scheduleId}:`, error);
      throw error;
    }
  },

  deleteSchedules: async (scheduleIds: string[], userId: string) => {
    try {
      const { error } = await supabase
        .from('feeding_schedules')
        .update({
          is_deleted: true,
          modified_by: userId,
          updated_at: new Date().toISOString(),
        })
        .in('id', scheduleIds);

      if (error) {
        const { error: hardErr } = await supabase
          .from('feeding_schedules')
          .delete()
          .in('id', scheduleIds);
        if (hardErr) throw hardErr;
      }
      return true;
    } catch (error: any) {
      console.error('[Feeding Service] Batch delete failed:', error);
      throw error;
    }
  },
};

export default feedingService;