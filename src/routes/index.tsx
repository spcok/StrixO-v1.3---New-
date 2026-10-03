import { createFileRoute } from '@tanstack/react-router';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import Dashboard from '../components/dashboard/Dashboard';

export const Route = createFileRoute('/')({
  loader: async ({ context: { queryClient } }) => {
    const today = format(new Date(), 'yyyy-MM-dd');

    await Promise.all([
      queryClient.ensureQueryData({
        queryKey: ['animals', 'dashboard'],
        queryFn: async () => {
          const { data, error } = await supabase.from('animals').select('*');
          if (error) throw error;
          return data;
        },
      }),

      queryClient.ensureQueryData({
        queryKey: ['feeding_schedules', 'dashboard', today],
        queryFn: async () => {
          const { data, error } = await supabase
            .from('feeding_schedules')
            .select('*')
            .eq('scheduled_date', today)
            .eq('is_deleted', false);
          if (error) throw error;
          return data;
        },
      }),

      queryClient.ensureQueryData({
        queryKey: ['daily_rounds', 'dashboard', today],
        queryFn: async () => {
          const { data, error } = await supabase
            .from('daily_rounds')
            .select('*')
            .eq('date', today)
            .eq('is_deleted', false);
          if (error) throw error;
          return data;
        },
      })
    ]);
  },
  
  component: Dashboard,
});