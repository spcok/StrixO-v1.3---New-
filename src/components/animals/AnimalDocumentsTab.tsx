import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  FileText, 
  Upload, 
  Trash2, 
  ExternalLink, 
  ShieldAlert, 
  FileBadge, 
  AlertTriangle, 
  Loader2, 
  CheckCircle2, 
  FolderOpen, 
  Scale, 
  GitMerge, 
  ShieldCheck,
  Lock
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { Animal } from '../../types';

interface AnimalDocumentsTabProps {
  animal: Animal & {
    cites_annex?: string;
    article_10_number?: string;
    article_10_type?: string;
    article_10_file_url?: string;
  };
}

const DOCUMENT_CLASSIFICATIONS = [
  { value: 'ARTICLE_10', label: 'Article 10 Certificate (CITES)' },
  { value: 'IBR_CERTIFICATE', label: 'Independent Bird Register Certificate (IBR)' },
  { value: 'HATCH_CERTIFICATE', label: 'Hatch Certificate / Birth Record' },
  { value: 'TRANSFER_DEED', label: 'Transfer Deed / Bill of Sale' },
  { value: 'DNA_CERTIFICATE', label: 'DNA Sexing Certificate' },
  { value: 'VET_PASSPORT', label: 'Veterinary Health Passport' },
  { value: 'OTHER', label: 'Other Statutory File' },
] as const;

