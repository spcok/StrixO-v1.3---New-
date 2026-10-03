import React, { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  FileText, ClipboardList, ArrowLeft, Edit2, Archive, 
  AlertTriangle, ShieldAlert, Scale, X, CalendarDays, Target, 
  ThermometerSun, Droplets, MapPin, GitMerge, Presentation, Loader2,
  Skull, FileBadge
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { IUCNBadge } from './IUCNBadge';
import AnimalFormModal from './AnimalFormModal';
import HusbandryLogs from '../husbandry/HusbandryLogs';
import { SignGenerator } from './SignGenerator';
import { AnimalDocumentsTab } from './AnimalDocumentsTab';

export interface Props {
  animalId?: string;
  id?: string;
  animal?: any;
  onBack?: () => void;
  onClose?: () => void;
}

const formatWeight = (val: number | null | undefined, unit?: string) => {
  if (val === null || val === undefined) return '--';
  return `${val}${unit || 'g'}`;
};

export function AnimalProfile({ animalId, id, animal: passedAnimal, onBack, onClose }: Props) {
  const queryClient = useQueryClient();
  const { profile, hasPermission } = useAuth(); 
  const params = useParams({ strict: false }) as Record<string, any>;
  const effectiveId = passedAnimal?.id || animalId || id || params.id || '';
  const handleClose = onClose || onBack;
  
  // RBAC Document Read Gate
  const canReadDocs = hasPermission ? hasPermission('document:read') : true;

  const [activeTab, setActiveTab] = useState<'profile' | 'husbandry' | 'documents' | 'events' | 'training'>('profile');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSignModalOpen, setIsSignModalOpen] = useState(false);
  
  // Custom Disposition / Archive Modal State
  const [isArchiveConfirmOpen, setIsArchiveConfirmOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState('Transferred');
  const [archiveDestination, setArchiveDestination] = useState('');
  const [archivedAt, setArchivedAt] = useState('');
  
  // Mortality Fields
  const [causeOfDeath, setCauseOfDeath] = useState('');
  const [necropsyNotes, setNecropsyNotes] = useState('');

  const isDeath = archiveReason === 'Died' || archiveReason === 'Euthanasia';
  const requiresDestination = archiveReason === 'Transferred' || archiveReason === 'Released to Wild';

  const handleOpenArchive = () => {
    setArchiveReason('Transferred');
    setArchiveDestination('');
    setCauseOfDeath('');
    setNecropsyNotes('');
    
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(now.getTime() - tzOffset)).toISOString().slice(0, 16);
    setArchivedAt(localISOTime);
    
    setIsArchiveConfirmOpen(true);
  };

  const { data: animal, isLoading } = useQuery({
    queryKey: ['animal_profile', effectiveId],
    queryFn: async () => {
      const { data, error } = await supabase.from('animals').select('*').eq('id', effectiveId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!effectiveId,
    initialData: passedAnimal ? passedAnimal : undefined,
  });

  // Smart Routing Disposition Mutation
  const archiveMutation = useMutation({
    mutationFn: async () => {
      const dispositionDateISO = new Date(archivedAt).toISOString();

      // 1. Archive the Animal record
      const { error: animalError } = await supabase
        .from('animals')
        .update({ 
          status: 'ARCHIVED',
          archive_reason: archiveReason,
          archive_destination: requiresDestination ? archiveDestination : null,
          archived_at: dispositionDateISO,
          archived_by: profile?.id
        })
        .eq('id', effectiveId);

      if (animalError) throw animalError;

      // 2. Route disposition records based on cause
      if (isDeath) {
        const { error: deathError } = await supabase
          .from('death_logs')
          .insert({
            animal_id: effectiveId,
            date_of_death: dispositionDateISO,
            manner_of_death: archiveReason,
            cause_of_death: causeOfDeath,
            necropsy_notes: necropsyNotes,
            logged_by: profile?.id
          });
          
        if (deathError) throw new Error(`Archived, but Mortality Log failed: ${deathError.message}`);
      } else {
        const { error: transferError } = await supabase
          .from('external_transfers')
          .insert({
            animal_id: effectiveId,
            transfer_type: 'OUT',
            transfer_date: dispositionDateISO,
            entity_name: archiveDestination || 'Unknown / N/A',
            reason: archiveReason
          });
          
        if (transferError) throw new Error(`Archived, but Transfer Log failed: ${transferError.message}`);
      }
    },
    onSuccess: () => {
      setIsArchiveConfirmOpen(false);
      toast.success(`${animal?.name || 'Animal'} has been formally dispositioned.`);
      queryClient.invalidateQueries({ queryKey: ['animals'] });
      queryClient.invalidateQueries({ queryKey: ['animal_profile'] });
      queryClient.invalidateQueries({ queryKey: ['external_transfers'] });
      queryClient.invalidateQueries({ queryKey: ['death_logs'] });
      if (handleClose) handleClose();
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to process disposition.');
      console.error("Disposition Error:", err);
    }
  });

  if (!effectiveId) return null;

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  if (!animal) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
          <AlertTriangle className="text-rose-500 mx-auto mb-3" size={32} />
          <h3 className="text-base font-black text-slate-900 uppercase tracking-tight mb-4">Profile Not Found</h3>
          <button onClick={handleClose} className="px-6 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-slate-200">
            Close
          </button>
        </div>
      </div>
    );
  }

  // Define tab collection dynamically based on RBAC permissions
  const tabs = [
    { id: 'profile', label: 'Profile Matrix', icon: FileText },
    { id: 'husbandry', label: 'Husbandry Logs', icon: ClipboardList },
    ...(canReadDocs ? [{ id: 'documents', label: 'Documents & CITES', icon: FileBadge }] : []),
    { id: 'events', label: 'Events', icon: CalendarDays },
    { id: 'training', label: 'Training', icon: Target },
  ] as const;

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm overflow-y-auto pt-6 pb-12 px-4 custom-scrollbar">
      <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-200 relative">
        
        {handleClose && (
          <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-widest text-slate-300">
            <button onClick={handleClose} className="flex items-center gap-2 hover:text-white transition-colors bg-slate-800/50 px-3 py-1.5 rounded-lg border border-slate-700 cursor-pointer">
              <ArrowLeft size={14} /> Back To Dashboard
            </button>
          </div>
        )}

        {/* HEADER CARD */}
        <div className="bg-white rounded-3xl p-5 flex flex-col md:flex-row gap-8 shadow-2xl">
          <div className="w-full md:w-[280px] h-[280px] shrink-0 rounded-2xl overflow-hidden bg-slate-100 shadow-inner border border-slate-200">
            <img 
              src={animal.profile_image_url || '/offline-media-fallback.svg'} 
              alt={animal.name} 
              className="w-full h-full object-cover"
              onError={(e) => { 
                e.currentTarget.onerror = null; 
                e.currentTarget.src = '/offline-media-fallback.svg'; 
              }}
            />
          </div>

          <div className="flex-1 flex flex-col pt-2 relative">
            <div className="absolute top-0 right-0 flex items-center gap-2">
              <button onClick={() => setIsSignModalOpen(true)} className="p-2.5 text-blue-600 border border-slate-200 rounded-xl hover:bg-blue-50 hover:border-blue-200 transition-all shadow-sm bg-white cursor-pointer" title="Generate Signage">
                <Presentation size={16} />
              </button>
              <button onClick={() => setIsEditModalOpen(true)} className="p-2.5 text-emerald-600 border border-slate-200 rounded-xl hover:bg-emerald-50 hover:border-emerald-200 transition-all shadow-sm bg-white cursor-pointer" title="Edit Profile">
                <Edit2 size={16} />
              </button>
              
              <button 
                onClick={handleOpenArchive}
                className="p-2.5 border rounded-xl transition-all shadow-sm text-rose-600 border-slate-200 bg-white hover:bg-rose-50 hover:border-rose-200 cursor-pointer"
                title="Log Disposition"
              >
                <Archive size={16} />
              </button>

              {handleClose && (
                <button onClick={handleClose} className="p-2.5 text-slate-400 border border-slate-200 rounded-xl hover:bg-slate-100 hover:text-slate-700 transition-all shadow-sm bg-white ml-2 cursor-pointer">
                  <X size={16} />
                </button>
              )}
            </div>

            <div className="mb-8 pr-48">
              <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2 truncate">{animal.name}</h1>
              <p className="text-[10px] font-bold text-slate-500 font-mono tracking-widest uppercase mb-1">ID: {animal.id.toUpperCase()}</p>
              <p className="text-[10px] font-bold text-slate-500 font-mono tracking-widest uppercase flex flex-wrap items-center gap-1.5">
                <span>RING: {animal.ring_number || 'UN-RINGED'}</span>
                <span>|</span>
                <span>CHIP: {animal.microchip_id || animal.microchip_number || 'NONE'}</span>
                {canReadDocs && animal.cites_annex && (
                  <>
                    <span>|</span>
                    <span className="text-amber-600 font-black">CITES: {animal.cites_annex.replace('_', ' ')}</span>
                  </>
                )}
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-y-6 gap-x-4">
              <div>
                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Species</span>
                <span className="text-sm font-bold text-slate-900">{animal.species}</span>
              </div>
              <div>
                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Latin Name</span>
                <span className="text-sm font-bold text-slate-900 italic">{animal.latin_name || 'N/A'}</span>
              </div>
              <div>
                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Gender</span>
                <span className="text-sm font-bold text-slate-900">{animal.gender || 'UNKNOWN'}</span>
              </div>
              <div>
                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Date of Birth</span>
                <span className="text-sm font-bold text-slate-900">
                  {animal.is_dob_unknown 
                    ? 'Unknown' 
                    : animal.date_of_birth && !isNaN(new Date(animal.date_of_birth).getTime()) 
                      ? new Date(animal.date_of_birth).toLocaleDateString() 
                      : 'Unrecorded'}
                  {animal.is_dob_estimated && <span className="ml-1 text-[10px] text-slate-500 font-medium">(Approx)</span>}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Location</span>
                <span className="text-sm font-bold text-slate-900">{animal.location || 'Unassigned'}</span>
              </div>
              <div>
                <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Category</span>
                <span className="text-sm font-bold text-slate-900">{animal.category || 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* TABS & BODY */}
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col min-h-[500px]">
          <div className="flex border-b border-slate-100 px-2 pt-2 bg-slate-50 shrink-0 overflow-x-auto custom-scrollbar">
            {tabs.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-6 py-4 text-[11px] font-black uppercase tracking-widest transition-all border-b-2 whitespace-nowrap cursor-pointer ${
                    isActive 
                      ? 'border-emerald-500 text-emerald-600 bg-white rounded-t-xl shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)]' 
                      : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-100/50 rounded-t-xl'
                  }`}
                >
                  <tab.icon size={14} /> 
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="p-6 bg-white flex-1 overflow-y-auto custom-scrollbar">
            
            {activeTab === 'profile' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* LEFT COLUMN */}
                <div className="lg:col-span-2 space-y-6">
                  
                  {animal.critical_husbandry_notes && (
                    <div className="bg-rose-50/80 border border-rose-200 rounded-2xl p-5 shadow-sm">
                      <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-rose-900 mb-4">
                        <AlertTriangle size={16} className="text-rose-600" /> Critical Husbandry Notes
                      </h3>
                      <div className="text-sm font-bold text-rose-800 space-y-2">
                        {Array.isArray(animal.critical_husbandry_notes) 
                            ? animal.critical_husbandry_notes.map((n: string, i: number) => <p key={i} className="flex gap-3"><span className="text-rose-500 font-black">-</span><span>{n}</span></p>)
                            : String(animal.critical_husbandry_notes).split('\n').map((n, i) => <p key={i} className="flex gap-3"><span className="text-rose-500 font-black">-</span><span>{n.replace(/^- /, '')}</span></p>)
                        }
                      </div>
                    </div>
                  )}

                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-900 mb-4">
                      <Scale size={16} className="text-emerald-600" /> Biometrics &amp; Weight Parameters
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div className="p-3 bg-white border border-slate-100 rounded-xl">
                        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Target / Flying</span>
                        <span className="text-lg font-black text-slate-800">{formatWeight(animal.flying_weight, animal.weight_unit)}</span>
                      </div>
                      <div className="p-3 bg-white border border-slate-100 rounded-xl">
                        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Winter / Resting</span>
                        <span className="text-lg font-black text-slate-800">{formatWeight(animal.winter_weight, animal.weight_unit)}</span>
                      </div>
                    </div>
                  </div>

                  {animal.category === 'EXOTIC' && (
                    <div className="bg-orange-50/30 border border-orange-200 rounded-2xl p-5 shadow-sm">
                      <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-900 mb-4">
                        <ThermometerSun size={16} className="text-orange-500" /> Environmental Parameters
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Day Target</span>
                          <span className="text-sm font-black text-slate-800">{animal.target_day_temp_c ? `${animal.target_day_temp_c}°C` : '--'}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Night Target</span>
                          <span className="text-sm font-black text-slate-800">{animal.target_night_temp_c ? `${animal.target_night_temp_c}°C` : '--'}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Humidity Range</span>
                          <span className="text-sm font-black text-slate-800">
                            {animal.target_humidity_min_percent ? `${animal.target_humidity_min_percent}%` : '--'} - {animal.target_humidity_max_percent ? `${animal.target_humidity_max_percent}%` : '--'}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1"><Droplets size={10} /> Misting</span>
                          <span className="text-sm font-black text-slate-800">{animal.misting_not_required ? 'Not Req.' : (animal.misting_frequency || '--')}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {animal.description && (
                     <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm">
                        <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-900 mb-2">Description &amp; Identifying Marks</h3>
                        <p className="text-sm font-medium text-slate-700 leading-relaxed">{animal.description}</p>
                     </div>
                  )}
                </div>

                {/* RIGHT COLUMN */}
                <div className="space-y-6">
                  
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-900 mb-4">
                      <ShieldAlert size={16} className="text-amber-500" /> Safety &amp; Status
                    </h3>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                        <span className="text-xs font-bold text-slate-500">Hazard Rating</span>
                        <span className={`text-xs font-black uppercase tracking-widest px-2 py-1 rounded ${animal.hazard_rating === 'HIGH' ? 'bg-rose-100 text-rose-700' : animal.hazard_rating === 'MEDIUM' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                          {animal.hazard_rating || 'LOW'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                        <span className="text-xs font-bold text-slate-500">Conservation</span>
                        <IUCNBadge status={animal.red_list_status} />
                      </div>
                      {canReadDocs && (
                        <>
                          <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                            <span className="text-xs font-bold text-slate-500">CITES Status</span>
                            <span className={`text-xs font-black uppercase tracking-widest px-2 py-0.5 rounded ${
                              animal.cites_annex === 'ANNEX_A' 
                                ? 'bg-rose-100 text-rose-700 border border-rose-200' 
                                : animal.cites_annex === 'ANNEX_B'
                                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                : 'bg-slate-100 text-slate-700'
                            }`}>
                              {animal.cites_annex ? animal.cites_annex.replace('_', ' ') : 'NON-CITES'}
                            </span>
                          </div>
                          {animal.article_10_number && (
                            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                              <span className="text-xs font-bold text-slate-500">Article 10 Cert</span>
                              <span className="text-xs font-mono font-bold text-slate-800">
                                {animal.article_10_number}
                              </span>
                            </div>
                          )}
                        </>
                      )}
                      {animal.is_venomous && (
                        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-black uppercase tracking-widest p-2.5 rounded-xl text-center flex items-center justify-center gap-2">
                          <AlertTriangle size={14} /> Venomous Species
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <h3 className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-900 mb-4">
                      <GitMerge size={16} className="text-purple-500" /> Lineage &amp; Origin
                    </h3>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                           <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Sire ID</span>
                           <span className="text-xs font-mono text-slate-800 truncate block" title={animal.sire_id || 'Unknown'}>{animal.sire_id ? animal.sire_id.substring(0,8)+'...' : 'Unknown'}</span>
                        </div>
                        <div>
                           <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Dam ID</span>
                           <span className="text-xs font-mono text-slate-800 truncate block" title={animal.dam_id || 'Unknown'}>{animal.dam_id ? animal.dam_id.substring(0,8)+'...' : 'Unknown'}</span>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-slate-100">
                        <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1 mb-1"><MapPin size={10} /> Origin / Acquisition</span>
                        <span className="text-sm font-bold text-slate-800 block">{animal.origin || 'Unknown Source'}</span>
                        <span className="text-xs text-slate-500 font-medium">{animal.acquisition_date ? new Date(animal.acquisition_date).toLocaleDateString() : 'No date'} ({animal.acquisition_type || 'Unknown Type'})</span>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {activeTab === 'husbandry' && <HusbandryLogs animalId={animal.id} animal={animal} />}
            
            {activeTab === 'documents' && canReadDocs && <AnimalDocumentsTab animal={animal} />}

            {activeTab === 'events' && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
                <CalendarDays size={32} className="opacity-40" />
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">Events Engine</h3>
                <p className="text-[10px] font-bold mt-1 text-center">Module pending installation. Will display displays, interactions, and public events.</p>
              </div>
            )}

            {activeTab === 'training' && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
                <Target size={32} className="opacity-40" />
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">Behavioral Training</h3>
                <p className="text-[10px] font-bold mt-1 text-center">Module pending installation. Will log conditioning, flight weights, and behavioral notes.</p>
              </div>
            )}

          </div>
        </div>
      </div>

      {isEditModalOpen && (
        <AnimalFormModal isOpen={isEditModalOpen} initialData={animal} onClose={() => setIsEditModalOpen(false)} />
      )}
      {isSignModalOpen && (
        <SignGenerator animal={animal} onClose={() => setIsSignModalOpen(false)} />
      )}

      {/* DYNAMIC DISPOSITION MODAL */}
      {isArchiveConfirmOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200 my-auto">
            <div className="flex flex-col">
              
              {/* Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${isDeath ? 'bg-slate-100 text-slate-700' : 'bg-rose-50 text-rose-500'}`}>
                  {isDeath ? <Skull size={24} /> : <AlertTriangle size={24} />}
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900 tracking-tight">Log Disposition</h3>
                  <p className="text-xs font-bold text-slate-500 truncate w-full">Record {animal.name}'s Departure</p>
                </div>
              </div>

              {/* Form Fields */}
              <div className="space-y-4 mb-8">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Reason for Disposition</label>
                  <select 
                    value={archiveReason} 
                    onChange={(e) => setArchiveReason(e.target.value)}
                    className={`w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 shadow-sm transition-colors ${isDeath ? 'focus:border-slate-500 focus:ring-slate-500/20' : 'focus:border-rose-500 focus:ring-rose-500/20'}`}
                  >
                    <option value="Transferred">Transferred (External)</option>
                    <option value="Died">Died (Natural/Illness)</option>
                    <option value="Euthanasia">Euthanasia</option>
                    <option value="Released to Wild">Released to Wild</option>
                    <option value="Escaped">Escaped</option>
                  </select>
                </div>

                {/* DYNAMIC FIELDS: DEATH VS TRANSFER */}
                {isDeath ? (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-2">
                        Cause of Death <span className="text-[9px] text-slate-400 font-bold">(If Known)</span>
                      </label>
                      <input 
                        type="text" 
                        placeholder="e.g. Aspergillosis, Renal Failure..."
                        value={causeOfDeath}
                        onChange={(e) => setCauseOfDeath(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 shadow-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Necropsy / Post-Mortem Notes</label>
                      <textarea 
                        rows={3} 
                        placeholder="Initial clinical observations..."
                        value={necropsyNotes}
                        onChange={(e) => setNecropsyNotes(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-500/20 shadow-sm resize-none"
                      />
                    </div>
                  </div>
                ) : (
                  <div className={`animate-in fade-in slide-in-from-top-2 duration-200 ${!requiresDestination ? 'opacity-50' : ''}`}>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Destination / Receiving Entity</label>
                    <input 
                      type="text" 
                      placeholder={requiresDestination ? "e.g. London Zoo" : "N/A"}
                      value={archiveDestination}
                      onChange={(e) => setArchiveDestination(e.target.value)}
                      disabled={!requiresDestination}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 shadow-sm disabled:cursor-not-allowed"
                    />
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Date &amp; Time of Disposition</label>
                  <input 
                    type="datetime-local" 
                    value={archivedAt}
                    onChange={(e) => setArchivedAt(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 shadow-sm"
                  />
                </div>
              </div>
              
              {/* Actions */}
              <div className="flex items-center gap-3 w-full border-t border-slate-100 pt-5 mt-auto">
                <button 
                  onClick={() => setIsArchiveConfirmOpen(false)} 
                  disabled={archiveMutation.isPending}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => archiveMutation.mutate()} 
                  disabled={
                    archiveMutation.isPending || 
                    (requiresDestination && !archiveDestination.trim())
                  }
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-colors shadow-sm disabled:opacity-50 cursor-pointer ${isDeath ? 'bg-slate-900 hover:bg-slate-800' : 'bg-rose-600 hover:bg-rose-500'}`}
                >
                  {archiveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : 'Confirm Disposition'}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AnimalProfile;