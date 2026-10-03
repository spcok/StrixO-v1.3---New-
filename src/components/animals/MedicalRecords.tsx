import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stethoscope, FileText, Loader2, Calendar, User } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface MedicalRecordsProps {
  animalId: string;
  variant?: 'quick-view' | 'full';
}

export default function MedicalRecords({ animalId, variant = 'quick-view' }: MedicalRecordsProps) {
  // Direct, optimized query to the clinical_records table
  const { data: records = [], isLoading } = useQuery({
    queryKey: ['clinical_records', animalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clinical_records')
        .select('*')
        .eq('animal_id', animalId)
        .eq('is_deleted', false)
        .order('record_date', { ascending: false });
        
      if (error) throw error;
      return data;
    },
    enabled: !!animalId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-emerald-600 w-8 h-8" />
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <Stethoscope size={32} className="mb-3 opacity-50" />
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">No Clinical History</h3>
        <p className="text-[10px] font-bold mt-1">This animal has no recorded medical interventions or vet checks.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
          <Stethoscope className="text-emerald-600" size={18} /> Clinical History
        </h3>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-200">
          {records.length} Records Found
        </span>
      </div>

      <div className="overflow-x-auto custom-scrollbar rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm whitespace-nowrap min-w-[800px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Date & Encounter</th>
              <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">Conductor</th>
              <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest w-1/2">Assessment / SOAP Notes</th>
              <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {records.map((record: any) => (
              <tr key={record.id} className="hover:bg-slate-50/50 transition-colors">
                
                {/* Date and Type */}
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Calendar size={12} className="text-emerald-600" />
                      {new Date(record.record_date).toLocaleDateString()}
                    </span>
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded w-max">
                      {record.encounter_type || record.record_type || 'General Check'}
                    </span>
                  </div>
                </td>

                {/* Conductor */}
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <User size={12} className="text-slate-400" />
                      {record.external_vet_name || 'Internal Staff'}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">
                      {record.conductor_role || 'KEEPER'}
                    </span>
                  </div>
                </td>

                {/* SOAP Assessment Summary */}
                <td className="px-4 py-3 whitespace-normal">
                  <p className="text-xs font-medium text-slate-600 line-clamp-2">
                    {record.soap_assessment || record.soap_subjective || 'No detailed assessment notes provided for this encounter.'}
                  </p>
                </td>

                {/* Actions */}
                <td className="px-4 py-3 text-right">
                  <button className="text-[10px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 px-3 py-1.5 rounded border border-emerald-200 transition-colors">
                    View
                  </button>
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}