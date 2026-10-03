import React, { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { 
  X, 
  Save, 
  Loader2, 
  AlertCircle, 
  Users, 
  User, 
  ShieldAlert, 
  FileBadge, 
  Upload, 
  ExternalLink, 
  CheckCircle2, 
  Trash2 
} from 'lucide-react';
import { z } from 'zod';
import { supabase } from '../../lib/supabase';
import { Animal } from '../../types';
import { ImageUploader } from '../ui/ImageUploader';
import { IUCNBadge } from './IUCNBadge';

// ------------------------------------------------------------------
// ZOD FIREWALL: ZLA 1981 SSSMZP, COTES 2018 & DB INTEGRITY SCHEMA
// ------------------------------------------------------------------
const ZlaComplianceSchema = z.object({
  census_count: z.number().min(1),
  weight_unit: z.string().min(1),
  display_order: z.number(),

  name: z.string().min(1, "ZLA COMPLIANCE: Animal Name is required."),
  species: z.string().min(1, "ZLA COMPLIANCE: Common Species name is required."),
  latin_name: z.string().min(1, "ZLA COMPLIANCE: Scientific/Latin name is required by SSSMZP."),
  gender: z.string().min(1, "ZLA COMPLIANCE: Sex must be recorded (Select 'Unsexed/Unknown' if not determinable)."),
  
  acquisition_date: z.string().min(1, "ZLA COMPLIANCE: Arrival/Acquisition date is strictly required."),
  acquisition_type: z.string().min(1, "ZLA COMPLIANCE: Acquisition method is required."),
  origin: z.string().min(1, "ZLA COMPLIANCE: Previous holding/origin source is required for traceability."),

  cites_annex: z.string().optional().nullable(),
  article_10_number: z.string().optional().nullable(),
  article_10_type: z.string().optional().nullable(),
  article_10_file_url: z.any().optional().nullable(),

  date_of_birth: z.any().optional().nullable(),
  is_dob_unknown: z.boolean().default(false),
  is_dob_estimated: z.boolean().default(false),
  has_no_id: z.boolean().default(false),
  microchip_id: z.string().optional().nullable(),
  ring_number: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  profile_image_url: z.any().optional().nullable(),
  
  record_type: z.string().optional().nullable(),
  parent_group_id: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  flying_weight: z.any().optional().nullable(),
  winter_weight: z.any().optional().nullable(),
  average_target_weight: z.any().optional().nullable(),
  ambient_temp_only: z.boolean().optional().nullable(),
  target_day_temp_c: z.any().optional().nullable(),
  target_night_temp_c: z.any().optional().nullable(),
  water_tipping_temp: z.any().optional().nullable(),
  target_humidity_min_percent: z.any().optional().nullable(),
  target_humidity_max_percent: z.any().optional().nullable(),
  misting_frequency: z.string().optional().nullable(),
  misting_not_required: z.boolean().default(false),
  special_requirements: z.string().optional().nullable(),
  critical_husbandry_notes: z.string().optional().nullable(),
  hazard_rating: z.string().optional().nullable(),
  is_venomous: z.boolean().optional().nullable(),
  red_list_status: z.string().optional().nullable(),
  origin_location: z.string().optional().nullable(),
  is_boarding: z.boolean().optional().nullable(),
  is_quarantine: z.boolean().optional().nullable(),
  lineage_unknown: z.boolean().optional().nullable(),
  sire_id: z.string().optional().nullable(),
  dam_id: z.string().optional().nullable(),
  distribution_map_url: z.any().optional().nullable()
}).superRefine((data, ctx) => {
  const hasFormalId = (data.microchip_id && data.microchip_id.trim() !== '') || (data.ring_number && data.ring_number.trim() !== '');
  if (!data.has_no_id && !hasFormalId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ring_number'], message: "ZLA COMPLIANCE: Provide a Ring/Microchip number, or explicitly declare 'No Formal ID'." });
  }
  if (data.has_no_id && (!data.description || data.description.trim() === '') && !data.profile_image_url) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['description'], message: "ZLA COMPLIANCE: If lacking formal ID, a visual description or profile photo is legally required." });
  }
  if (!data.is_dob_unknown && (!data.date_of_birth || String(data.date_of_birth).trim() === '')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['date_of_birth'], message: "ZLA COMPLIANCE: Date of Birth is required, or explicitly mark it as Approximate/Unknown." });
  }
});

interface AnimalFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: Animal | any; 
}

const TABS = [
  { id: 'core', label: 'Core Details' },
  { id: 'id', label: 'ID & Weight' },
  { id: 'cites', label: 'CITES & Legal' },
  { id: 'husbandry', label: 'Husbandry & Env' },
  { id: 'safety', label: 'Safety & Origin' },
  { id: 'notes', label: 'Notes & Meta' }
] as const;

