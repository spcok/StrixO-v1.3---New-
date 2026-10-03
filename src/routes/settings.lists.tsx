import React, { useState, useEffect, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { 
  Utensils, Ticket, Plus, Trash2, Activity, MapPin, 
  Check, X, Edit2, Loader2, Info, CheckCircle2 
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';

export enum AnimalCategory {
  OWL = 'OWL',
  RAPTOR = 'RAPTOR',
  MAMMAL = 'MAMMAL',
  EXOTIC = 'EXOTIC'
}

const CATEGORY_LABELS: Record<AnimalCategory, string> = {
  [AnimalCategory.OWL]: 'Owls',
  [AnimalCategory.RAPTOR]: 'Raptors',
  [AnimalCategory.MAMMAL]: 'Mammals',
  [AnimalCategory.EXOTIC]: 'Exotics'
};

// ------------------------------------------------------------------
// 1. STRICT OFFLINE QUERY OPTIONS
// ------------------------------------------------------------------
const operationalListsOptions = queryOptions({
  queryKey: ['operational_lists'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('operational_lists')
      .select('*')
      .eq('is_deleted', false)
      .order('name', { ascending: true });
    if (error) throw error;
    return data || [];
  },
  staleTime: 1000 * 60 * 60,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

export const Route = createFileRoute('/settings/lists')({
  loader: async ({ context: { queryClient } }) => {
    // @ts-ignore
    if (queryClient) await queryClient.ensureQueryData(operationalListsOptions);
  },
  component: OperationalListsPage,
});

// ------------------------------------------------------------------
// 2. MAIN COMPONENT
// ------------------------------------------------------------------
export function OperationalListsPage() {
  const queryClient = useQueryClient();
  const [listSection, setListSection] = useState<AnimalCategory>(AnimalCategory.OWL);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newValue, setNewValue] = useState<{ [key: string]: string }>({});

  // Supabase Realtime Synchronization
  useEffect(() => {
    const channel = supabase.channel('lists-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operational_lists' }, () => {
        queryClient.invalidateQueries({ queryKey: ['operational_lists'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const { data: allLists = [], isLoading } = useQuery(operationalListsOptions);

  const { foodTypes, feedMethods, eventTypes, locations } = useMemo(() => {
    const currentTab = listSection.toUpperCase();
    
    return {
      foodTypes: allLists.filter((i: any) => 
        i.category?.toLowerCase() === 'food_type' && 
        i.animal_category?.toUpperCase().includes(currentTab)
      ),
      feedMethods: allLists.filter((i: any) => 
        i.category?.toLowerCase() === 'feed_method' && 
        i.animal_category?.toUpperCase().includes(currentTab)
      ),
      eventTypes: allLists.filter((i: any) => i.category?.toLowerCase() === 'event'),
      locations: allLists.filter((i: any) => i.category?.toLowerCase() === 'location'),
    };
  }, [allLists, listSection]);

  const addMutation = useMutation({
    mutationFn: async (payload: any) => {
      const { error } = await supabase.from('operational_lists').insert([payload]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operational_lists'] });
      toast.success('List item added.');
    },
    onError: (err: any) => toast.error(`Failed to add item: ${err.message}`)
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: string, name: string }) => {
      const { error } = await supabase.from('operational_lists').update({ name: payload.name }).eq('id', payload.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operational_lists'] });
      setEditingId(null);
      setEditValue('');
      toast.success('List item updated.');
    },
    onError: (err: any) => toast.error(`Failed to update item: ${err.message}`)
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('operational_lists').update({ is_deleted: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operational_lists'] });
      toast.success('List item deleted.');
    },
    onError: (err: any) => toast.error(`Failed to delete item: ${err.message}`)
  });

  const handleAdd = (type: string, category?: AnimalCategory) => {
    const val = newValue[type];
    if (!val?.trim()) return;

    addMutation.mutate({
      id: crypto.randomUUID(),
      category: type,
      name: val.trim(),
      animal_category: category || null, 
      is_deleted: false
    });

    setNewValue(prev => ({ ...prev, [type]: '' }));
  };

  const handleUpdate = (id: string) => {
    if (!editValue.trim()) return;
    updateMutation.mutate({ id, name: editValue.trim() });
  };

  const startEditing = (id: string, value: string) => {
    setEditingId(id);
    setEditValue(value);
  };

  const renderList = (items: any[], type: string, title: string, icon: React.ReactNode, category?: AnimalCategory) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="p-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-white rounded-lg border border-slate-200 text-slate-700 shadow-sm">
            {icon}
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-900">{title}</h3>
            {category && (
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mt-0.5">
                {CATEGORY_LABELS[category]} Scope
              </span>
            )}
          </div>
        </div>
        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest bg-white px-2 py-0.5 rounded-lg border border-slate-200 shadow-sm">
          {items.length} {items.length === 1 ? 'Item' : 'Items'}
        </span>
      </div>

      {/* Add New Item Input */}
      <div className="p-3 border-b border-slate-100 bg-slate-50/50 shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={newValue[type] || ''}
            onChange={(e) => setNewValue(prev => ({ ...prev, [type]: e.target.value }))}
            placeholder={`Add new ${title.toLowerCase()}...`}
            className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all shadow-sm"
            onKeyDown={(e) => e.key === 'Enter' && handleAdd(type, category)}
          />
          <button
            onClick={() => handleAdd(type, category)}
            disabled={addMutation.isPending && !!newValue[type]?.trim()}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition-all shadow-sm active:scale-95 disabled:opacity-50 flex items-center justify-center shrink-0"
            title={`Add ${title}`}
          >
            {addMutation.isPending && newValue[type]?.length > 0 ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
          </button>
        </div>
      </div>

      {/* List Item Entries */}
      <div className="flex-1 overflow-y-auto custom-scrollbar max-h-[260px] divide-y divide-slate-100 bg-white">
        {items.length === 0 ? (
          <div className="p-6 text-center text-slate-400 flex flex-col items-center justify-center">
            <p className="text-xs font-medium italic">No {title.toLowerCase()} configured yet.</p>
          </div>
        ) : (
          items.map((item, idx) => (
            <div 
              key={item.id ? `${item.id}-${idx}` : `item-${idx}`} 
              className="p-3 flex items-center justify-between group hover:bg-slate-50/80 transition-colors"
            >
              {editingId === item.id ? (
                <div className="flex items-center gap-2 w-full animate-in fade-in duration-150">
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-white border border-slate-900 rounded-lg text-xs font-bold text-slate-900 focus:outline-none shadow-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleUpdate(item.id);
                      if (e.key === 'Escape') {
                        setEditingId(null);
                        setEditValue('');
                      }
                    }}
                  />
                  <button 
                    onClick={() => handleUpdate(item.id)} 
                    disabled={updateMutation.isPending}
                    className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                    title="Save Change"
                  >
                    <Check size={14} />
                  </button>
                  <button 
                    onClick={() => { setEditingId(null); setEditValue(''); }} 
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    title="Cancel"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <span className="text-xs font-bold text-slate-800 truncate pr-2">{item.name}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={() => startEditing(item.id, item.name)}
                      className="p-1 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                      title="Edit Item"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete "${item.name}"?`)) {
                          deleteMutation.mutate(item.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50"
                      title="Delete Item"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col space-y-4 animate-in fade-in duration-300 relative">
      
      {/* --- HEADER CONTROLS --- */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shrink-0">
        <div>
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">
            Operational Taxonomies
          </h3>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
            Manage dropdown selections for husbandry, feeding, locations & events
          </p>
        </div>

        {/* Category Selector Pill Tabs */}
        <div className="flex gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 custom-scrollbar">
          {[AnimalCategory.OWL, AnimalCategory.RAPTOR, AnimalCategory.MAMMAL, AnimalCategory.EXOTIC].map((cat) => (
            <button
              key={cat}
              onClick={() => setListSection(cat)}
              className={`px-3 py-1.5 rounded-xl text-[9px] lg:text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all shadow-sm flex items-center justify-center gap-1.5 shrink-0 ${
                listSection === cat 
                  ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20' 
                  : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center min-h-[300px]">
          <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
            <Loader2 className="animate-spin text-slate-600" size={24} />
            <span className="text-sm font-bold text-slate-700">Loading Operational Lists...</span>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-1">
          {/* Scoped Lists (Scoped to selected animal category) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {renderList(foodTypes, 'food_type', 'Dietary Items', <Utensils size={14} />, listSection)}
            {renderList(feedMethods, 'feed_method', 'Feeding Methods', <Activity size={14} />, listSection)}
          </div>

          {/* Global Lists (Available across entire zoo system) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {renderList(locations, 'location', 'Enclosure Locations', <MapPin size={14} />)}
            {renderList(eventTypes, 'event', 'Daily Event Types', <Ticket size={14} />)}
          </div>

          {/* Data Consistency Callout Banner */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-start gap-3 shadow-inner">
            <div className="p-2 bg-white rounded-xl border border-slate-200 text-slate-600 shrink-0 shadow-sm">
              <Info size={16} />
            </div>
            <div>
              <h4 className="text-xs font-black uppercase tracking-widest text-slate-900">
                Taxonomy Scoping Protocol
              </h4>
              <p className="text-[11px] font-medium text-slate-600 mt-0.5 leading-relaxed">
                Dietary items and feed methods are dynamically scoped to the selected animal category ({CATEGORY_LABELS[listSection]}). Enclosure locations and daily event types remain globally accessible across all husbandry modules.
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default OperationalListsPage;