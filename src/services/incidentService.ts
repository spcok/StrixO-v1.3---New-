import { supabase } from '../lib/supabase';

export const incidentService = {
  async getIncidents() {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('incidents')
      .select('*')
      .eq('is_deleted', false)
      // ENTERPRISE FIX: Keep all OPEN incidents, or any incident from the last 14 days
      .or(`status.eq.OPEN,incident_date.gte.${fourteenDaysAgo}`)
      .order('incident_date', { ascending: false });

    if (error) throw error;
    return data;
  },

  async commitIncident(incidentPayload: any, firstAidPayload?: any) {
    const promises = [];
    
    if (!incidentPayload.id) {
      incidentPayload.id = crypto.randomUUID();
    }
    const incidentId = incidentPayload.id;

    promises.push(
      supabase.from('incidents').insert([{
        ...incidentPayload,
        is_deleted: false,
        status: incidentPayload.status || 'OPEN'
      }])
    );

    if (firstAidPayload) {
      if (!firstAidPayload.id) {
        firstAidPayload.id = crypto.randomUUID();
      }
      promises.push(
        supabase.from('first_aid_logs').insert([{
          ...firstAidPayload,
          incident_id: incidentId,
          is_deleted: false
        }])
      );
    }

    const results = await Promise.all(promises);
    
    for (const res of results) {
      if (res.error) throw res.error;
    }

    return true;
  },

  async resolveIncident(id: string, resolutionNotes: string) {
    const { data, error } = await supabase
      .from('incidents')
      .update({
        status: 'RESOLVED',
        resolution_notes: resolutionNotes
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
};