export function AnimalDocumentsTab({ animal }: AnimalDocumentsTabProps) {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  // RBAC Permission Gates
  const canRead = hasPermission ? hasPermission('document:read') : true;
  const canManage = hasPermission ? hasPermission('document:manage') : false;

  const [isUploading, setIsUploading] = useState(false);
  const [docType, setDocType] = useState<string>('ARTICLE_10');
  const [docTitle, setDocTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Fetch specimen documents only if permitted
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['animal_documents', animal.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('animal_documents')
        .select('*')
        .eq('animal_id', animal.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!canRead && !!animal.id,
  });

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      toast.error('Unauthorized: document:manage permission required.');
      return;
    }
    if (!selectedFile) {
      toast.error('Please select a file to upload.');
      return;
    }

    setIsUploading(true);
    try {
      const sanitizedName = selectedFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = `${animal.id}/${Date.now()}_${sanitizedName}`;

      const { error: uploadErr } = await supabase.storage
        .from('animal-documents')
        .upload(filePath, selectedFile, { upsert: true });

      if (uploadErr) throw uploadErr;

      const { data: publicUrlData } = supabase.storage
        .from('animal-documents')
        .getPublicUrl(filePath);

      const generatedTitle = docTitle.trim() || `${
        DOCUMENT_CLASSIFICATIONS.find(c => c.value === docType)?.label || docType
      } (${selectedFile.name})`;

      const { error: dbErr } = await supabase
        .from('animal_documents')
        .insert({
          animal_id: animal.id,
          document_type: docType,
          title: generatedTitle,
          file_name: selectedFile.name,
          file_url: publicUrlData.publicUrl,
        });

      if (dbErr) throw dbErr;

      if (docType === 'ARTICLE_10') {
        await supabase
          .from('animals')
          .update({ article_10_file_url: publicUrlData.publicUrl })
          .eq('id', animal.id);
      }

      toast.success('Document archived into statutory ledger.');
      setDocTitle('');
      setSelectedFile(null);

      queryClient.invalidateQueries({ queryKey: ['animal_documents', animal.id] });
      queryClient.invalidateQueries({ queryKey: ['animal_profile', animal.id] });
      queryClient.invalidateQueries({ queryKey: ['animals'] });
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload document.');
    } finally {
      setIsUploading(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => {
      if (!canManage) throw new Error('Unauthorized');
      const { error } = await supabase.from('animal_documents').delete().eq('id', docId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Document deleted.');
      queryClient.invalidateQueries({ queryKey: ['animal_documents', animal.id] });
      queryClient.invalidateQueries({ queryKey: ['animal_profile', animal.id] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to delete document.');
    }
  });

  // Access Denied State (Lacks document:read)
  if (!canRead) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-10 text-center space-y-4 max-w-xl mx-auto shadow-sm my-6 font-sans text-left">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-600 border border-amber-500/20 flex items-center justify-center mx-auto shadow-sm">
          <Lock size={26} />
        </div>
        <div className="text-center space-y-1">
          <h3 className="text-sm font-black uppercase tracking-tight text-slate-900">
            Restricted Statutory Archive
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            Inspection of CITES Article 10 certificates, IBR records, and transfer deeds is restricted to authorized personnel. Contact an administrator to request the <span className="font-mono font-bold text-slate-700 bg-slate-200 px-1.5 py-0.5 rounded">document:read</span> permission.
          </p>
        </div>
      </div>
    );
  }

  const isAnnexA = animal.cites_annex === 'ANNEX_A';
  const hasArticle10 = Boolean(animal.article_10_number || animal.article_10_file_url);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-sans text-left">
      
      {/* LEFT COLUMN: Metrics, Upload Form (if canManage), & Document List */}
      <div className="lg:col-span-2 space-y-6">
        
        {isAnnexA && !hasArticle10 && (
          <div className="bg-rose-50/80 border border-rose-200 rounded-2xl p-5 shadow-sm">
            <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-rose-900 mb-2">
              <AlertTriangle size={16} className="text-rose-600 shrink-0" />
              Statutory COTES 2018 Compliance Action Required
            </h3>
            <p className="text-sm font-bold text-rose-800 leading-relaxed">
              This specimen is catalogued under <span className="underline">CITES Annex A</span> without an active APHA Article 10 Certificate on file. Commercial displays, breeding loans, and public demonstrations are restricted under UK law until a valid certificate is attached.
            </p>
          </div>
        )}

        {/* Biometrics-Style Summary Metrics */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-900 mb-4">
            <Scale size={16} className="text-emerald-600" /> Document &amp; Registry Verification
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="p-3 bg-white border border-slate-100 rounded-xl">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                Total Archived
              </span>
              <span className="text-lg font-black text-slate-800">
                {documents.length} Files
              </span>
            </div>
            <div className="p-3 bg-white border border-slate-100 rounded-xl">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                CITES Annex
              </span>
              <span className="text-lg font-black text-slate-800">
                {animal.cites_annex ? animal.cites_annex.replace(/_/g, ' ') : 'NON-CITES'}
              </span>
            </div>
            <div className="p-3 bg-white border border-slate-100 rounded-xl col-span-2 md:col-span-1">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                Article 10 Status
              </span>
              <span className={`text-lg font-black ${
                hasArticle10 ? 'text-emerald-600' : isAnnexA ? 'text-rose-600' : 'text-slate-800'
              }`}>
                {hasArticle10 ? 'Documented' : isAnnexA ? 'Missing' : 'Exempt'}
              </span>
            </div>
          </div>
        </div>

        {/* Upload Form Card: Visible only if user has document:manage */}
        {canManage ? (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm">
            <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-900 mb-4">
              <Upload size={16} className="text-emerald-600" />
              Archive Statutory Documentation
            </h3>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                    Document Classification *
                  </label>
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-500 shadow-sm"
                  >
                    {DOCUMENT_CLASSIFICATIONS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                    Document Title / Reference Note
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. APHA Specimen Cert #582914/01"
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:border-emerald-500 shadow-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                  Attach File Scan (PDF, JPG, PNG)
                </label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:uppercase file:tracking-wider file:bg-slate-200 file:text-slate-800 hover:file:bg-slate-300 cursor-pointer bg-white border border-slate-200 rounded-xl p-1 shadow-sm"
                />
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={isUploading || !selectedFile}
                  className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {isUploading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Archiving File...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      <span>Commit to Archive</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs text-slate-500 shadow-sm">
            <span className="flex items-center gap-2 font-medium">
              <Lock size={14} className="text-slate-400" />
              Upload and deletion actions require <code className="font-mono font-bold text-slate-700 bg-slate-200 px-1 py-0.5 rounded">document:manage</code>.
            </span>
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-600">
              Read-Only
            </span>
          </div>
        )}

        {/* Uploaded Documents List */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-900">
              <FileText size={16} className="text-emerald-600" />
              Attached Certificates &amp; Legal Records
            </h3>
            <span className="text-[10px] font-bold font-mono uppercase tracking-widest text-slate-400">
              {documents.length} Records
            </span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 size={24} className="animate-spin text-emerald-600" />
            </div>
          ) : documents.length === 0 ? (
            <div className="p-8 bg-white border border-slate-100 rounded-xl text-center space-y-2">
              <FolderOpen size={28} className="mx-auto text-slate-300" />
              <p className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                No Documents Archived
              </p>
              <p className="text-[11px] text-slate-400 font-medium">
                No statutory paperwork or certificates currently recorded for this animal.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {documents.map((doc: any) => {
                const label = DOCUMENT_CLASSIFICATIONS.find(c => c.value === doc.document_type)?.label || doc.document_type.replace(/_/g, ' ');
                return (
                  <div 
                    key={doc.id} 
                    className="p-3.5 bg-white border border-slate-100 hover:border-slate-300 rounded-xl flex items-center justify-between gap-4 transition-all shadow-sm"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                        <FileText size={18} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{doc.title}</p>
                        <p className="text-[10px] font-medium text-slate-400 mt-0.5 truncate">
                          <span className="font-bold text-slate-600">{label}</span> • Uploaded {new Date(doc.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <a
                        href={doc.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 text-blue-600 border border-slate-200 rounded-xl hover:bg-blue-50 hover:border-blue-200 transition-all shadow-sm bg-white cursor-pointer"
                        title="View File"
                      >
                        <ExternalLink size={15} />
                      </a>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm('Delete this statutory document from the permanent record?')) {
                              deleteMutation.mutate(doc.id);
                            }
                          }}
                          className="p-2 text-rose-600 border border-slate-200 rounded-xl hover:bg-rose-50 hover:border-rose-200 transition-all shadow-sm bg-white cursor-pointer"
                          title="Delete Record"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* RIGHT COLUMN: Statutory Status & Framework (1 Column) */}
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-900 mb-4">
            <ShieldAlert size={16} className="text-amber-500" /> Statutory &amp; Legal Status
          </h3>

          <div className="space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-500">CITES Classification</span>
              <span className={`text-xs font-black uppercase tracking-widest px-2 py-1 rounded ${
                animal.cites_annex === 'ANNEX_A' 
                  ? 'bg-rose-100 text-rose-700' 
                  : animal.cites_annex === 'ANNEX_B'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-slate-100 text-slate-700'
              }`}>
                {animal.cites_annex ? animal.cites_annex.replace(/_/g, ' ') : 'NON-CITES'}
              </span>
            </div>

            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-500">Article 10 Number</span>
              <span className="text-xs font-mono font-bold text-slate-900">
                {animal.article_10_number || 'None Recorded'}
              </span>
            </div>

            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-500">Certificate Scope</span>
              <span className="text-xs font-bold text-slate-800">
                {animal.article_10_type ? animal.article_10_type.replace(/_/g, ' ') : 'N/A'}
              </span>
            </div>

            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <span className="text-xs font-bold text-slate-500">Seamless Leg Ring</span>
              <span className="text-xs font-mono font-bold text-slate-900">
                {animal.ring_number || 'Un-Ringed'}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-500">Microchip Transponder</span>
              <span className="text-xs font-mono font-bold text-slate-900">
                {animal.microchip_id || animal.microchip_number || 'None'}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-900 mb-4">
            <GitMerge size={16} className="text-purple-500" /> Retention &amp; Authorities
          </h3>
          
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Vault Target</span>
                <span className="text-xs font-mono text-slate-800 truncate block">animal-documents</span>
              </div>
              <div>
                <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Enforcement</span>
                <span className="text-xs font-mono text-slate-800 truncate block">APHA / Defra</span>
              </div>
            </div>
            
            <div className="pt-2 border-t border-slate-100">
              <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1 mb-1">
                <ShieldCheck size={10} className="text-emerald-600" /> Statutory Mandate
              </span>
              <span className="text-sm font-bold text-slate-800 block">Zoo Licensing Act 1981 / COTES 2018</span>
              <span className="text-xs text-slate-500 font-medium">Mandatory specimen permanent archive (SSSMZP Section 9)</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

export default AnimalDocumentsTab;