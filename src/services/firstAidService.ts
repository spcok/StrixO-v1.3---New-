import { supabase } from '../lib/supabase';

export interface StaffMember {
  id: string;
  name: string | null;
  initials: string | null;
  email: string | null;
}

export const firstAidService = {
  async getFirstAidLogs() {
    const { data, error } = await supabase
      .from('first_aid_logs')
      .select('*')
      .eq('is_deleted', false)
      .order('incident_date', { ascending: false });

    if (error) throw error;
    return data;
  },

  async getStaffMembers(): Promise<StaffMember[]> {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, initials, email')
      .eq('is_deleted', false)
      .order('name');

    if (error) throw error;
    return data;
  },

  // Handles both isolated clinical logs and compound operational incidents securely
  async commitFirstAidLog(firstAidPayload: any, incidentPayload?: any) {
    const promises = [];
    
    // Offline-Safe Relational Linkage
    const firstAidId = crypto.randomUUID();
    let incidentId = null;

    if (incidentPayload) {
      incidentId = crypto.randomUUID();
      promises.push(
        supabase.from('incidents').insert([{
          ...incidentPayload,
          id: incidentId,
          is_deleted: false,
          status: 'OPEN' // Default status for new operational incidents
        }])
      );
    }

    promises.push(
      supabase.from('first_aid_logs').insert([{
        ...firstAidPayload,
        id: firstAidId,
        incident_id: incidentId, // Links seamlessly, even if offline
        is_deleted: false
      }])
    );

    // Fire both requests in parallel. TanStack will queue both if offline.
    const results = await Promise.all(promises);
    
    // Check for errors in the parallel execution
    for (const res of results) {
      if (res.error) throw res.error;
    }

    return true;
  }
};