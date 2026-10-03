import React, { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { FileText, Plus, Trash2, Loader2, Download, X, AlertTriangle } from 'lucide-react';
import { format, parseISO, formatISO, isPast, addDays } from 'date-fns';
import { supabase } from '../lib/supabase';

const zlaOptions = queryOptions({
  queryKey: ['zla_documents'],
  queryFn: async () => {
    const { data, error } = await supabase.from('zla_documents').select('*').eq('is_deleted', false).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  staleTime: 1000 * 60 * 60, gcTime: 1000 * 60 * 60 * 24 * 15, networkMode: 'offlineFirst', meta: { persist: true }
});

export const Route = createFileRoute('/settings/zla')({
  loader: async ({ context: { queryClient } }) => {
    // @ts-ignore
    await queryClient.ensureQueryData(zlaOptions);
  },
  component: ZlaDocumentsPage,
});

export function ZlaDocumentsPage() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { data: documents = [], isLoading } = useQuery(zlaOptions);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('zla_documents').update({ is_deleted: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['zla_documents'] })
  });

  if (isLoading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin text-blue-600" /></div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b-2 border-slate-200 pb-6">
        <div>
          <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
            <FileText className="text-rose-600" size={24} /> ZLA Compliance Documents
          </h3>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Zoo Licensing Act Policies & Certificates</p>
        </div>
        
        <button 
          onClick={() => setIsModalOpen(true)}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2 bg-rose-600 hover:bg-rose-500 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-[0_0_15px_rgba(225,29,72,0.15)]"
        >
          <Plus size={16} /> Upload Document
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {documents.map((doc: any) => {
          const isExpired = doc.valid_until && isPast(parseISO(doc.valid_until));
          const isExpiringSoon = doc.valid_until && isPast(addDays(parseISO(doc.valid_until), -30)) && !isExpired;

          return (
            <div key={doc.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-4 relative overflow-hidden group hover:border-rose-300 transition-all">
              {isExpired && <div className="absolute top-0 right-0 bg-rose-500 text-white text-[8px] font-black uppercase tracking-widest px-3 py-1 rounded-bl-lg">EXPIRED</div>}
              {isExpiringSoon && <div className="absolute top-0 right-0 bg-amber-500 text-white text-[8px] font-black uppercase tracking-widest px-3 py-1 rounded-bl-lg">RENEWAL DUE</div>}
              
              <div>
                <h4 className="font-black text-slate-900 text-sm line-clamp-1 pr-12">{doc.title}</h4>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">{doc.category.replace(/_/g, ' ')}</p>
              </div>

              <div className="flex-1 text-xs font-medium text-slate-600">
                 {doc.valid_until ? (
                   <div className={`flex items-center gap-1.5 ${isExpired ? 'text-rose-600' : isExpiringSoon ? 'text-amber-600' : 'text-emerald-600'}`}>
                     <AlertTriangle size={14} /> Valid Until: {format(parseISO(doc.valid_until), 'dd MMM yyyy')}
                   </div>
                 ) : (
                   <span className="text-slate-400 italic">No expiry date</span>
                 )}
              </div>

              <div className="flex items-center gap-2 pt-4 border-t border-slate-100">
                <a href={doc.document_url} target="_blank" rel="noreferrer" className="flex-1 bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-700 hover:text-rose-700 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-colors">
                  <Download size={14} /> View PDF
                </a>
                <button onClick={() => { if(window.confirm('Delete document?')) deleteMutation.mutate(doc.id); }} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          );
        })}
        {documents.length === 0 && (
          <div className="col-span-full py-12 text-center text-slate-400 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl">
            <FileText size={32} className="mx-auto mb-2 opacity-20" />
            <p className="text-xs font-black uppercase tracking-widest">No documents uploaded</p>
          </div>
        )}
      </div>

      {isModalOpen && <DocumentModal onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}

function DocumentModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      if (!file) throw new Error('A PDF file must be selected.');
      if (!navigator.onLine) throw new Error('File uploads require an active internet connection.');

      const fileExt = file.name.split('.').pop();
      const filePath = `zla/${crypto.randomUUID()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage.from('koa-attachments').upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('koa-attachments').getPublicUrl(filePath);

      const { error } = await supabase.from('zla_documents').insert([{
        ...payload,
        document_url: urlData.publicUrl,
        is_deleted: false
      }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zla_documents'] });
    },
    onError: (err: any) => setErrorMsg(err.message || 'Failed to upload document.')
  });

  const form = useForm({
    defaultValues: { title: '', category: 'RISK_ASSESSMENT', valid_until: '' },
    onSubmit: ({ value }) => {
      setErrorMsg(null);
      // ENTERPRISE FIX: Temporal lock for valid dates + Fire-and-forget UI
      const payload = {
        id: crypto.randomUUID(),
        title: value.title,
        category: value.category,
        valid_until: value.valid_until ? formatISO(parseISO(value.valid_until), { representation: 'date' }) : null,
      };
      saveMutation.mutate(payload);
      onClose();
    }
  });

  const inputClass = "w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20";
  const labelClass = "text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block";

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        <div className="bg-slate-50 p-5 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2"><FileText size={16} className="text-rose-600"/> Upload Compliance Doc</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-900"><X size={16}/></button>
        </div>
        
        <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="p-6 space-y-5">
          {errorMsg && <div className="p-3 bg-rose-50 text-rose-700 text-xs font-bold rounded-xl border border-rose-200">{errorMsg}</div>}

          <form.Field name="title" children={(field) => (
            <div><label className={labelClass}>Document Title</label><input required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} /></div>
          )} />

          <form.Field name="category" children={(field) => (
            <div>
              <label className={labelClass}>ZLA Category</label>
              <select required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass}>
                <option value="RISK_ASSESSMENT">Risk Assessment</option>
                <option value="HUSBANDRY_GUIDELINES">Husbandry Guidelines</option>
                <option value="EMERGENCY_PROTOCOL">Emergency Protocol</option>
                <option value="VETERINARY_PLAN">Veterinary Plan</option>
                <option value="OTHER">Other Compliance Document</option>
              </select>
            </div>
          )} />

          <form.Field name="valid_until" children={(field) => (
            <div><label className={labelClass}>Valid Until / Expiry Date (Optional)</label><input type="date" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} /></div>
          )} />

          <div>
            <label className={labelClass}>PDF File</label>
            <input type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} required className="w-full text-sm text-slate-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-[10px] file:font-black file:uppercase file:tracking-widest file:bg-rose-50 file:text-rose-700 hover:file:bg-rose-100 cursor-pointer border border-slate-200 rounded-xl p-1" />
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
             <button type="button" onClick={onClose} className="px-5 py-2 text-xs font-bold text-slate-500 uppercase tracking-widest hover:bg-slate-100 rounded-xl">Cancel</button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <button type="submit" disabled={!canSubmit || isSubmitting as boolean || !file} className="px-6 py-2 bg-rose-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-rose-500 disabled:opacity-50 flex items-center gap-2">
                  {(isSubmitting || saveMutation.isPending) && <Loader2 size={14} className="animate-spin"/>} Upload
                </button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </div>
    </div>
  );
}