type TabId = typeof TABS[number]['id'];

function FormInput({ field, label, type = 'text', placeholder, disabled = false }: { field: any; label: string; type?: string; placeholder?: string; disabled?: boolean }) {
  const hasError = field.state?.meta?.errors?.length > 0;
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <label className={`text-[10px] font-black uppercase tracking-widest ${disabled ? 'text-slate-300' : hasError ? 'text-rose-500' : 'text-slate-500'}`}>{label}</label>
      {type === 'textarea' ? (
        <textarea
          value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)}
          placeholder={placeholder} disabled={disabled}
          className={`w-full p-2.5 rounded-xl outline-none transition-all text-sm font-medium shadow-sm h-24 custom-scrollbar resize-none ${disabled ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed' : hasError ? 'bg-rose-50 border-rose-300 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 text-rose-900' : 'bg-white border-slate-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-900'}`}
        />
      ) : (
        <input
          type={type}
          value={field.state.value} onBlur={field.handleBlur} 
          onChange={(e) => field.handleChange(type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
          placeholder={placeholder} disabled={disabled}
          className={`w-full p-2.5 rounded-xl outline-none transition-all text-sm font-medium shadow-sm ${disabled ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed' : hasError ? 'bg-rose-50 border-rose-300 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 text-rose-900' : 'bg-white border-slate-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-900'}`}
        />
      )}
      {hasError && <span className="text-[10px] font-bold text-rose-500">{field.state.meta.errors.join(', ')}</span>}
    </div>
  );
}

function FormSelect({ field, label, options, disabled = false }: { field: any; label: string; options: { value: string, label: string }[]; disabled?: boolean }) {
  const hasError = field.state?.meta?.errors?.length > 0;
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <label className={`text-[10px] font-black uppercase tracking-widest ${disabled ? 'text-slate-300' : hasError ? 'text-rose-500' : 'text-slate-500'}`}>{label}</label>
      <select
        value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} disabled={disabled}
        className={`w-full p-2.5 rounded-xl outline-none transition-all text-sm font-medium shadow-sm ${disabled ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed' : hasError ? 'bg-rose-50 border-rose-300 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 text-rose-900' : 'bg-white border-slate-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-900'}`}
      >
        {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
      {hasError && <span className="text-[10px] font-bold text-rose-500">{field.state.meta.errors.join(', ')}</span>}
    </div>
  );
}

function FormCheckbox({ field, label, disabled = false }: { field: any; label: string; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-100'}`}>
      <input type="checkbox" disabled={disabled} checked={!!field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.checked)} className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 disabled:cursor-not-allowed" />
      <span className="text-xs font-bold text-slate-700 tracking-wide">{label}</span>
    </label>
  );
}

