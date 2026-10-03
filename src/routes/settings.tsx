import React from 'react';
import { Link, Outlet, createFileRoute, useLocation } from '@tanstack/react-router';
import { 
  ShieldCheck, Users, FileText, 
  List, Building, History, Activity, Lock, ChevronRight
} from 'lucide-react';
import { useAuth } from '../lib/auth';

export const Route = createFileRoute('/settings')({
  component: SettingsLayout,
});

function SettingsLayout() {
  const { profile, hasPermission } = useAuth();
  const location = useLocation();
  const currentTab = location.pathname.split('/').pop() || 'organization';
  
  // 5-Tier Role-Based Access Control for Settings Navigation
  const isSeniorOrAbove = hasPermission('staff:manage') || ['SENIOR_KEEPER', 'DIRECTOR', 'ADMIN', 'MANAGER', 'HR'].includes(profile?.role || '');
  const isDirectorOrAdmin = ['DIRECTOR', 'ADMIN'].includes(profile?.role || '');

  const tabs = [
    { id: 'organization', label: 'Organisation Profile', icon: Building, show: true },
    { id: 'directory', label: 'Staff Directory', icon: Users, show: isSeniorOrAbove },
    { id: 'lists', label: 'Operational Lists', icon: List, show: true },
    { id: 'health', label: 'System Health', icon: Activity, show: true },
    { id: 'access', label: 'Access Control', icon: ShieldCheck, show: isDirectorOrAdmin },
    { id: 'rbac', label: 'RBAC Matrix', icon: Lock, show: isDirectorOrAdmin },
    { id: 'zla', label: 'ZLA Documents', icon: FileText, show: isSeniorOrAbove },
    { id: 'changelog', label: 'System Changelog', icon: History, show: true },
  ];

  const visibleTabs = tabs.filter(t => t.show);

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col space-y-5 lg:space-y-6 animate-in fade-in duration-500 w-full">
      
      {/* --- BLOCK A: HEADER RIBBON --- */}
      <div className="flex justify-between items-start w-full mb-2 lg:mb-4 portrait:flex landscape:hidden lg:landscape:flex shrink-0">
        <div className="shrink-0 pr-4 flex flex-col gap-1.5 lg:gap-2">
           <h1 className="text-xl lg:text-2xl font-black text-slate-900 tracking-tight leading-none">
             System Settings
           </h1>
           <p className="text-[10px] lg:text-xs text-slate-500 font-bold uppercase tracking-widest">
             Configuration, Compliance, Governance & RBAC Security
           </p>
        </div>
      </div>

      {/* --- BLOCK B: MOBILE HORIZONTAL NAVIGATION (Pill Tabs) --- */}
      <div className="lg:hidden flex gap-1.5 w-full shrink-0 overflow-x-auto pb-1 custom-scrollbar">
        {visibleTabs.map((t) => {
          const isActive = currentTab === t.id;
          return (
            <Link
              key={t.id}
              to={`/settings/${t.id}` as any}
              className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest whitespace-nowrap transition-all shadow-sm flex items-center justify-center gap-1.5 shrink-0 ${
                isActive 
                  ? 'bg-slate-900 text-white border border-slate-800 shadow-slate-900/20' 
                  : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-slate-200'
              }`}
            >
              <t.icon size={12} className={isActive ? 'text-white' : 'text-slate-400'} />
              <span>{t.label}</span>
            </Link>
          );
        })}
      </div>

      {/* --- BLOCK C: MAIN WORKSPACE (Desktop Sidebar + Outlet Workspace) --- */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
        
        {/* Desktop Sidebar Deck */}
        <div className="hidden lg:flex lg:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50 shrink-0">
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
              <ShieldCheck size={14} className="text-slate-400" /> Settings Categories
            </h2>
          </div>

          <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto custom-scrollbar">
            {visibleTabs.map((t) => {
              const isActive = currentTab === t.id;
              return (
                <Link
                  key={t.id}
                  to={`/settings/${t.id}` as any}
                  className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl transition-all duration-200 group border text-xs font-black uppercase tracking-widest ${
                    isActive 
                      ? 'bg-slate-900 border-slate-800 text-white shadow-md' 
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <t.icon size={15} className={`shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'}`} />
                    <span className="truncate">{t.label}</span>
                  </div>
                  {isActive && <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1.5" />}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Dynamic Outlet Pane */}
        <div className="lg:col-span-9 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 md:p-7 bg-slate-50/30">
            <Outlet />
          </div>
        </div>

      </div>

    </div>
  );
}

export default SettingsLayout;