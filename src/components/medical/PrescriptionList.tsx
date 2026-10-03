import React, { useState } from 'react';
import { Clock, ChevronRight, Edit2, AlertTriangle, Printer, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';

interface PrescriptionListProps {
  prescriptions: any[];
  onEditOrder: (rx: any) => void;
  onPrintMar: (rx: any, setLocalLoading: (b: boolean) => void) => void;
}

export default function PrescriptionList({ prescriptions, onEditOrder, onPrintMar }: PrescriptionListProps) {
  const [printingId, setPrintingId] = useState<string | null>(null);

  if (prescriptions.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500 shadow-sm">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">No Active Orders</h3>
        <p className="text-xs font-medium mt-1">There are no active clinical orders or prescriptions in the system.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {prescriptions.map((rx: any) => (
        <div key={rx.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h3 className="font-black text-slate-900 leading-tight text-lg">{rx.drug_name}</h3>
              <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{rx.order_type}</p>
            </div>
            <button onClick={() => onEditOrder(rx)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Edit2 size={16} /></button>
          </div>
          <p className="text-sm font-bold text-slate-700 mb-4 bg-slate-50 p-2 rounded-lg border border-slate-100">{rx.dosage} • {rx.route} • {rx.frequency}</p>
          {rx.is_prn && (
            <div className="mb-4 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-amber-700 bg-amber-50 px-2 py-1 rounded w-fit border border-amber-200"><AlertTriangle size={12} /> PRN (As Needed)</div>
          )}
          <div className="bg-white border border-slate-200 p-3 rounded-xl mb-4 flex-1">
            <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Assigned Patient</span>
            <div className="flex justify-between items-center"><span className="font-bold text-slate-800 text-sm">{rx.animals?.name || 'Unknown'}</span><span className="text-[10px] font-bold text-slate-500">{rx.animals?.species}</span></div>
          </div>
          <div className="flex justify-between items-center pt-4 border-t border-slate-100 mt-auto">
            <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1"><Clock size={12} /> {rx.end_date ? `Ends: ${format(parseISO(rx.end_date), 'dd MMM yyyy')}` : 'Ongoing Order'}</span>
            <button 
              disabled={printingId !== null}
              onClick={() => {
                setPrintingId(rx.id);
                onPrintMar(rx, (loading: boolean) => loading ? setPrintingId(rx.id) : setPrintingId(null));
              }}
              className="text-[10px] font-black text-slate-700 bg-slate-100 border border-slate-200 hover:bg-slate-200 uppercase tracking-widest flex items-center gap-1.5 transition-colors px-3 py-1.5 rounded-lg shadow-sm disabled:opacity-50"
            >
              {printingId === rx.id ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />} Print MAR
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}