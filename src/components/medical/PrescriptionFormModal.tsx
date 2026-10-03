import React, { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { X, Save, Loader2, AlertCircle, Pill } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';

interface PrescriptionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: any; 
}

function FormInput({ field, label, type = 'text', placeholder, required = false }: { field: any; label: string; type?: string; placeholder?: string; required?: boolean }) {
  const hasError = field.state?.meta?.errors?.length > 0 && field.state?.meta?.isTouched;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {type === 'textarea' ? (
        <textarea
          value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full p-2.5 rounded-xl outline-none transition-all text-sm font-medium shadow-sm h-24 custom-scrollbar resize-none ${hasError ? 'bg-rose-50 border-rose-300 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 text-rose-900' : 'bg-white border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900'}`}
        />
      ) : (
        <input
          type={type}
          value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full p-2.5 rounded-xl outline-none transition-all text-sm font-medium shadow-sm ${hasError ? 'bg-rose-50 border-rose-300 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 text-rose-900' : 'bg-white border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900'}`}
        />
      )}
      {hasError && <span className="text-[10px] font-bold text-rose-500 mt-0.5">{field.state.meta.errors.join(', ')}</span>}
    </div>
  );
}

function FormSelect({ field, label, options, required = false }: { field: any; label: string; options: { value: string, label: string }[]; required?: boolean }) {
  const hasError = field.state?.meta?.errors?.length > 0 && field.state?.meta?.isTouched;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      <select
        value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)}
        className={`w-full p-2.5 rounded-xl outline-none transition-all text-sm font-medium shadow-sm ${hasError ? 'bg-rose-50 border-rose-300 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 text-rose-900' : 'bg-white border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900'}`}
      >
        <option value="" disabled>-- Select Option --</option>
        {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
      {hasError && <span className="text-[10px] font-bold text-rose-500 mt-0.5">{field.state.meta.errors.join(', ')}</span>}
    </div>
  );
}

