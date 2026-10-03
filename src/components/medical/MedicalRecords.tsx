import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stethoscope, Loader2, Activity, User, Scale } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';

interface MedicalRecordsProps {
  animalId: string;
}

export default function MedicalRecords({ animalId }: MedicalRecordsProps) {
  // Fetch clinical records specifically for THIS animal
  const { data: records = [], isLoading, error } = useQuery({
    queryKey: ['clinical_records', animalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clinical_records')
        .select('*, users!conducted_by(first_name, last_name)')
        .eq('animal_id', animalId)
        .eq('is_deleted', false)
        .order('record_date', { ascending: false });
        
      if (error) throw error;
      return data || [];
    },
    enabled: !!animalId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-teal-600 w-8 h-8" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-rose-50 text-rose-700 rounded-xl text-xs font-bold text-center border border-rose-200">
        Failed to load medical history.
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400 bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
        <Stethoscope size={32} className="mb-3 opacity-30" />
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">No Clinical History</h3>
        <p className="text-[10px] font-bold mt-1 text-slate-400">This entity has no recorded medical interventions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400 w-32">Date</th>
                <th className="px-5 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400 w-32">Encounter</th>
                <th className="px-5 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400">SOAP Assessment & Plan</th>
                <th className="px-5 py-3 text-[9px] font-black uppercase tracking-widest text-slate-400 w-32 text-right">Vitals & Staff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {records.map((record: any) => (
                <tr key={record.id} className="hover:bg-slate-50/50 transition-colors">
                  
                  {/* Date Column */}
                  <td className="px-5 py-4 text-xs font-bold text-slate-900 whitespace-nowrap align-top">
                    {record.record_date ? format(parseISO(record.record_date), 'dd MMM yyyy') : '--'}
                    <span className="block text-[10px] text-slate-400 mt-0.5">
                      {record.record_date ? format(parseISO(record.record_date), 'HH:mm') : ''}
                    </span>
                  </td>
                  
                  {/* Encounter Column */}
                  <td className="px-5 py-4 align-top">
                     <span className="text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 px-2 py-1 rounded inline-block">
                       {record.encounter_type?.replace('_', ' ') || 'CLINICAL'}
                     </span>
                  </td>
                  
                  {/* SOAP Column */}
                  <td className="px-5 py-4 align-top">
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-slate-900 line-clamp-2">
                        <span className="text-teal-600 mr-1">A:</span>{record.soap_assessment}
                      </p>
                      <p className="text-[11px] font-medium text-slate-600 line-clamp-2">
                        <span className="text-teal-600 mr-1">P:</span>{record.soap_plan}
                      </p>
                    </div>
                  </td>
                  
                  {/* Vitals & Staff Column */}
                  <td className="px-5 py-4 text-right align-top">
                    <div className="flex flex-col items-end gap-1.5">
                      {record.weight_grams > 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                          <Scale size={10} /> {record.weight_grams}g
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                        <User size={10} /> 
                        {record.users ? `${record.users.first_name} ${record.users.last_name}` : record.conductor_role?.replace('_', ' ')}
                      </span>
                    </div>
                  </td>

                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}