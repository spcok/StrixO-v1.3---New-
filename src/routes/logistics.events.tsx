import { useState, useMemo, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  Sparkles, 
  Plus, 
  Search, 
  Loader2, 
  Clock, 
  MapPin, 
  CheckCircle2, 
  AlertCircle, 
  CreditCard, 
  Calendar as CalIcon,
  Trash2,
  Users,
  Feather,
  Phone,
  Ticket,
  CalendarCheck,
  AlertTriangle,
  Receipt,
  Pencil,
  RotateCcw
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { EventFormModal, type FullEventEntry } from '../components/events/EventFormModal';
import { IssueVoucherModal } from '../components/events/IssueVoucherModal';
import type { Animal, UserProfile, Voucher } from '../types';

const EVENT_TABS = [
  { id: 'ALL', label: 'All Scheduled' },
  { id: 'WEDDING', label: 'Weddings' },
  { id: 'SCHOOL_TALK', label: 'School Talks' },
  { id: 'PARTY', label: 'Parties' },
  { id: 'EXPERIENCE', label: 'Experience Bookings' },
  { id: 'OTHER', label: 'Other Displays' },
  { id: 'VOUCHER_DIRECTORY', label: 'Purchased Vouchers' },
] as const;

const formatDisplayDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '--';
  const clean = dateStr.split('T')[0];
  if (!clean) return '--';
  const [y, m, d] = clean.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
};

const formatDisplayTime = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '--:--';
  if (dateStr.length === 5 && dateStr.includes(':')) return dateStr;
  const dateObj = new Date(dateStr);
  if (Number.isNaN(dateObj.getTime())) return dateStr;
  return dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

// ------------------------------------------------------------------
// 1. STRICT QUERY OPTIONS
// ------------------------------------------------------------------
const eventsLedgerOptions = queryOptions({
  queryKey: ['events_ledger_management'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('events_calendar')
      .select(`
        *,
        commercials:event_commercials (*),
        staff_allocations:event_staff_allocations (
          *,
          users:user_id (id, name, initials, role)
        ),
        animal_allocations:events_animals (
          *,
          animals (id, name, species, ring_number, profile_image_url)
        )
      `)
      .eq('is_deleted', false)
      .order('start_time', { ascending: false });

    if (error) throw error;
    return (data || []) as FullEventEntry[];
  },
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 14,
  networkMode: 'offlineFirst',
});

const allVouchersDirectoryOptions = queryOptions({
  queryKey: ['all_vouchers_directory'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('vouchers')
      .select('*')
      .order('purchase_date', { ascending: false });
    if (error) throw error;
    return (data || []) as Voucher[];
  },
  staleTime: 1000 * 60 * 5,
});

const animalsListOptions = queryOptions({
  queryKey: ['animals_event_select'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('animals')
      .select('id, name, species, ring_number, location, profile_image_url')
      .eq('status', 'ON_DISPLAY')
      .order('name');
    if (error) throw error;
    return (data || []) as Animal[];
  },
  staleTime: 1000 * 60 * 15,
});

const staffListOptions = queryOptions({
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
  staleTime: 1000 * 60 * 15,
});

// ------------------------------------------------------------------
// 2. ROUTE DEFINITION
// ------------------------------------------------------------------
export const Route = createFileRoute('/logistics/events')({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(eventsLedgerOptions),
      context.queryClient.ensureQueryData(allVouchersDirectoryOptions),
      context.queryClient.ensureQueryData(animalsListOptions),
      context.queryClient.ensureQueryData(staffListOptions),
    ]);
  },
  component: EventsManagerPage,
});

