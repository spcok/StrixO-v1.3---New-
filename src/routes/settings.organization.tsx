import React, { useState, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { Building, Loader2, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ImageUploader } from '../components/ui/ImageUploader';
import { OrganizationProfile } from '../types';

// ------------------------------------------------------------------
// STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const orgSettingsOptions = queryOptions({
  queryKey: ['org_settings'],
  queryFn: async () => {
    const { data, error } = await supabase.from('organization_profile').select('*').single();
    if (error && error.code !== 'PGRST116') throw error; 
    return (data || {}) as Partial<OrganizationProfile>;
  },
  staleTime: 1000 * 60 * 60,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

export const Route = createFileRoute('/settings/organization')({
  loader: async ({ context: { queryClient } }) => {
    // @ts-ignore
    await queryClient.ensureQueryData(orgSettingsOptions);
  },
  component: OrgProfilePage,
});

// ------------------------------------------------------------------
// MAIN COMPONENT
// ------------------------------------------------------------------
export function OrgProfilePage() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { data: settings = {}, isLoading } = useQuery(orgSettingsOptions);

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      // Fetch the actual ID from the database if one exists, otherwise rely on UPSERT constraints
      const idToUpsert = settings.id || undefined; 
      
      const upsertPayload = idToUpsert 
        ? { id: idToUpsert, ...payload } 
        : { ...payload };

      const { data, error } = await supabase
        .from('organization_profile')
        .upsert(upsertPayload) 
        .select();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org_settings'] });
      setToast({ message: 'Settings saved successfully!', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    },
    onError: (err: any) => {
      setToast({ message: err.message || 'Failed to save settings.', type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  });

  const form = useForm({
    defaultValues: {
      org_name: settings.org_name || '',
      logo_url: settings.logo_url || '',
      contact_email: settings.contact_email || '',
      contact_phone: settings.contact_phone || '',
      address: settings.address || '',
      license_number: settings.license_number || '',
      website: settings.website || '',
      adoptionurl: settings.adoptionurl || '',
    },
    onSubmit: async ({ value }) => {
      await saveMutation.mutateAsync(value);
    }
  });

  const handleLogoUpload = async (fileOrUrl: string | Blob | null) => {
    if (fileOrUrl instanceof Blob) {
      if (!navigator.onLine) {
        setToast({ message: 'Cannot upload images while offline.', type: 'error' });
        return;
      }
      setIsUploading(true);
      try {
        const fileExt = fileOrUrl.type.split('/')[1] || 'jpeg';
        const filePath = `logos/primary-logo.${fileExt}`;
        
        const fileToUpload = new File([fileOrUrl], `primary-logo.${fileExt}`, {
          type: fileOrUrl.type || 'image/jpeg',
        });

        const { data: files } = await supabase.storage.from('koa-attachments').list('logos');
        if (files && files.length > 0) {
            await supabase.storage.from('koa-attachments').remove(files.map(f => `logos/${f.name}`));
        }

        const { error: uploadError } = await supabase.storage.from('koa-attachments').upload(filePath, fileToUpload, { 
            upsert: true,
            contentType: fileToUpload.type,
            cacheControl: '3600'
        });
        if (uploadError) throw uploadError;

        const { data } = supabase.storage.from('koa-attachments').getPublicUrl(filePath);
        form.setFieldValue('logo_url', `${data.publicUrl}?t=${Date.now()}`);
      } catch (err: any) {
        setToast({ message: 'Upload failed: ' + err.message, type: 'error' });
      } finally {
        setIsUploading(false);
      }
    } else if (fileOrUrl === null) {
      form.setFieldValue('logo_url', '');
    }
  };

  if (isLoading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin text-blue-600" /></div>;

  const inputClass = "mt-1 block w-full border border-slate-200 rounded-lg p-2.5 bg-slate-50 text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none";
  const labelClass = "block text-xs font-bold text-slate-500 uppercase tracking-wider";

  return (
    <div className="space-y-6 relative animate-in fade-in duration-300">
      {toast && (
        <div className={`absolute -top-4 right-0 p-4 rounded-xl flex items-center gap-3 text-sm font-bold shadow-lg z-50 transition-all ${toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />} {toast.message}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2 mb-6">
            <Building size={16} /> Organisation Identity
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Logo</label>
              <form.Subscribe selector={(state) => state.values.logo_url} children={(url) => (
                <div className="w-full relative">
                  {isUploading && (
                    <div className="absolute inset-0 z-10 bg-white/80 backdrop-blur-sm border border-slate-200 border-dashed rounded-xl flex flex-col items-center justify-center text-blue-600 font-bold text-xs gap-3">
                      <Loader2 className="animate-spin" size={24} /> Uploading...
                    </div>
                  )}
                  <ImageUploader value={url} onChange={handleLogoUpload} requireCrop={true} />
                </div>
              )} />
            </div>

            <div className="md:col-span-2 space-y-4">
              <form.Field name="org_name" children={(field) => (
                <div>
                  <label className={labelClass}>Academy Name</label>
                  <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} className={inputClass} />
                </div>
              )} />
              <form.Field name="license_number" children={(field) => (
                <div>
                  <label className={labelClass}>Zoo Licence Number</label>
                  <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} className={inputClass} />
                </div>
              )} />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <form.Field name="address" children={(field) => (
            <div>
              <label className={labelClass}>Headquarters Address</label>
              <textarea value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} className={`${inputClass} h-24 resize-none`} />
            </div>
          )} />
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            <form.Field name="contact_email" children={(field) => (
              <div>
                <label className={labelClass}>Professional Email</label>
                <input type="email" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} className={inputClass} />
              </div>
            )} />
            <form.Field name="contact_phone" children={(field) => (
              <div>
                <label className={labelClass}>Academy Phone</label>
                <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} className={inputClass} />
              </div>
            )} />
            <form.Field name="website" children={(field) => (
              <div>
                <label className={labelClass}>Official Website</label>
                <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} className={inputClass} />
              </div>
            )} />
            <form.Field name="adoptionurl" children={(field) => (
              <div>
                <label className={labelClass}>Adoption Portal</label>
                <input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} className={inputClass} />
              </div>
            )} />
          </div>
        </div>

        <div className="flex justify-end">
            <button 
            type="submit" 
            disabled={saveMutation.isPending || isUploading}
            className="bg-blue-600 text-white px-8 py-3 rounded-lg font-bold uppercase text-xs tracking-widest hover:bg-blue-700 shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
            {saveMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Save Changes
            </button>
        </div>
      </form>
    </div>
  );
}