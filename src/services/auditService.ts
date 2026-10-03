import { supabase } from '../lib/supabase';

export const auditService = {
  getValidSections() {
    return ['OWL', 'RAPTOR', 'MAMMAL'];
  },

  async getAuditData(startStr: string, endStr: string) {
    // 1. Fetch target animals AND their related isolation logs in a single relational query
    const { data: targetAnimals, error: animalErr } = await supabase
      .from('animals')
      .select(`
        id, 
        name, 
        species, 
        category,
        isolation_logs (
          isolation_type,
          start_date,
          end_date,
          is_deleted
        )
      `)
      .eq('is_deleted', false)
      .in('category', ['OWL', 'RAPTOR', 'MAMMAL'])
      .order('name');

    if (animalErr) throw new Error(`Animals Query Failed: ${animalErr.message}`);
    if (!targetAnimals || targetAnimals.length === 0) return { animals: [], logs: [] };

    const now = new Date();

    // 2. The Biosecurity Engine: Evaluate the windowed state for every animal
    const processedAnimals = targetAnimals.map(animal => {
      let biosecurityStatus = 'none';

      // Ensure isolation_logs exists and is an array (Supabase returns arrays for one-to-many joins)
      if (animal.isolation_logs && Array.isArray(animal.isolation_logs)) {
        const activeLogs = animal.isolation_logs.filter((log: any) => {
          if (log.is_deleted) return false;
          
          const start = new Date(log.start_date);
          const end = log.end_date ? new Date(log.end_date) : null;
          
          // Windowed logic: Started in the past, and has no end date OR ends in the future
          return start <= now && (end === null || end >= now);
        });

        // Determine hierarchy of flags (Quarantine overrides Isolation)
        if (activeLogs.some((log: any) => String(log.isolation_type).toLowerCase().includes('quarantine'))) {
          biosecurityStatus = 'quarantine';
        } else if (activeLogs.length > 0) {
          biosecurityStatus = 'isolation';
        }
      }

      // Strip the raw logs from memory to keep the frontend bundle light, passing only the status
      const { isolation_logs, ...rest } = animal;
      return { ...rest, biosecurityStatus };
    });

    const animalIds = processedAnimals.map(a => a.id);

    // 3. Chunk UUIDs to prevent URI-Too-Long PostgREST crashes
    const CHUNK_SIZE = 100;
    const chunkedIds = [];
    for (let i = 0; i < animalIds.length; i += CHUNK_SIZE) {
      chunkedIds.push(animalIds.slice(i, i + CHUNK_SIZE));
    }

    const logPromises = chunkedIds.map(chunk => 
      supabase
        .from('daily_logs')
        .select('animal_id, log_date, weight_grams, weight_not_required, feed_details')
        .in('animal_id', chunk)
        .gte('log_date', `${startStr}T00:00:00.000Z`)
        .lte('log_date', `${endStr}T23:59:59.999Z`)
        .eq('is_deleted', false)
    );

    const chunkResults = await Promise.all(logPromises);
    
    const logs = [];
    for (const result of chunkResults) {
      if (result.error) throw new Error(`Logs Chunk Query Failed: ${result.error.message}`);
      if (result.data) logs.push(...result.data);
    }

    return { 
      animals: processedAnimals, 
      logs 
    };
  }
};