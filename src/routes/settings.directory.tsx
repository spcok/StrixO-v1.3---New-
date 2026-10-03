import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Phone, Plus, Trash2, Mail, MapPin, X, Loader2, Search, Briefcase } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ExternalContact } from '../types';

// ------------------------------------------------------------------
// STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const directoryOptions = queryOptions({
  queryKey: ['external_directory'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('external_directory')
      .select('*')
      .eq('is_deleted', false)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []) as ExternalContact[];
  },
  staleTime: 1000 * 60 * 60,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

export const Route = createFileRoute('/settings/directory')({
  loader: async ({ context: { queryClient } }) => {
    // @ts-ignore
    await queryClient.ensureQueryData(directoryOptions);
  },
  component: DirectoryPage,
});

// ------------------------------------------------------------------
// MAIN COMPONENT
// ------------------------------------------------------------------
export function DirectoryPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const scrollParentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const channel = supabase
      .channel('directory-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'external_directory' }, () => {
        queryClient.invalidateQueries({ queryKey: ['external_directory'] });
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const { data: contacts = [], isLoading } = useQuery(directoryOptions);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('external_directory').update({ is_deleted: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['external_directory'] })
  });

  const filteredContacts = useMemo(() => {
    if (!searchQuery) return contacts;
    const lower = searchQuery.toLowerCase();
    return contacts.filter(c => 
      (c.name || '').toLowerCase().includes(lower) ||
      (c.role || '').toLowerCase().includes(lower) ||
      (c.address || '').toLowerCase().includes(lower)
    );
  }, [contacts, searchQuery]);

  // Window Virtualizer for flat memory footprint
  const rowVirtualizer = useWindowVirtualizer({
    count: filteredContacts.length,
    estimateSize: () => 140, 
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-20">
      
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b-2 border-slate-200 pb-6">
        <div>
          <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">External Directory</h3>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Veterinarians, Contractors & Suppliers</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input 
              type="text" 
              placeholder="Search contacts..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all" 
            />
          </div>
          <button 
            onClick={() => setIsModalOpen(true)} 
            className="w-full sm:w-auto bg-blue-600 text-white px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-sm shrink-0"
          >
            <Plus size={14} /> Add Contact
          </button>
        </div>
      </div>

      <div className="min-h-[500px] relative">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" size={32} /></div>
        ) : filteredContacts.length === 0 ? (
          <div className="py-12 text-center text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-2xl">
            <Phone size={32} className="mx-auto mb-2 opacity-20" />
            <p className="text-xs font-black uppercase tracking-widest">Directory Empty</p>
          </div>
        ) : (
          <div className="w-full relative" style={{ height: rowVirtualizer.getTotalSize() }}>
            {virtualItems.map((virtualRow) => {
              const contact = filteredContacts[virtualRow.index];
              return (
                <div 
                  key={contact.id} 
                  ref={rowVirtualizer.measureElement} 
                  data-index={virtualRow.index} 
                  className="absolute top-0 left-0 w-full py-2"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-blue-300 transition-all shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                    
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                         <Briefcase size={20} className="text-slate-400" />
                      </div>
                      <div>
                        <h4 className="font-black text-slate-900 uppercase tracking-tight text-sm">{contact.name}</h4>
                        <span className="text-[10px] font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded uppercase tracking-widest mt-1 inline-block border border-blue-100">{contact.role}</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 md:w-1/2">
                      {contact.phone && (
                        <div className="flex items-center gap-3 text-xs font-medium text-slate-600">
                          <Phone size={14} className="text-blue-500 shrink-0" /> {contact.phone}
                        </div>
                      )}
                      {contact.email && (
                        <div className="flex items-center gap-3 text-xs font-medium text-slate-600 truncate">
                          <Mail size={14} className="text-blue-500 shrink-0" /> {contact.email}
                        </div>
                      )}
                      {contact.address && (
                        <div className="flex items-start gap-3 text-xs font-medium text-slate-600">
                          <MapPin size={14} className="text-blue-500 shrink-0 mt-0.5" />
                          <span className="leading-snug">{contact.address}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0">
                      <button 
                        onClick={() => { if(window.confirm('Delete contact?')) deleteMutation.mutate(contact.id); }} 
                        disabled={deleteMutation.isPending}
                        className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isModalOpen && <ContactModal onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------
// TANSTACK FORM MODAL
// ------------------------------------------------------------------
function ContactModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      const { error } = await supabase.from('external_directory').insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['external_directory'] });
      onClose();
    },
    onError: (err: any) => setErrorMsg(err.message || 'Failed to save contact.')
  });

  const form = useForm({
    defaultValues: { name: '', role: '', phone: '', email: '', address: '' },
    onSubmit: async ({ value }) => {
      setErrorMsg(null);
      await saveMutation.mutateAsync(value);
    }
  });

  const inputClass = "w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all placeholder-slate-400";
  const labelClass = "block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5";

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
            <Phone size={16} className="text-blue-600" /> New Contact
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"><X size={18} /></button>
        </div>
        
        <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="p-6 space-y-4">
          {errorMsg && <div className="p-3 bg-rose-50 text-rose-700 text-xs font-bold rounded-xl border border-rose-200">{errorMsg}</div>}
          
          <form.Field name="name" children={(field) => (
            <div>
              <label className={labelClass}>Entity / Name *</label>
              <input required value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
            </div>
          )} />
          <form.Field name="role" children={(field) => (
            <div>
              <label className={labelClass}>Specialty / Role *</label>
              <input required placeholder="e.g. Avian Veterinarian" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
            </div>
          )} />
          <div className="grid grid-cols-2 gap-4">
            <form.Field name="phone" children={(field) => (
              <div>
                <label className={labelClass}>Phone Number</label>
                <input value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
              </div>
            )} />
            <form.Field name="email" children={(field) => (
              <div>
                <label className={labelClass}>Email Address</label>
                <input type="email" value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={inputClass} />
              </div>
            )} />
          </div>
          <form.Field name="address" children={(field) => (
            <div>
              <label className={labelClass}>Physical Location</label>
              <textarea value={field.state.value} onBlur={field.handleBlur} onChange={e => field.handleChange(e.target.value)} className={`${inputClass} h-20 resize-none`} />
            </div>
          )} />
          
          <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
             <button type="button" onClick={onClose} className="px-5 py-2.5 text-xs font-bold text-slate-500 uppercase tracking-widest hover:bg-slate-100 rounded-xl">Cancel</button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <button type="submit" disabled={!canSubmit || isSubmitting as boolean || saveMutation.isPending} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl font-black uppercase text-xs tracking-widest hover:bg-blue-700 transition-all shadow-sm disabled:opacity-50">
                  {(isSubmitting || saveMutation.isPending) ? <Loader2 size={16} className="animate-spin" /> : 'Save'}
                </button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </div>
    </div>
  );
}