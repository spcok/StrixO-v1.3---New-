import React, { useState, useEffect, useSyncExternalStore, useMemo, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient, queryOptions } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  Activity, HardDrive, Wifi, WifiOff, CloudUpload, 
  Cpu, RefreshCw, Download, Trash2, 
  CheckCircle2, Smartphone, Bug, Loader2, Play, 
  Terminal, X, Copy
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

interface DiagnosticStepResult {
  step: string;
  status: 'RUNNING' | 'SUCCESS' | 'WARNING' | 'FAILED';
  details: string;
  rawData?: any;
}

const errorLogsQueryOptions = queryOptions({
  queryKey: ['system_error_logs'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('system_error_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return data || [];
  },
  staleTime: 1000 * 15,
});

export const Route = createFileRoute('/settings/health')({
  loader: async ({ context }: any) => {
    if (context?.queryClient) {
      await context.queryClient.ensureQueryData(errorLogsQueryOptions);
    }
  },
  component: SystemHealthPage,
});

export function SystemHealthPage() {
  const queryClient = useQueryClient();
  const { user, profile, hasPermission } = useAuth();
  const scrollParentRef = useRef<HTMLDivElement>(null);

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [storageData, setStorageData] = useState<{ usage: string; quota: string; percent: number }>({ usage: '0 MB', quota: '0 MB', percent: 0 });
  const [dbLatency, setDbLatency] = useState<number | null>(null);
  const [dbStatus, setDbStatus] = useState<'CONNECTED' | 'DEGRADED' | 'DISCONNECTED'>('CONNECTED');
  const [isPinging, setIsPinging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'ALL' | 'UNHANDLED_EXCEPTION' | 'PROMISE_REJECTION' | 'CONSOLE_ERROR'>('ALL');

  // Diagnostic Test Modal State
  const [isDiagModalOpen, setIsDiagModalOpen] = useState(false);
  const [diagSteps, setDiagSteps] = useState<DiagnosticStepResult[]>([]);
  const [isRunningDiag, setIsRunningDiag] = useState(false);

  const pausedMutations = useSyncExternalStore(
    (onStoreChange) => queryClient.getMutationCache().subscribe(onStoreChange),
    () => queryClient.getMutationCache().getAll().filter(m => m.state.isPaused).length
  );

  const totalQueriesCount = useSyncExternalStore(
    (onStoreChange) => queryClient.getQueryCache().subscribe(onStoreChange),
    () => queryClient.getQueryCache().getAll().length
  );

  const { data: serverLogs = [], isLoading: loadingLogs } = useQuery(errorLogsQueryOptions);

  const pingDatabase = async () => {
    if (!navigator.onLine) {
      setDbStatus('DISCONNECTED');
      setDbLatency(null);
      return;
    }
    setIsPinging(true);
    const start = performance.now();
    try {
      const { error } = await supabase.from('animals').select('id', { count: 'exact', head: true });
      const duration = Math.round(performance.now() - start);
      if (error) {
        setDbStatus('DEGRADED');
        setDbLatency(duration);
      } else {
        setDbStatus('CONNECTED');
        setDbLatency(duration);
      }
    } catch (_) {
      setDbStatus('DISCONNECTED');
      setDbLatency(null);
    } finally {
      setIsPinging(false);
    }
  };

  useEffect(() => {
    pingDatabase();
    const handleOnline = () => { setIsOnline(true); pingDatabase(); };
    const handleOffline = () => { setIsOnline(false); setDbStatus('DISCONNECTED'); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if ('storage' in navigator && 'estimate' in navigator.storage) {
      navigator.storage.estimate().then(({ usage, quota }) => {
        if (usage && quota) {
          setStorageData({
            usage: (usage / (1024 * 1024)).toFixed(2) + ' MB',
            quota: (quota / (1024 * 1024)).toFixed(2) + ' MB',
            percent: Math.min((usage / quota) * 100, 100),
          });
        }
      }).catch(() => {});
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Bulletproof Quick Purge Mutation
  const purgeLogsMutation = useMutation({
    mutationFn: async () => {
      const rpcResult = await supabase.rpc('purge_system_error_logs');
      if (rpcResult.error) {
        const fallback = await supabase
          .from('system_error_logs')
          .delete()
          .gte('created_at', '1970-01-01T00:00:00Z');
        if (fallback.error) throw fallback.error;
      }
    },
    onSuccess: () => {
      queryClient.setQueryData(['system_error_logs'], []);
      queryClient.invalidateQueries({ queryKey: ['system_error_logs'] });
      toast.success('Error logs cleared.');
    },
    onError: (err: any) => {
      toast.error(`Clear failed: ${err.message || 'Database error'}`);
    }
  });

  const handleClearErrorLogs = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (window.confirm('Purge all recorded error events from Supabase?')) {
      purgeLogsMutation.mutate();
    }
  };

  // Full Diagnostic Runner
  const runFullDiagnosticsAndPurge = async () => {
    setIsRunningDiag(true);
    setIsDiagModalOpen(true);
    const results: DiagnosticStepResult[] = [];

    const appendStep = (step: string, status: DiagnosticStepResult['status'], details: string, rawData?: any) => {
      results.push({ step, status, details, rawData });
      setDiagSteps([...results]);
    };

    try {
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      const currentAuthUser = sessionData?.session?.user;
      
      appendStep(
        '1. Authentication Session',
        sessionErr ? 'FAILED' : currentAuthUser ? 'SUCCESS' : 'WARNING',
        currentAuthUser 
          ? `Authenticated as: ${currentAuthUser.email} (UID: ${currentAuthUser.id.substring(0, 8)}) | Profile Role: ${profile?.role || 'None'}`
          : `Operating under 'anon' client key.`,
        { sessionUser: currentAuthUser, sessionError: sessionErr, clientRole: currentAuthUser ? 'authenticated' : 'anon' }
      );

      const readTestStart = performance.now();
      const { data: preRead, error: readErr, count: preCount } = await supabase
        .from('system_error_logs')
        .select('*', { count: 'exact' })
        .limit(5);

      const readLatency = Math.round(performance.now() - readTestStart);

      if (readErr) {
        appendStep(
          '2. Table Accessibility',
          'FAILED',
          `Cannot read 'system_error_logs': ${readErr.message}`,
          readErr
        );
      } else {
        appendStep(
          '2. Table Accessibility',
          'SUCCESS',
          `Table readable in ${readLatency}ms. Current row count: ${preCount ?? 0}`,
          { preCount, sample: preRead }
        );
      }

      let rpcExecuted = false;
      try {
        const { error: rpcErr, data: rpcData } = await supabase.rpc('purge_system_error_logs');
        if (!rpcErr) {
          rpcExecuted = true;
          appendStep('3. Stored RPC Purge', 'SUCCESS', `SECURITY DEFINER RPC executed.`, rpcData);
        } else {
          appendStep('3. Stored RPC Purge', 'WARNING', `RPC: ${rpcErr.message}. Running fallback delete.`, rpcErr);
        }
      } catch (err: any) {
        appendStep('3. Stored RPC Purge', 'WARNING', `RPC threw: ${err.message}`, err);
      }

      if (!rpcExecuted) {
        const deleteTest = await supabase
          .from('system_error_logs')
          .delete({ count: 'exact' })
          .gte('created_at', '1970-01-01T00:00:00Z');

        if (deleteTest.error) {
          appendStep('4. Direct PostgREST Delete', 'FAILED', `Delete failed: ${deleteTest.error.message}`, deleteTest.error);
        } else {
          appendStep('4. Direct PostgREST Delete', 'SUCCESS', `Deleted ${deleteTest.count ?? 0} rows.`, deleteTest);
        }
      }

      const { count: postCount } = await supabase
        .from('system_error_logs')
        .select('*', { count: 'exact', head: true });

      if (postCount === 0) {
        appendStep('5. Verification Query', 'SUCCESS', `Table is verified empty (0 rows remaining).`, { postCount });
      } else {
        appendStep('5. Verification Query', 'FAILED', `Table still contains ${postCount} rows.`, { remainingRows: postCount });
      }

      queryClient.setQueryData(['system_error_logs'], []);
      await queryClient.invalidateQueries({ queryKey: ['system_error_logs'] });
      appendStep('6. UI Cache Invalidation', 'SUCCESS', `Local TanStack Query cache flushed.`);

      if (postCount === 0 || rpcExecuted) {
        toast.success('System error logs purged.');
      } else {
        toast.error('Purge incomplete. Check diagnostic output.');
      }

    } catch (unexpectedErr: any) {
      appendStep('Unhandled Exception', 'FAILED', `Diagnostics error: ${unexpectedErr.message}`, unexpectedErr);
    } finally {
      setIsRunningDiag(false);
    }
  };

  const filteredLogs = useMemo(() => {
    let result = serverLogs;

    if (selectedTypeFilter !== 'ALL') {
      result = result.filter((l: any) => l.error_type === selectedTypeFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((l: any) => 
        (l.message || '').toLowerCase().includes(q) ||
        (l.user_name || '').toLowerCase().includes(q) ||
        (l.device_os || '').toLowerCase().includes(q) ||
        (l.route_path || '').toLowerCase().includes(q) ||
        (l.stack_trace || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [serverLogs, selectedTypeFilter, searchQuery]);

  const rowVirtualizer = useVirtualizer({
    count: filteredLogs.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 140,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const exportTelemetryJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      adminUser: user?.email,
      totalCapturedErrors: serverLogs.length,
      deviceLogs: serverLogs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `strixos-fleet-telemetry-${format(new Date(), 'yyyyMMdd-HHmmss')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Fleet telemetry exported.');
  };

  const copyDiagnosticOutput = () => {
    navigator.clipboard.writeText(JSON.stringify(diagSteps, null, 2));
    toast.success('Diagnostic log copied.');
  };

  return (
    <div className="h-full flex flex-col space-y-4 animate-in fade-in duration-300 relative">
      
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shrink-0 pb-1">
        <div>
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
            <Activity size={16} className="text-slate-700" /> System Health & Automated Telemetry
          </h3>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">
            Fleet error capturing, database heartbeat & mobile telemetry
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => queryClient.invalidateQueries()}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95"
            title="Refresh cache and ping database"
          >
            <RefreshCw size={13} />
            <span>Refresh</span>
          </button>

          <button
            onClick={exportTelemetryJson}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95"
          >
            <Download size={13} className="text-emerald-400" />
            <span>Export Fleet JSON</span>
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-1">
        
        {/* Metric Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className={`p-4 rounded-2xl border ${isOnline ? 'bg-emerald-50/60 border-emerald-200' : 'bg-rose-50/60 border-rose-200'} shadow-sm flex flex-col justify-between`}>
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-black uppercase tracking-widest ${isOnline ? 'text-emerald-800' : 'text-rose-800'}`}>Local Connection</span>
              {isOnline ? <Wifi size={16} className="text-emerald-600" /> : <WifiOff size={16} className="text-rose-600" />}
            </div>
            <div className="mt-3">
              <p className="text-2xl font-black text-slate-900">{isOnline ? 'ONLINE' : 'OFFLINE'}</p>
              <p className={`text-[9px] font-bold uppercase tracking-widest mt-0.5 ${isOnline ? 'text-emerald-700' : 'text-rose-700'}`}>Active Gateway</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl border bg-white border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">PostgreSQL Latency</span>
              <button onClick={pingDatabase} disabled={isPinging} className="p-1 text-slate-400 hover:text-slate-900 rounded transition-colors">
                <RefreshCw size={14} className={isPinging ? 'animate-spin text-indigo-600' : ''} />
              </button>
            </div>
            <div className="mt-3">
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-black text-slate-900">{dbLatency !== null ? `${dbLatency}ms` : '--'}</p>
                <span className={`px-1.5 py-0.2 rounded text-[8px] font-black uppercase tracking-widest border ${dbStatus === 'CONNECTED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                  {dbStatus}
                </span>
              </div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">Supabase Database Pool</p>
            </div>
          </div>

          <div className={`p-4 rounded-2xl border ${pausedMutations > 0 ? 'bg-amber-50/60 border-amber-200' : 'bg-white border-slate-200'} shadow-sm flex flex-col justify-between`}>
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-black uppercase tracking-widest ${pausedMutations > 0 ? 'text-amber-800' : 'text-slate-500'}`}>Mutation Queue</span>
              <CloudUpload size={16} className={pausedMutations > 0 ? 'text-amber-600 animate-pulse' : 'text-slate-400'} />
            </div>
            <div className="mt-3">
              <p className="text-2xl font-black text-slate-900">{pausedMutations}</p>
              <p className={`text-[9px] font-bold uppercase tracking-widest mt-0.5 ${pausedMutations > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
                {pausedMutations > 0 ? 'Queued For Network Sync' : `${totalQueriesCount} Queries Active in RAM`}
              </p>
            </div>
          </div>

          <div className="p-4 rounded-2xl border bg-white border-slate-200 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Device Platform</span>
              <Smartphone size={16} className="text-slate-400" />
            </div>
            <div className="mt-3">
              <p className="text-lg font-black text-slate-900 truncate">{isIOS ? 'iOS Safari (RAM Buffer)' : 'PWA (IndexedDB Persist)'}</p>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">Automated Telemetry Enabled</p>
            </div>
          </div>
        </div>

        {/* Centralized Device Error Ledger */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          
          <div className="p-3.5 border-b border-slate-100 bg-slate-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <Bug size={15} className="text-slate-700" />
              <h4 className="text-xs font-black uppercase tracking-widest text-slate-900">
                Remote Keeper Error Feed ({filteredLogs.length} Events)
              </h4>
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              {(['ALL', 'UNHANDLED_EXCEPTION', 'PROMISE_REJECTION', 'CONSOLE_ERROR'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setSelectedTypeFilter(tab)}
                  className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                    selectedTypeFilter === tab 
                      ? 'bg-slate-900 text-white shadow-sm' 
                      : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {tab === 'UNHANDLED_EXCEPTION' ? 'Exceptions' : tab === 'PROMISE_REJECTION' ? 'Promises' : tab === 'CONSOLE_ERROR' ? 'Console' : 'All'}
                </button>
              ))}

              {/* Action 1: Instant Purge */}
              <button
                onClick={handleClearErrorLogs}
                disabled={purgeLogsMutation.isPending || serverLogs.length === 0}
                className="flex items-center gap-1 text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-600 border border-rose-200 hover:border-rose-600 px-3 py-1 rounded-lg transition-all text-[9px] font-black uppercase tracking-widest ml-1 disabled:opacity-40 disabled:pointer-events-none shadow-sm active:scale-95"
                title="Purge all error logs from Supabase"
              >
                {purgeLogsMutation.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
                <span>Clear</span>
              </button>

              {/* Action 2: Diagnostic Pipeline Runner */}
              <button
                onClick={runFullDiagnosticsAndPurge}
                disabled={isRunningDiag}
                className="flex items-center gap-1.5 text-indigo-600 hover:text-white bg-indigo-50 hover:bg-indigo-600 border border-indigo-200 hover:border-indigo-600 px-2.5 py-1 rounded-lg transition-all text-[9px] font-black uppercase tracking-widest shadow-sm active:scale-95"
                title="Test database connection, RLS policies, and clear"
              >
                {isRunningDiag ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Play size={12} />
                )}
                <span>Diagnose</span>
              </button>
            </div>
          </div>

          <div ref={scrollParentRef} className="max-h-96 overflow-y-auto custom-scrollbar p-3 bg-slate-900 text-slate-100 font-mono text-[11px]">
            {loadingLogs ? (
              <div className="p-8 text-center text-slate-500 flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin text-slate-400" />
                <span className="font-sans text-xs">Streaming telemetry feed...</span>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center">
                <CheckCircle2 size={24} className="text-emerald-500 mb-2 opacity-80" />
                <p className="font-sans font-bold text-xs text-slate-300">All field devices operating without runtime errors.</p>
                <p className="font-sans text-[10px] text-slate-500 mt-0.5">Errors captured from keeper phones will automatically log here in real-time.</p>
              </div>
            ) : (
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {virtualItems.map((virtualRow) => {
                  const log = filteredLogs[virtualRow.index];
                  const dateObj = new Date(log.created_at);

                  return (
                    <div
                      key={log.id}
                      className="absolute top-0 left-0 w-full p-2.5 rounded-xl border leading-relaxed mb-2 bg-slate-950/80 border-slate-800 text-slate-200"
                      style={{
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <div className="flex flex-wrap justify-between items-center text-[9px] text-slate-400 mb-1 gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`font-black uppercase tracking-wider px-1.5 py-0.2 rounded ${
                            log.error_type === 'UNHANDLED_EXCEPTION' ? 'bg-rose-900 text-rose-100' :
                            log.error_type === 'PROMISE_REJECTION' ? 'bg-purple-900 text-purple-100' :
                            'bg-amber-900 text-amber-100'
                          }`}>
                            {log.error_type}
                          </span>
                          <span className="text-slate-300 font-bold font-sans">
                            {log.user_name} ({log.user_role})
                          </span>
                          <span className="bg-slate-800 text-slate-400 px-1.5 py-0.2 rounded font-sans">
                            {log.device_os} • {log.route_path}
                          </span>
                        </div>
                        <span>{format(dateObj, 'dd MMM yyyy HH:mm:ss')}</span>
                      </div>

                      <p className="font-semibold text-rose-300 break-words font-sans text-xs">
                        {log.message}
                      </p>

                      {log.stack_trace && (
                        <pre className="mt-1.5 p-2 bg-black/60 rounded-lg text-[9px] text-slate-400 overflow-x-auto whitespace-pre-wrap leading-normal border border-white/5 font-mono">
                          {log.stack_trace}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

      </div>

      {/* DIAGNOSTIC TEST RUNNER MODAL */}
      {isDiagModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <div className="flex items-center gap-2">
                <Terminal size={18} className="text-slate-700" />
                <h3 className="font-black text-slate-900 uppercase tracking-widest text-xs">
                  Telemetry & Database Diagnostics
                </h3>
              </div>
              <button 
                onClick={() => setIsDiagModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto custom-scrollbar space-y-3 font-mono text-xs">
              {diagSteps.map((step, idx) => (
                <div 
                  key={idx} 
                  className={`p-3 rounded-xl border ${
                    step.status === 'SUCCESS' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' :
                    step.status === 'WARNING' ? 'bg-amber-50 border-amber-200 text-amber-900' :
                    step.status === 'FAILED' ? 'bg-rose-50 border-rose-200 text-rose-900' :
                    'bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold text-[11px] mb-1">
                    <span>{step.step}</span>
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${
                      step.status === 'SUCCESS' ? 'bg-emerald-200 text-emerald-800' :
                      step.status === 'WARNING' ? 'bg-amber-200 text-amber-800' :
                      step.status === 'FAILED' ? 'bg-rose-200 text-rose-800' :
                      'bg-slate-200 text-slate-700'
                    }`}>
                      {step.status}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed font-sans">{step.details}</p>
                  
                  {step.rawData && (
                    <pre className="mt-2 p-2 bg-black/80 text-emerald-400 rounded-lg text-[9px] overflow-x-auto whitespace-pre-wrap font-mono">
                      {JSON.stringify(step.rawData, null, 2)}
                    </pre>
                  )}
                </div>
              ))}

              {isRunningDiag && (
                <div className="p-4 flex items-center justify-center gap-2 text-slate-500">
                  <Loader2 size={16} className="animate-spin text-slate-700" />
                  <span className="text-xs font-sans font-bold">Executing test pipeline...</span>
                </div>
              )}
            </div>

            <div className="p-3.5 border-t border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
              <button
                onClick={copyDiagnosticOutput}
                className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-1.5 transition-all"
              >
                <Copy size={13} />
                <span>Copy Log</span>
              </button>

              <button
                onClick={() => setIsDiagModalOpen(false)}
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default SystemHealthPage;