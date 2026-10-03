import React, { useState, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { 
  ArrowRightLeft, Plus, Calendar, Search, 
  Loader2, X, ShieldCheck
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { ExternalTransfer, Animal } from '../types';

const externalTransfersOptions = queryOptions({
  queryKey: ['external_transfers'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('external_transfers')
      .select('*, animals(id, name, species, ring_number, record_type, profile_image_url, category)')
      .order('transfer_date', { ascending: false });
    if (error) throw error;
    return (data || []) as ExternalTransfer[];
  },
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

const animalsSelectListOptions = queryOptions({
  queryKey: ['animals_transfer_select_list'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('animals')
      .select('id, name, species, ring_number, category, status')
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []) as Animal[];
  },
  staleTime: 1000 * 60 * 10
});

export const Route = createFileRoute('/logistics/external-transfers')({
  loader: async ({ context }: any) => {
    if (context?.queryClient) {
      await Promise.all([
        context.queryClient.ensureQueryData(externalTransfersOptions),
        context.queryClient.ensureQueryData(animalsSelectListOptions)
      ]);
    }
  },
  component: ExternalTransfersPage,
});

const TRANSFER_TYPES = [
  'ACQUISITION',
  'DISPOSITION',
  'LOAN_OUT',
  'LOAN_IN',
  'RELEASE'
] as const;

export function ExternalTransfersPage() {
  const queryClient = useQueryClient();
  const { user, profile, hasPermission } = useAuth();
  const isAuthorized = hasPermission('transfers:approve') || ['ADMIN', 'DIRECTOR'].includes(profile?.role || '');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');

  const [form, setForm] = useState({
    animal_id: '',
    transfer_type: TRANSFER_TYPES[0],
    transfer_date: format(new Date(), 'yyyy-MM-dd'),
    entity_name: '',
    entity_contact: '',
    reason: '',
    transport_details: '',
    authorized_by: profile?.name || user?.email || ''
  });

  const { data: transfers = [], isLoading } = useQuery(externalTransfersOptions);
  const { data: animals = [] } = useQuery(animalsSelectListOptions);

  const createTransferMutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      const { data, error } = await supabase
        .from('external_transfers')
        .insert([{
          animal_id: payload.animal_id || null,
          transfer_type: payload.transfer_type,
          transfer_date: payload.transfer_date,
          entity_name: payload.entity_name,
          entity_contact: payload.entity_contact || null,
          reason: payload.reason || null,
          transport_details: payload.transport_details || null,
          authorized_by: payload.authorized_by
        }])
        .select()
        .single();

      if (error) throw error;

      if (payload.animal_id) {
        let newStatus: string = 'ACTIVE';
        if (payload.transfer_type === 'DISPOSITION') newStatus = 'TRANSFERRED';
        if (payload.transfer_type === 'LOAN_OUT') newStatus = 'OFF_SITE';
        if (payload.transfer_type === 'RELEASE') newStatus = 'ARCHIVED';

        await supabase
          .from('animals')
          .update({ status: newStatus as any })
          .eq('id', payload.animal_id);
      }

      return data;
    },
    onSuccess: () => {
      toast.success('External transfer recorded and animal status synchronized.');
      queryClient.invalidateQueries({ queryKey: ['external_transfers'] });
      queryClient.invalidateQueries({ queryKey: ['animals'] });
      setIsModalOpen(false);
      setForm({
        animal_id: '',
        transfer_type: TRANSFER_TYPES[0],
        transfer_date: format(new Date(), 'yyyy-MM-dd'),
        entity_name: '',
        entity_contact: '',
        reason: '',
        transport_details: '',
        authorized_by: profile?.name || user?.email || ''
      });
    },
    onError: (err: any) => {
      toast.error(`Failed to record transfer: ${err.message}`);
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.entity_name.trim()) {
      return toast.error('Please specify the recipient or source institution.');
    }
    createTransferMutation.mutate(form);
  };

  const filteredTransfers = useMemo(() => {
    return transfers.filter(t => {
      const matchesType = selectedType === 'ALL' || t.transfer_type === selectedType;
      const animal = Array.isArray(t.animals) ? t.animals[0] : t.animals;
      const q = searchQuery.toLowerCase();

      const matchesSearch = !q ||
        t.entity_name.toLowerCase().includes(q) ||
        (animal?.name || '').toLowerCase().includes(q) ||
        (animal?.species || '').toLowerCase().includes(q) ||
        (animal?.ring_number || '').toLowerCase().includes(q) ||
        (t.reason || '').toLowerCase().includes(q) ||
        (t.authorized_by || '').toLowerCase().includes(q);

      return matchesType && matchesSearch;
    });
  }, [transfers, selectedType, searchQuery]);

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-4 animate-in fade-in duration-300 w-full font-sans">
      
      {/* Header */}
      <div className="flex justify-between items-start w-full mb-1 shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1">
          <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none flex items-center gap-2.5">
            <ArrowRightLeft className="text-slate-800" size={22} />
            External Transfers & Dispositions
          </h1>
          <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
            Statutory Zoo Licensing Act (ZLA) Section 9 Acquisitions, Loans & Dispositions
          </p>
        </div>

        {isAuthorized && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
          >
            <Plus size={14} className="text-emerald-400" />
            <span>Record Transfer</span>
          </button>
        )}
      </div>

      {/* Control Bar */}
      <div className="bg-slate-50/90 p-3 rounded-2xl border border-slate-200 shadow-inner flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar w-full sm:w-auto">
          <button
            onClick={() => setSelectedType('ALL')}
            className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest whitespace-nowrap transition-all shadow-sm ${
              selectedType === 'ALL'
                ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
                : 'bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700 border border-slate-200'
            }`}
          >
            All Transfers
          </button>
          {TRANSFER_TYPES.map(type => (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest whitespace-nowrap transition-all shadow-sm ${
                selectedType === type
                  ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
                  : 'bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700 border border-slate-200'
              }`}
            >
              {type.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
          <input
            type="text"
            placeholder="Search institution, animal, ring..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-slate-900 outline-none shadow-sm"
          />
        </div>
      </div>

      {/* Transfer List Table */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50/30">
          
          <div className="hidden lg:grid grid-cols-12 border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-10 backdrop-blur-md px-5 py-3.5">
            <div className="col-span-3">Transfer Type & Institution</div>
            <div className="col-span-3">Animal Details</div>
            <div className="col-span-2">Date</div>
            <div className="col-span-4">Terms, Notes & Authority</div>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
              <Loader2 size={24} className="animate-spin text-slate-600" />
              <span className="text-xs font-black uppercase tracking-widest text-slate-600">Loading Transfer History...</span>
            </div>
          ) : filteredTransfers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2 p-8">
              <ShieldCheck size={36} className="opacity-20" />
              <span className="text-xs font-black uppercase tracking-widest">No External Transfers Found</span>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredTransfers.map((t) => {
                const animal = Array.isArray(t.animals) ? t.animals[0] : t.animals;
                const dateStr = t.transfer_date ? format(parseISO(t.transfer_date), 'dd MMM yyyy') : '-';

                return (
                  <div key={t.id} className="p-4 lg:px-5 lg:py-3.5 bg-white hover:bg-slate-50/80 transition-colors">
                    {/* Mobile Card */}
                    <div className="lg:hidden space-y-2.5">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                        <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-800 border border-slate-200">
                          {t.transfer_type.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500">{dateStr}</span>
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-xs">{t.entity_name}</h4>
                        <p className="text-[10px] text-slate-500">{animal ? `${animal.name} (${animal.species || '-'})` : 'General / Mob Disposition'}</p>
                      </div>
                      {t.reason && <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg">{t.reason}</p>}
                    </div>

                    {/* Desktop Row */}
                    <div className="hidden lg:grid grid-cols-12 items-center text-xs">
                      <div className="col-span-3 min-w-0 pr-4">
                        <span className="inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-800 border border-slate-200 mb-1">
                          {t.transfer_type.replace(/_/g, ' ')}
                        </span>
                        <p className="font-bold text-slate-900 truncate">{t.entity_name}</p>
                      </div>

                      <div className="col-span-3 min-w-0 pr-4">
                        <p className="font-bold text-slate-800 truncate">{animal?.name || 'General / Group'}</p>
                        <p className="text-[10px] text-slate-400 truncate">{animal?.species || '-'} {animal?.ring_number ? `• ${animal.ring_number}` : ''}</p>
                      </div>

                      <div className="col-span-2 text-slate-700 font-bold flex items-center gap-1.5">
                        <Calendar size={12} className="text-slate-400" />
                        <span>{dateStr}</span>
                      </div>

                      <div className="col-span-4 min-w-0">
                        <p className="font-medium text-slate-700 truncate">{t.reason || 'ZLA Regulatory Transfer'}</p>
                        <p className="text-[10px] text-slate-400 truncate">Auth: {t.authorized_by || 'Director'}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Record Transfer Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="font-black text-slate-900 uppercase tracking-widest text-xs flex items-center gap-2">
                <ArrowRightLeft size={15} className="text-slate-700" />
                Record External Transfer / Disposition
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 overflow-y-auto custom-scrollbar space-y-4 text-xs font-medium">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Transfer Category *
                  </label>
                  <select
                    required
                    value={form.transfer_type}
                    onChange={(e) => setForm({ ...form, transfer_type: e.target.value as any })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                  >
                    {TRANSFER_TYPES.map(type => (
                      <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Transfer Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={form.transfer_date}
                    onChange={(e) => setForm({ ...form, transfer_date: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Transferred Animal (Optional for general groups)
                </label>
                <select
                  value={form.animal_id}
                  onChange={(e) => setForm({ ...form, animal_id: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                >
                  <option value="">-- General / Unspecified Group --</option>
                  {animals.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.species || a.category}) {a.ring_number ? `[${a.ring_number}]` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Institution / Entity Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Chester Zoo"
                    value={form.entity_name}
                    onChange={(e) => setForm({ ...form, entity_name: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Authorizing Director/Staff *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.authorized_by}
                    onChange={(e) => setForm({ ...form, authorized_by: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Contact Details (Email / Phone / Contact Person)
                </label>
                <input
                  type="text"
                  placeholder="e.g. curator@chesterzoo.org / +44 1244 380280"
                  value={form.entity_contact}
                  onChange={(e) => setForm({ ...form, entity_contact: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Reason & Transfer Terms
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. European Endangered Species Programme (EEP) breeding loan, permanent sanctuary transfer..."
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createTransferMutation.isPending}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-widest rounded-xl disabled:opacity-50 flex items-center gap-2 shadow-sm"
                >
                  {createTransferMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  <span>Save Transfer</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default ExternalTransfersPage;