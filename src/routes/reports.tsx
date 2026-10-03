import React, { useState, useMemo, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, queryOptions } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { reportExportService } from '../services/reportExportService';
import { 
  CalendarDays, ListOrdered, AlertTriangle, ArrowRightLeft, 
  Download, Loader2, FileText, ChevronRight, Eye, Filter, WifiOff, 
  Scale, Utensils, Wrench, HeartPulse, Archive, CalendarClock,
  Monitor
} from 'lucide-react';
import { format, parseISO, addDays } from 'date-fns';

// ------------------------------------------------------------------
// 1. DATA FETCHER (Unified Pre-Fetch Pool with Offline Failover)
// ------------------------------------------------------------------
const reportDataOptions = queryOptions({
  queryKey: ['report_data'],
  queryFn: async () => {
    const [animals, logs, internal, external, incidents, maintenance, firstAid, schedules] = await Promise.all([
      supabase.from('animals').select('*'),
      supabase.from('daily_logs').select('*, animals(name)'),
      supabase.from('internal_movements').select('*, animals(name, species)'),
      supabase.from('external_transfers').select('*, animals(name, species)'),
      supabase.from('incidents').select('*'),
      supabase.from('maintenance_tickets').select('*'),
      supabase.from('first_aid_logs').select('*'),
      supabase.from('feeding_schedules').select('*')
    ]);
    return {
      animals: animals.data || [],
      logs: logs.data || [],
      internal: internal.data || [],
      external: external.data || [],
      incidents: incidents.data || [],
      maintenance: maintenance.data || [],
      firstAid: firstAid.data || [],
      schedules: schedules.data || []
    };
  },
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 60 * 24 * 15,
  networkMode: 'offlineFirst',
  meta: { persist: true }
});

export const Route = createFileRoute('/reports')({
  loader: async ({ context }: any) => {
    if (context?.queryClient) {
      await context.queryClient.ensureQueryData(reportDataOptions);
    }
  },
  component: ReportsDashboard,
});

// ------------------------------------------------------------------
// 2. REPORT DEFINITIONS
// ------------------------------------------------------------------
const REPORTS = [
  { id: 'husbandry', title: 'Daily Husbandry Logs', description: 'Export daily observation records.', icon: CalendarDays, columns: ['Date', 'Animal', 'Log Type', 'Notes', 'Staff'] },
  { id: 'weekly_feed', title: 'Weekly Feed Chart', description: 'Log of nutritional intake & feed methods.', icon: Utensils, columns: ['Date', 'Animal', 'Feed Details', 'Quantity', 'Notes'] },
  { id: 'feed_tick_sheet', title: 'Feeding Tick Sheet', description: 'Printable weekly calendar for physical sign-offs.', icon: CalendarClock, columns: ['Animal', 'Category', 'Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'] },
  { id: 'weekly_weight', title: 'Weekly Weight Chart', description: 'Tracking of animal masses and anomalies.', icon: Scale, columns: ['Date', 'Animal', 'Weight', 'Unit', 'Notes'] },
  { id: 'internal_movements', title: 'Internal Movements', description: 'Log of enclosure changes.', icon: ArrowRightLeft, columns: ['Date', 'Animal', 'Species', 'From', 'To', 'Reason'] },
  { id: 'external_movements', title: 'External Transfers', description: 'Acquisitions, loans, and dispositions.', icon: ArrowRightLeft, columns: ['Date', 'Animal', 'Transfer Type', 'Origin/Destination', 'Auth By'] },
  { id: 'census', title: 'Annual Census (Section 9)', description: 'Complete site inventory.', icon: ListOrdered, columns: ['Name', 'Species', 'Category', 'Sex', 'Status'] },
  { id: 'incidents', title: 'Safety Incidents', description: 'Operational and safety incident log.', icon: AlertTriangle, columns: ['Date', 'Category', 'Severity', 'Description', 'Reported By'] },
  { id: 'first_aid', title: 'First Aid Report', description: 'Medical interventions for staff/public.', icon: HeartPulse, columns: ['Date', 'Person Type', 'Injury', 'Treatment', 'Administered By'] },
  { id: 'maintenance', title: 'Site Maintenance', description: 'Facility repair and upkeep log.', icon: Wrench, columns: ['Date', 'Location', 'Issue', 'Priority', 'Status'] },
  { id: 'inspection_pack', title: 'ZLA Inspection Pack', description: 'Auto-generates a .zip containing all statutory requirements.', icon: Archive, columns: ['Included Document', 'Description'] }
];

