import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Menu, UserCircle, PlayCircle, StopCircle, Loader2, CloudOff, CloudUpload } from 'lucide-react';
import { format, formatISO } from 'date-fns';
import { useAuth } from '../../lib/auth';
import { timesheetService } from '../../services/timesheetService';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  
  // ENTERPRISE FIX: Offline Queue Telemetry
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pausedCount, setPausedCount] = useState(0);

  useEffect(() => {
    // 1. Network event listeners
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 2. Direct subscription to the TanStack Mutation Cache to track offline payloads
    const mutationCache = queryClient.getMutationCache();
    
    const updatePausedCount = () => {
      const count = mutationCache.getAll().filter(m => m.state.isPaused).length;
      setPausedCount(count);
    };

    updatePausedCount(); // Initial check
    const unsubscribe = mutationCache.subscribe(updatePausedCount);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, [queryClient]);

  const { data: activeShift, isLoading: isLoadingShift } = useQuery({
    queryKey: ['my_active_shift', user?.id],
    queryFn: () => timesheetService.getMyActiveShift(user!.id),
    enabled: !!user?.id,
  });

  const clockInMutation = useMutation({
    mutationFn: async () => {
      const now = new Date();
      await timesheetService.clockIn({
        shift_date: format(now, 'yyyy-MM-dd'),
        clock_in_time: formatISO(now) 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my_active_shift'] });
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
      queryClient.invalidateQueries({ queryKey: ['active_timesheets_rollcall'] });
    }
  });

  const clockOutMutation = useMutation({
    mutationFn: async (id: string) => {
      await timesheetService.clockOut(id, formatISO(new Date()));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my_active_shift'] });
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
      queryClient.invalidateQueries({ queryKey: ['active_timesheets_rollcall'] });
    }
  });

  return (
    <header className="bg-white border-b border-slate-200 h-16 md:h-20 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-30 shrink-0">
      
      {/* LEFT SIDE: Menu Toggle & Welcome Text */}
      <div className="flex items-center gap-3 md:gap-4 shrink-0">
        <button 
          onClick={onMenuClick}
          className="p-2 -ml-2 text-slate-500 hover:text-slate-900 transition-colors rounded-lg hover:bg-slate-100"
          title="Toggle Menu"
        >
          <Menu size={24} />
        </button>
        
        {/* Welcome Text - Hidden on very small phones so it doesn't crush the Clock button */}
        <div className="hidden sm:block">
           <h2 className="text-sm md:text-base font-bold text-slate-800 tracking-tight">
             {activeShift ? 'Active Shift' : 'Welcome back,'} <span className="text-emerald-600">{profile?.name?.split(' ')[0] || 'Staff'}</span>
           </h2>
        </div>
      </div>

      {/* RIGHT SIDE: Telemetry, Clock In, Profile */}
      <div className="flex items-center gap-2 md:gap-4 min-w-0 justify-end">
        
        {/* ENTERPRISE FIX: Telemetry Gauge (Removed hidden sm:flex to show on mobile) */}
        <div className="flex items-center mr-0 md:mr-2">
          {!isOnline ? (
            <div className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-widest shadow-sm transition-all duration-300">
              <CloudOff size={14} className="shrink-0" /> <span className="hidden sm:inline">Offline</span>
              {pausedCount > 0 && (
                <span className="ml-1 bg-rose-200 text-rose-800 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                  {pausedCount} <span className="hidden md:inline">Queued</span>
                </span>
              )}
            </div>
          ) : pausedCount > 0 ? (
            <div className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-widest shadow-sm transition-all duration-300">
              <CloudUpload size={14} className="animate-pulse shrink-0" /> <span className="hidden sm:inline">Syncing</span>
              <span className="ml-1 bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full">{pausedCount}</span>
            </div>
          ) : null}
        </div>

        {/* CLOCK IN/OUT BUTTON (Removed hidden sm:flex, added whitespace-nowrap) */}
        <div className="flex items-center shrink-0">
          {isLoadingShift ? (
            <div className="px-3 py-1.5 md:px-4 md:py-2 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-center min-w-[80px] md:min-w-[120px]">
               <Loader2 size={14} className="animate-spin text-slate-400" />
            </div>
          ) : activeShift ? (
            <button 
              onClick={() => clockOutMutation.mutate(activeShift.id)}
              disabled={clockOutMutation.isPending}
              className="group flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-600 hover:text-white rounded-lg text-[10px] md:text-xs font-black uppercase tracking-widest transition-all shadow-sm disabled:opacity-50 whitespace-nowrap"
            >
              {clockOutMutation.isPending ? <Loader2 size={14} className="animate-spin shrink-0" /> : <StopCircle size={14} className="group-hover:animate-pulse shrink-0" />}
              Clock Out
            </button>
          ) : (
            <button 
              onClick={() => clockInMutation.mutate()}
              disabled={clockInMutation.isPending}
              className="group flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-white rounded-lg text-[10px] md:text-xs font-black uppercase tracking-widest transition-all shadow-sm disabled:opacity-50 whitespace-nowrap"
            >
              {clockInMutation.isPending ? <Loader2 size={14} className="animate-spin shrink-0" /> : <PlayCircle size={14} className="shrink-0" />}
              Clock In
            </button>
          )}
        </div>

        {/* AVATAR (Hidden on mobile phones to prioritize the Clock In button space) */}
        <div className="hidden sm:flex items-center gap-3 pl-3 md:pl-4 border-l border-slate-200 shrink-0">
          <div className="hidden md:block text-right">
            <p className="text-xs font-black text-slate-900 uppercase tracking-tight">{profile?.name || 'Loading...'}</p>
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{profile?.role?.replace('_', ' ') || 'Staff'}</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 overflow-hidden shrink-0">
            <UserCircle size={32} strokeWidth={1} />
          </div>
        </div>
        
      </div>
    </header>
  );
}