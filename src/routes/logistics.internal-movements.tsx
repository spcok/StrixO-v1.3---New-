import React, { useState, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { 
  MapPin, Plus, Calendar, ArrowRight, Search, 
  Loader2, X, ShieldCheck
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { InternalMovement, Animal } from '../types';

const internalMovementsOptions = queryOptions({
  queryKey: ['internal_movements'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('internal_movements')
      .select('*, animals(id, name, species, ring_number, record_type, profile_image_url, category, location)')
      .order('movement_date', { ascending: false });
    if (error) throw error;
    return (data || []) as InternalMovement[];
  },
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

const animalsListOptions = queryOptions({
  queryKey: ['animals_select_list'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('animals')
      .select('id, name, species, ring_number, location, category, profile_image_url')
      .neq('status', 'ARCHIVED')
      .neq('status', 'DECEASED')
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []) as Animal[];
  },
  staleTime: 1000 * 60 * 10
});

export const Route = createFileRoute('/logistics/internal-movements')({
  loader: async ({ context }: any) => {
    if (context?.queryClient) {
      await Promise.all([
        context.queryClient.ensureQueryData(internalMovementsOptions),
        context.queryClient.ensureQueryData(animalsListOptions)
      ]);
    }
  },
  component: InternalMovementsPage,
});

export function InternalMovementsPage() {
  const queryClient = useQueryClient();
  const { user, profile, hasPermission } = useAuth();
  const isAuthorized = hasPermission('transfers:write') || ['ADMIN', 'DIRECTOR', 'MANAGER', 'SENIOR_KEEPER'].includes(profile?.role || '');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  const [form, setForm] = useState({
    animal_id: '',
    movement_date: format(new Date(), 'yyyy-MM-dd'),
    from_enclosure: '',
    to_enclosure: '',
    reason: '',
    authorized_by: profile?.name || user?.email || ''
  });

  const { data: movements = [], isLoading } = useQuery(internalMovementsOptions);
  const { data: animals = [] } = useQuery(animalsListOptions);

  const createMovementMutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      const { data, error } = await supabase
        .from('internal_movements')
        .insert([{
          animal_id: payload.animal_id,
          movement_date: payload.movement_date,
          from_location: payload.from_enclosure || null,
          to_location: payload.to_enclosure,
          reason: payload.reason || null,
          authorized_by: payload.authorized_by
        }])
        .select()
        .single();

      if (error) throw error;

      await supabase
        .from('animals')
        .update({ location: payload.to_enclosure })
        .eq('id', payload.animal_id);

      return data;
    },
    onSuccess: () => {
      toast.success('Internal movement recorded and animal location updated.');
      queryClient.invalidateQueries({ queryKey: ['internal_movements'] });
      queryClient.invalidateQueries({ queryKey: ['animals'] });
      queryClient.invalidateQueries({ queryKey: ['animals_select_list'] });
      setIsModalOpen(false);
      setForm({
        animal_id: '',
        movement_date: format(new Date(), 'yyyy-MM-dd'),
        from_enclosure: '',
        to_enclosure: '',
        reason: '',
        authorized_by: profile?.name || user?.email || ''
      });
    },
    onError: (err: any) => {
      toast.error(`Failed to record movement: ${err.message}`);
    }
  });

  const handleAnimalSelect = (animalId: string) => {
    const selected = animals.find(a => a.id === animalId);
    setForm(prev => ({
      ...prev,
      animal_id: animalId,
      from_enclosure: selected?.location || selected?.enclosure || ''
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.animal_id || !form.to_enclosure.trim()) {
      return toast.error('Please select an animal and specify the destination enclosure.');
    }
    createMovementMutation.mutate(form);
  };

  const filteredMovements = useMemo(() => {
    return movements.filter(m => {
      const animal = Array.isArray(m.animals) ? m.animals[0] : m.animals;
      const matchesCategory = selectedCategory === 'ALL' || animal?.category === selectedCategory;
      const q = searchQuery.toLowerCase();

      const matchesSearch = !q ||
        (animal?.name || '').toLowerCase().includes(q) ||
        (animal?.species || '').toLowerCase().includes(q) ||
        (animal?.ring_number || '').toLowerCase().includes(q) ||
        (m.from_location || m.from_enclosure || '').toLowerCase().includes(q) ||
        (m.to_location || m.to_enclosure || '').toLowerCase().includes(q) ||
        (m.reason || '').toLowerCase().includes(q) ||
        (m.authorized_by || '').toLowerCase().includes(q);

      return matchesCategory && matchesSearch;
    });
  }, [movements, selectedCategory, searchQuery]);

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-4 animate-in fade-in duration-300 w-full font-sans">
      
      {/* Header */}
      <div className="flex justify-between items-start w-full mb-1 shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1">
          <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none flex items-center gap-2.5">
            <MapPin className="text-slate-800" size={22} />
            Internal Movements & Enclosure Changes
          </h1>
          <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
            Statutory Zoo Licensing Act (ZLA) On-Site Relocation Ledger
          </p>
        </div>

        {isAuthorized && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 shrink-0"
          >
            <Plus size={14} className="text-emerald-400" />
            <span>Record Movement</span>
          </button>
        )}
      </div>

      {/* Control Bar */}
      <div className="bg-slate-50/90 p-3 rounded-2xl border border-slate-200 shadow-inner flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar w-full sm:w-auto">
          {['ALL', 'OWL', 'RAPTOR', 'MAMMAL', 'EXOTIC'].map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest whitespace-nowrap transition-all shadow-sm ${
                selectedCategory === cat
                  ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
                  : 'bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700 border border-slate-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
          <input
            type="text"
            placeholder="Search animal, enclosure, staff..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-medium focus:ring-2 focus:ring-slate-900 outline-none shadow-sm"
          />
        </div>
      </div>

      {/* Movement List Table */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50/30">
          
          <div className="hidden lg:grid grid-cols-12 border-b border-slate-200 bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-10 backdrop-blur-md px-5 py-3.5">
            <div className="col-span-4">Animal Details</div>
            <div className="col-span-2">Date</div>
            <div className="col-span-3">Relocation Route</div>
            <div className="col-span-3">Reason & Authorizer</div>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
              <Loader2 size={24} className="animate-spin text-slate-600" />
              <span className="text-xs font-black uppercase tracking-widest text-slate-600">Loading Movement History...</span>
            </div>
          ) : filteredMovements.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2 p-8">
              <ShieldCheck size={36} className="opacity-20" />
              <span className="text-xs font-black uppercase tracking-widest">No Movement Records Found</span>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredMovements.map((m) => {
                const animal = Array.isArray(m.animals) ? m.animals[0] : m.animals;
                const fromLoc = m.from_location || m.from_enclosure || 'Unassigned';
                const toLoc = m.to_location || m.to_enclosure || '-';
                const dateStr = m.movement_date ? format(parseISO(m.movement_date), 'dd MMM yyyy') : '-';

                return (
                  <div key={m.id} className="p-4 lg:px-5 lg:py-3.5 bg-white hover:bg-slate-50/80 transition-colors">
                    {/* Mobile Card */}
                    <div className="lg:hidden space-y-2.5">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                        <div>
                          <h4 className="font-bold text-slate-900 text-xs">{animal?.name || 'Unknown'}</h4>
                          <p className="text-[10px] text-slate-400 font-medium">{animal?.species || '-'}</p>
                        </div>
                        <span className="text-[10px] font-bold text-slate-500">{dateStr}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                        <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{fromLoc}</span>
                        <ArrowRight size={13} className="text-slate-400" />
                        <span className="bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded border border-emerald-200">{toLoc}</span>
                      </div>
                      {m.reason && <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg">{m.reason}</p>}
                    </div>

                    {/* Desktop Row */}
                    <div className="hidden lg:grid grid-cols-12 items-center text-xs">
                      <div className="col-span-4 min-w-0 pr-4">
                        <p className="font-bold text-slate-900 truncate">{animal?.name || 'Unknown'}</p>
                        <p className="text-[10px] text-slate-400 truncate">{animal?.species || '-'} {animal?.ring_number ? `• ${animal.ring_number}` : ''}</p>
                      </div>

                      <div className="col-span-2 text-slate-700 font-bold flex items-center gap-1.5">
                        <Calendar size={12} className="text-slate-400" />
                        <span>{dateStr}</span>
                      </div>

                      <div className="col-span-3 flex items-center gap-2 font-bold min-w-0 pr-2">
                        <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200 truncate">{fromLoc}</span>
                        <ArrowRight size={12} className="text-slate-400 shrink-0" />
                        <span className="bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded border border-emerald-200 truncate">{toLoc}</span>
                      </div>

                      <div className="col-span-3 min-w-0">
                        <p className="font-medium text-slate-700 truncate">{m.reason || 'Routine Relocation'}</p>
                        <p className="text-[10px] text-slate-400 truncate">Auth: {m.authorized_by || 'Staff Lead'}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Record Movement Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="font-black text-slate-900 uppercase tracking-widest text-xs flex items-center gap-2">
                <MapPin size={15} className="text-slate-700" />
                Record Internal Movement
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 overflow-y-auto custom-scrollbar space-y-4 text-xs font-medium">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Select Animal *
                </label>
                <select
                  required
                  value={form.animal_id}
                  onChange={(e) => handleAnimalSelect(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                >
                  <option value="">-- Choose Animal --</option>
                  {animals.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.species || a.category}) {a.location ? `[Curr: ${a.location}]` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Movement Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={form.movement_date}
                    onChange={(e) => setForm({ ...form, movement_date: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Authorizing Staff *
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Origin Enclosure
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Aviary 4"
                    value={form.from_enclosure}
                    onChange={(e) => setForm({ ...form, from_enclosure: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Destination Enclosure *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Flight Barn 2"
                    value={form.to_enclosure}
                    onChange={(e) => setForm({ ...form, to_enclosure: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Reason for Relocation
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Scheduled breeding season pairing, display rotation, enclosure maintenance..."
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
                  disabled={createMovementMutation.isPending}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-widest rounded-xl disabled:opacity-50 flex items-center gap-2 shadow-sm"
                >
                  {createMovementMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  <span>Save Movement</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default InternalMovementsPage;