// ------------------------------------------------------------------
// 3. MAIN COMPONENT
// ------------------------------------------------------------------
export function ReportsDashboard() {
  const { user, profile } = useAuth();
  const [activeReportId, setActiveReportId] = useState('husbandry');
  
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd')); 
  const [endDate, setEndDate] = useState(format(addDays(new Date(), 7), 'yyyy-MM-dd'));
  const [selectedCategory, setSelectedCategory] = useState<string>('EXOTIC');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const { data: db, isLoading } = useQuery(reportDataOptions);
  const activeReport = REPORTS.find(r => r.id === activeReportId)!;

  // ------------------------------------------------------------------
  // DATA TRANSFORMATION ENGINE
  // ------------------------------------------------------------------
  const getTransformedData = (reportId: string) => {
    if (!db) return [];

    const filterByDateAndCategory = (items: any[], dateField: string) => {
      return items.filter(item => {
        const itemDate = item[dateField] ? item[dateField].split('T')[0] : null;
        const animal = db.animals.find((a: any) => a.id === item.animal_id);
        const inDateRange = itemDate ? itemDate >= startDate && itemDate <= endDate : true;
        const inCategory = selectedCategory === 'ALL' ? true : animal?.category === selectedCategory;
        return inDateRange && inCategory;
      });
    };

    switch (reportId) {
      case 'husbandry':
        return filterByDateAndCategory(db.logs.filter((l: any) => l.log_type === 'OBSERVATION'), 'log_date')
          .map((l: any) => [format(parseISO(l.log_date), 'dd MMM yyyy HH:mm'), `${l.animals?.name || 'Unknown'}`, l.log_type, l.notes || '-', l.created_by?.substring(0, 8) || 'Unknown']);
      
      case 'weekly_feed':
        return filterByDateAndCategory(db.logs.filter((l: any) => l.log_type === 'FEEDING'), 'log_date')
          .map((l: any) => {
            const meals = l.feed_details?.meals?.map((m: any) => m.food_item).join(', ') || 'Standard Diet';
            const qty = l.feed_details?.meals?.map((m: any) => m.quantity_offered || m.quantity).join(', ') || '-';
            return [format(parseISO(l.log_date), 'dd MMM yyyy'), l.animals?.name || 'Unknown', meals, qty, l.notes || '-'];
          });
      
      case 'feed_tick_sheet': {
        const start = parseISO(startDate);
        const days = Array.from({ length: 7 }).map((_, i) => addDays(start, i));

        const targetAnimals = selectedCategory === 'ALL'
          ? db.animals.filter((a: any) => a.status !== 'ARCHIVED')
          : db.animals.filter((a: any) => a.category === selectedCategory && a.status !== 'ARCHIVED');

        return targetAnimals.map((animal: any) => {
          const animalSchedules = db.schedules.filter((s: any) => s.animal_id === animal.id && !s.is_deleted);
          const row = [animal.name, animal.category || '-'];

          days.forEach(day => {
            const dayStr = format(day, 'yyyy-MM-dd');
            const schedulesForDay = animalSchedules.filter((s: any) => s.scheduled_date === dayStr);

            if (schedulesForDay.length > 0) {
              const isFasting = schedulesForDay.some((s: any) => s.notes === 'FAST DAY / NOT REQUIRED' || s.food_type === 'NOT REQUIRED');
              
              if (isFasting) {
                row.push('FAST');
              } else {
                const combinedFeeds = schedulesForDay.map((s: any) => {
                  const qty = s.quantity || '';
                  const unit = (s.quantity_unit === 'item' || s.quantity_unit === 'whole_item') ? 'x' : (s.quantity_unit || '');
                  let itemString = `${qty}${unit} ${s.food_type || 'Diet'}`.trim();
                  
                  const needsCalci = s.calci_dust === true || 
                                     s.requires_calcidust === true || 
                                     (s.supplements && s.supplements.toLowerCase().includes('calci'));
                  
                  if (needsCalci) {
                    itemString += ' (+Calci)';
                  }
                  return itemString;
                }).join(' & ');

                row.push(`[ ] ${combinedFeeds}`);
              }
            } else {
               row.push('-');
            }
          });
          return row;
        });
      }

      case 'weekly_weight':
         return filterByDateAndCategory(db.logs.filter((l: any) => l.log_type === 'WEIGHT'), 'log_date')
          .map((l: any) => [format(parseISO(l.log_date), 'dd MMM yyyy'), l.animals?.name || 'Unknown', l.weight_grams, 'g', l.notes || '-']);
      
      case 'internal_movements':
         return filterByDateAndCategory(db.internal, 'movement_date')
          .map((m: any) => [format(parseISO(m.movement_date), 'dd MMM yyyy'), m.animals?.name || 'Unknown', m.animals?.species || '-', m.from_enclosure, m.to_enclosure, m.reason || '-']);
      
      case 'external_movements':
         return filterByDateAndCategory(db.external, 'transfer_date')
          .map((m: any) => [format(parseISO(m.transfer_date), 'dd MMM yyyy'), m.animals?.name || 'Unknown', m.transfer_type, m.entity_name, m.reason || '-']);
      
      case 'census':
         return db.animals.filter((a: any) => a.status !== 'ARCHIVED' && (selectedCategory === 'ALL' || a.category === selectedCategory))
          .map((a: any) => [a.name, a.species || '-', a.category || '-', a.gender || '-', a.status || '-']);
      
      case 'incidents':
         return filterByDateAndCategory(db.incidents, 'incident_date')
          .map((i: any) => [format(parseISO(i.incident_date), 'dd MMM yyyy'), i.category || i.incident_type || '-', i.severity, i.description, i.reported_by?.substring(0,8) || '-']);
      
      case 'first_aid':
         return filterByDateAndCategory(db.firstAid, 'incident_date')
          .map((f: any) => [format(parseISO(f.incident_date), 'dd MMM yyyy'), f.person_type, f.injury_description || f.injury_type || '-', f.treatment_provided, f.administered_by?.substring(0,8) || '-']);
      
      case 'maintenance':
         return filterByDateAndCategory(db.maintenance, 'created_at')
          .map((m: any) => [format(parseISO(m.created_at), 'dd MMM yyyy'), m.location, m.title || m.issue_description || '-', m.priority, m.status]);
      
      case 'inspection_pack':
         return [
           ['Husbandry Logs', 'Complete daily logs for all animals'],
           ['Internal Movements', 'Complete log of enclosure changes'],
           ['External Transfers', 'Acquisitions, loans, and dispositions'],
           ['Site Census', 'Current animal inventory']
         ];
      
      default:
        return [];
    }
  };

  const reportData = useMemo(() => getTransformedData(activeReportId), [db, activeReportId, startDate, endDate, selectedCategory]);

  // ------------------------------------------------------------------
  // EXPORT HANDLER
  // ------------------------------------------------------------------
  const handleExport = async () => {
    if (!isOnline) {
      alert("Compliance exports require an active internet connection to securely fetch the latest letterheads.");
      return;
    }

    setIsGenerating(true);
    try {
      const basePayload = {
        generatorName: profile?.name || user?.email || "System Administrator",
        dateRange: activeReportId === 'feed_tick_sheet' 
          ? `Week Commencing ${format(new Date(startDate), 'dd MMM yyyy')}` 
          : `${format(new Date(startDate), 'dd MMM yyyy')} to ${format(new Date(endDate), 'dd MMM yyyy')}`
      };

      if (activeReportId === 'inspection_pack') {
        const packReports = [
          { filenameId: 'Husbandry', payload: { ...basePayload, title: 'Husbandry Logs', columns: REPORTS.find(r => r.id === 'husbandry')!.columns, data: getTransformedData('husbandry') } },
          { filenameId: 'Internal_Movements', payload: { ...basePayload, title: 'Internal Movements', columns: REPORTS.find(r => r.id === 'internal_movements')!.columns, data: getTransformedData('internal_movements') } },
          { filenameId: 'External_Transfers', payload: { ...basePayload, title: 'External Transfers', columns: REPORTS.find(r => r.id === 'external_movements')!.columns, data: getTransformedData('external_movements') } },
          { filenameId: 'Census', payload: { ...basePayload, title: 'Site Census', columns: REPORTS.find(r => r.id === 'census')!.columns, data: getTransformedData('census') } },
        ];
        await reportExportService.generateInspectionPackZip(packReports);
      } else {
        let dynamicColumns = activeReport.columns;
        if (activeReportId === 'feed_tick_sheet') {
           const start = parseISO(startDate);
           dynamicColumns = ['Animal', 'Category', ...Array.from({ length: 7 }).map((_, i) => format(addDays(start, i), 'EEE dd MMM'))];
        }

        await reportExportService.exportSingleReport({
          ...basePayload,
          title: activeReport.title,
          columns: dynamicColumns,
          data: reportData
        }, activeReportId);
      }
    } catch (error) {
      console.error("Export Failed:", error);
      alert("Failed to generate report export.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      {/* 1. MOBILE & TABLET FALLBACK NOTICE (Screen width < 1024px) */}
      <div className="lg:hidden flex-1 flex flex-col items-center justify-center p-6 text-center my-auto min-h-[60vh]">
        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl max-w-md w-full flex flex-col items-center">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
            <Monitor size={32} className="text-slate-700" />
          </div>
          <h2 className="text-base font-black text-slate-900 uppercase tracking-tight mb-1.5">
            Desktop Display Required
          </h2>
          <p className="text-xs text-slate-500 font-medium leading-relaxed mb-4">
            Statutory Zoo Licensing Act (ZLA) audits, rolling 7-day feeding tick sheets, and compliance document compilers require desktop resolution for accurate preview and formatting.
          </p>
          <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Please log in from a desktop workstation or laptop
          </div>
        </div>
      </div>

      {/* 2. FULL DESKTOP WORKSPACE (Visible on lg screens and up) */}
      <div className="hidden lg:flex h-[calc(100vh-6rem)] flex-col space-y-4 animate-in fade-in duration-300 w-full">
        
        {/* --- HEADER RIBBON --- */}
        <div className="flex justify-between items-start w-full mb-1 shrink-0">
          <div className="shrink-0 pr-4 flex flex-col gap-1">
             <h1 className="text-xl font-black text-slate-900 tracking-tight leading-none">
               Reports & Statutory Audits
             </h1>
             <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
               Statutory Zoo Licensing Act (ZLA) Compliance Packs & Records
             </p>
          </div>
          
          <button
            onClick={handleExport}
            disabled={isGenerating || isLoading || reportData.length === 0 || !isOnline}
            className={`flex items-center justify-center gap-2 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 disabled:opacity-50 shrink-0 ${
              activeReportId === 'inspection_pack' 
                ? 'bg-indigo-600 hover:bg-indigo-700' 
                : 'bg-slate-900 hover:bg-slate-800'
            }`}
          >
            {isGenerating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : activeReportId === 'inspection_pack' ? (
              <Archive size={14} className="text-indigo-300" />
            ) : (
              <Download size={14} className="text-emerald-400" />
            )}
            <span>{activeReportId === 'inspection_pack' ? 'Compile .ZIP Pack' : 'Export .DOCX'}</span>
          </button>
        </div>

        {/* --- CONTROL DECK --- */}
        <div className="flex flex-row flex-wrap gap-2.5 w-full bg-slate-50/80 p-2.5 rounded-2xl border border-slate-200 shadow-inner shrink-0 items-center">
          
          {/* Date Filters */}
          {activeReportId !== 'census' && activeReportId !== 'inspection_pack' && (
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center bg-white rounded-xl p-1 border border-slate-200 shadow-sm">
                <div className="flex items-center gap-1.5 px-2 py-0.5 border-r border-slate-100">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                    {activeReportId === 'feed_tick_sheet' ? 'Start' : 'From'}
                  </span>
                  <input 
                    type="date" 
                    value={startDate} 
                    onChange={(e) => setStartDate(e.target.value)} 
                    className="bg-transparent border-none text-xs font-bold text-slate-700 focus:outline-none focus:ring-0 py-1 cursor-pointer"
                  />
                </div>

                {activeReportId !== 'feed_tick_sheet' && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">To</span>
                    <input 
                      type="date" 
                      value={endDate} 
                      onChange={(e) => setEndDate(e.target.value)} 
                      className="bg-transparent border-none text-xs font-bold text-slate-700 focus:outline-none focus:ring-0 py-1 cursor-pointer"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Category Dropdown */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center bg-white rounded-xl px-3 py-1.5 border border-slate-200 shadow-sm gap-2">
              <Filter size={13} className="text-slate-400 shrink-0" />
              <select 
                value={selectedCategory} 
                onChange={(e) => setSelectedCategory(e.target.value)} 
                className="bg-transparent text-xs font-bold text-slate-800 border-none focus:ring-0 cursor-pointer outline-none p-0 min-w-[130px]"
              >
                <option value="ALL">All Categories</option>
                <option value="EXOTIC">Exotic</option>
                <option value="MAMMAL">Mammal</option>
                <option value="BIRD">Bird</option>
                <option value="RAPTOR">Raptor</option>
                <option value="OWL">Owl</option>
              </select>
            </div>
          </div>

          {/* Report Description */}
          <div className="flex-1 flex items-center justify-end px-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest truncate">
              {activeReport.title} • {activeReport.description}
            </span>
          </div>
        </div>

        {/* --- MAIN WORKSPACE --- */}
        <div className="flex flex-row gap-4 flex-1 min-h-0">
          
          {/* Vertical Sidebar */}
          <div className="w-60 shrink-0 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="p-3.5 border-b border-slate-100 bg-slate-50 shrink-0">
              <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                <FileText size={13} className="text-slate-400" /> Report Categories
              </h2>
            </div>

            <nav className="flex-1 p-2 space-y-1 overflow-y-auto custom-scrollbar">
              {REPORTS.map((report) => {
                const isActive = activeReportId === report.id;
                return (
                  <button
                    key={report.id}
                    onClick={() => setActiveReportId(report.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-200 group border text-[11px] font-black uppercase tracking-wide ${
                      isActive 
                        ? 'bg-slate-900 border-slate-800 text-white shadow-md' 
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <report.icon size={14} className={`shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'}`} />
                      <span className="truncate text-left">{report.title}</span>
                    </div>
                    {isActive && <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Data Preview Grid */}
          <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col min-h-0 overflow-hidden relative">
            {isLoading && (
              <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
                <Loader2 className="animate-spin text-slate-600 w-8 h-8" />
                <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Generating Preview...</span>
              </div>
            )}

            <div className="p-3.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Eye size={14} className="text-slate-400" />
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-800">
                  Data Preview ({reportData.length} Records)
                </h2>
              </div>
              {!isOnline && (
                <span className="text-[10px] font-bold text-amber-600 flex items-center gap-1">
                  <WifiOff size={12}/> Offline Mode
                </span>
              )}
            </div>

            <div className="flex-1 overflow-auto custom-scrollbar bg-slate-50/30">
              {reportData.length === 0 && !isLoading ? (
                <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center h-full">
                  <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
                    <FileText size={24} className="text-slate-400" />
                  </div>
                  <p className="font-black text-slate-700 mb-1 text-sm tracking-tight">No records found for these parameters</p>
                  <p className="text-xs font-medium">Try adjusting your date range or category filter.</p>
                </div>
              ) : (
                <table className="w-full text-left whitespace-nowrap border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500 sticky top-0 z-10 backdrop-blur-md">
                    <tr>
                      {(activeReportId === 'feed_tick_sheet' 
                        ? ['Animal', 'Category', ...Array.from({ length: 7 }).map((_, i) => format(addDays(parseISO(startDate), i), 'EEE dd MMM'))]
                        : activeReport.columns
                      ).map((col, idx) => (
                        <th key={idx} className="py-3 px-4">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white text-xs font-medium text-slate-700">
                    {reportData.slice(0, 150).map((row: any, rIdx: number) => (
                      <tr key={rIdx} className="hover:bg-slate-50/70 transition-colors">
                        {row.map((cell: any, cIdx: number) => (
                          <td key={cIdx} className="py-3 px-4">
                            {typeof cell === 'string' && cell.startsWith('[ ]') ? (
                              <span className="font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                {cell}
                              </span>
                            ) : cell === 'FAST' ? (
                              <span className="font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-[10px] uppercase tracking-widest">
                                FAST DAY
                              </span>
                            ) : (
                              <span>{cell}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {reportData.length > 150 && (
                <div className="p-4 text-center text-xs font-bold text-slate-400 uppercase tracking-widest border-t border-slate-100 bg-white">
                  Preview limited to 150 rows. Export to view all {reportData.length} records.
                </div>
              )}
            </div>
          </div>

        </div>

      </div>
    </>
  );
}

export default ReportsDashboard;