export function EventsManagerPage() {
  const queryClient = useQueryClient();
  const { user, profile, hasPermission } = useAuth();
  const scrollParentRef = useRef<HTMLDivElement>(null);

  const isManager =
    hasPermission('events:manage') ||
    hasPermission('vouchers:manage') ||
    ['DIRECTOR', 'ADMIN', 'MANAGER', 'SENIOR_KEEPER'].includes(profile?.role || '');

  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Sub-filter tabs
  const [eventTimeFilter, setEventTimeFilter] = useState<'BOOKED' | 'PAST' | 'ALL'>('BOOKED');
  const [voucherFilterStatus, setVoucherFilterStatus] = useState<'UNBOOKED' | 'REDEEMED' | 'ALL'>('UNBOOKED');

  // Modal Control States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isIssueVoucherModalOpen, setIsIssueVoucherModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<FullEventEntry | null>(null);
  const [selectedVoucher, setSelectedVoucher] = useState<Voucher | null>(null);

  // Confirmation Modals
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [cancelVoucherTarget, setCancelVoucherTarget] = useState<{ eventId: string; voucherId: string; title: string } | null>(null);

  // Queries
  const { data: events = [], isLoading } = useQuery(eventsLedgerOptions);
  const { data: vouchers = [], isLoading: loadingVouchers } = useQuery(allVouchersDirectoryOptions);
  const { data: animals = [] } = useQuery(animalsListOptions);
  const { data: staffList = [] } = useQuery(staffListOptions);

  const openCreateModal = () => {
    setSelectedEvent(null);
    setSelectedVoucher(null);
    setIsModalOpen(true);
  };

  const openEditEvent = (event: FullEventEntry) => {
    setSelectedEvent(event);
    setSelectedVoucher(null);
    setIsModalOpen(true);
  };

  const openBookingForVoucher = (voucher: Voucher) => {
    setSelectedEvent(null);
    setSelectedVoucher(voucher);
    setIsModalOpen(true);
  };

  // Mutation: Cancel Booking & Return Voucher
  const cancelBookingAndReturnVoucherMutation = useMutation({
    mutationFn: async ({ eventId, voucherId }: { eventId: string; voucherId: string }) => {
      const { error: eventError } = await supabase
        .from('events_calendar')
        .update({
          is_deleted: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', eventId);

      if (eventError) throw eventError;

      const { data: vData, error: fetchError } = await supabase
        .from('vouchers')
        .select('notes')
        .eq('id', voucherId)
        .maybeSingle();

      if (fetchError) throw fetchError;

      const auditNote = `[Booking cancelled & returned to purchased on ${new Date().toLocaleDateString('en-GB')} by staff]`;
      const updatedNotes = vData?.notes ? `${vData.notes}\n${auditNote}` : auditNote;

      const { error: voucherError } = await supabase
        .from('vouchers')
        .update({
          status: 'ACTIVE',
          redeemed_at: null,
          redeemed_by: null,
          notes: updatedNotes,
          modified_by: user?.id || profile?.id || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', voucherId);

      if (voucherError) throw voucherError;
      return { eventId, voucherId };
    },
    onSuccess: () => {
      toast.success('Booking cancelled. Voucher returned to Purchased Vouchers tab.');
      queryClient.invalidateQueries({ queryKey: ['events_ledger_management'] });
      queryClient.invalidateQueries({ queryKey: ['operational_calendar'] });
      queryClient.invalidateQueries({ queryKey: ['all_vouchers_directory'] });
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      setCancelVoucherTarget(null);
    },
    onError: (err: any) => {
      const msg = err?.message || err?.details || 'Failed to return voucher';
      toast.error(`Error: ${msg}`);
      setCancelVoucherTarget(null);
    }
  });

  // Mutation: Archive Event
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('events_calendar')
        .update({ 
          is_deleted: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select();

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('Database accepted update but modified 0 rows. Verify RLS policies on events_calendar.');
      }
      return id;
    },
    onSuccess: (deletedId) => {
      queryClient.setQueryData(['events_ledger_management'], (old: FullEventEntry[] | undefined) => {
        if (!old) return [];
        return old.filter(e => e.id !== deletedId);
      });
      queryClient.invalidateQueries({ queryKey: ['events_ledger_management'] });
      queryClient.invalidateQueries({ queryKey: ['operational_calendar'] });
      queryClient.invalidateQueries({ queryKey: ['all_vouchers_directory'] });
      toast.success('Event archived successfully.');
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      toast.error(msg);
      setDeleteTarget(null);
    }
  });

  const voucherBookingMap = useMemo(() => {
    const map = new Map<string, string>();
    events.forEach(e => {
      if (!e.is_deleted && e.voucher_id && e.start_time) {
        map.set(e.voucher_id, e.start_time);
      }
    });
    return map;
  }, [events]);

  const nowTimestamp = useMemo(() => Date.now(), []);

  // Events filtered by Tab, Temporal state (Booked/Past/All), and Search
  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      const matchesTab = activeTab === 'ALL' || e.event_type === activeTab;

      const eventEndTime = e.end_time 
        ? new Date(e.end_time).getTime() 
        : (e.start_time ? new Date(e.start_time).getTime() : 0);
      const isPast = eventEndTime < nowTimestamp;

      let matchesTime = true;
      if (eventTimeFilter === 'BOOKED') {
        matchesTime = !isPast;
      } else if (eventTimeFilter === 'PAST') {
        matchesTime = isPast;
      }

      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (e.title || '').toLowerCase().includes(q) ||
        (e.site_contact_name || '').toLowerCase().includes(q) ||
        (e.venue_address || '').toLowerCase().includes(q) ||
        (e.commercials?.client_full_name || '').toLowerCase().includes(q) ||
        (e.commercials?.xero_invoice_number || '').toLowerCase().includes(q);

      return matchesTab && matchesTime && matchesSearch;
    });
  }, [events, activeTab, eventTimeFilter, searchQuery, nowTimestamp]);

  // Vouchers filtered by Unbooked, Redeemed, or All
  const filteredVouchers = useMemo(() => {
    return vouchers.filter(v => {
      const isBooked = voucherBookingMap.has(v.id);

      let matchesStatus = true;
      if (voucherFilterStatus === 'UNBOOKED') {
        matchesStatus = v.status === 'ACTIVE' && !isBooked;
      } else if (voucherFilterStatus === 'REDEEMED') {
        matchesStatus = v.status === 'REDEEMED';
      }

      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (v.purchaser_name || '').toLowerCase().includes(q) ||
        (v.purchaser_email || '').toLowerCase().includes(q) ||
        (v.voucher_code || '').toLowerCase().includes(q) ||
        (v.item_name || '').toLowerCase().includes(q) ||
        ((v as any).experience_type || '').toLowerCase().includes(q);

      return matchesStatus && matchesSearch;
    });
  }, [vouchers, voucherBookingMap, voucherFilterStatus, searchQuery]);

  const rowVirtualizer = useVirtualizer({
    count: activeTab === 'VOUCHER_DIRECTORY' ? filteredVouchers.length : filteredEvents.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 150,
    overscan: 4,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  const getPaymentBadge = (status?: string | null, isPast = false) => {
    if (isPast && status && status !== 'PAID_IN_FULL' && status !== 'NOT_APPLICABLE') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest bg-rose-50 border border-rose-300 text-rose-800 shrink-0">
          <AlertCircle size={11} className="text-rose-600 shrink-0" />
          OVERDUE SETTLEMENT
        </span>
      );
    }

    switch (status) {
      case 'PAID_IN_FULL':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest bg-emerald-50 border border-emerald-200 text-emerald-700 shrink-0">
            <CheckCircle2 size={11} className="text-emerald-600 shrink-0" />
            PAID IN FULL
          </span>
        );
      case 'DEPOSIT_PAID':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest bg-amber-50 border border-amber-200 text-amber-700 shrink-0">
            <Clock size={11} className="text-amber-600 shrink-0" />
            DEPOSIT PAID
          </span>
        );
      case 'UNPAID':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest bg-rose-50 border border-rose-200 text-rose-700 shrink-0">
            <AlertCircle size={11} className="text-rose-600 shrink-0" />
            UNPAID
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest bg-slate-100 border border-slate-200 text-slate-600 shrink-0">
            N/A
          </span>
        );
    }
  };

  return (
    <div className="h-full flex-1 flex flex-col min-h-0 overflow-hidden space-y-2 lg:space-y-2.5 font-sans text-left pb-4">
      
      {/* Header Ribbon */}
      <div className="flex justify-between items-center w-full shrink-0 text-left">
        <div>
          <h1 className="text-lg lg:text-xl font-black text-slate-900 tracking-tight leading-none flex items-center gap-2 text-left">
            Events &amp; Commercials Ledger
          </h1>
          <p className="text-[10px] lg:text-xs text-slate-400 font-bold uppercase tracking-wider mt-1 text-left">
            Weddings, Schools, Parties, Vouchers &amp; Commercial Files
          </p>
        </div>

        {/* Action Controls */}
        {isManager && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsIssueVoucherModalOpen(true)}
              className="flex items-center justify-center gap-1.5 bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-xs active:scale-95 cursor-pointer shrink-0"
            >
              <Ticket size={14} className="text-emerald-600" />
              <span>Issue Voucher</span>
            </button>

            <button
              type="button"
              onClick={openCreateModal}
              className="flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-xs active:scale-95 cursor-pointer shrink-0"
            >
              <Plus size={14} className="text-emerald-400" />
              <span>Create Event</span>
            </button>
          </div>
        )}
      </div>

      {/* Control Deck with Symmetrical Sub-Filter Pills */}
      <div className="flex flex-col sm:flex-row gap-2 w-full bg-slate-50/80 p-2 rounded-xl border border-slate-200 shrink-0 text-left">
        <div className="relative flex-1 shrink-0 text-left">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="text"
            placeholder={
              activeTab === 'VOUCHER_DIRECTORY'
                ? "Search purchaser, code, or experience..."
                : "Search event title, client, invoice #, or venue..."
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 transition-all shadow-xs placeholder:text-slate-400 font-medium text-left"
          />
        </div>

        {/* Dynamic Contextual Sub-Pills */}
        <div className="flex items-center gap-1 overflow-x-auto shrink-0">
          {activeTab === 'VOUCHER_DIRECTORY' ? (
            (['UNBOOKED', 'REDEEMED', 'ALL'] as const).map(st => (
              <button
                key={st}
                type="button"
                onClick={() => setVoucherFilterStatus(st)}
                className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                  voucherFilterStatus === st
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {st === 'UNBOOKED' ? 'Unbooked' : st === 'REDEEMED' ? 'Redeemed' : 'All Vouchers'}
              </button>
            ))
          ) : (
            (['BOOKED', 'PAST', 'ALL'] as const).map(st => (
              <button
                key={st}
                type="button"
                onClick={() => setEventTimeFilter(st)}
                className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                  eventTimeFilter === st
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {st === 'BOOKED' ? 'Booked' : st === 'PAST' ? 'Past' : 'All'}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className="flex gap-1.5 w-full shrink-0 overflow-x-auto text-left">
        {EVENT_TABS.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-[9px] lg:text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-all shadow-xs cursor-pointer ${
              activeTab === tab.id
                ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20'
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Virtualized Main Content Area */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col flex-1 min-h-0 overflow-hidden relative text-left">
        {(isLoading || loadingVouchers) && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-xs z-10 flex items-center justify-center">
            <div className="bg-white p-3.5 rounded-xl shadow-lg flex items-center gap-2.5 border border-slate-100 text-left">
              <Loader2 className="animate-spin text-slate-800" size={20} />
              <span className="text-xs font-bold text-slate-700 text-left">Syncing data...</span>
            </div>
          </div>
        )}

        <div ref={scrollParentRef} className="flex-1 overflow-y-auto custom-scrollbar p-3 bg-slate-50/30 text-left">
          {activeTab === 'VOUCHER_DIRECTORY' ? (
            filteredVouchers.length === 0 && !loadingVouchers ? (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center">
                <Ticket size={36} className="opacity-20 mb-2" />
                <p className="text-xs font-black uppercase tracking-widest text-slate-700">No Vouchers Found</p>
                <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                  No purchased vouchers matched your current filter criteria.
                </p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const voucher = filteredVouchers[virtualRow.index]!;
                  const bookedStartTime = voucherBookingMap.get(voucher.id);
                  const isBooked = Boolean(bookedStartTime);

                  return (
                    <div
                      key={voucher.id}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      className="absolute top-0 left-0 w-full pb-2.5 text-left"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs hover:border-slate-300 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3.5 text-left">
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                              {voucher.voucher_code}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest border ${
                              voucher.status === 'ACTIVE'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : voucher.status === 'REDEEMED'
                                ? 'bg-slate-100 text-slate-600 border-slate-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}>
                              {voucher.status}
                            </span>
                            {isBooked ? (
                              <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                                <CalendarCheck size={10} /> Booked for {formatDisplayDate(bookedStartTime)}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-amber-50 text-amber-700 border border-amber-200">
                                Unbooked
                              </span>
                            )}
                          </div>

                          <h3 className="font-black text-slate-900 text-sm tracking-tight truncate">
                            {voucher.purchaser_name} &bull; <span className="text-slate-600 font-medium">{voucher.item_name || (voucher as any).experience_type}</span>
                          </h3>

                          <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400 flex-wrap">
                            <span>{voucher.purchaser_email}</span>
                            <span>&bull;</span>
                            <span>{voucher.participants} Participant{voucher.participants > 1 ? 's' : ''} {voucher.guests > 0 ? `+ ${voucher.guests} Guests` : ''}</span>
                            <span>&bull;</span>
                            <span>Purchased: {formatDisplayDate(voucher.purchase_date)}</span>
                          </div>
                        </div>

                        <div className="shrink-0 flex items-center gap-2">
                          {!isBooked && voucher.status === 'ACTIVE' && isManager && (
                            <button
                              type="button"
                              onClick={() => openBookingForVoucher(voucher)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-xs active:scale-95 cursor-pointer"
                            >
                              <CalendarCheck size={13} className="text-emerald-400" />
                              <span>Book Schedule</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            filteredEvents.length === 0 && !isLoading ? (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center">
                <Sparkles size={36} className="opacity-20 mb-2" />
                <p className="text-xs font-black uppercase tracking-widest text-slate-700">No Events Found</p>
                <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                  No {eventTimeFilter.toLowerCase()} bookings registered for this category.
                </p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const event = filteredEvents[virtualRow.index]!;
                  const comm = event.commercials;
                  const isWedding = event.event_type === 'WEDDING';

                  const eventEndTime = event.end_time 
                    ? new Date(event.end_time).getTime() 
                    : (event.start_time ? new Date(event.start_time).getTime() : 0);
                  const isPast = eventEndTime < nowTimestamp;

                  return (
                    <div
                      key={event.id}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      className="absolute top-0 left-0 w-full pb-2.5 text-left"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <div className={`border rounded-2xl p-4 shadow-xs transition-all flex flex-col lg:flex-row items-start justify-between gap-4 text-left ${
                        isPast 
                          ? 'bg-slate-50/70 border-slate-200/90 opacity-90' 
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}>
                        {/* Operational Logistics */}
                        <div className="space-y-2 flex-1 min-w-0 text-left">
                          <div className="flex items-center gap-2 flex-wrap text-left">
                            <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-slate-100 text-slate-700 border border-slate-200 text-left">
                              {event.event_type.replace(/_/g, ' ')}
                            </span>
                            {isPast && (
                              <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-slate-200 text-slate-600">
                                Concluded
                              </span>
                            )}
                            <h3 className="font-black text-slate-900 text-sm tracking-tight truncate text-left">
                              {event.title}
                            </h3>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-left">
                            <div className="space-y-1 text-left">
                              <div className="flex items-center gap-1.5 text-slate-700 font-bold text-left">
                                <CalIcon size={12} className="text-slate-400 shrink-0" />
                                <span>{formatDisplayDate(event.start_time)}</span>
                                <span className="text-slate-400 font-medium">
                                  ({formatDisplayTime(event.start_time)} &ndash; {formatDisplayTime(event.end_time)})
                                </span>
                              </div>
                              
                              {isWedding && event.rehearsal_at_centre_date && (
                                <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700 text-left">
                                  Centre Rehearsal: {formatDisplayDate(event.rehearsal_at_centre_date)} {event.rehearsal_at_centre_time ? `at ${formatDisplayTime(event.rehearsal_at_centre_time)}` : ''}
                                </p>
                              )}
                              
                              {isWedding && event.rehearsal_time && (
                                <p className="text-[10px] font-black uppercase tracking-wider text-purple-700 text-left">
                                  Onsite Rehearsal: {formatDisplayTime(event.rehearsal_time)}
                                </p>
                              )}

                              <div className="flex items-start gap-1.5 text-[10px] text-slate-500 font-medium text-left">
                                <MapPin size={11} className="text-slate-400 shrink-0 mt-0.5" />
                                <span>{event.venue_address}</span>
                              </div>
                            </div>

                            <div className="space-y-1 text-left">
                              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-800 text-left">
                                <Phone size={11} className="text-slate-400 shrink-0" />
                                <span>Contact: {event.site_contact_name} {event.site_contact_phone ? `(${event.site_contact_phone})` : ''}</span>
                              </div>
                              {event.wedding_flying_participant && (
                                <p className="text-[10px] text-slate-600 font-medium truncate text-left">
                                  Ring Bearer: <span className="font-bold">{event.wedding_flying_participant}</span> {event.wedding_ring_delivery_only ? '(Ring Only)' : '(Ring + Static)'}
                                </p>
                              )}
                              {event.school_talk_curriculum && (
                                <p className="text-[10px] text-slate-600 font-medium truncate text-left">
                                  Topic: <span className="font-bold">{event.school_talk_curriculum}</span>
                                </p>
                              )}
                              {event.party_type && (
                                <p className="text-[10px] text-slate-600 font-medium truncate text-left">
                                  Party: <span className="font-bold">{event.party_type}</span>
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Staff & Birds Roster */}
                          <div className="flex items-center gap-4 pt-1 flex-wrap text-left">
                            {event.staff_allocations && event.staff_allocations.length > 0 && (
                              <div className="flex items-center gap-1 text-[10px] font-bold text-slate-600 text-left">
                                <Users size={12} className="text-slate-400 shrink-0" />
                                <span>Staff:</span>
                                <div className="flex items-center gap-1 flex-wrap">
                                  {event.staff_allocations.map(s => (
                                    <span key={s.id} className="bg-slate-100 px-1.5 py-0.2 rounded text-[9px] font-black text-slate-700">
                                      {s.users?.name?.split(' ')[0] || 'Staff'}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {event.animal_allocations && event.animal_allocations.length > 0 && (
                              <div className="flex items-center gap-1 text-[10px] font-bold text-slate-600 text-left">
                                <Feather size={12} className="text-emerald-600 shrink-0" />
                                <span>Specimens:</span>
                                <div className="flex items-center gap-1 flex-wrap">
                                  {event.animal_allocations.map(a => (
                                    <span key={a.id} className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.2 rounded text-[9px] font-black" title={a.role_description || undefined}>
                                      {a.animals?.name || 'Bird'}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Commercials Box */}
                        <div className="w-full lg:w-80 bg-white border border-slate-200 rounded-2xl p-3.5 space-y-2 shrink-0 text-left shadow-2xs">
                          <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100 text-left">
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 text-left">
                              <CreditCard size={12} className="text-slate-500" /> Commercials
                            </span>
                            {getPaymentBadge(comm?.payment_status, isPast)}
                          </div>

                          <div className="space-y-1 pt-0.5 text-left">
                            <div className="text-xs font-bold text-slate-900 flex justify-between items-center text-left">
                              <span className="text-slate-500 text-[11px] font-medium text-left">Total Fee:</span>
                              <span className="font-mono font-bold text-slate-900">£{Number(comm?.total_amount || 0).toFixed(2)}</span>
                            </div>

                            {comm?.deposit_amount ? (
                              <div className="text-[11px] text-slate-600 flex justify-between items-center text-left">
                                <span className="text-slate-400 font-medium text-[10px] uppercase tracking-wider text-left">Deposit:</span>
                                <span className="font-mono font-bold text-amber-700">£{Number(comm.deposit_amount).toFixed(2)}</span>
                              </div>
                            ) : null}
                          </div>

                          {comm?.xero_invoice_number && (
                            <div className="bg-slate-50 px-2 py-1 rounded-lg border border-slate-200 flex items-center justify-between gap-2 min-w-0">
                              <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 shrink-0 flex items-center gap-1">
                                <Receipt size={10} /> Ref:
                              </span>
                              <span 
                                className="font-mono text-[10px] font-bold text-slate-800 truncate text-right select-all" 
                                title={comm.xero_invoice_number}
                              >
                                {comm.xero_invoice_number}
                              </span>
                            </div>
                          )}

                          <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 text-left">
                            <span 
                              className="text-[10px] text-slate-400 truncate max-w-[170px] text-left font-medium"
                              title={comm?.client_email || 'No email recorded'}
                            >
                              {comm?.client_email || 'No email recorded'}
                            </span>
                            
                            {isManager && (
                              <div className="flex items-center gap-1 shrink-0">
                                {event.voucher_id && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCancelVoucherTarget({ 
                                        eventId: event.id, 
                                        voucherId: event.voucher_id!, 
                                        title: event.title 
                                      });
                                    }}
                                    className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                                    title="Cancel Booking & Return Voucher to Purchased"
                                  >
                                    <RotateCcw size={13} />
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditEvent(event);
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                                  title="Edit Event Record"
                                >
                                  <Pencil size={13} />
                                </button>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteTarget({ id: event.id, title: event.title });
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                                  title="Archive Record"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>

      {/* Confirmation Dialog: Cancel Booking & Return Voucher */}
      {cancelVoucherTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200 font-sans">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 text-left space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <RotateCcw size={20} />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Return to Purchased?</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Voucher Reinstatement</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 font-medium leading-relaxed">
              Are you sure you want to cancel the scheduled booking for <strong className="text-slate-900 font-bold">{cancelVoucherTarget.title}</strong>? 
              This removes the event from the ledger and returns the voucher to the <strong>Purchased Vouchers</strong> tab so it can be re-booked later.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCancelVoucherTarget(null)}
                disabled={cancelBookingAndReturnVoucherMutation.isPending}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer"
              >
                Keep Booking
              </button>
              <button
                type="button"
                onClick={() => cancelBookingAndReturnVoucherMutation.mutate({ 
                  eventId: cancelVoucherTarget.eventId, 
                  voucherId: cancelVoucherTarget.voucherId 
                })}
                disabled={cancelBookingAndReturnVoucherMutation.isPending}
                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-xs active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {cancelBookingAndReturnVoucherMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                <span>Reinstate Voucher</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog: Archiving Events */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 text-left space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Archive Event?</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Confirmation Required</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 font-medium leading-relaxed">
              Are you sure you want to archive <strong className="text-slate-900 font-bold">{deleteTarget.title}</strong>? This will remove it from active operational rosters.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-xs active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {deleteMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                <span>Archive</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Issue Voucher Modal */}
      <IssueVoucherModal
        isOpen={isIssueVoucherModalOpen}
        onClose={() => setIsIssueVoucherModalOpen(false)}
      />

      {/* Event Registration & Edit Modal */}
      <EventFormModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedEvent(null);
          setSelectedVoucher(null);
        }}
        event={selectedEvent}
        voucher={selectedVoucher}
        animals={animals}
        staffList={staffList}
      />
    </div>
  );
}

export default EventsManagerPage;