import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router'; 
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { 
  Stethoscope, Search, Plus, Activity, 
  ShieldAlert, FileText, ChevronRight, X, Loader2, UserRound, AlertCircle, CalendarClock, Scale, MapPin, Cake, ChevronDown, Trash2, Edit, Pill, AlertTriangle
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { toast } from 'sonner';

import PrescriptionFormModal from '../components/medical/PrescriptionFormModal';

export const Route = createFileRoute('/clinical/records')({
  component: ClinicalRecordsModule,
});

// Helper function to calculate age and include DOB
function formatAgeWithDOB(dob: string | null | undefined): string {
  if (!dob) return 'Unknown Age';
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  const formattedDob = birthDate.toLocaleDateString('en-GB');
  return `${age === 0 ? '< 1 Year Old' : `${age} Years Old`} (DOB: ${formattedDob})`;
}

// 30-Day Compliance Lock Check
function isEditable(createdAt: string): boolean {
  const recordDate = new Date(createdAt);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return recordDate > thirtyDaysAgo;
}

function ClinicalRecordsModule() {
  const { hasPermission, profile } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate(); 
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAnimalId, setSelectedAnimalId] = useState<string | null>(null);
  
  // Modal States
  const [isSOAPModalOpen, setIsSOAPModalOpen] = useState(false);
  const [isMARModalOpen, setIsMARModalOpen] = useState(false);
  const [recordToEdit, setRecordToEdit] = useState<any | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<{ recordId: string, weightLogId: string | null } | null>(null);
  const [linkedClinicalIdForMAR, setLinkedClinicalIdForMAR] = useState<string | null>(null);
  
  // Expanded State
  const [expandedRecords, setExpandedRecords] = useState<Record<string, boolean>>({});
  const scrollParentRef = useRef<HTMLDivElement>(null);

  const toggleRecord = (id: string) => {
    setExpandedRecords(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // --- QUERIES ---
  const { data: animals = [], isLoading: isLoadingAnimals } = useQuery({
    queryKey: ['clinical_animals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('animals')
        .select('id, name, species, ring_number, average_target_weight, date_of_birth, location')
        .eq('is_deleted', false)
        .order('name');
      if (error) throw error;
      return data;
    },
    networkMode: 'always',
  });

  const { data: staffMembers = [], isLoading: isStaffLoading } = useQuery({
    queryKey: ['active_staff'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, role')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
    networkMode: 'always',
  });

  const { data: records = [], isLoading: isLoadingRecords } = useQuery({
    queryKey: ['clinical_records', selectedAnimalId],
    enabled: !!selectedAnimalId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clinical_records')
        .select(`
          *,
          weight_logs(weight_grams)
        `)
        .eq('animal_id', selectedAnimalId)
        .eq('is_deleted', false)
        .order('record_date', { ascending: false }); 
      
      if (error) {
        console.error("Timeline Query Error:", error);
        toast.error(`Database Error: ${error.message}`);
        throw error;
      }
      return data;
    },
    networkMode: 'always',
  });

  const { data: activeMars = [] } = useQuery({
    queryKey: ['active_mars', selectedAnimalId],
    enabled: !!selectedAnimalId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clinical_schedule')
        .select('id')
        .eq('animal_id', selectedAnimalId)
        .eq('status', 'ACTIVE')
        .eq('is_deleted', false);
      if (error && error.code !== 'PGRST116') throw error;
      return data || [];
    },
    networkMode: 'always',
  });

  const selectedAnimal = useMemo(() => animals.find(a => a.id === selectedAnimalId), [animals, selectedAnimalId]);
  
  const filteredAnimals = useMemo(() => {
    if (!searchQuery) return animals;
    const lowerQuery = searchQuery.toLowerCase();
    return animals.filter(a => 
      a.name?.toLowerCase().includes(lowerQuery) || 
      a.ring_number?.toLowerCase().includes(lowerQuery)
    );
  }, [animals, searchQuery]);

  // --- DELETE MUTATION ---
  const deleteMutation = useMutation({
    mutationFn: async ({ recordId, weightLogId }: { recordId: string, weightLogId: string | null }) => {
      const { error: clinicalError } = await supabase
        .from('clinical_records')
        .update({ is_deleted: true, modified_by: profile?.id })
        .eq('id', recordId);
      if (clinicalError) throw clinicalError;

      if (weightLogId) {
         await supabase
          .from('weight_logs')
          .update({ is_deleted: true, modified_by: profile?.id })
          .eq('id', weightLogId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinical_records', selectedAnimalId] });
      queryClient.invalidateQueries({ queryKey: ['weight_logs', selectedAnimalId] }); 
      toast.success('Clinical record permanently deleted.');
      setRecordToDelete(null);
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const handleDeleteTrigger = (e: React.MouseEvent, recordId: string, weightLogId: string | null) => {
    e.stopPropagation(); 
    setRecordToDelete({ recordId, weightLogId });
  };

  const handleEditTrigger = (e: React.MouseEvent, record: any) => {
    e.stopPropagation();
    setRecordToEdit(record);
    setIsSOAPModalOpen(true);
  };

  const handleOpenNewSOAP = () => {
    setRecordToEdit(null);
    setIsSOAPModalOpen(true);
  };

  const handleMARHandoff = (clinicalRecordId: string) => {
    setLinkedClinicalIdForMAR(clinicalRecordId);
    setIsMARModalOpen(true);
    setIsSOAPModalOpen(false);
    setRecordToEdit(null);
  };

  // Virtualizer for the clinical timeline
  const rowVirtualizer = useWindowVirtualizer({
    count: records.length,
    estimateSize: () => 120,
    overscan: 5,
  });

  return (
    <div className="flex h-[calc(100vh-6rem)] bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-300 relative w-full">
      
      {/* LEFT PANEL: Patient Roster */}
      <div className="w-1/3 lg:w-1/4 border-r border-slate-200 flex flex-col bg-slate-50 shrink-0">
        <div className="p-4 border-b border-slate-200 bg-white">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2 mb-3">
           Patient Roster
          </h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="Search by name or ring ID..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {isLoadingAnimals ? (
            <div className="flex justify-center p-8"><Loader2 className="animate-spin text-emerald-500" size={24} /></div>
          ) : (
            filteredAnimals.map(animal => (
              <button
                key={animal.id}
                onClick={() => setSelectedAnimalId(animal.id)}
                className={`w-full text-left p-3 rounded-xl flex items-center justify-between transition-all ${
                  selectedAnimalId === animal.id 
                    ? 'bg-emerald-600 text-white shadow-md' 
                    : 'hover:bg-slate-200 text-slate-700'
                }`}
              >
                <div>
                  <p className="font-bold text-sm">{animal.name}</p>
                  <p className={`text-[10px] uppercase tracking-widest font-black ${selectedAnimalId === animal.id ? 'text-emerald-100' : 'text-slate-400'}`}>
                    {animal.species} • {animal.ring_number || 'NO RING'}
                  </p>
                </div>
                <ChevronRight size={16} className={selectedAnimalId === animal.id ? 'text-white' : 'text-slate-300'} />
              </button>
            ))
          )}
        </div>
      </div>

      {/* RIGHT PANEL: Master Patient File */}
      <div className="flex-1 flex flex-col relative bg-slate-50/50">
        {!selectedAnimal ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <Stethoscope size={48} className="mb-4 opacity-20" />
            <p className="text-sm font-black uppercase tracking-widest">Select a Patient to view Medical Records</p>
          </div>
        ) : (
          <>
            {/* 1. The Enriched Vitals Ribbon */}
            <div className="bg-white border-b border-slate-200 p-6 shrink-0 shadow-sm z-10 relative">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h1 className="text-2xl font-black text-slate-900 tracking-tight">{selectedAnimal.name}</h1>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-500 mt-1">
                    {selectedAnimal.species} • ID: {selectedAnimal.ring_number || 'N/A'}
                  </p>
                </div>
                {hasPermission('clinical:write') && (
                  <button 
                    onClick={handleOpenNewSOAP}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-colors shadow-sm"
                  >
                    <Plus size={16} /> New Clinical Entry
                  </button>
                )}
              </div>

              {/* Status Badges */}
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2 bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border border-slate-200">
                  <Cake size={14} /> {formatAgeWithDOB(selectedAnimal.date_of_birth)}
                </div>
                <div className="flex items-center gap-2 bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border border-slate-200">
                  <MapPin size={14} /> {selectedAnimal.location || 'Location Unknown'}
                </div>
                <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border border-emerald-200">
                  <Activity size={14} /> Target: {selectedAnimal.average_target_weight || 'N/A'}g
                </div>
                
                {activeMars.length > 0 ? (
                  <button 
                    onClick={() => navigate({ to: '/clinical/medications' })}
                    className="flex items-center gap-2 bg-rose-50 text-rose-700 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border border-rose-200 animate-pulse cursor-pointer hover:bg-rose-100 transition-colors"
                  >
                    <Pill size={14} /> {activeMars.length} Active MAR{activeMars.length > 1 ? 's' : ''}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 bg-slate-50 text-slate-400 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border border-slate-200">
                    <Pill size={14} /> No Active MARs
                  </div>
                )}
              </div>
            </div>

            {/* 2. The Chronological Timeline */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6" ref={scrollParentRef}>
              {isLoadingRecords ? (
                <div className="flex justify-center py-12"><Loader2 className="animate-spin text-emerald-500" size={32} /></div>
              ) : records.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <FileText size={32} className="mx-auto mb-3 opacity-20" />
                  <p className="text-xs font-black uppercase tracking-widest">No Clinical Records Found</p>
                </div>
              ) : (
                <div className="space-y-4 pl-4 border-l-2 border-slate-200 ml-4">
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const record = records[virtualRow.index];
                    const isExpanded = expandedRecords[record.id];
                    const canEdit = hasPermission('clinical:write') && isEditable(record.created_at);
                    
                    const conductorName = record.conductor_role === 'EXTERNAL_VET'
                      ? `Dr. ${record.external_vet_name}`
                      : `${staffMembers.find(s => s.id === record.conducted_by)?.name || 'Staff'}`;
                    
                    const problemTitle = record.title || 'Clinical Evaluation';
                    
                    let linkedWeight = 'N/A';
                    const wLog = record.weight_logs || record.weight;
                    if (wLog) {
                      if (Array.isArray(wLog) && wLog.length > 0) linkedWeight = wLog[0].weight_grams;
                      else if (!Array.isArray(wLog) && wLog.weight_grams !== undefined) linkedWeight = wLog.weight_grams;
                    }

                    return (
                      <div key={record.id} className="relative pl-6">
                        <div className="absolute -left-[31px] top-4 w-4 h-4 rounded-full border-4 border-white bg-emerald-600 shadow-sm z-10" />
                        
                        <div className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-200 ${isExpanded ? 'ring-2 ring-emerald-500/20' : 'hover:border-slate-300 hover:shadow-md'}`}>
                          
                          {/* Collapsible Header */}
                          <div 
                            onClick={() => toggleRecord(record.id)}
                            className="w-full text-left px-5 py-4 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-3 mb-1.5">
                                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100 flex items-center gap-1.5">
                                  <CalendarClock size={12} />
                                  {new Date(record.record_date || record.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                                </span>
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 bg-slate-100 px-2 py-1 rounded-md border border-slate-200">
                                  {record.record_type || 'Routine Check'}
                                </span>
                                {!isEditable(record.created_at) && (
                                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1" title="ZLA Compliance Lock Active">
                                    <ShieldAlert size={10} /> Sealed
                                  </span>
                                )}
                              </div>
                              <p className="text-sm font-bold text-slate-800 truncate" title={problemTitle}>
                                {problemTitle}
                              </p>
                            </div>
                            
                            <div className="flex items-center gap-6 shrink-0 text-[11px] font-black uppercase tracking-widest text-slate-500">
                              <div className="flex items-center gap-2">
                                <UserRound size={14} className="text-slate-400" />
                                <span className={record.conductor_role === 'EXTERNAL_VET' ? 'text-rose-600' : ''}>
                                  {conductorName} ({record.conductor_role || 'Staff'})
                                </span>
                              </div>
                              <div className="flex items-center gap-2 w-20 justify-end">
                                <Scale size={14} className="text-slate-400" />
                                {linkedWeight}g
                              </div>
                              <ChevronDown size={18} className={`text-slate-300 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                            </div>
                          </div>

                          {/* Expanded SOAP Body & Actions */}
                          {isExpanded && (
                            <div className="p-5 pt-0 border-t border-slate-100 bg-slate-50/50 mt-2">
                              
                              {record.conductor_role === 'EXTERNAL_VET' && (
                                <div className="mb-4 bg-rose-50 text-rose-800 p-3 rounded-lg border border-rose-100 text-xs font-medium flex items-center gap-2">
                                  <AlertCircle size={14} className="text-rose-500" />
                                  External Consultation at {record.external_vet_clinic}. Logged by internal staff.
                                </div>
                              )}
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                                <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 shadow-sm">
                                  <div className="text-[10px] font-black uppercase tracking-widest text-blue-600 mb-2 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div> Subjective</div>
                                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{record.soap_subjective}</p>
                                </div>
                                <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 shadow-sm">
                                  <div className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-2 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Objective</div>
                                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{record.soap_objective}</p>
                                </div>
                                <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-100 shadow-sm md:col-span-2">
                                  <div className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-2 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div> Assessment</div>
                                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{record.soap_assessment}</p>
                                </div>
                                <div className="bg-purple-50/50 p-4 rounded-xl border border-purple-100 shadow-sm md:col-span-2">
                                  <div className="text-[10px] font-black uppercase tracking-widest text-purple-600 mb-2 flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-purple-500"></div> Plan</div>
                                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{record.soap_plan}</p>
                                </div>
                              </div>

                              {/* Action Footer */}
                              <div className="flex justify-between items-center pt-4 border-t border-slate-200">
                                {!canEdit ? (
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                                    <ShieldAlert size={12} /> ZLA Compliance Lock Active (Past 30 Days)
                                  </p>
                                ) : (
                                  <div className="flex gap-2">
                                    <button 
                                      onClick={(e) => handleEditTrigger(e, record)}
                                      className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                      title="Edit Record"
                                    >
                                      <Edit size={16} />
                                    </button>
                                    <button 
                                      onClick={(e) => handleDeleteTrigger(e, record.id, record.weight_log_id)}
                                      className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                      title="Delete Record"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                )}
                                
                                {hasPermission('clinical:prescribe') && (
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMARHandoff(record.id);
                                    }}
                                    className="text-[10px] font-black uppercase tracking-widest text-rose-600 bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-200 hover:bg-rose-100 transition-colors flex items-center gap-1.5 cursor-pointer"
                                  >
                                    <Pill size={12} /> Issue Prescription
                                  </button>
                                )}
                              </div>

                            </div>
                          )}

                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* CONFIRMATION DELETE MODAL */}
      {recordToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
           <div className="bg-white max-w-sm w-full rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200">
             <div className="flex items-center gap-3 text-rose-600 mb-4">
               <AlertTriangle size={24} />
               <h3 className="text-lg font-black tracking-tight">Confirm Deletion</h3>
             </div>
             <p className="text-sm text-slate-600 mb-6 leading-relaxed">
               Are you sure you want to permanently delete this clinical record? This action will also remove the associated weight log. This cannot be undone.
             </p>
             <div className="flex justify-end gap-3">
               <button 
                 onClick={() => setRecordToDelete(null)}
                 disabled={deleteMutation.isPending}
                 className="px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all"
               >
                 Cancel
               </button>
               <button 
                 onClick={() => recordToDelete && deleteMutation.mutate(recordToDelete)}
                 disabled={deleteMutation.isPending}
                 className="bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 shadow-sm"
               >
                 {deleteMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                 Delete Record
               </button>
             </div>
           </div>
        </div>
      )}

      {/* MODALS */}
      {isSOAPModalOpen && selectedAnimal && (
        <SOAPFormModal 
          animalId={selectedAnimal.id} 
          animalName={selectedAnimal.name!}
          staffMembers={staffMembers}
          isStaffLoading={isStaffLoading}
          existingRecord={recordToEdit} 
          onClose={() => {
            setIsSOAPModalOpen(false);
            setRecordToEdit(null); 
          }}
          onMARTriggered={(clinicalRecordId) => {
            handleMARHandoff(clinicalRecordId);
          }}
        />
      )}

      {isMARModalOpen && selectedAnimal && (
        <PrescriptionFormModal
          isOpen={isMARModalOpen}
          onClose={() => {
            setIsMARModalOpen(false);
            setLinkedClinicalIdForMAR(null);
          }}
          initialData={{
            animal_id: selectedAnimal.id,
            clinical_record_id: linkedClinicalIdForMAR
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// PREMIUM S.O.A.P. DATA ENTRY MODAL
// ------------------------------------------------------------------
function SOAPFormModal({ 
  animalId, 
  animalName, 
  staffMembers, 
  isStaffLoading, 
  existingRecord, 
  onClose,
  onMARTriggered
}: { 
  animalId: string, 
  animalName: string, 
  staffMembers: any[], 
  isStaffLoading: boolean, 
  existingRecord?: any, 
  onClose: () => void,
  onMARTriggered: (recordId: string) => void
}) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const isEditMode = !!existingRecord;

  const [recordType, setRecordType] = useState('Routine Check');
  const [title, setTitle] = useState('');
  const [recordDate, setRecordDate] = useState('');
  const [weight, setWeight] = useState('');
  const [subjective, setSubjective] = useState('');
  const [objective, setObjective] = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');
  const [requiresMedication, setRequiresMedication] = useState(false);
  
  const [conductorType, setConductorType] = useState<'INTERNAL' | 'EXTERNAL'>('INTERNAL');
  const [conductedBy, setConductedBy] = useState(profile?.id || '');
  const [conductorRole, setConductorRole] = useState('Keeper');
  const [externalVetName, setExternalVetName] = useState('');
  const [externalClinic, setExternalClinic] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (existingRecord) {
      setRecordType(existingRecord.record_type || 'Routine Check');
      setTitle(existingRecord.title || '');
      setSubjective(existingRecord.soap_subjective || '');
      setObjective(existingRecord.soap_objective || '');
      setAssessment(existingRecord.soap_assessment || '');
      setPlan(existingRecord.soap_plan || '');
      
      if (existingRecord.conductor_role === 'EXTERNAL_VET') {
        setConductorType('EXTERNAL');
        setExternalVetName(existingRecord.external_vet_name || '');
        setExternalClinic(existingRecord.external_vet_clinic || '');
      } else {
        setConductorType('INTERNAL');
        setConductedBy(existingRecord.conducted_by || profile?.id || '');
        setConductorRole(existingRecord.conductor_role || 'Keeper');
      }

      if (existingRecord.record_date) {
        const existingDate = new Date(existingRecord.record_date);
        existingDate.setMinutes(existingDate.getMinutes() - existingDate.getTimezoneOffset());
        setRecordDate(existingDate.toISOString().slice(0, 16));
      }

      const wLog = existingRecord.weight_logs || existingRecord.weight;
      if (wLog) {
        if (Array.isArray(wLog) && wLog.length > 0) {
          setWeight(wLog[0].weight_grams?.toString() || '');
        } else if (!Array.isArray(wLog) && wLog.weight_grams !== undefined) {
          setWeight(wLog.weight_grams?.toString() || '');
        } else {
          setWeight('');
        }
      } else {
        setWeight('');
      }
      
    } else {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      setRecordDate(now.toISOString().slice(0, 16));
      setWeight('');
    }
  }, [existingRecord, profile?.id]);

  const submitMutation = async () => {
    setIsSubmitting(true);
    try {
      if (!profile) throw new Error("Authentication error: No active profile found.");
      
      if (!title?.trim()) throw new Error("A Clinical Title/Diagnosis is mandatory.");
      if (!recordDate) throw new Error("Record Date & Time is mandatory.");
      if (!weight) throw new Error("Weight is a mandatory field.");
      if (!subjective?.trim()) throw new Error("Subjective notes are mandatory.");
      if (!objective?.trim()) throw new Error("Objective notes are mandatory.");
      if (!assessment?.trim()) throw new Error("Assessment is mandatory.");
      if (!plan?.trim()) throw new Error("Treatment Plan is mandatory.");
      
      if (conductorType === 'EXTERNAL') {
        if (!externalVetName?.trim()) throw new Error("External Vet Name is required.");
        if (!externalClinic?.trim()) throw new Error("External Clinic Name is required.");
      }

      const finalConductedBy = conductorType === 'INTERNAL' ? conductedBy : profile.id;
      const finalConductorRole = conductorType === 'INTERNAL' ? conductorRole : 'EXTERNAL_VET';

      const parsedDateObj = new Date(recordDate);
      const parsedRecordDate = parsedDateObj.toISOString();
      const calculatedAmPm = parsedDateObj.getHours() >= 12 ? 'PM' : 'AM';

      const payload = {
          record_type: recordType, 
          title: title.trim(), 
          record_date: parsedRecordDate, 
          soap_subjective: subjective.trim(), 
          soap_objective: objective.trim(),
          soap_assessment: assessment.trim(),
          soap_plan: plan.trim(),
          conducted_by: finalConductedBy,
          conductor_role: finalConductorRole,
          external_vet_name: conductorType === 'EXTERNAL' ? externalVetName.trim() : null,
          external_vet_clinic: conductorType === 'EXTERNAL' ? externalClinic.trim() : null,
      };

      let returnedRecordId = existingRecord?.id;

      if (isEditMode) {
        let finalWeightLogId = existingRecord.weight_log_id;

        if (finalWeightLogId) {
          const { error: weightError } = await supabase.from('weight_logs').update({
            weight_grams: Number(weight),
            recorded_by: finalConductedBy,
            recorded_at: parsedRecordDate,
            am_pm: calculatedAmPm,
            modified_by: profile.id,
          }).eq('id', finalWeightLogId);
          if (weightError) throw new Error(`Failed to update weight log: ${weightError.message}`);
        } else {
          const { data: newWeightData, error: newWeightError } = await supabase.from('weight_logs').insert({
              animal_id: animalId,
              weight_grams: Number(weight),
              recorded_by: finalConductedBy,
              recorded_at: parsedRecordDate, 
              am_pm: calculatedAmPm,
              created_by: profile.id
          }).select('id').single();
          if (newWeightError) throw new Error(`Failed to create missing weight log: ${newWeightError.message}`);
          finalWeightLogId = newWeightData.id;
        }

        const { error: clinicalError } = await supabase.from('clinical_records').update({
          ...payload,
          modified_by: profile.id,
          weight_log_id: finalWeightLogId 
        }).eq('id', existingRecord.id);

        if (clinicalError) throw new Error(`Clinical Update Error: ${clinicalError.message}`);
        
      } else {
        const { data: weightData, error: weightError } = await supabase.from('weight_logs').insert({
          animal_id: animalId,
          weight_grams: Number(weight),
          recorded_by: finalConductedBy,
          recorded_at: parsedRecordDate, 
          am_pm: calculatedAmPm,
          created_by: profile.id
        }).select('id').single();

        if (weightError) throw new Error(`Failed to secure weight log: ${weightError.message}`);

        const { data: clinicalData, error: clinicalError } = await supabase.from('clinical_records').insert({
          animal_id: animalId,
          ...payload,
          created_by: profile.id, 
          modified_by: profile.id,
          weight_log_id: weightData.id 
        }).select('id').single();

        if (clinicalError) throw new Error(`Clinical Insert Error: ${clinicalError.message}`);
        
        returnedRecordId = clinicalData.id;
      }

      // --- ON SUCCESS ---
      queryClient.invalidateQueries({ queryKey: ['clinical_records', animalId] });
      queryClient.invalidateQueries({ queryKey: ['weight_logs', animalId] }); 
      
      if (requiresMedication) {
        onMARTriggered(returnedRecordId);
      } else {
        toast.success(isEditMode ? 'Clinical Record successfully updated.' : 'Clinical Record officially sealed and logged.');
        onClose();
      }

    } catch (err: any) {
      console.error("Mutation failed:", err);
      toast.error(err.message || "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-50 w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
        
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-white shrink-0">
          <div>
            <h3 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
              <Stethoscope className="text-emerald-500" size={20} />
              {isEditMode ? 'Edit Clinical Entry' : 'New Clinical Entry'}
            </h3>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mt-0.5">Patient: {animalName}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm space-y-5">
                
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Clinical Title / Diagnosis <span className="text-rose-500">*</span></label>
                  <input 
                    type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Suspected Bumblefoot"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-slate-300 placeholder:font-medium"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Record Type <span className="text-rose-500">*</span></label>
                    <select 
                      value={recordType} onChange={(e) => setRecordType(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all cursor-pointer"
                    >
                      <option value="Routine Check">Routine Check</option>
                      <option value="Illness">Illness</option>
                      <option value="Injury">Injury</option>
                      <option value="Surgery">Surgery</option>
                      <option value="Follow up">Follow up</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Date & Time <span className="text-rose-500">*</span></label>
                    <input 
                      type="datetime-local" 
                      value={recordDate} 
                      onChange={(e) => setRecordDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all cursor-pointer"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Current Weight (g) <span className="text-rose-500">*</span></label>
                  <div className="relative">
                    <Scale className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input 
                      type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="e.g. 1250"
                      className="w-full pl-9 pr-4 bg-slate-50 border border-slate-200 rounded-lg py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-slate-300 placeholder:font-medium"
                    />
                  </div>
                  <p className="text-[9px] font-bold text-slate-400 mt-1.5 uppercase tracking-widest flex items-center gap-1">
                    Auto-syncs to Husbandry Logs
                  </p>
                </div>

                {/* MAR PIPELINE TOGGLE */}
                <div className="pt-4 border-t border-slate-100">
                  <label className="flex items-center gap-3 cursor-pointer group w-max">
                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${requiresMedication ? 'bg-rose-500 border-rose-500' : 'bg-slate-50 border-slate-300 group-hover:border-slate-400'}`}>
                      {requiresMedication && <div className="w-2 h-2 bg-white rounded-sm" />}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Pill size={14} className={requiresMedication ? "text-rose-500" : "text-slate-400"} /> 
                        Medication Required?
                      </p>
                    </div>
                  </label>
                  <input type="checkbox" className="sr-only" checked={requiresMedication} onChange={(e) => setRequiresMedication(e.target.checked)} />
                </div>
              </div>

              <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <UserRound size={16} className="text-slate-400" />
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-700">Conductor Details</h4>
                </div>
                
                <div className="flex bg-slate-100 p-1 rounded-lg mb-5">
                  <button
                    onClick={() => setConductorType('INTERNAL')}
                    className={`flex-1 py-1.5 text-xs font-black uppercase tracking-widest rounded-md transition-all ${conductorType === 'INTERNAL' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    Internal
                  </button>
                  <button
                    onClick={() => setConductorType('EXTERNAL')}
                    className={`flex-1 py-1.5 text-xs font-black uppercase tracking-widest rounded-md transition-all ${conductorType === 'EXTERNAL' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    External Vet
                  </button>
                </div>

                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-4">
                  {conductorType === 'INTERNAL' ? (
                    <>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Select Staff Member <span className="text-rose-500">*</span></label>
                        <select 
                          value={conductedBy} 
                          onChange={(e) => setConductedBy(e.target.value)}
                          disabled={isStaffLoading}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all disabled:opacity-50 cursor-pointer"
                        >
                          {staffMembers.map(user => (
                            <option key={user.id} value={user.id}>{user.name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Conductor Role <span className="text-rose-500">*</span></label>
                        <select 
                          value={conductorRole} 
                          onChange={(e) => setConductorRole(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all cursor-pointer"
                        >
                          <option value="Volunteer">Volunteer</option>
                          <option value="Keeper">Keeper</option>
                          <option value="Senior Keeper">Senior Keeper</option>
                          <option value="Head Keeper">Head Keeper / Volunteer</option>
                          <option value="Owner Director">Owner Director</option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-rose-500 mb-2">Attending Vet Name <span className="text-rose-500">*</span></label>
                        <input 
                          type="text" value={externalVetName} onChange={(e) => setExternalVetName(e.target.value)} placeholder="e.g. Dr. Sarah Jenkins"
                          className="w-full bg-white border border-rose-200 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all placeholder:text-slate-300"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-rose-500 mb-2">Clinic Name <span className="text-rose-500">*</span></label>
                        <input 
                          type="text" value={externalClinic} onChange={(e) => setExternalClinic(e.target.value)} placeholder="e.g. City Wildlife Vets"
                          className="w-full bg-white border border-rose-200 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all placeholder:text-slate-300"
                        />
                      </div>
                      <div className="flex items-start gap-2 bg-rose-50 p-3 rounded-lg border border-rose-100">
                        <AlertCircle size={14} className="text-rose-500 mt-0.5 shrink-0" />
                        <p className="text-[10px] font-medium text-rose-800 leading-relaxed uppercase tracking-widest">
                          You will be recorded as the authorizing internal sponsor for this external consultation.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex flex-col gap-5">
              <div className="flex-1 flex flex-col">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-600 mb-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500"></div> S - Subjective (History / Observations) <span className="text-rose-500">*</span>
                </label>
                <textarea 
                  value={subjective} onChange={(e) => setSubjective(e.target.value)} placeholder="Keeper reports bird is reluctant to bear weight..."
                  className="flex-1 w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-y transition-all placeholder:text-slate-300"
                />
              </div>
              
              <div className="flex-1 flex flex-col">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div> O - Objective (Exam Findings / Vitals) <span className="text-rose-500">*</span>
                </label>
                <textarea 
                  value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Grade III Bumblefoot lesion present on left plantar metatarsal pad..."
                  className="flex-1 w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-y transition-all placeholder:text-slate-300"
                />
              </div>

              <div className="flex-1 flex flex-col">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-amber-600 mb-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500"></div> A - Assessment (Diagnosis) <span className="text-rose-500">*</span>
                </label>
                <textarea 
                  value={assessment} onChange={(e) => setAssessment(e.target.value)} placeholder="Pododermatitis (Bumblefoot) - Left Foot."
                  className="flex-1 w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 resize-y transition-all placeholder:text-slate-300"
                />
              </div>

              <div className="flex-1 flex flex-col">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-purple-600 mb-2">
                  <div className="w-2 h-2 rounded-full bg-purple-500"></div> P - Plan (Treatment / Actions) <span className="text-rose-500">*</span>
                </label>
                <textarea 
                  value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="Apply hydrogel dressing. Start Meloxicam 0.5mg/kg PO SID..."
                  className="flex-1 w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 resize-y transition-all placeholder:text-slate-300"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-white flex justify-between items-center shrink-0 rounded-b-2xl">
          {requiresMedication ? (
             <div className="text-[10px] font-bold text-rose-600 uppercase tracking-widest flex items-center gap-1.5 bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-100">
               <Pill size={14} /> MAR Pipeline Engaged
             </div>
          ) : (
            <div />
          )}

          <div className="flex gap-3">
            <button 
              onClick={onClose} 
              disabled={isSubmitting}
              className="px-6 py-2.5 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button 
              onClick={submitMutation}
              disabled={isSubmitting}
              className={`${requiresMedication ? 'bg-rose-500 hover:bg-rose-600' : 'bg-emerald-600 hover:bg-emerald-500'} disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 shadow-sm hover:shadow active:scale-95`}
            >
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : requiresMedication ? <ChevronRight size={16} /> : <ShieldAlert size={16} />}
              {isEditMode ? 'Update Record' : requiresMedication ? 'Seal & Prescribe' : 'Seal Clinical Record'}
            </button>
          </div>
        </div>
        
      </div>
    </div>
  );
}

export default ClinicalRecordsModule;