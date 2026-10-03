import React from 'react';

interface IUCNBadgeProps {
  status?: string | null;
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string; border: string }> = {
  'EX': { label: 'Extinct', color: 'text-slate-100', bg: 'bg-slate-900', border: 'border-slate-950' },
  'EW': { label: 'Extinct in Wild', color: 'text-slate-100', bg: 'bg-slate-800', border: 'border-slate-900' },
  'CR': { label: 'Critically Endangered', color: 'text-rose-700', bg: 'bg-rose-100', border: 'border-rose-200' },
  'EN': { label: 'Endangered', color: 'text-orange-700', bg: 'bg-orange-100', border: 'border-orange-200' },
  'VU': { label: 'Vulnerable', color: 'text-amber-700', bg: 'bg-amber-100', border: 'border-amber-200' },
  'NT': { label: 'Near Threatened', color: 'text-lime-700', bg: 'bg-lime-100', border: 'border-lime-200' },
  'LC': { label: 'Least Concern', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  'DD': { label: 'Data Deficient', color: 'text-slate-600', bg: 'bg-slate-100', border: 'border-slate-200' },
  'NE': { label: 'Not Evaluated', color: 'text-slate-500', bg: 'bg-slate-50', border: 'border-slate-200' },
};

export const IUCNBadge: React.FC<IUCNBadgeProps> = ({ status }) => {
  // Fallback to NE if null or unknown status is passed
  const config = STATUS_MAP[status || 'NE'] || STATUS_MAP['NE'];
  
  return (
    <span className={`px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest border rounded ${config.bg} ${config.color} ${config.border}`}>
      {config.label}
    </span>
  );
};