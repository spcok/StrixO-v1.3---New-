import { useState, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { 
  Calendar as CalIcon, 
  Search, 
  Loader2, 
  Clock, 
  MapPin, 
  ChevronLeft, 
  ChevronRight, 
  Users, 
  Feather, 
  Phone, 
  CloudRain, 
  RotateCcw, 
  X, 
  AlertTriangle,
  Sparkles
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { 
  EventsCalendar, 
  EventStaffAllocation, 
  EventAnimalAllocation, 
  Animal, 
  User 
} from '../types';

export interface OperationalCalendarEvent extends EventsCalendar {
  staff_allocations?: (EventStaffAllocation & { users?: Partial<User> | null })[];
  animal_allocations?: (EventAnimalAllocation & { animals?: Partial<Animal> | null })[];
}

// Projected item structure for the calendar canvas
export interface ProjectedCalendarItem {
  id: string;
  sourceEventId: string;
  isCentreRehearsal: boolean;
  dateStr: string;
  startTime: string;
  endTime: string;
  title: string;
  eventType: string;
  venueAddress: string;
  siteContactName: string;
  siteContactPhone?: string | null;
  description?: string | null;
  staffAllocations: OperationalCalendarEvent['staff_allocations'];
  animalAllocations: OperationalCalendarEvent['animal_allocations'];
  rawEvent: OperationalCalendarEvent;
}

const getLocalDateString = (d: Date = new Date()): string => {
  if (!d || Number.isNaN(d.getTime())) d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDisplayDate = (dateStr?: string | null): string => {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const firstPart = dateStr.split('T')[0];
  if (!firstPart) return dateStr;
  const parts = firstPart.split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return dateStr;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
};

const formatDisplayTime = (dateStr?: string | null): string => {
  if (!dateStr || typeof dateStr !== 'string') return '--:--';
  if (dateStr.length === 5 && dateStr.includes(':')) return dateStr;
  const dateObj = new Date(dateStr);
  if (Number.isNaN(dateObj.getTime())) return dateStr;
  return dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

// ------------------------------------------------------------------
// 1. QUERY OPTIONS (Fetches Main Weddings AND Rehearsals in Window)
// ------------------------------------------------------------------
const getOperationalEventsOptions = (startDate: string, endDate: string) =>
  queryOptions({
    queryKey: ['operational_calendar', startDate, endDate],
    queryFn: async () => {
      // Query records where EITHER main event OR centre rehearsal falls into the date range
      const { data, error } = await supabase
        .from('events_calendar')
        .select(`
          *,
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
        .or(`and(start_time.gte.${startDate}T00:00:00.000Z,start_time.lte.${endDate}T23:59:59.999Z),and(rehearsal_at_centre_date.gte.${startDate},rehearsal_at_centre_date.lte.${endDate})`)
        .order('start_time', { ascending: true });

      if (error) throw error;
      return (data || []) as OperationalCalendarEvent[];
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24 * 14,
    networkMode: 'offlineFirst',
  });

export const Route = createFileRoute('/logistics/calendar')({
  loader: async ({ context }) => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 2, 0);

    if (context?.queryClient) {
      await context.queryClient.ensureQueryData(
        getOperationalEventsOptions(getLocalDateString(start), getLocalDateString(end))
      );
    }
  },
  component: OperationalCalendarPage,
});

export function OperationalCalendarPage() {
  const { user, hasPermission, profile } = useAuth();
  const queryClient = useQueryClient();

  const isManager =
    hasPermission('events:manage') ||
    ['DIRECTOR', 'ADMIN', 'MANAGER', 'SENIOR_KEEPER'].includes(profile?.role || '');

  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [viewMode, setViewMode] = useState<'DAY' | 'WEEK' | 'MONTH'>('WEEK');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [selectedEvent, setSelectedEvent] = useState<OperationalCalendarEvent | null>(null);
  const [selectedModalIsRehearsal, setSelectedModalIsRehearsal] = useState(false);
  const [isReinstateModalOpen, setIsReinstateModalOpen] = useState(false);
  const [reinstateCode, setReinstateCode] = useState('');
  const [reinstateReason, setReinstateReason] = useState('Weather Cancellation / Reschedule');

  const rangeStartStr = useMemo(() => {
    const start = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    return getLocalDateString(start);
  }, [currentDate]);

  const rangeEndStr = useMemo(() => {
    const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 0);
    return getLocalDateString(end);
  }, [currentDate]);

  const { data: events = [], isLoading } = useQuery(
    getOperationalEventsOptions(rangeStartStr, rangeEndStr)
  );

  // Return voucher mutation
  const returnVoucherMutation = useMutation({
    mutationFn: async ({ code, reason }: { code: string; reason: string }) => {
      const cleanCode = code.trim().toUpperCase();
      if (!cleanCode) throw new Error('Please provide a valid voucher code.');

      const { data: voucher, error: fetchErr } = await supabase
        .from('vouchers')
        .select('*')
        .ilike('voucher_code', cleanCode)
        .maybeSingle();

      if (fetchErr || !voucher) {
        throw new Error(`Voucher code "${cleanCode}" not found.`);
      }

      const auditNote = `[Returned to Purchased on ${new Date().toLocaleDateString('en-GB')} by staff: ${reason}]`;
      const currentNotes = (voucher as any).booking_notes ?? (voucher as any).notes ?? '';
      const updatedNotes = currentNotes ? `${currentNotes}\n${auditNote}` : auditNote;

      const updatePayload: Record<string, any> = {
        status: 'ACTIVE',
        redeemed_at: null,
        redeemed_by: null,
        updated_at: new Date().toISOString(),
        modified_by: user?.id || null,
      };

      if ('booking_notes' in voucher) {
        updatePayload.booking_notes = updatedNotes;
      } else {
        updatePayload.notes = updatedNotes;
      }

      const { data: updated, error: updateErr } = await supabase
        .from('vouchers')
        .update(updatePayload)
        .eq('id', voucher.id)
        .select()
        .single();

      if (updateErr) throw updateErr;
      return updated;
    },
    onSuccess: (voucher: any) => {
      toast.success(`Voucher ${voucher.voucher_code} returned to Purchased (Active) status.`);
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['all_vouchers_directory'] });
      queryClient.invalidateQueries({ queryKey: ['operational_calendar'] });
      setIsReinstateModalOpen(false);
      setReinstateCode('');
    },
    onError: (err: any) => {
      toast.error(`Return failed: ${err.message}`);
    },
  });

  // ------------------------------------------------------------------
  // 2. IN-MEMORY CALENDAR PROJECTION (Expands Weddings into 2 Items)
  // ------------------------------------------------------------------
  const projectedItems = useMemo(() => {
    const items: ProjectedCalendarItem[] = [];

    events.forEach((e) => {
      if (!e) return;

      // 1. Project the Main Event
      if (e.start_time) {
        const eventDateStr = e.start_time.split('T')[0]!;
        items.push({
          id: e.id,
          sourceEventId: e.id,
          isCentreRehearsal: false,
          dateStr: eventDateStr,
          startTime: e.start_time,
          endTime: e.end_time,
          title: e.title,
          eventType: e.event_type,
          venueAddress: e.venue_address || 'Kent Owl Academy Onsite',
          siteContactName: e.site_contact_name,
          siteContactPhone: e.site_contact_phone,
          description: e.description,
          staffAllocations: e.staff_allocations,
          animalAllocations: e.animal_allocations,
          rawEvent: e,
        });
      }

      // 2. If it's a Wedding with a Centre Rehearsal Date, Project the Rehearsal Session
      if (e.event_type === 'WEDDING' && e.rehearsal_at_centre_date) {
        const rehearsalDateClean = e.rehearsal_at_centre_date.split('T')[0]!;
        const rehearsalTime = e.rehearsal_at_centre_time || '10:00';
        
        // Approximate 1-hour duration for the rehearsal schedule block
        const [h, m] = rehearsalTime.split(':').map(Number);
        const endHour = String(((h || 10) + 1) % 24).padStart(2, '0');
        const endMin = String(m || 0).padStart(2, '0');

        items.push({
          id: `${e.id}-centre-rehearsal`,
          sourceEventId: e.id,
          isCentreRehearsal: true,
          dateStr: rehearsalDateClean,
          startTime: `${rehearsalDateClean}T${rehearsalTime}:00`,
          endTime: `${rehearsalDateClean}T${endHour}:${endMin}:00`,
          title: `Centre Rehearsal: ${e.title}`,
          eventType: 'WEDDING_REHEARSAL',
          venueAddress: 'Kent Owl Academy (Centre Aviary & Flying Ground)',
          siteContactName: e.site_contact_name,
          siteContactPhone: e.site_contact_phone,
          description: `Onsite rehearsal and flight practice for ring-bearer participant: ${e.wedding_flying_participant || 'Best Man/Bride/Groom'}. Wedding ceremony takes place on ${formatDisplayDate(e.start_time)}.`,
          staffAllocations: e.staff_allocations,
          // Only show allocated specimens (usually the ring-bearer owl)
          animalAllocations: e.animal_allocations,
          rawEvent: e,
        });
      }
    });

    return items;
  }, [events]);

  // Search filtering
  const filteredItems = useMemo(() => {
    return projectedItems.filter((item) => {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.venueAddress.toLowerCase().includes(q) ||
        (item.siteContactName || '').toLowerCase().includes(q) ||
        (item.description || '').toLowerCase().includes(q) ||
        item.eventType.toLowerCase().includes(q)
      );
    });
  }, [projectedItems, searchQuery]);

  const handlePrev = () => {
    const next = new Date(currentDate);
    if (viewMode === 'DAY') next.setDate(next.getDate() - 1);
    else if (viewMode === 'WEEK') next.setDate(next.getDate() - 7);
    else next.setMonth(next.getMonth() - 1);
    setCurrentDate(next);
  };

  const handleNext = () => {
    const next = new Date(currentDate);
    if (viewMode === 'DAY') next.setDate(next.getDate() + 1);
    else if (viewMode === 'WEEK') next.setDate(next.getDate() + 7);
    else next.setMonth(next.getMonth() + 1);
    setCurrentDate(next);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Week Days (Mon-Sun)
  const weekDays = useMemo(() => {
    const curr = new Date(currentDate);
    const dayOfWeek = curr.getDay();
    const distanceToMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(curr);
    monday.setDate(curr.getDate() - distanceToMonday);

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return {
        dateObj: d,
        dateStr: getLocalDateString(d),
        dayName: d.toLocaleDateString('en-GB', { weekday: 'short' }),
        dayNum: d.getDate(),
        isToday: getLocalDateString(d) === getLocalDateString(new Date()),
      };
    });
  }, [currentDate]);

  // Month Matrix
  const monthMatrix = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    const firstDayIndex = (firstDayOfMonth.getDay() + 6) % 7;
    const totalDays = lastDayOfMonth.getDate();

    const matrix: ({ dateStr: string; dayNum: number; isCurrentMonth: boolean; isToday: boolean } | null)[] = [];

    for (let i = 0; i < firstDayIndex; i++) {
      matrix.push(null);
    }

    for (let day = 1; day <= totalDays; day++) {
      const d = new Date(year, month, day);
      matrix.push({
        dateStr: getLocalDateString(d),
        dayNum: day,
        isCurrentMonth: true,
        isToday: getLocalDateString(d) === getLocalDateString(new Date()),
      });
    }

    return matrix;
  }, [currentDate]);

  const getItemBadge = (item: ProjectedCalendarItem) => {
    if (item.isCentreRehearsal) {
      return (
        <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center gap-1">
          <Sparkles size={9} className="text-indigo-600" /> Centre Rehearsal
        </span>
      );
    }

    switch (item.eventType) {
      case 'WEDDING':
        return <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-purple-50 text-purple-700 border border-purple-200">Wedding</span>;
      case 'SCHOOL_TALK':
        return <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-blue-50 text-blue-700 border border-blue-200">School</span>;
      case 'PARTY':
        return <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-pink-50 text-pink-700 border border-pink-200">Party</span>;
      case 'EXPERIENCE':
        return <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-200">Experience</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-slate-100 text-slate-700 border border-slate-200">{item.eventType.replace(/_/g, ' ')}</span>;
    }
  };

  const getHeaderText = () => {
    if (viewMode === 'DAY') {
      return currentDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (viewMode === 'WEEK') {
      const first = weekDays[0]!.dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const last = weekDays[6]!.dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      return `${first} – ${last}`;
    }
    return currentDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  };

  const handleOpenItem = (item: ProjectedCalendarItem) => {
    setSelectedEvent(item.rawEvent);
    setSelectedModalIsRehearsal(item.isCentreRehearsal);
  };

  return (
    <div className="h-full flex-1 flex flex-col min-h-0 overflow-hidden space-y-2 lg:space-y-2.5 font-sans text-left">
      
      {/* Header */}
      <div className="flex justify-between items-center w-full shrink-0 text-left">
        <div className="text-left">
          <h1 className="text-lg lg:text-xl font-black text-slate-900 tracking-tight leading-none flex items-center gap-2 text-left">
            Operational Calendar
          </h1>
          <p className="text-[10px] lg:text-xs text-slate-400 font-bold uppercase tracking-wider mt-1 text-left">
            Master Roster, Centre Rehearsals, Deployments &amp; Timings
          </p>
        </div>

        {/* View Switcher & Voucher Reinstatement Button */}
        <div className="flex items-center gap-2 shrink-0">
          {isManager && (
            <button
              type="button"
              onClick={() => setIsReinstateModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer shadow-xs active:scale-95"
              title="Return a voucher to Purchased status after weather/event cancellation"
            >
              <RotateCcw size={13} className="text-amber-600" />
              <span className="hidden sm:inline">Reinstate Voucher</span>
            </button>
          )}

          <div className="flex items-center bg-slate-100 p-1 rounded-xl gap-1 shrink-0 text-left">
            <button
              type="button"
              onClick={() => setViewMode('DAY')}
              className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                viewMode === 'DAY' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Day
            </button>
            <button
              type="button"
              onClick={() => setViewMode('WEEK')}
              className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                viewMode === 'WEEK' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Week
            </button>
            <button
              type="button"
              onClick={() => setViewMode('MONTH')}
              className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                viewMode === 'MONTH' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Month
            </button>
          </div>
        </div>
      </div>

      {/* Control Deck */}
      <div className="flex flex-col sm:flex-row gap-2 w-full bg-slate-50/80 p-2 rounded-xl border border-slate-200 shrink-0 text-left">
        <div className="relative flex-1 shrink-0 text-left">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="text"
            placeholder="Search weddings, rehearsals, staff, or specimens..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 transition-all shadow-xs placeholder:text-slate-400 font-medium text-left"
          />
        </div>

        <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-xs shrink-0 text-left">
          <button
            type="button"
            onClick={handlePrev}
            className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
          >
            <ChevronLeft size={15} />
          </button>

          <span className="text-xs font-black uppercase tracking-wider text-slate-800 px-2 text-left min-w-[160px] text-center">
            {getHeaderText()}
          </span>

          <button
            type="button"
            onClick={handleNext}
            className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
          >
            <ChevronRight size={15} />
          </button>

          <button
            type="button"
            onClick={handleToday}
            className="ml-1 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
          >
            Today
          </button>
        </div>
      </div>

      {/* Main Schedule Canvas */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col flex-1 min-h-0 overflow-hidden relative text-left">
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-xs z-10 flex items-center justify-center">
            <div className="bg-white p-3.5 rounded-xl shadow-lg flex items-center gap-2.5 border border-slate-100 text-left">
              <Loader2 className="animate-spin text-slate-800" size={20} />
              <span className="text-xs font-bold text-slate-700 text-left">Loading operational schedule...</span>
            </div>
          </div>
        )}

        {/* 1. DAY VIEW */}
        {viewMode === 'DAY' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3 bg-slate-50/30 text-left">
            {(() => {
              const selectedDateStr = getLocalDateString(currentDate);
              const dayItems = filteredItems.filter((item) => item.dateStr === selectedDateStr);

              if (dayItems.length === 0) {
                return (
                  <div className="p-16 text-center text-slate-400 flex flex-col items-center justify-center">
                    <CalIcon size={40} className="opacity-20 mb-2" />
                    <p className="text-xs font-black uppercase tracking-widest text-slate-700">No Events or Rehearsals</p>
                    <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                      No bookings or centre rehearsals registered for {formatDisplayDate(selectedDateStr)}.
                    </p>
                  </div>
                );
              }

              return dayItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleOpenItem(item)}
                  className={`border rounded-2xl p-4 shadow-xs hover:border-slate-400 transition-all space-y-3 text-left cursor-pointer ${
                    item.isCentreRehearsal ? 'bg-indigo-50/40 border-indigo-200' : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between flex-wrap gap-2 text-left">
                    <div className="flex items-center gap-2">
                      {getItemBadge(item)}
                      <h3 className="font-black text-slate-900 text-base tracking-tight text-left">
                        {item.title}
                      </h3>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs font-black text-slate-800">
                      <Clock size={13} className="text-slate-400" />
                      <span>{formatDisplayTime(item.startTime)} &ndash; {formatDisplayTime(item.endTime)}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs text-left bg-white p-3 rounded-xl border border-slate-200/80">
                    <div>
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Location</span>
                      <p className="font-bold text-slate-800 flex items-start gap-1 mt-0.5">
                        <MapPin size={12} className="text-slate-400 shrink-0 mt-0.5" />
                        <span>{item.venueAddress}</span>
                      </p>
                    </div>

                    <div>
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Client Contact</span>
                      <p className="font-bold text-slate-800 flex items-center gap-1 mt-0.5">
                        <Phone size={12} className="text-slate-400 shrink-0" />
                        <span>{item.siteContactName || 'Staff Lead'} {item.siteContactPhone ? `(${item.siteContactPhone})` : ''}</span>
                      </p>
                    </div>

                    <div>
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Session Focus</span>
                      {item.isCentreRehearsal ? (
                        <p className="text-[10px] font-bold text-indigo-700">
                          Pre-Wedding Flying Practice at KOA Centre
                        </p>
                      ) : (
                        <p className="text-[10px] text-slate-500 font-medium">Main Event Day</p>
                      )}
                    </div>
                  </div>

                  {/* Staff & Bird Deployments */}
                  <div className="flex flex-wrap items-center gap-4 pt-1 text-left">
                    {item.staffAllocations && item.staffAllocations.length > 0 && (
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                        <Users size={14} className="text-slate-400" />
                        <span>Staff Assigned:</span>
                        <div className="flex items-center gap-1 flex-wrap">
                          {item.staffAllocations.map((s) => (
                            <span key={s.id} className="bg-slate-100 px-2 py-0.5 rounded text-[10px] font-black text-slate-800">
                              {s.users?.name || 'Staff'} ({s.users?.role || 'Keeper'})
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {item.animalAllocations && item.animalAllocations.length > 0 && (
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                        <Feather size={14} className="text-emerald-600" />
                        <span>Flying Specimens:</span>
                        <div className="flex items-center gap-1 flex-wrap">
                          {item.animalAllocations.map((a) => (
                            <span key={a.id} className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-black">
                              {a.animals?.name || 'Bird'} {a.role_description ? `(${a.role_description})` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ));
            })()}
          </div>
        )}

        {/* 2. WEEK VIEW */}
        {viewMode === 'WEEK' && (
          <div className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar p-3 bg-slate-50/40 text-left">
            <div className="grid grid-cols-7 gap-2 min-w-[980px] h-full text-left">
              {weekDays.map((day) => {
                const dayItems = filteredItems.filter((item) => item.dateStr === day.dateStr);

                return (
                  <div
                    key={day.dateStr}
                    className={`flex flex-col rounded-2xl border ${
                      day.isToday
                        ? 'bg-white border-emerald-400/80 shadow-xs'
                        : 'bg-white/80 border-slate-200'
                    } overflow-hidden min-h-[360px] text-left`}
                  >
                    <div className={`p-2.5 border-b text-center shrink-0 ${
                      day.isToday ? 'bg-emerald-500 text-white' : 'bg-slate-50 text-slate-800 border-slate-100'
                    }`}>
                      <p className={`text-[10px] font-black uppercase tracking-widest ${day.isToday ? 'text-emerald-100' : 'text-slate-400'}`}>
                        {day.dayName}
                      </p>
                      <p className="text-base font-black leading-none mt-0.5">{day.dayNum}</p>
                    </div>

                    <div className="flex-1 p-2 space-y-2 overflow-y-auto custom-scrollbar text-left">
                      {dayItems.length === 0 ? (
                        <p className="text-[10px] text-slate-300 font-bold uppercase text-center pt-8 tracking-widest">
                          No Events
                        </p>
                      ) : (
                        dayItems.map((item) => (
                          <div
                            key={item.id}
                            onClick={() => handleOpenItem(item)}
                            className={`border rounded-xl p-2 space-y-1 hover:border-slate-400 transition-all text-left shadow-2xs cursor-pointer ${
                              item.isCentreRehearsal ? 'bg-indigo-50/60 border-indigo-200' : 'bg-slate-50 border-slate-200'
                            }`}
                          >
                            <div className="flex items-center justify-between text-[9px] font-bold text-slate-500">
                              <span>{formatDisplayTime(item.startTime)}</span>
                              {getItemBadge(item)}
                            </div>

                            <p className="text-xs font-black text-slate-900 leading-snug line-clamp-2 text-left">
                              {item.title}
                            </p>

                            <p className="text-[10px] text-slate-500 truncate text-left">
                              {item.venueAddress}
                            </p>

                            {item.animalAllocations && item.animalAllocations.length > 0 && (
                              <div className="flex flex-wrap gap-0.5 pt-1 text-left">
                                {item.animalAllocations.map((a) => (
                                  <span key={a.id} className="text-[8px] font-black bg-emerald-100 text-emerald-800 px-1 py-0.2 rounded">
                                    {a.animals?.name || 'Bird'}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. MONTH VIEW */}
        {viewMode === 'MONTH' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 bg-slate-50/40 text-left">
            <div className="grid grid-cols-7 gap-1.5 min-w-[760px] text-left">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                <div key={day} className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-center py-1">
                  {day}
                </div>
              ))}

              {monthMatrix.map((cell, idx) => {
                if (!cell) {
                  return <div key={`blank-${idx}`} className="bg-slate-50/40 border border-slate-100 rounded-xl min-h-[90px]" />;
                }

                const dayItems = filteredItems.filter((item) => item.dateStr === cell.dateStr);

                return (
                  <div
                    key={cell.dateStr}
                    onClick={() => {
                      const parts = cell.dateStr.split('-').map(Number);
                      if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
                        setCurrentDate(new Date(parts[0], parts[1] - 1, parts[2]));
                      }
                      setViewMode('DAY');
                    }}
                    className={`bg-white border ${
                      cell.isToday ? 'border-emerald-500 shadow-xs' : 'border-slate-200'
                    } rounded-xl p-1.5 min-h-[96px] flex flex-col justify-between hover:border-slate-400 transition-all cursor-pointer text-left`}
                  >
                    <div className="flex items-center justify-between pb-1 border-b border-slate-100 text-left">
                      <span className={`text-xs font-black ${cell.isToday ? 'text-emerald-600 font-black' : 'text-slate-700'}`}>
                        {cell.dayNum}
                      </span>
                      {dayItems.length > 0 && (
                        <span className="text-[8px] font-black bg-slate-100 text-slate-600 px-1 py-0.2 rounded">
                          {dayItems.length}
                        </span>
                      )}
                    </div>

                    <div className="space-y-1 overflow-y-auto custom-scrollbar max-h-16 pt-1 text-left">
                      {dayItems.map((item) => (
                        <div
                          key={item.id}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            handleOpenItem(item);
                          }}
                          className={`px-1.5 py-0.5 rounded text-[8px] font-black truncate border text-left hover:brightness-95 ${
                            item.isCentreRehearsal 
                              ? 'bg-indigo-50 border-indigo-200 text-indigo-900' 
                              : 'bg-slate-50 border-slate-200 text-slate-800'
                          }`}
                          title={`${formatDisplayTime(item.startTime)} - ${item.title}`}
                        >
                          <span className={item.isCentreRehearsal ? 'text-indigo-500' : 'text-slate-400'}>
                            {formatDisplayTime(item.startTime)}
                          </span>{' '}
                          {item.title}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* --- EVENT DETAILS MODAL --- */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 font-sans text-left">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  {selectedModalIsRehearsal ? (
                    <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center gap-1">
                      <Sparkles size={9} /> Centre Rehearsal Session
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-purple-50 text-purple-700 border border-purple-200">
                      Wedding Day
                    </span>
                  )}
                  <h2 className="text-lg font-black text-slate-900 tracking-tight">{selectedEvent.title}</h2>
                </div>
                <p className="text-xs text-slate-500 font-bold mt-0.5">
                  Ceremony: {formatDisplayDate(selectedEvent.start_time)} • {formatDisplayTime(selectedEvent.start_time)} &ndash; {formatDisplayTime(selectedEvent.end_time)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs font-medium text-slate-700">
              {/* Highlight if opened from Rehearsal */}
              {selectedModalIsRehearsal && selectedEvent.rehearsal_at_centre_date && (
                <div className="bg-indigo-50/80 border border-indigo-200 p-3 rounded-2xl space-y-1">
                  <span className="text-[9px] font-black uppercase tracking-widest text-indigo-800 block">
                    Active Centre Rehearsal Timings:
                  </span>
                  <p className="text-xs font-bold text-indigo-950">
                    {formatDisplayDate(selectedEvent.rehearsal_at_centre_date)} at {selectedEvent.rehearsal_at_centre_time ? formatDisplayTime(selectedEvent.rehearsal_at_centre_time) : '10:00'}
                  </p>
                  <p className="text-[11px] text-indigo-800">
                    Location: Kent Owl Academy Aviaries (Flying practice with {selectedEvent.wedding_flying_participant || 'Best Man'}).
                  </p>
                </div>
              )}

              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-2">
                <p className="flex items-start gap-1.5">
                  <MapPin size={14} className="text-slate-400 shrink-0 mt-0.5" />
                  <span><strong>Wedding Venue:</strong> {selectedEvent.venue_address || 'Kent Owl Academy Centre'}</span>
                </p>
                <p className="flex items-center gap-1.5">
                  <Phone size={14} className="text-slate-400 shrink-0" />
                  <span><strong>Lead Contact:</strong> {selectedEvent.site_contact_name || 'N/A'} {selectedEvent.site_contact_phone ? `(${selectedEvent.site_contact_phone})` : ''}</span>
                </p>
                {selectedEvent.description && (
                  <p className="text-slate-600 mt-1 pl-5 border-l-2 border-slate-200">
                    {selectedEvent.description}
                  </p>
                )}
              </div>

              {/* Staff and Animals */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Assigned Keepers</span>
                  {selectedEvent.staff_allocations && selectedEvent.staff_allocations.length > 0 ? (
                    <ul className="space-y-1">
                      {selectedEvent.staff_allocations.map((s) => (
                        <li key={s.id} className="font-bold text-slate-800 text-[11px]">
                          • {s.users?.name || 'Staff'} ({s.users?.role || 'Keeper'})
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-slate-400 italic">No staff assigned</p>
                  )}
                </div>

                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1">Assigned Birds</span>
                  {selectedEvent.animal_allocations && selectedEvent.animal_allocations.length > 0 ? (
                    <ul className="space-y-1">
                      {selectedEvent.animal_allocations.map((a) => (
                        <li key={a.id} className="font-bold text-emerald-800 text-[11px]">
                          • {a.animals?.name || 'Specimen'} {a.role_description ? `(${a.role_description})` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-slate-400 italic">No birds assigned</p>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Actions Footer */}
            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              {isManager && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEvent(null);
                    setIsReinstateModalOpen(true);
                  }}
                  className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <CloudRain size={14} className="text-amber-600" />
                  <span>Reinstate Client Voucher</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-widest cursor-pointer ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- REINSTATE VOUCHER MODAL --- */}
      {isReinstateModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 font-sans text-left">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-amber-50 text-amber-600 rounded-xl border border-amber-200">
                  <RotateCcw size={18} />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 uppercase tracking-tight text-sm">Return Voucher to Purchased</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Reinstate uncancelled voucher</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsReinstateModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                returnVoucherMutation.mutate({ code: reinstateCode, reason: reinstateReason });
              }}
              className="space-y-3.5"
            >
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Voucher Code *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. OE2507260101-A4B9"
                  value={reinstateCode}
                  onChange={(e) => setReinstateCode(e.target.value.toUpperCase())}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-mono font-black text-slate-900 uppercase tracking-widest focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Reason for Reinstatement
                </label>
                <input
                  type="text"
                  required
                  value={reinstateReason}
                  onChange={(e) => setReinstateReason(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>

              <div className="bg-amber-50/70 border border-amber-200/80 p-3 rounded-xl text-[11px] font-medium text-amber-900 flex items-start gap-2">
                <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                <span>This resets the voucher status to <strong>ACTIVE</strong> and clears the redeemed timestamp so the visitor can re-book or redeem it at a later date.</span>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsReinstateModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!reinstateCode.trim() || returnVoucherMutation.isPending}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-widest rounded-xl disabled:opacity-50 flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  {returnVoucherMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                  <span>Return to Purchased</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default OperationalCalendarPage;