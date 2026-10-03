import React, { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ticket, Plus, Trash2, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';

export const EXPERIENCE_OPTIONS = [
  "The Owl Experience",
  "The Owl Encounter",
  "The Owl and Meerkat Experience",
  "Meet the Meerkats",
  "Junior Keeper's Experience",
  "The Children's experience",
  "Static Owl and Animal Workshop",
  "Full Day Owl and Animal Workshop",
  "Photo Workshop",
  "Full Day Photo Workshop",
  "The Big Snake Experience",
  "The Eagle Experience",
  "The Raptor Experience",
  "Skunk Meet and Greet",
  "Ferret Meet and Greet",
  "Lizard Meet and Greet",
  "Owl Meet and Greet",
  "Tawny Frogmouth Meet and Greet",
  "American Kestrel Meet and Greet",
  "Tenrec Meet and Greet",
  "Snake Meet and Greet",
  "Christmas Sale - Owl Encounter",
  "Adoption Meet and Greet"
];

interface ExperienceItem {
  id: string;
  itemName: string;
  participants: number;
  guests: number;
}

interface IssueVoucherModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function IssueVoucherModal({ isOpen, onClose }: IssueVoucherModalProps) {
  const queryClient = useQueryClient();

  const [issueForm, setIssueForm] = useState({
    customerName: '',
    customerEmail: '',
    purchaseDate: new Date().toISOString().split('T')[0]!,
    transactionId: '',
    experiences: [
      { 
        id: crypto.randomUUID(), 
        itemName: EXPERIENCE_OPTIONS[0]!, 
        participants: 1, 
        guests: 0 
      }
    ] as ExperienceItem[]
  });

  const issueMutation = useMutation({
    mutationFn: async (payload: typeof issueForm) => {
      const { data, error } = await supabase.functions.invoke('issue-manual-voucher', {
        body: payload,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Vouchers issued and emailed successfully.');
      onClose();
      setIssueForm({ 
        customerName: '', 
        customerEmail: '', 
        purchaseDate: new Date().toISOString().split('T')[0]!,
        transactionId: '',
        experiences: [{ id: crypto.randomUUID(), itemName: EXPERIENCE_OPTIONS[0]!, participants: 1, guests: 0 }]
      });
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['all_vouchers_directory'] });
    },
    onError: (error: any) => {
      toast.error(`Failed to issue voucher: ${error.message || 'Server error'}`);
    }
  });

  const updateExperience = (id: string, field: keyof ExperienceItem, value: any) => {
    setIssueForm(prev => ({
      ...prev,
      experiences: prev.experiences.map(exp => exp.id === id ? { ...exp, [field]: value } : exp)
    }));
  };

  const removeExperience = (id: string) => {
    setIssueForm(prev => ({
      ...prev,
      experiences: prev.experiences.filter(exp => exp.id !== id)
    }));
  };

  const addExperience = () => {
    setIssueForm(prev => ({
      ...prev,
      experiences: [
        ...prev.experiences, 
        { id: crypto.randomUUID(), itemName: EXPERIENCE_OPTIONS[0]!, participants: 1, guests: 0 }
      ]
    }));
  };

  const handleIssueSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!issueForm.customerName || !issueForm.customerEmail || !issueForm.purchaseDate || issueForm.experiences.length === 0) {
      return toast.error("Please fill in all required fields and add at least one experience.");
    }
    issueMutation.mutate(issueForm);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200 font-sans text-left">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 max-h-[90vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <div>
            <h2 className="font-black text-slate-900 uppercase tracking-widest text-sm flex items-center gap-2">
              <Ticket size={16} className="text-emerald-600" />
              Issue Experience Voucher
            </h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">
              Manual provision &amp; automated email dispatch
            </p>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            className="text-slate-400 hover:text-slate-700 transition-colors p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
        
        <form onSubmit={handleIssueSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
            
            {/* Customer Information Block */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-2 gap-4">
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Customer Name *
                </label>
                <input 
                  type="text" 
                  required 
                  placeholder="e.g. Sarah Jenkins"
                  value={issueForm.customerName} 
                  onChange={e => setIssueForm({...issueForm, customerName: e.target.value})} 
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none" 
                />
              </div>

              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Customer Email *
                </label>
                <input 
                  type="email" 
                  required 
                  placeholder="e.g. sarah@example.com"
                  value={issueForm.customerEmail} 
                  onChange={e => setIssueForm({...issueForm, customerEmail: e.target.value})} 
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none" 
                />
              </div>

              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Purchase Date *
                </label>
                <input 
                  type="date" 
                  required 
                  value={issueForm.purchaseDate} 
                  onChange={e => setIssueForm({...issueForm, purchaseDate: e.target.value})} 
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none" 
                />
              </div>

              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Transaction ID / Ref (Optional)
                </label>
                <input 
                  type="text" 
                  placeholder="e.g. MANUAL-12345 or Cash" 
                  value={issueForm.transactionId} 
                  onChange={e => setIssueForm({...issueForm, transactionId: e.target.value})} 
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none" 
                />
              </div>
            </div>

            {/* Experience Items Roster */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-800">
                  Experience Items ({issueForm.experiences.length})
                </h3>
                <button 
                  type="button" 
                  onClick={addExperience} 
                  className="text-[10px] font-black uppercase tracking-widest text-slate-900 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Plus size={12}/> Add Item
                </button>
              </div>

              <div className="space-y-3">
                {issueForm.experiences.map((exp) => (
                  <div key={exp.id} className="grid grid-cols-12 gap-3 items-end bg-white border border-slate-200 p-3.5 rounded-xl shadow-xs">
                    <div className="col-span-12 md:col-span-6">
                      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">
                        Experience Type
                      </label>
                      <select 
                        required 
                        value={exp.itemName} 
                        onChange={e => updateExperience(exp.id, 'itemName', e.target.value)} 
                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none cursor-pointer"
                      >
                        {EXPERIENCE_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>

                    <div className="col-span-5 md:col-span-2">
                      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">
                        Participants
                      </label>
                      <input 
                        type="number" 
                        min="1" 
                        required 
                        value={exp.participants} 
                        onChange={e => updateExperience(exp.id, 'participants', parseInt(e.target.value, 10) || 1)} 
                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none" 
                      />
                    </div>

                    <div className="col-span-5 md:col-span-2">
                      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">
                        Guests
                      </label>
                      <input 
                        type="number" 
                        min="0" 
                        required 
                        value={exp.guests} 
                        onChange={e => updateExperience(exp.id, 'guests', parseInt(e.target.value, 10) || 0)} 
                        className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 outline-none" 
                      />
                    </div>

                    <div className="col-span-2 md:col-span-2 flex justify-end pb-0.5">
                      {issueForm.experiences.length > 1 && (
                        <button 
                          type="button" 
                          onClick={() => removeExperience(exp.id)} 
                          className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Remove item"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
          
          {/* Footer Submit Buttons */}
          <div className="p-5 flex justify-end gap-3 border-t border-slate-100 bg-slate-50 shrink-0">
            <button 
              type="button" 
              onClick={onClose} 
              className="px-5 py-2.5 text-xs font-bold text-slate-500 hover:bg-slate-200 rounded-xl transition-colors uppercase tracking-widest cursor-pointer"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={issueMutation.isPending || issueForm.experiences.length === 0} 
              className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black rounded-xl disabled:opacity-50 transition-colors flex items-center gap-2 uppercase tracking-widest shadow-xs active:scale-95 cursor-pointer"
            >
              {issueMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Ticket size={14} className="text-emerald-400" />}
              <span>{issueMutation.isPending ? 'Issuing...' : 'Issue All Tickets'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default IssueVoucherModal;