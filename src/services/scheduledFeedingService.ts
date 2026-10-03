import { supabase } from '../lib/supabase';
import { FeedLogPayload, DietOutcome, FeedingScheduleWithAnimal } from '../types';

export const scheduledFeedingService = {
  /**
   * 1. THE TRIAGE RADAR (For Dashboard)
   * Fetches the single oldest PENDING schedule per animal to drive the colored badges.
   */
  async getNextPendingFeeds(category?: string): Promise<FeedingScheduleWithAnimal[]> {
    let query = supabase
      .from('feeding_schedules')
      .select('*, animals!inner(id, name, species, category, profile_image_url)')
      .eq('is_deleted', false)
      .eq('status', 'PENDING')
      .order('scheduled_date', { ascending: true }); // Oldest dates surface first

    if (category) {
      // Filter by the joined animal category (e.g., 'EXOTIC')
      query = query.eq('animals.category', category);
    }

    const { data, error } = await query;
    if (error) throw error;
    
    // Client-side reduction: We only want the FIRST (oldest) active schedule per animal
    const uniqueAnimalMap = new Map<string, FeedingScheduleWithAnimal>();
    
    data?.forEach((row: any) => {
      if (!uniqueAnimalMap.has(row.animal_id)) {
        uniqueAnimalMap.set(row.animal_id, row as FeedingScheduleWithAnimal);
      }
    });

    return Array.from(uniqueAnimalMap.values());
  },

  /**
   * 2. THE 1-TAP RESOLUTION ENGINE
   * Atomic handoff: Inserts the historical log AND resolves the pending schedule.
   */
  async resolveScheduledFeed(
    scheduleId: string, 
    outcome: DietOutcome, 
    logPayload: FeedLogPayload
  ) {
    // Determine the status to apply to the schedule table based on the outcome
    const resolvedStatus = outcome === 'EATEN' ? 'COMPLETED' : outcome;

    // A. Insert the immutable historical log (linked via schedule_id)
    // NOTE: If you use 'daily_logs' instead of 'feed_logs' for your core feed tracking, 
    // simply change the table name string below to 'daily_logs'.
    const { data: logData, error: logError } = await supabase
      .from('feed_logs') 
      .insert([{ 
        ...logPayload, 
        outcome: outcome,
        schedule_id: scheduleId 
      }])
      .select()
      .single();

    if (logError) throw logError;

    // B. Promote the schedule row out of PENDING
    const { error: scheduleError } = await supabase
      .from('feeding_schedules')
      .update({ 
        status: resolvedStatus, 
        logged_feed_id: logData.id,
        updated_at: new Date().toISOString() 
      })
      .eq('id', scheduleId);

    if (scheduleError) {
      // Rollback: If the schedule fails to update, delete the log to prevent ghost/duplicate data
      await supabase.from('feed_logs').delete().eq('id', logData.id);
      throw scheduleError;
    }

    return logData;
  },

  /**
   * 3. CYCLE MUTATIONS (Soft-Deletes)
   * Safely truncates or cancels future recurring interval diets.
   */
  async softDeleteFutureSchedules(scheduleIds: string[]) {
    if (!scheduleIds || scheduleIds.length === 0) return;

    const { error } = await supabase
      .from('feeding_schedules')
      .update({ 
        is_deleted: true, 
        updated_at: new Date().toISOString() 
      })
      .in('id', scheduleIds)
      .eq('status', 'PENDING'); // Security gate: never allow soft-deleting completed history

    if (error) throw error;
  }
};