export default function AnimalFormModal({ isOpen, onClose, initialData }: AnimalFormModalProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('core');
  const [systemError, setSystemError] = useState<string | null>(null);
  const [formHasErrors, setFormHasErrors] = useState(false);

  // Document states
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<string>('ARTICLE_10');

  const { data: existingGroups = [] } = useQuery({ 
    queryKey: ['animal-groups'], 
    queryFn: async () => { 
      const { data } = await supabase.from('animals').select('id, name, species').eq('record_type', 'GROUP'); 
      return data || []; 
    }
  });

  const { data: locations = [] } = useQuery({ 
    queryKey: ['operational_lists', 'location'], 
    queryFn: async () => { 
      const { data } = await supabase.from('operational_lists').select('id, name').eq('category', 'location').eq('is_deleted', false); 
      return data || []; 
    }
  });

  const uploadToSupabase = async (file: Blob, folder: string): Promise<string> => {
    const fileExt = file.type === 'image/png' ? 'png' : 'jpg';
    const uuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const fileName = `${folder}/${uuid}.${fileExt}`;
    const { error } = await supabase.storage.from('media').upload(fileName, file, { contentType: file.type || 'image/jpeg' });
    if (error) throw error;
    const { data } = supabase.storage.from('media').getPublicUrl(fileName);
    return data.publicUrl;
  };

  // Immediate close without blocking alert
  const handleImmediateClose = () => {
    setSystemError(null);
    setFormHasErrors(false);
    onClose();
  };

  const executeSaveMutation = useMutation({
    mutationFn: async ({ payload, file, docClassification }: { payload: any; file: File | null; docClassification: string }) => {
      // 1. Parallel profile/map images upload
      const uploadPromises: Promise<any>[] = [];
      if (payload.profile_image_url instanceof Blob) {
        uploadPromises.push(uploadToSupabase(payload.profile_image_url, 'profiles').then(url => payload.profile_image_url = url));
      }
      if (payload.distribution_map_url instanceof Blob) {
        uploadPromises.push(uploadToSupabase(payload.distribution_map_url, 'maps').then(url => payload.distribution_map_url = url));
      }
      if (uploadPromises.length > 0) await Promise.all(uploadPromises);

      // 2. Animal record insert/update
      let savedAnimal: any;
      if (initialData?.id) {
        const { data, error } = await supabase.from('animals').update(payload).eq('id', initialData.id).select().single();
        if (error) throw error;
        savedAnimal = data;
      } else {
        const { data, error } = await supabase.from('animals').insert([payload]).select().single();
        if (error) throw error;
        savedAnimal = data;
      }

      // 3. Storage file upload & document registration
      if (file && savedAnimal?.id) {
        const sanitized = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const docPath = `${savedAnimal.id}/${Date.now()}_${sanitized}`;

        const { error: uploadErr } = await supabase.storage
          .from('animal-documents')
          .upload(docPath, file, { upsert: true });

        if (uploadErr) throw uploadErr;

        const { data: publicUrlData } = supabase.storage
          .from('animal-documents')
          .getPublicUrl(docPath);

        const docUrl = publicUrlData.publicUrl;

        const docPayload = {
          animal_id: savedAnimal.id,
          document_type: docClassification,
          title: docClassification === 'IBR_CERTIFICATE' 
            ? `Independent Bird Register Certificate (${savedAnimal.ring_number || file.name})`
            : `Article 10 Certificate (${payload.article_10_number || file.name})`,
          file_name: file.name,
          file_url: docUrl,
        };

        // Try primary table, with fallback for hyphenated table naming
        let { error: docDbErr } = await supabase.from('animal_documents').insert(docPayload);
        if (docDbErr && docDbErr.message.includes('does not exist')) {
          const res = await supabase.from('animal-documents').insert(docPayload);
          docDbErr = res.error;
        }

        if (docDbErr) throw docDbErr;

        if (docClassification === 'ARTICLE_10') {
          await supabase.from('animals').update({ article_10_file_url: docUrl }).eq('id', savedAnimal.id);
        }
      }

      // 4. Logistics movement logging
      if (initialData?.id && initialData.location !== payload.location) {
        await supabase.from('internal_movements').insert([{
          animal_id: savedAnimal.id,
          from_location: initialData.location || 'Unassigned',
          to_location: payload.location || 'Unassigned',
          reason: 'Location updated via profile edit',
          movement_date: new Date().toISOString(),
          is_deleted: false
        }]);
      }

      return savedAnimal;
    },
    onSuccess: (savedAnimal) => {
      queryClient.invalidateQueries({ queryKey: ['animals'] });
      queryClient.invalidateQueries({ queryKey: ['animal_profile', savedAnimal.id] });
      queryClient.invalidateQueries({ queryKey: ['animal_documents', savedAnimal.id] });
      queryClient.invalidateQueries({ queryKey: ['internal_movements'] });
      handleImmediateClose();
    },
    onError: (err: any) => {
      setSystemError(err.message || 'An error occurred while committing the record.');
    }
  });

  const form = useForm({
    defaultValues: {
      record_type: initialData?.record_type || 'INDIVIDUAL',
      parent_group_id: initialData?.parent_group_id || '',
      census_count: initialData?.census_count ?? 1, 
      name: initialData?.name || '', 
      species: initialData?.species || '', 
      latin_name: initialData?.latin_name || '', 
      category: initialData?.category || 'OWL', 
      location: initialData?.location || '', 
      profile_image_url: initialData?.profile_image_url || (null as string | Blob | null),
      distribution_map_url: initialData?.distribution_map_url || (null as string | Blob | null),
      status: initialData?.status || 'ON_DISPLAY', 
      gender: initialData?.gender || '', 
      date_of_birth: initialData?.date_of_birth || '', 
      is_dob_unknown: initialData?.is_dob_unknown || false, 
      is_dob_estimated: initialData?.is_dob_estimated || false, 
      microchip_id: initialData?.microchip_id || '', 
      ring_number: initialData?.ring_number || '', 
      has_no_id: initialData?.has_no_id || false, 
      weight_unit: initialData?.weight_unit || 'g',
      flying_weight: initialData?.flying_weight || '', 
      winter_weight: initialData?.winter_weight || '', 
      average_target_weight: initialData?.average_target_weight || '', 
      ambient_temp_only: initialData?.ambient_temp_only || false, 
      target_day_temp_c: initialData?.target_day_temp_c || '', 
      target_night_temp_c: initialData?.target_night_temp_c || '', 
      water_tipping_temp: initialData?.water_tipping_temp || '', 
      target_humidity_min_percent: initialData?.target_humidity_min_percent || '', 
      target_humidity_max_percent: initialData?.target_humidity_max_percent || '', 
      misting_frequency: initialData?.misting_frequency || '', 
      misting_not_required: initialData?.misting_not_required || false, 
      special_requirements: initialData?.special_requirements || '', 
      critical_husbandry_notes: initialData?.critical_husbandry_notes || '',
      hazard_rating: initialData?.hazard_rating || 'LOW', 
      is_venomous: initialData?.is_venomous || false, 
      red_list_status: initialData?.red_list_status || 'LC', 
      acquisition_date: initialData?.acquisition_date || '', 
      acquisition_type: initialData?.acquisition_type || 'BRED', 
      origin: initialData?.origin || '', 
      origin_location: initialData?.origin_location || '', 
      is_boarding: initialData?.is_boarding || false, 
      is_quarantine: initialData?.is_quarantine || false, 
      lineage_unknown: initialData?.lineage_unknown || false, 
      sire_id: initialData?.sire_id || '', 
      dam_id: initialData?.dam_id || '', 
      description: initialData?.description || '', 
      display_order: initialData?.display_order ?? '',
      cites_annex: initialData?.cites_annex || 'NON_CITES',
      article_10_number: initialData?.article_10_number || '',
      article_10_type: initialData?.article_10_type || 'NOT_APPLICABLE',
      article_10_file_url: initialData?.article_10_file_url || null
    },
    validators: {
      onSubmit: ZlaComplianceSchema
    },
    onSubmit: async ({ value }) => {
      setSystemError(null);
      setFormHasErrors(false);

      const rawPayload = { ...value } as any;

      const nullableNumerics = ['flying_weight', 'winter_weight', 'average_target_weight', 'target_day_temp_c', 'target_night_temp_c', 'water_tipping_temp', 'target_humidity_min_percent', 'target_humidity_max_percent'];
      nullableNumerics.forEach(key => {
         if (rawPayload[key] === '' || rawPayload[key] === null || rawPayload[key] === undefined) rawPayload[key] = null;
         else rawPayload[key] = Number(rawPayload[key]);
      });

      rawPayload.display_order = (rawPayload.display_order === '' || rawPayload.display_order === null) ? 0 : Number(rawPayload.display_order);
      rawPayload.census_count = (rawPayload.census_count === '' || rawPayload.census_count === null) ? 1 : Number(rawPayload.census_count);

      if (rawPayload.is_dob_unknown || rawPayload.date_of_birth === '') rawPayload.date_of_birth = null;
      if (rawPayload.acquisition_date === '') rawPayload.acquisition_date = null;
      if (rawPayload.parent_group_id === '' || rawPayload.record_type === 'GROUP') rawPayload.parent_group_id = null;
      if (rawPayload.sire_id === '') rawPayload.sire_id = null;
      if (rawPayload.dam_id === '') rawPayload.dam_id = null;
      if (rawPayload.location === '') rawPayload.location = null;
      if (rawPayload.latin_name === '') rawPayload.latin_name = null;
      if (rawPayload.has_no_id) { rawPayload.microchip_id = ''; rawPayload.ring_number = ''; }
      if (rawPayload.article_10_number) rawPayload.article_10_number = rawPayload.article_10_number.trim();
      if (!rawPayload.article_10_number) rawPayload.article_10_number = null;

      try {
        await executeSaveMutation.mutateAsync({
          payload: rawPayload,
          file: docFile,
          docClassification: docType
        });
      } catch (err: any) {
        setSystemError(err.message || 'An error occurred while saving.');
      }
    },
    onSubmitInvalid: () => {
      setFormHasErrors(true);
    }
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
        onClick={handleImmediateClose} 
        aria-hidden="true" 
      />

      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col max-h-[85dvh] border border-slate-200 overflow-hidden relative z-10">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div>
            <h2 className="text-lg font-black text-slate-900 tracking-tight uppercase">
              {initialData ? 'Edit Database Record' : 'Provision New Animal'}
            </h2>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-0.5">
              StrixOS Data Matrix
            </p>
          </div>
          <button 
            type="button"
            onClick={handleImmediateClose} 
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex px-4 pt-2 border-b border-slate-100 bg-slate-50 shrink-0 overflow-x-auto custom-scrollbar">
          {TABS.map(tab => (
            <button 
              key={tab.id} 
              type="button" 
              onClick={() => setActiveTab(tab.id)} 
              className={`px-4 py-3 text-xs font-black uppercase tracking-widest border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === tab.id ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-slate-400 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Form Body */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-white">
          
          {systemError && (
            <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start justify-between gap-3 text-rose-700">
              <div className="flex items-start gap-3">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <div className="text-sm font-medium">{systemError}</div>
              </div>
              <button 
                type="button" 
                onClick={() => setSystemError(null)} 
                className="text-rose-400 hover:text-rose-700 p-1"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {formHasErrors && (
            <div className="mb-6 p-4 bg-rose-50 border-2 border-rose-300 rounded-xl flex items-start gap-3 text-rose-900 shadow-md animate-in fade-in slide-in-from-top-2">
              <ShieldAlert size={20} className="shrink-0 mt-0.5 text-rose-600" />
              <div className="flex flex-col">
                <span className="text-xs font-black uppercase tracking-widest text-rose-600">Compliance Audit Failure</span>
                <span className="text-sm font-bold mt-1">Please review the fields marked in red across the tabs.</span>
              </div>
            </div>
          )}

          <form id="animal-mutation-form" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit(); }} className="space-y-6">
            
            {/* TAB 1: CORE */}
            <div className={activeTab === 'core' ? 'block' : 'hidden'}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="sm:col-span-2 p-5 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col gap-4">
                  <form.Field name="record_type">
                    {(field) => (
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Record Scope</label>
                        <div className="flex bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
                          <button type="button" onClick={() => field.handleChange('INDIVIDUAL')} className={`flex-1 flex justify-center items-center gap-2 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all cursor-pointer ${field.state.value === 'INDIVIDUAL' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}><User size={14} /> Individual</button>
                          <button type="button" onClick={() => { field.handleChange('GROUP'); form.setFieldValue('gender', ''); }} className={`flex-1 flex justify-center items-center gap-2 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all cursor-pointer ${field.state.value === 'GROUP' ? 'bg-blue-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}><Users size={14} /> Parent Group</button>
                        </div>
                      </div>
                    )}
                  </form.Field>
                  <form.Subscribe selector={state => state.values.record_type}>
                    {(recordType) => recordType === 'INDIVIDUAL' && (
                      <div className="pt-2 border-t border-slate-200 border-dashed">
                        <form.Field name="parent_group_id">{(field) => <FormSelect field={field as any} label="Assign to Parent Group / Mob" options={[{ value: '', label: '-- No Group Assignment --' }, ...existingGroups.map((g: any) => ({ value: g.id, label: `${g.name || 'Unnamed'} (${g.species || 'Unknown'})` }))]} />}</form.Field>
                      </div>
                    )}
                  </form.Subscribe>
                </div>

                <form.Field name="name">{(field) => <FormInput field={field as any} label="Animal Name *" placeholder="e.g. Apollo" />}</form.Field>
                <form.Field name="location">{(field) => <FormSelect field={field as any} label="Location" options={[{ value: '', label: '-- Unassigned --' }, ...locations.map((l: any) => ({ value: l.name, label: l.name }))]} />}</form.Field>
                <form.Field name="species">{(field) => <FormInput field={field as any} label="Common Species *" placeholder="e.g. Golden Eagle" />}</form.Field>
                <form.Field name="latin_name">{(field) => <FormInput field={field as any} label="Latin / Scientific Name *" placeholder="e.g. Aquila chrysaetos" />}</form.Field>
                <form.Field name="category">{(field) => <FormSelect field={field as any} label="Category" options={[{ value: 'OWL', label: 'Owl' }, { value: 'RAPTOR', label: 'Raptor' }, { value: 'MAMMAL', label: 'Mammal' }, { value: 'EXOTIC', label: 'Exotic' }]} />}</form.Field>
                <form.Field name="status">{(field) => <FormSelect field={field as any} label="System Status" options={[{ value: 'ON_DISPLAY', label: 'On Display' }, { value: 'OFF_DISPLAY', label: 'Off Display' }, { value: 'QUARANTINE', label: 'Quarantine' }, { value: 'MEDICAL', label: 'Medical' }, { value: 'OFFSITE', label: 'Stored Offsite' }, { value: 'ARCHIVED', label: 'Archived' }]} />}</form.Field>
                
                <form.Subscribe selector={state => state.values.record_type}>
                  {(recordType) => (
                    <form.Field name="gender">
                      {(field) => <FormSelect field={field as any} label="Gender *" disabled={recordType === 'GROUP'} options={[{ value: '', label: '-- Select --' }, { value: 'UNKNOWN', label: 'Unknown / Unsexed' }, { value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }]} />}
                    </form.Field>
                  )}
                </form.Subscribe>

                <form.Field name="census_count">{(field) => <FormInput field={field as any} label="Census Count (Headcount)" type="number" />}</form.Field>
                
                <form.Subscribe selector={(state) => state.values.is_dob_unknown}>
                  {(isUnknown) => (
                    <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <form.Field name="date_of_birth">
                        {(field) => <FormInput field={field as any} label="Date of Birth / Est. Hatch *" type="date" disabled={isUnknown} />}
                      </form.Field>
                      <div className="flex flex-col sm:flex-row gap-4 sm:items-end pb-1">
                        <form.Field name="is_dob_estimated">
                          {(field) => <FormCheckbox field={field as any} disabled={isUnknown} label="Approximate Date" />}
                        </form.Field>
                        <form.Field name="is_dob_unknown">
                          {(field) => <FormCheckbox field={field as any} label="Unknown Date" />}
                        </form.Field>
                      </div>
                    </div>
                  )}
                </form.Subscribe>

                <div className="sm:col-span-2 pt-4 border-t border-slate-100">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Profile Photo (4:3) - Uploads to Storage Bucket</label>
                  <form.Field name="profile_image_url">
                    {(field) => <ImageUploader value={field.state.value} onChange={(file) => field.handleChange(file as any)} requireCrop={true} defaultAspect={4/3} allowToggle={false} />}
                  </form.Field>
                </div>
              </div>
            </div>

            {/* TAB 2: ID & WEIGHT */}
            <div className={activeTab === 'id' ? 'block' : 'hidden'}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <form.Subscribe selector={state => state.values.has_no_id}>
                  {(hasNoId) => (
                    <>
                      <form.Field name="ring_number">{(field) => <FormInput field={field as any} disabled={hasNoId} label="Ring Number *" placeholder="e.g. A10-992" />}</form.Field>
                      <form.Field name="microchip_id">{(field) => <FormInput field={field as any} disabled={hasNoId} label="Microchip ID *" />}</form.Field>
                    </>
                  )}
                </form.Subscribe>
                
                <div className="sm:col-span-2 pb-4 border-b border-slate-100">
                  <form.Field name="has_no_id">{(field) => <FormCheckbox field={field as any} label="Entity holds no formal identification (Disables ID fields)" />}</form.Field>
                </div>
                
                <form.Field name="flying_weight">{(field) => <FormInput field={field as any} label="Flying / Summer Weight" type="number" />}</form.Field>
                <form.Field name="winter_weight">{(field) => <FormInput field={field as any} label="Winter / Resting Weight" type="number" />}</form.Field>
                <form.Field name="average_target_weight">{(field) => <FormInput field={field as any} label="Target Average Weight" type="number" />}</form.Field>
                <form.Field name="weight_unit">{(field) => <FormSelect field={field as any} label="Input Unit" options={[{ value: 'g', label: 'Grams (g)' }, { value: 'kg', label: 'Kilograms (kg)' }, { value: 'oz', label: 'Ounces (oz)' }, { value: 'lb', label: 'Pounds (lb)' }]} />}</form.Field>
              </div>
            </div>

            {/* TAB 3: CITES & STATUTORY LEGAL */}
            <div className={activeTab === 'cites' ? 'block' : 'hidden'}>
              <div className="space-y-6">
                <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-emerald-600 flex items-center justify-center shrink-0 shadow-sm">
                      <FileBadge size={20} />
                    </div>
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-widest text-slate-900">
                        CITES, COTES 2018 &amp; Registry Verification
                      </h3>
                      <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                        Statutory tracking for European Annex levels, Article 10 licensing, and IBR certificates.
                      </p>
                    </div>
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-xl self-start sm:self-auto shadow-sm">
                    UK Wildlife Trade Act
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  <form.Field name="cites_annex">
                    {(field) => (
                      <FormSelect
                        field={field as any}
                        label="CITES Annex Classification"
                        options={[
                          { value: 'NON_CITES', label: 'Non-CITES' },
                          { value: 'ANNEX_A', label: 'Annex A (Strict Legal Mandate)' },
                          { value: 'ANNEX_B', label: 'Annex B' },
                          { value: 'ANNEX_C', label: 'Annex C' }
                        ]}
                      />
                    )}
                  </form.Field>

                  <form.Field name="article_10_number">
                    {(field) => (
                      <FormInput
                        field={field as any}
                        label="APHA Article 10 Certificate No."
                        placeholder="e.g. 589214/01"
                      />
                    )}
                  </form.Field>

                  <form.Field name="article_10_type">
                    {(field) => (
                      <FormSelect
                        field={field as any}
                        label="Certificate Type"
                        options={[
                          { value: 'NOT_APPLICABLE', label: 'Not Applicable' },
                          { value: 'SPECIMEN_SPECIFIC', label: 'Specimen-Specific (Commercial)' },
                          { value: 'TRANSACTION_SPECIFIC', label: 'Transaction-Specific' }
                        ]}
                      />
                    )}
                  </form.Field>
                </div>

                {/* Document Attachment Box */}
                <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block text-[10px] font-black text-slate-600 uppercase tracking-widest">
                        Attach Legal / Registration Certificate
                      </label>
                      <p className="text-[11px] text-slate-500 font-medium">
                        Files are archived in the <span className="font-mono text-slate-700 font-bold">animal-documents</span> persistent bucket.
                      </p>
                    </div>
                    {initialData?.article_10_file_url && (
                      <a
                        href={initialData.article_10_file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-all shadow-sm"
                      >
                        <span>View Existing</span>
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                      Attached Document Classification
                    </label>
                    <select
                      value={docType}
                      onChange={(e) => setDocType(e.target.value)}
                      className="w-full sm:w-1/2 p-2.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="ARTICLE_10">Article 10 Certificate (CITES)</option>
                      <option value="IBR_CERTIFICATE">Independent Bird Register Certificate (IBR)</option>
                      <option value="HATCH_CERTIFICATE">Hatch Certificate / Birth Proof</option>
                      <option value="TRANSFER_DEED">Transfer Deed / Bill of Sale</option>
                      <option value="OTHER">Other Legal File</option>
                    </select>
                  </div>

                  <div className="relative">
                    <label className={`w-full flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
                      docFile 
                        ? 'bg-emerald-50/60 border-emerald-300 text-emerald-900' 
                        : 'bg-white hover:bg-slate-100/50 border-slate-200 text-slate-600 shadow-sm'
                    }`}>
                      {docFile ? (
                        <>
                          <CheckCircle2 size={24} className="text-emerald-600" />
                          <div className="text-center">
                            <span className="text-xs font-black text-slate-900 block">{docFile.name}</span>
                            <span className="text-[10px] font-bold text-slate-500">{(docFile.size / 1024).toFixed(1)} KB • Queued for atomic upload</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDocFile(null);
                            }}
                            className="mt-1 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-rose-600 hover:text-rose-700 hover:underline cursor-pointer"
                          >
                            <Trash2 size={12} /> Remove Attachment
                          </button>
                        </>
                      ) : (
                        <>
                          <Upload size={20} className="text-slate-400" />
                          <div className="text-center">
                            <span className="text-xs font-black uppercase tracking-wider text-slate-800 block">Select Document Scan (PDF, JPG, PNG)</span>
                            <span className="text-[10px] text-slate-400 font-bold">Uploads simultaneously with record commit</span>
                          </div>
                        </>
                      )}
                      <input
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp"
                        onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* TAB 4: HUSBANDRY */}
            <div className={activeTab === 'husbandry' ? 'block' : 'hidden'}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="sm:col-span-2 pb-4 border-b border-slate-100">
                  <form.Field name="ambient_temp_only">{(field) => <FormCheckbox field={field as any} label="Requires Ambient Temperature Only (No localized basking)" />}</form.Field>
                </div>
                <form.Field name="target_day_temp_c">{(field) => <FormInput field={field as any} label="Target Day Temp (°C)" type="number" />}</form.Field>
                <form.Field name="target_night_temp_c">{(field) => <FormInput field={field as any} label="Target Night Temp (°C)" type="number" />}</form.Field>
                <form.Field name="target_humidity_min_percent">{(field) => <FormInput field={field as any} label="Min Humidity (%)" type="number" />}</form.Field>
                <form.Field name="target_humidity_max_percent">{(field) => <FormInput field={field as any} label="Max Humidity (%)" type="number" />}</form.Field>
                <form.Field name="water_tipping_temp">{(field) => <FormInput field={field as any} label="Water Tipping Threshold (°C)" type="number" />}</form.Field>
                
                <div className="sm:col-span-2 border-t border-slate-100 pt-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-500 mb-4">Misting Routine</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
                    <form.Subscribe selector={(state) => state.values.misting_not_required}>
                      {(notRequired) => (
                        <>
                          <form.Field name="misting_frequency">{(field) => <FormInput field={field as any} disabled={notRequired} label="Frequency/Notes" placeholder="e.g. Twice Daily, heavy spray" />}</form.Field>
                          <div className="pt-2">
                             <form.Field name="misting_not_required">{(field) => <FormCheckbox field={field as any} label="Misting Not Required" />}</form.Field>
                          </div>
                        </>
                      )}
                    </form.Subscribe>
                  </div>
                </div>

                <div className="sm:col-span-2 pt-4 border-t border-slate-100">
                  <form.Field name="special_requirements">{(field) => <FormInput field={field as any} label="Special Dietary or Enclosure Requirements" type="textarea" />}</form.Field>
                </div>
                <div className="sm:col-span-2">
                  <form.Field name="critical_husbandry_notes">{(field) => <FormInput field={field as any} label="Critical Husbandry Warnings (Displays in Red on Profile)" type="textarea" />}</form.Field>
                </div>
              </div>
            </div>

            {/* TAB 5: SAFETY & ORIGIN */}
            <div className={activeTab === 'safety' ? 'block' : 'hidden'}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <form.Field name="hazard_rating">{(field) => <FormSelect field={field as any} label="Hazard Rating" options={[{ value: 'LOW', label: 'Low Risk' }, { value: 'MEDIUM', label: 'Medium Risk' }, { value: 'HIGH', label: 'High Risk' }]} />}</form.Field>
                
                <div className="flex gap-4 items-end">
                  <div className="flex-1">
                    <form.Field name="red_list_status">{(field) => <FormSelect field={field as any} label="IUCN Red List Status" options={[{ value: 'NE', label: 'Not Evaluated (NE)' }, { value: 'DD', label: 'Data Deficient (DD)' }, { value: 'LC', label: 'Least Concern (LC)' }, { value: 'NT', label: 'Near Threatened (NT)' }, { value: 'VU', label: 'Vulnerable (VU)' }, { value: 'EN', label: 'Endangered (EN)' }, { value: 'CR', label: 'Critically Endangered (CR)' }, { value: 'EW', label: 'Extinct in Wild (EW)' }, { value: 'EX', label: 'Extinct (EX)' }]} />}</form.Field>
                  </div>
                  <form.Subscribe selector={(state) => state.values.red_list_status}>
                    {(status) => <div className="pb-2.5 h-[64px] flex items-end"><IUCNBadge status={status as any} /></div>}
                  </form.Subscribe>
                </div>

                <div className="sm:col-span-2 pb-4 border-b border-slate-100">
                  <form.Field name="is_venomous">{(field) => <FormCheckbox field={field as any} label="Species is Venomous" />}</form.Field>
                </div>
                
                <form.Field name="acquisition_date">
                  {(field) => <FormInput field={field as any} label="Acquisition / Origin Date *" type="date" />}
                </form.Field>
                
                <form.Field name="acquisition_type">
                  {(field) => <FormSelect field={field as any} label="Acquisition Type *" options={[{ value: '', label: '-- Select --' }, { value: 'CAPTIVE_BRED', label: 'Captive Bred' }, { value: 'WILD_CAUGHT', label: 'Wild Caught / Rescue' }, { value: 'DONATION', label: 'Donated / Rehome' }, { value: 'LOAN', label: 'On Loan' }]} />}
                </form.Field>
                
                <form.Field name="origin">
                  {(field) => <FormInput field={field as any} label="Breeder / Origin Source *" placeholder="e.g. Scottish Owl Centre" />}
                </form.Field>
                
                <form.Field name="origin_location">{(field) => <FormInput field={field as any} label="Origin Area / Country" />}</form.Field>
                
                <div className="sm:col-span-2 pt-4 border-t border-slate-100">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Distribution Map</label>
                  <form.Field name="distribution_map_url">
                    {(field) => <ImageUploader value={field.state.value} onChange={(file) => field.handleChange(file as any)} requireCrop={true} defaultAspect={4/3} allowToggle={true} />}
                  </form.Field>
                </div>

                <div className="sm:col-span-2 grid grid-cols-2 gap-5 pt-2 border-t border-slate-100 mt-2">
                  <form.Field name="is_boarding">{(field) => <FormCheckbox field={field as any} label="Currently Boarding" />}</form.Field>
                  <form.Field name="is_quarantine">{(field) => <FormCheckbox field={field as any} label="Requires Strict Quarantine" />}</form.Field>
                </div>
              </div>
            </div>

            {/* TAB 6: NOTES */}
            <div className={activeTab === 'notes' ? 'block' : 'hidden'}>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="sm:col-span-2">
                    <form.Field name="lineage_unknown">{(field) => <FormCheckbox field={field as any} label="Lineage/Parentage is Unknown" />}</form.Field>
                  </div>
                  <form.Subscribe selector={(state) => state.values.lineage_unknown}>
                    {(lineage_unknown) => (
                      <>
                        <form.Field name="sire_id">{(field) => <FormInput field={field as any} disabled={lineage_unknown} label="Sire UUID" />}</form.Field>
                        <form.Field name="dam_id">{(field) => <FormInput field={field as any} disabled={lineage_unknown} label="Dam UUID" />}</form.Field>
                      </>
                    )}
                  </form.Subscribe>
                  <div className="sm:col-span-2">
                    <form.Field name="description">{(field) => <FormInput field={field as any} label="General Description / Identifying Marks *" type="textarea" placeholder="Crucial if animal lacks formal ID..." />}</form.Field>
                  </div>
                  <form.Field name="display_order">{(field) => <FormInput field={field as any} label="Display Sequence (UI Override)" type="number" />}</form.Field>
               </div>
            </div>

          </form>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50 shrink-0 relative z-20">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest hidden sm:block">{activeTab} active</div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button 
              type="button" 
              onClick={handleImmediateClose} 
              className="w-full sm:w-auto px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <button 
                  type="submit" 
                  form="animal-mutation-form" 
                  disabled={!canSubmit || isSubmitting || executeSaveMutation.isPending} 
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(16,185,129,0.15)] cursor-pointer"
                >
                  {(isSubmitting || executeSaveMutation.isPending) ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} 
                  {(isSubmitting || executeSaveMutation.isPending) ? 'Committing...' : (initialData ? 'Update Record' : 'Commit Record')}
                </button>
              )}
            </form.Subscribe>
          </div>
        </div>

      </div>
    </div>
  );
}