export default function PrescriptionFormModal({ isOpen, onClose, initialData }: PrescriptionFormModalProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: animals = [] } = useQuery({
    queryKey: ['animals', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('animals').select('id, name, species, location').neq('status', 'ARCHIVED').order('name');
      if (error) throw error;
      return data;
    }
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      if (initialData?.id) {
        const { data, error } = await supabase.from('prescriptions').update(payload).eq('id', initialData.id).select().single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase.from('prescriptions').insert([payload]).select().single();
        if (error) throw error;
        return data;
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['prescriptions'] });
    },
  });

  const form = useForm({
    defaultValues: {
      animal_id: initialData?.animal_id || '',
      order_type: initialData?.order_type || 'PRESCRIPTION',
      drug_name: initialData?.drug_name || '',
      concentration: initialData?.concentration || '',
      dosage: initialData?.dosage || '',
      route: initialData?.route || 'PO',
      frequency: initialData?.frequency || 'SID',
      is_prn: false, // Force false, stripped from UI
      indication: initialData?.indication || '',
      special_instructions: initialData?.special_instructions || '',
      start_date: initialData?.start_date || new Date().toISOString().split('T')[0],
      end_date: initialData?.end_date || '',
      prescribing_vet_name: initialData?.prescribing_vet_name || '',
      prescribing_clinic: initialData?.prescribing_clinic || '',
    },
    onSubmit: async ({ value }) => {
      setSaveError(null);
      try {
        const payload = { ...value } as any;
        if (payload.end_date === '') payload.end_date = null;
        if (payload.order_type !== 'PRESCRIPTION') {
          payload.prescribing_vet_name = null;
          payload.prescribing_clinic = null;
        } else {
          if (payload.prescribing_vet_name === '') payload.prescribing_vet_name = null;
          if (payload.prescribing_clinic === '') payload.prescribing_clinic = null;
        }
        if (!initialData?.id && user) payload.internal_authorizing_user = user.id;

        await saveMutation.mutateAsync(payload);
        onClose();
      } catch (err: any) {
        setSaveError(err.message || "Failed to save prescription. Check database connection.");
      }
    }
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm overflow-hidden flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[95vh] border border-slate-200 overflow-hidden">
        
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-lg"><Pill size={20} /></div>
            <div>
              <h2 className="text-lg font-black text-slate-900 tracking-tight uppercase">
                {initialData ? 'Edit Clinical Order' : 'Provision New Order'}
              </h2>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-0.5">Clinical Dispensary & Formularies</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl transition-colors"><X size={20} /></button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-white">
          {saveError && (
            <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-rose-700">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <div className="text-sm font-medium">{saveError}</div>
            </div>
          )}

          <form id="rx-mutation-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="space-y-6">
            
            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
               <form.Field name="animal_id" validators={{ onChange: ({ value }) => !value ? 'Animal is required' : undefined }}>
                 {(field) => (
                   <FormSelect 
                     field={field as any} 
                     label="Select Animal" 
                     required 
                     options={animals.map((a: any) => ({ value: a.id, label: `${a.name} (${a.species}) - ${a.location || 'No Loc'}` }))} 
                   />
                 )}
               </form.Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              <div className="md:col-span-2">
                <form.Field name="order_type">
                  {(field) => (
                    <div>
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Order Classification</label>
                      <div className="flex bg-slate-50 border border-slate-200 rounded-xl p-1 shadow-sm">
                        <button type="button" onClick={() => field.handleChange('PRESCRIPTION')} className={`flex-1 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${field.state.value === 'PRESCRIPTION' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>Prescription (Rx)</button>
                        <button type="button" onClick={() => field.handleChange('OTC')} className={`flex-1 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${field.state.value === 'OTC' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>Over-the-Counter</button>
                        <button type="button" onClick={() => field.handleChange('SUPPLEMENT')} className={`flex-1 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${field.state.value === 'SUPPLEMENT' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>Supplement</button>
                      </div>
                    </div>
                  )}
                </form.Field>
              </div>

              <form.Subscribe selector={(state) => state.values.order_type}>
                {(orderType) => (
                  orderType === 'PRESCRIPTION' ? (
                    <>
                      <form.Field name="prescribing_vet_name" validators={{ onChange: ({ value }) => !value ? 'Vet name is required for Rx' : undefined }}>
                        {(field) => <FormInput field={field as any} label="Prescribing Veterinarian" required placeholder="e.g. Dr. Sarah Jenkins" />}
                      </form.Field>
                      <form.Field name="prescribing_clinic">
                        {(field) => <FormInput field={field as any} label="Clinic / Practice Name" placeholder="e.g. City Exotics Clinic" />}
                      </form.Field>
                    </>
                  ) : null
                )}
              </form.Subscribe>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-100">
               <form.Field name="drug_name" validators={{ onChange: ({ value }) => !value ? 'Drug name is required' : undefined }}>
                 {(field) => <FormInput field={field as any} label="Drug Name / Formulation" required placeholder="e.g. Meloxicam" />}
               </form.Field>
               <form.Field name="concentration">
                 {(field) => <FormInput field={field as any} label="Concentration (Optional)" placeholder="e.g. 1.5mg/ml" />}
               </form.Field>
               <form.Field name="dosage" validators={{ onChange: ({ value }) => !value ? 'Dosage is required' : undefined }}>
                 {(field) => <FormInput field={field as any} label="Dosage Amount" required placeholder="e.g. 0.3ml or 1 tablet" />}
               </form.Field>
               <form.Field name="route">
                 {(field) => (
                   <FormSelect 
                     field={field as any} 
                     label="Route of Administration" 
                     required
                     options={[
                       { value: 'PO', label: 'Oral (PO)' }, { value: 'IM', label: 'Intramuscular (IM)' }, { value: 'SC', label: 'Subcutaneous (SC)' },
                       { value: 'IV', label: 'Intravenous (IV)' }, { value: 'TOPICAL', label: 'Topical / Skin' }, { value: 'OPHTH', label: 'Eye Drops (Ophth)' },
                       { value: 'INHAL', label: 'Inhaled / Nebulizer' }
                     ]} 
                   />
                 )}
               </form.Field>
               {/* FIX: Removed PRN from Frequency Options entirely */}
               <form.Field name="frequency">
                 {(field) => (
                   <FormSelect 
                     field={field as any} 
                     label="Frequency" 
                     required
                     options={[
                       { value: 'SID', label: 'Once Daily (SID)' }, { value: 'BID', label: 'Twice Daily (BID)' }, { value: 'TID', label: 'Three Times Daily (TID)' },
                       { value: 'QID', label: 'Four Times Daily (QID)' }, { value: 'EOD', label: 'Every Other Day (EOD)' }, { value: 'STAT', label: 'Immediate Single Dose (STAT)' },
                       { value: 'WEEKLY', label: 'Once Weekly' }, { value: 'MONTHLY', label: 'Once Monthly' }
                     ]} 
                   />
                 )}
               </form.Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-100">
               <form.Field name="start_date" validators={{ onChange: ({ value }) => !value ? 'Start date is required' : undefined }}>
                 {(field) => <FormInput field={field as any} label="Start Date" type="date" required />}
               </form.Field>
               <form.Field name="end_date">
                 {(field) => <FormInput field={field as any} label="End Date (Leave blank for ongoing)" type="date" />}
               </form.Field>
               <div className="md:col-span-2">
                 <form.Field name="indication">
                   {(field) => <FormInput field={field as any} label="Clinical Indication / Diagnosis" placeholder="e.g. Bumblefoot treatment" />}
                 </form.Field>
               </div>
               <div className="md:col-span-2">
                 <form.Field name="special_instructions">
                   {(field) => <FormInput field={field as any} label="Special Instructions for Keepers" type="textarea" placeholder="e.g. Hide medication in day-old chick" />}
                 </form.Field>
               </div>
            </div>
          </form>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest hidden sm:block">Verify details against veterinary order</div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button type="button" onClick={onClose} className="w-full sm:w-auto px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors">Cancel</button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <button 
                  type="submit" 
                  form="rx-mutation-form" 
                  disabled={!canSubmit || isSubmitting || saveMutation.isPending} 
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(37,99,235,0.2)]"
                >
                  {(isSubmitting || saveMutation.isPending) ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} 
                  {(isSubmitting || saveMutation.isPending) ? 'Processing...' : (initialData ? 'Update Order' : 'Authorize Order')}
                </button>
              )}
            </form.Subscribe>
          </div>
        </div>

      </div>
    </div>
  );
}