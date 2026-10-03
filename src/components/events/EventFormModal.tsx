import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { 
  Sparkles, 
  X, 
  Users, 
  Feather, 
  Lock, 
  Loader2, 
  Check, 
  Pencil,
  Search,
  Bird
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import type { Animal, Voucher } from '../../types';

export interface EventsCalendar {
  id: string;
  title: string;
  event_type: 'WEDDING' | 'SCHOOL_TALK' | 'PARTY' | 'EXPERIENCE' | 'OTHER';
  description?: string | null;
  start_time: string;
  end_time: string;
  rehearsal_time?: string | null;
  rehearsal_at_centre_date?: string | null;
  rehearsal_at_centre_time?: string | null;
  venue_address: string;
  wedding_ring_delivery_only?: boolean;
  wedding_flying_participant?: string | null;
  school_talk_curriculum?: string | null;
  party_type?: string | null;
  site_contact_name: string;
  site_contact_phone?: string | null;
  voucher_id?: string | null;
  created_by?: string | null;
  is_deleted?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface EventCommercial {
  id?: string;
  event_id: string;
  client_full_name: string;
  client_email?: string | null;
  client_billing_address?: string | null;
  payment_status: 'UNPAID' | 'DEPOSIT_PAID' | 'PAID_IN_FULL' | 'NOT_APPLICABLE' | string;
  total_amount: number;
  deposit_amount: number;
  deposit_due_date?: string | null;
  balance_due_date?: string | null;
  xero_invoice_number?: string | null;
  billing_notes?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface EventStaffAllocation {
  id?: string;
  event_id: string;
  user_id: string;
  created_by?: string | null;
}

export interface EventAnimalAllocation {
  id?: string;
  event_id: string;
  animal_id: string;
  role_description?: string | null;
  created_by?: string | null;
}

export interface UserProfile {
  id: string;
  name: string;
  initials?: string | null;
  role?: string | null;
}

export interface FullEventEntry extends EventsCalendar {
  commercials?: EventCommercial | null;
  staff_allocations?: (EventStaffAllocation & { users?: Partial<UserProfile> | null })[];
  animal_allocations?: (EventAnimalAllocation & { animals?: Partial<Animal> | null })[];
}

export interface EventFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  event?: FullEventEntry | null;
  voucher?: Voucher | null;
  animals?: Animal[];
  staffList?: UserProfile[];
  initialDate?: string;
}

// ------------------------------------------------------------------
// ANIMAL SECTION RESOLVER (OWL / RAPTOR / MAMMAL / EXOTIC)
// ------------------------------------------------------------------
export type AnimalSection = 'ALL' | 'OWL' | 'RAPTOR' | 'MAMMAL' | 'EXOTIC';

export const resolveAnimalSection = (animal: Animal): AnimalSection => {
  const text = `${animal.name || ''} ${animal.species || ''} ${(animal as any).category || ''}`.toLowerCase();

  // 1. Owls
  if (
    text.includes('owl') || 
    text.includes('tyto') || 
    text.includes('bubo') || 
    text.includes('strix') || 
    text.includes('athene') || 
    text.includes('boobook') ||
    text.includes('tawny')
  ) {
    return 'OWL';
  }

  // 2. Raptors (Diurnal Birds of Prey)
  if (
    text.includes('hawk') || 
    text.includes('falcon') || 
    text.includes('eagle') || 
    text.includes('buzzard') || 
    text.includes('kite') || 
    text.includes('harrier') || 
    text.includes('kestrel') || 
    text.includes('vulture') || 
    text.includes('caracara')
  ) {
    return 'RAPTOR';
  }

  // 3. Mammals
  if (
    text.includes('meerkat') || 
    text.includes('tenrec') || 
    text.includes('skunk') || 
    text.includes('ferret') || 
    text.includes('armadillo') || 
    text.includes('possum') || 
    text.includes('fox') || 
    text.includes('mammal')
  ) {
    return 'MAMMAL';
  }

  // 4. Exotics
  return 'EXOTIC';
};

const getLocalDateString = (d = new Date()): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const extractTimeInput = (isoOrTime: string | null | undefined): string => {
  if (!isoOrTime) return '';
  if (isoOrTime.length === 5 && isoOrTime.includes(':')) return isoOrTime;
  const d = new Date(isoOrTime);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const extractDateInput = (isoOrDate: string | null | undefined): string => {
  if (!isoOrDate) return '';
  if (isoOrDate.length === 10 && isoOrDate.includes('-')) return isoOrDate;
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  return getLocalDateString(d);
};

// Safe helper to combine date and time into an ISO string for PostgreSQL timestamptz columns
const combineDateAndTimeToISO = (dateStr: string | null | undefined, timeStr: string | null | undefined): string | null => {
  if (!timeStr || !timeStr.trim()) return null;
  
  // If already an ISO timestamp
  if (timeStr.includes('T') && !isNaN(new Date(timeStr).getTime())) {
    return new Date(timeStr).toISOString();
  }

  const baseDate = dateStr && dateStr.trim() ? dateStr.trim() : getLocalDateString();
  const cleanDate = baseDate.includes('T') ? baseDate.split('T')[0] : baseDate;
  const cleanTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;

  const combined = new Date(`${cleanDate}T${cleanTime}`);
  if (isNaN(combined.getTime())) return null;
  return combined.toISOString();
};

const defaultFormState = {
  title: '',
  event_type: 'WEDDING' as EventsCalendar['event_type'],
  description: '',
  start_date: getLocalDateString(),
  start_time: '12:00',
  end_time: '14:00',
  venue_address: 'Kent Life, Lock Lane, Maidstone ME14 3AU',
  wedding_ring_delivery_only: false,
  wedding_flying_participant: '',
  rehearsal_time: '',
  rehearsal_at_centre_date: getLocalDateString(),
  rehearsal_at_centre_time: '',
  school_talk_curriculum: '',
  party_type: '',
  site_contact_name: '',
  site_contact_phone: '',
  voucher_id: '',
  client_full_name: '',
  client_email: '',
  client_billing_address: '',
  payment_status: 'UNPAID',
  total_amount: 0,
  deposit_amount: 0,
  deposit_due_date: '',
  balance_due_date: '',
  xero_invoice_number: '',
  billing_notes: '',
  selected_staff_ids: [] as string[],
  selected_animals: [] as { animal_id: string; role_description: string }[],
};

export function EventFormModal({
  isOpen,
  onClose,
  event,
  voucher,
  animals: propAnimals,
  staffList: propStaff,
  initialDate,
}: EventFormModalProps) {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  const [form, setForm] = useState(defaultFormState);
  const [animalSearchQuery, setAnimalSearchQuery] = useState('');
  const [animalSectionFilter, setAnimalSectionFilter] = useState<AnimalSection>('ALL');
  const [staffSearchQuery, setStaffSearchQuery] = useState('');

  // Fallback query filtering strictly for ON_DISPLAY animals
  const { data: queriedAnimals = [], isLoading: isLoadingAnimals } = useQuery({
    queryKey: ['animals_event_select'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('animals')
        .select('id, name, species, ring_number, location, status, profile_image_url')
        .eq('status', 'ON_DISPLAY')
        .order('name', { ascending: true });
        
      if (error) throw error;
      return (data || []) as Animal[];
    },
    enabled: isOpen && (!propAnimals || propAnimals.length === 0),
    staleTime: 1000 * 60 * 15,
  });

  const { data: queriedStaff = [] } = useQuery({
    queryKey: ['staff_event_select'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, initials, role')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as UserProfile[];
    },
    enabled: isOpen && (!propStaff || propStaff.length === 0),
    staleTime: 1000 * 60 * 15,
  });

  const animals = propAnimals && propAnimals.length > 0 ? propAnimals : queriedAnimals;
  const staffList = propStaff && propStaff.length > 0 ? propStaff : queriedStaff;

  useEffect(() => {
    if (!isOpen) return;

    if (event) {
      const comm = event.commercials;
      setForm({
        title: event.title,
        event_type: event.event_type as EventsCalendar['event_type'],
        description: event.description || '',
        start_date: extractDateInput(event.start_time) || getLocalDateString(),
        start_time: extractTimeInput(event.start_time) || '12:00',
        end_time: extractTimeInput(event.end_time) || '14:00',
        venue_address: event.venue_address || 'Kent Life, Lock Lane, Maidstone ME14 3AU',
        wedding_ring_delivery_only: Boolean(event.wedding_ring_delivery_only),
        wedding_flying_participant: event.wedding_flying_participant || '',
        rehearsal_time: extractTimeInput(event.rehearsal_time),
        rehearsal_at_centre_date: extractDateInput(event.rehearsal_at_centre_date) || '',
        rehearsal_at_centre_time: extractTimeInput(event.rehearsal_at_centre_time) || '',
        school_talk_curriculum: event.school_talk_curriculum || '',
        party_type: event.party_type || '',
        site_contact_name: event.site_contact_name || '',
        site_contact_phone: event.site_contact_phone || '',
        voucher_id: event.voucher_id || '',
        client_full_name: comm?.client_full_name || event.site_contact_name || '',
        client_email: comm?.client_email || '',
        client_billing_address: comm?.client_billing_address || '',
        payment_status: comm?.payment_status || 'UNPAID',
        total_amount: Number(comm?.total_amount || 0),
        deposit_amount: Number(comm?.deposit_amount || 0),
        deposit_due_date: comm?.deposit_due_date || '',
        balance_due_date: comm?.balance_due_date || '',
        xero_invoice_number: comm?.xero_invoice_number || '',
        billing_notes: comm?.billing_notes || '',
        selected_staff_ids: (event.staff_allocations || []).map((s) => s.user_id),
        selected_animals: (event.animal_allocations || []).map((a) => ({
          animal_id: a.animal_id,
          role_description: a.role_description || 'Flying / Display Specimen',
        })),
      });
    } else if (voucher) {
      setForm({
        ...defaultFormState,
        title: `${voucher.item_name || (voucher as any).experience_type || 'Experience'} - ${voucher.purchaser_name}`,
        event_type: 'EXPERIENCE',
        description: `Participants: ${voucher.participants}, Guests: ${voucher.guests}. Voucher Code: ${voucher.voucher_code}`,
        start_date: initialDate || getLocalDateString(),
        start_time: '10:00',
        end_time: '12:00',
        venue_address: 'Kent Owl Academy, Kent Life, Lock Lane, Maidstone ME14 3AU',
        site_contact_name: voucher.purchaser_name,
        voucher_id: voucher.id,
        client_full_name: voucher.purchaser_name,
        client_email: voucher.purchaser_email,
        payment_status: 'PAID_IN_FULL',
        xero_invoice_number: (voucher as any).transaction_id || '',
        billing_notes: `Pre-paid voucher purchase. Code: ${voucher.voucher_code}`,
      });
    } else {
      setForm({
        ...defaultFormState,
        start_date: initialDate || getLocalDateString(),
      });
    }
  }, [isOpen, event, voucher, initialDate]);

  const filteredAnimals = useMemo(() => {
    return animals.filter((a) => {
      const section = resolveAnimalSection(a);
      const matchesSection = animalSectionFilter === 'ALL' || section === animalSectionFilter;

      const q = animalSearchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (a.name || '').toLowerCase().includes(q) ||
        (a.species || '').toLowerCase().includes(q) ||
        (a.ring_number || '').toLowerCase().includes(q);

      return matchesSection && matchesSearch;
    });
  }, [animals, animalSectionFilter, animalSearchQuery]);

  const sectionCounts = useMemo(() => {
    const counts = { ALL: animals.length, OWL: 0, RAPTOR: 0, MAMMAL: 0, EXOTIC: 0 };
    animals.forEach((a) => {
      const sec = resolveAnimalSection(a);
      counts[sec] = (counts[sec] || 0) + 1;
    });
    return counts;
  }, [animals]);

  // Save Mutation (Schema Strict: Events, Commercials, Staff, Animals)
  const saveEventMutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      const startDateTime = new Date(`${payload.start_date}T${payload.start_time}:00`).toISOString();
      const endDateTime = new Date(`${payload.start_date}T${payload.end_time}:00`).toISOString();

      const editingEventId = event?.id;
      let targetEventId = editingEventId;

      const eventPayload: Record<string, any> = {
        title: payload.title.trim(),
        event_type: payload.event_type,
        description: payload.description.trim() || null,
        start_time: startDateTime,
        end_time: endDateTime,
        venue_address: payload.venue_address.trim(),
        site_contact_name: payload.site_contact_name.trim(),
        site_contact_phone: payload.site_contact_phone.trim() || null,
        voucher_id: payload.voucher_id || null,
        is_deleted: false,
        updated_at: new Date().toISOString(),
      };

      if (payload.event_type === 'WEDDING') {
        eventPayload.wedding_ring_delivery_only = payload.wedding_ring_delivery_only;
        eventPayload.wedding_flying_participant = payload.wedding_flying_participant.trim() || null;
        
        // Surcharge fix: convert time inputs to valid ISO timestamptz for PostgreSQL
        eventPayload.rehearsal_time = combineDateAndTimeToISO(payload.start_date, payload.rehearsal_time);
        eventPayload.rehearsal_at_centre_date = payload.rehearsal_at_centre_date || null;
        eventPayload.rehearsal_at_centre_time = combineDateAndTimeToISO(
          payload.rehearsal_at_centre_date || payload.start_date, 
          payload.rehearsal_at_centre_time
        );
      } else if (payload.event_type === 'SCHOOL_TALK') {
        eventPayload.school_talk_curriculum = payload.school_talk_curriculum.trim() || null;
      } else if (payload.event_type === 'PARTY') {
        eventPayload.party_type = payload.party_type.trim() || null;
      }

      // 1. Insert or Update events_calendar
      if (editingEventId) {
        const { error: updateError } = await supabase
          .from('events_calendar')
          .update(eventPayload)
          .eq('id', editingEventId);

        if (updateError) throw updateError;
      } else {
        if (user?.id || profile?.id) {
          eventPayload.created_by = user?.id || profile?.id;
        }

        const { data: newEvent, error: insertError } = await supabase
          .from('events_calendar')
          .insert([eventPayload])
          .select()
          .single();

        if (insertError) throw insertError;
        targetEventId = newEvent.id;
      }

      // 2. Safe Insert/Update for event_commercials
      const commPayload: Record<string, any> = {
        event_id: targetEventId,
        client_full_name: payload.client_full_name.trim() || payload.site_contact_name.trim(),
        client_email: payload.client_email.trim() || null,
        client_billing_address: payload.client_billing_address.trim() || null,
        payment_status: payload.payment_status || 'UNPAID',
        total_amount: Number(payload.total_amount) || 0,
        deposit_amount: Number(payload.deposit_amount) || 0,
        deposit_due_date: payload.deposit_due_date || null,
        balance_due_date: payload.balance_due_date || null,
        xero_invoice_number: payload.xero_invoice_number.trim() || null,
        billing_notes: payload.billing_notes.trim() || null,
        updated_at: new Date().toISOString(),
      };

      const { data: existingComm, error: commFetchError } = await supabase
        .from('event_commercials')
        .select('id')
        .eq('event_id', targetEventId)
        .maybeSingle();

      if (commFetchError) throw commFetchError;

      if (existingComm?.id) {
        const { error: commUpdateError } = await supabase
          .from('event_commercials')
          .update(commPayload)
          .eq('id', existingComm.id);

        if (commUpdateError) throw commUpdateError;
      } else {
        const { error: commInsertError } = await supabase
          .from('event_commercials')
          .insert([commPayload]);

        if (commInsertError) throw commInsertError;
      }

      // 3. Staff Allocations
      if (editingEventId) {
        await supabase.from('event_staff_allocations').delete().eq('event_id', editingEventId);
      }
      if (payload.selected_staff_ids.length > 0) {
        const { error: staffError } = await supabase
          .from('event_staff_allocations')
          .insert(
            payload.selected_staff_ids.map((uId) => ({
              event_id: targetEventId,
              user_id: uId,
            }))
          );
        if (staffError) throw staffError;
      }

      // 4. Animal Specimen Allocations
      if (editingEventId) {
        await supabase.from('events_animals').delete().eq('event_id', editingEventId);
      }
      if (payload.selected_animals.length > 0) {
        const { error: animalError } = await supabase
          .from('events_animals')
          .insert(
            payload.selected_animals.map((item) => ({
              event_id: targetEventId,
              animal_id: item.animal_id,
              role_description: item.role_description.trim() || 'Flying / Display Specimen',
            }))
          );
        if (animalError) throw animalError;
      }

      return targetEventId;
    },
    onSuccess: () => {
      toast.success(event ? 'Event updated successfully.' : 'Event registered successfully.');
      queryClient.invalidateQueries({ queryKey: ['events_ledger_management'] });
      queryClient.invalidateQueries({ queryKey: ['operational_calendar'] });
      queryClient.invalidateQueries({ queryKey: ['all_vouchers_directory'] });
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Operation failed';
      toast.error(msg);
    }
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200 font-sans text-left">
      <div className="bg-white border border-slate-200/80 rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[94vh] text-left">
        
        {/* Header Bar */}
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white shrink-0 text-left">
          <div className="flex items-center gap-3 text-left">
            <div className="w-9 h-9 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black shadow-xs shrink-0">
              {event ? <Pencil size={17} className="text-amber-400" /> : <Sparkles size={18} />}
            </div>
            <div className="text-left">
              <h3 className="text-sm sm:text-base font-black text-slate-900 uppercase tracking-tight leading-none text-left">
                {event ? 'Edit Event & Commercial Record' : 'Register Event & Commercial File'}
              </h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 text-left">
                Operations, Specimen Allocation &amp; Xero Invoicing
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!form.title.trim() || !form.site_contact_name.trim() || !form.venue_address.trim()) {
              toast.error('Title, Venue Address and Onsite Contact Name are mandatory.');
              return;
            }
            saveEventMutation.mutate(form);
          }}
          className="p-5 sm:p-6 overflow-y-auto custom-scrollbar space-y-5 text-xs font-medium bg-white flex-1 text-left"
        >
          {/* Classification Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200 text-left">
            <div className="text-left">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 text-left">
                Event Type *
              </label>
              <select
                value={form.event_type}
                onChange={(e) => setForm({ ...form, event_type: e.target.value as EventsCalendar['event_type'] })}
                className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 cursor-pointer text-left"
              >
                <option value="WEDDING">Wedding (Ring Delivery &amp; Displays)</option>
                <option value="SCHOOL_TALK">School Visit / Educational Workshop</option>
                <option value="PARTY">Birthday Party / Private Celebration</option>
                <option value="EXPERIENCE">Pre-paid Experience Session</option>
                <option value="OTHER">Other Arena / Offsite Display</option>
              </select>
            </div>

            <div className="text-left">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 text-left">
                Event Title *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Smith &amp; Jones Wedding Ring Bearer"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 text-left"
              />
            </div>
          </div>

          {/* Venue Address */}
          <div className="text-left">
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 text-left">
              Venue Address (Full Location &amp; Access Details) *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. The Orangery, Turkey Mill, Ashford Rd, Maidstone ME14 5PP"
              value={form.venue_address}
              onChange={(e) => setForm({ ...form, venue_address: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 text-left"
            />
          </div>

          {/* Dynamic Specifics by Event Type */}
          {form.event_type === 'WEDDING' && (
            <div className="p-4 bg-purple-50/70 border border-purple-200 rounded-2xl space-y-3.5 text-left">
              <span className="text-[10px] font-black uppercase tracking-widest text-purple-800 block text-left">
                Wedding Specifics &amp; Dual Rehearsals
              </span>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
                <div className="text-left">
                  <label className="block text-[9px] font-black uppercase tracking-widest text-slate-600 mb-1 text-left">
                    Flying Participant &amp; Relation to Couple
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Best Man (James), Groom's Brother"
                    value={form.wedding_flying_participant}
                    onChange={(e) => setForm({ ...form, wedding_flying_participant: e.target.value })}
                    className="w-full bg-white border border-purple-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900"
                  />
                </div>

                <div className="flex items-center pt-4 text-left">
                  <label className="flex items-center gap-2 cursor-pointer text-left">
                    <input
                      type="checkbox"
                      checked={form.wedding_ring_delivery_only}
                      onChange={(e) => setForm({ ...form, wedding_ring_delivery_only: e.target.checked })}
                      className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-slate-800 text-left">Ring Delivery Only (No Static Reception)</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-purple-100 text-left">
                <div className="space-y-1 text-left">
                  <label className="block text-[9px] font-black uppercase tracking-widest text-purple-900 text-left">
                    Centre Rehearsal at KOA (Date &amp; Time)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={form.rehearsal_at_centre_date}
                      onChange={(e) => setForm({ ...form, rehearsal_at_centre_date: e.target.value })}
                      className="w-full bg-white border border-purple-200 rounded-xl px-2.5 py-1.5 text-xs font-bold"
                    />
                    <input
                      type="time"
                      value={form.rehearsal_at_centre_time}
                      onChange={(e) => setForm({ ...form, rehearsal_at_centre_time: e.target.value })}
                      className="w-full bg-white border border-purple-200 rounded-xl px-2.5 py-1.5 text-xs font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-1 text-left">
                  <label className="block text-[9px] font-black uppercase tracking-widest text-purple-900 text-left">
                    Day-of Onsite Ceremony Rehearsal (Time)
                  </label>
                  <input
                    type="time"
                    value={form.rehearsal_time}
                    onChange={(e) => setForm({ ...form, rehearsal_time: e.target.value })}
                    className="w-full bg-white border border-purple-200 rounded-xl px-3 py-1.5 text-xs font-bold"
                  />
                </div>
              </div>
            </div>
          )}

          {form.event_type === 'SCHOOL_TALK' && (
            <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-2xl space-y-3 text-left">
              <span className="text-[10px] font-black uppercase tracking-widest text-blue-800 block text-left">
                School Talk Specifics
              </span>
              <div className="text-left">
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-600 mb-1 text-left">
                  Curriculum Topic / Presentation Required *
                </label>
                <input
                  type="text"
                  placeholder="e.g. KS2 Nocturnal Hunters &amp; British Habitats"
                  value={form.school_talk_curriculum}
                  onChange={(e) => setForm({ ...form, school_talk_curriculum: e.target.value })}
                  className="w-full bg-white border border-blue-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900"
                />
              </div>
            </div>
          )}

          {form.event_type === 'PARTY' && (
            <div className="p-4 bg-pink-50/70 border border-pink-200 rounded-2xl space-y-3 text-left">
              <span className="text-[10px] font-black uppercase tracking-widest text-pink-800 block text-left">
                Party &amp; Celebration Specifics
              </span>
              <div className="text-left">
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-600 mb-1 text-left">
                  Party Type / Celebration Theme
                </label>
                <input
                  type="text"
                  placeholder="e.g. 10th Birthday Experience &amp; Meerkat Meet"
                  value={form.party_type}
                  onChange={(e) => setForm({ ...form, party_type: e.target.value })}
                  className="w-full bg-white border border-pink-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900"
                />
              </div>
            </div>
          )}

          {/* Timings */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
            <div className="text-left">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 text-left">
                Event Date *
              </label>
              <input
                type="date"
                required
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="text-left">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 text-left">
                Start Time *
              </label>
              <input
                type="time"
                required
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="text-left">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 text-left">
                End Time *
              </label>
              <input
                type="time"
                required
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          {/* Day-of Contact */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
            <div className="text-left">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 text-left">
                Onsite Contact Person *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Wedding Coordinator / Teacher Lead"
                value={form.site_contact_name}
                onChange={(e) => setForm({ ...form, site_contact_name: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900"
              />
            </div>

            <div className="text-left">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 text-left">
                Onsite Direct Mobile Number
              </label>
              <input
                type="tel"
                placeholder="07123456789"
                value={form.site_contact_phone}
                onChange={(e) => setForm({ ...form, site_contact_phone: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-900"
              />
            </div>
          </div>

          {/* Staff Allocation */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 text-left">
            <div className="flex justify-between items-center text-left">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-700 flex items-center gap-1.5 text-left">
                <Users size={13} className="text-slate-500" /> Allocate Staff Members ({form.selected_staff_ids.length} Assigned)
              </label>
              <input
                type="text"
                placeholder="Filter staff..."
                value={staffSearchQuery}
                onChange={(e) => setStaffSearchQuery(e.target.value)}
                className="px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg w-40 outline-none"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-36 overflow-y-auto custom-scrollbar p-1">
              {staffList
                .filter((s) => !staffSearchQuery || s.name.toLowerCase().includes(staffSearchQuery.toLowerCase()))
                .map((s) => {
                  const isSelected = form.selected_staff_ids.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setForm((prev) => ({
                          ...prev,
                          selected_staff_ids: isSelected
                            ? prev.selected_staff_ids.filter((id) => id !== s.id)
                            : [...prev.selected_staff_ids, s.id],
                        }));
                      }}
                      className={`p-2 rounded-xl text-left border flex items-center justify-between transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                          : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <div className="truncate">
                        <p className="font-bold text-xs truncate">{s.name}</p>
                        <p className={`text-[9px] font-black uppercase ${isSelected ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {s.role}
                        </p>
                      </div>
                      {isSelected && <Check size={14} className="text-emerald-400 shrink-0" />}
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Animal Allocation with Section Tabs */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 text-left">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 text-left">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-700 flex items-center gap-1.5 text-left">
                <Feather size={13} className="text-emerald-600" /> Allocate Specimen Animals ({form.selected_animals.length} Assigned)
              </label>

              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
                <input
                  type="text"
                  placeholder="Search name, ring #..."
                  value={animalSearchQuery}
                  onChange={(e) => setAnimalSearchQuery(e.target.value)}
                  className="pl-7 pr-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg w-full sm:w-44 outline-none"
                />
              </div>
            </div>

            {/* QOL SECTION TABS */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 custom-scrollbar">
              {(
                [
                  { id: 'ALL', label: 'All', count: sectionCounts.ALL },
                  { id: 'OWL', label: 'Owls', count: sectionCounts.OWL },
                  { id: 'RAPTOR', label: 'Raptors', count: sectionCounts.RAPTOR },
                  { id: 'MAMMAL', label: 'Mammals', count: sectionCounts.MAMMAL },
                  { id: 'EXOTIC', label: 'Exotics', count: sectionCounts.EXOTIC },
                ] as const
              ).map((tab) => {
                const isActive = animalSectionFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setAnimalSectionFilter(tab.id)}
                    className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                      isActive
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className={`px-1 py-0.2 rounded text-[8px] font-bold ${
                      isActive ? 'bg-slate-800 text-emerald-400' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Selected Animals Role Description Inputs */}
            {form.selected_animals.length > 0 && (
              <div className="space-y-2 p-2.5 bg-white rounded-xl border border-slate-200 text-left">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block text-left">
                  Assigned Deployments ({form.selected_animals.length}):
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                  {form.selected_animals.map((item, idx) => {
                    const animalObj = animals.find((a) => a.id === item.animal_id);
                    return (
                      <div key={item.animal_id} className="p-2 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2 text-left">
                        <span className="font-bold text-xs text-slate-900 truncate w-24">
                          {animalObj?.name || 'Specimen'}
                        </span>
                        <input
                          type="text"
                          placeholder="Role (e.g. Ring Flight)"
                          value={item.role_description}
                          onChange={(e) => {
                            const updated = [...form.selected_animals];
                            updated[idx] = { ...updated[idx]!, role_description: e.target.value };
                            setForm({ ...form, selected_animals: updated });
                          }}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setForm((prev) => ({
                              ...prev,
                              selected_animals: prev.selected_animals.filter((a) => a.animal_id !== item.animal_id),
                            }));
                          }}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Animal Selection Grid */}
            {isLoadingAnimals ? (
              <div className="py-6 flex items-center justify-center gap-2 text-slate-400">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-xs font-bold">Loading animal roster...</span>
              </div>
            ) : filteredAnimals.length === 0 ? (
              <div className="py-6 text-center text-slate-400">
                <Bird size={24} className="mx-auto opacity-30 mb-1" />
                <p className="text-xs font-bold text-slate-600">No animals found in this section</p>
                <p className="text-[10px]">Try adjusting the search query or section tab filter.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto custom-scrollbar p-1">
                {filteredAnimals.map((a) => {
                  const isSelected = form.selected_animals.some((item) => item.animal_id === a.id);
                  const section = resolveAnimalSection(a);

                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setForm((prev) => ({
                          ...prev,
                          selected_animals: isSelected
                            ? prev.selected_animals.filter((item) => item.animal_id !== a.id)
                            : [
                                ...prev.selected_animals, 
                                { 
                                  animal_id: a.id, 
                                  role_description: form.event_type === 'WEDDING' ? 'Ring Delivery' : 'Flying Display' 
                                }
                              ],
                        }));
                      }}
                      className={`p-2 rounded-xl text-left border flex items-center justify-between transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-800 text-white border-emerald-900 shadow-xs'
                          : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <div className="truncate min-w-0 pr-1">
                        <div className="flex items-center gap-1.5">
                          <p className="font-bold text-xs truncate">{a.name}</p>
                          <span className={`px-1 rounded text-[8px] font-black uppercase ${
                            isSelected ? 'bg-emerald-700 text-emerald-100' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {section}
                          </span>
                        </div>
                        <p className={`text-[9px] truncate ${isSelected ? 'text-emerald-200' : 'text-slate-400'}`}>
                          {a.species || 'Specimen'}
                        </p>
                      </div>
                      {isSelected && <Check size={14} className="text-emerald-300 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Commercials Section */}
          <div className="bg-slate-900 text-white p-4 sm:p-5 rounded-2xl space-y-3.5 shadow-md text-left">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-800 text-left">
              <Lock size={14} className="text-emerald-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400 text-left">
                Commercials &amp; Xero Invoicing (GDPR Restricted)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
              <div className="text-left">
                <label className="block text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1 text-left">
                  Client Full Name (Billing)
                </label>
                <input
                  type="text"
                  value={form.client_full_name}
                  onChange={(e) => setForm({ ...form, client_full_name: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold text-white text-left"
                />
              </div>

              <div className="text-left">
                <label className="block text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1 text-left">
                  Client Email
                </label>
                <input
                  type="email"
                  value={form.client_email}
                  onChange={(e) => setForm({ ...form, client_email: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold text-white text-left"
                />
              </div>

              <div className="text-left">
                <label className="block text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1 text-left">
                  Payment Status
                </label>
                <select
                  value={form.payment_status}
                  onChange={(e) => setForm({ ...form, payment_status: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs font-bold text-white text-left cursor-pointer"
                >
                  <option value="UNPAID">Unpaid (Awaiting Deposit)</option>
                  <option value="DEPOSIT_PAID">Deposit Paid</option>
                  <option value="PAID_IN_FULL">Paid in Full</option>
                  <option value="NOT_APPLICABLE">Not Applicable (Voucher / Comp)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
              <div className="text-left">
                <label className="block text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1 text-left">
                  Total Fee (£)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.total_amount}
                  onChange={(e) => setForm({ ...form, total_amount: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold text-white text-left"
                />
              </div>

              <div className="text-left">
                <label className="block text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1 text-left">
                  Deposit Amount (£)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.deposit_amount}
                  onChange={(e) => setForm({ ...form, deposit_amount: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold text-white text-left"
                />
              </div>

              <div className="text-left">
                <label className="block text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1 text-left">
                  Xero Invoice #
                </label>
                <input
                  type="text"
                  placeholder="e.g. INV-1042"
                  value={form.xero_invoice_number}
                  onChange={(e) => setForm({ ...form, xero_invoice_number: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold text-white text-left"
                />
              </div>
            </div>
          </div>

          {/* Submit Controls */}
          <div className="pt-3 flex justify-end gap-2 border-t border-slate-100 text-left">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveEventMutation.isPending}
              className="px-6 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-widest rounded-xl disabled:opacity-50 flex items-center gap-1.5 shadow-xs cursor-pointer active:scale-95"
            >
              {saveEventMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : null}
              <span>{event ? 'Update Event Record' : 'Register Event File'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EventFormModal;