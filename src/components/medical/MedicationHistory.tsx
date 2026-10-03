import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { format, parseISO } from 'date-fns';
import { FileText, Loader2, Download } from 'lucide-react';
import { reportExportService } from '../../services/reportExportService';
import { useAuth } from '../../lib/auth';

export default function MedicationHistory() {
  const { profile } = useAuth();
  const [selectedAnimalId, setSelectedAnimalId] = useState<string>('ALL');
  const [isExporting, setIsExporting] = useState(false);

  // Fetch inactive prescriptions
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['prescriptions', 'history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prescriptions')
        .select('*, animals(id, name, species)')
        .neq('status', 'ACTIVE')
        .order('end_date', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  const uniqueAnimals = useMemo(() => {
    const map = new Map();
    history.forEach((rx: any) => {
      if (rx.animals) map.set(rx.animals.id, rx.animals);
    });
    return Array.from(map.values());
  }, [history]);

  const filteredHistory = useMemo(() => {
    if (selectedAnimalId === 'ALL') return history;
    return history.filter((rx: any) => rx.animal_id === selectedAnimalId);
  }, [history, selectedAnimalId]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const exportData = filteredHistory.map((rx: any) => [
        rx.animals?.name || 'Unknown',
        rx.drug_name,
        rx.dosage,
        `${rx.route} / ${rx.frequency}`,
        rx.start_date ? format(parseISO(rx.start_date), 'dd MMM yyyy') : 'N/A',
        rx.end_date ? format(parseISO(rx.end_date), 'dd MMM yyyy') : 'N/A',
        rx.status
      ]);

      await reportExportService.exportSingleReport({
        title: "Patient Medication History",
        columns: ["Patient", "Drug", "Dosage", "Route/Freq", "Start Date", "End Date", "Status"],
        data: exportData,
        generatorName: profile?.name || 'Staff',
        dateRange: "All Historic Records"
      }, 'MED_HISTORY');
    } catch (error) {
      console.error(error);
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) return <div className="p-12 flex justify-center"><Loader2 size={32} className="animate-spin text-blue-500" /></div>;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col min-h-[500px]">
      <div className="p-4 border-b border-slate-100 bg-slate-50 flex flex-col sm:flex-row justify-between items-center gap-4">
        <select 
          value={selectedAnimalId} 
          onChange={(e) => setSelectedAnimalId(e.target.value)}
          className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold text-slate-700 shadow-sm w-full sm:w-64"
        >
          <option value="ALL">All Historic Patients</option>
          {uniqueAnimals.map(a => <option key={a.id} value={a.id}>{a.name} ({a.species})</option>)}
        </select>
        
        <button 
          onClick={handleExport}
          disabled={isExporting || filteredHistory.length === 0}
          className="flex items-center gap-2 px-5 py-2 bg-slate-900 text-white rounded-xl font-bold uppercase tracking-widest text-[10px] hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50"
        >
          {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} 
          Export Report
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-3">
        {filteredHistory.length === 0 ? (
          <div className="text-center text-slate-400 text-xs font-bold uppercase tracking-widest mt-12">No history found.</div>
        ) : (
          filteredHistory.map((rx: any) => (
            <div key={rx.id} className="p-4 border border-slate-200 rounded-xl flex items-center justify-between hover:bg-slate-50">
              <div>
                <h4 className="font-black text-slate-900">{rx.drug_name} <span className="text-xs text-blue-600 font-bold ml-2">{rx.dosage}</span></h4>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Patient: {rx.animals?.name}</p>
              </div>
              <div className="text-right">
                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${rx.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-300'}`}>
                  {rx.status}
                </span>
                <p className="text-[10px] font-medium text-slate-400 mt-1">
                  {rx.start_date ? format(parseISO(rx.start_date), 'dd/MM/yy') : ''} - {rx.end_date ? format(parseISO(rx.end_date), 'dd/MM/yy') : ''}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}