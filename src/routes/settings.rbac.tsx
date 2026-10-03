import React, { useState, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';

export const Route = createFileRoute('/settings/rbac')({
  component: RbacSettings,
});

export interface PermissionModule {
  module: string;
  description: string;
  actions: { key: string; label: string; description?: string }[];
}

export const RBAC_MODULES: PermissionModule[] = [
  {
    module: 'Husbandry & Daily Records',
    description: 'Daily logs, weight tracking, feeding records, and temperature logs',
    actions: [
      { key: 'husbandry:read', label: 'View Daily Logs & Schedules' },
      { key: 'husbandry:write', label: 'Create & Update Daily Logs / Rounds' },
      { key: 'husbandry:delete', label: 'Delete / Void Husbandry Records' },
    ],
  },
  {
    module: 'Animal Records & Management',
    description: 'Animal directory, specimen profiles, and mob configurations',
    actions: [
      { key: 'animals:write', label: 'Add & Edit Animal Profiles' },
      { key: 'animal:manage', label: 'Archive, Decommission & Mob Reassignment' },
    ],
  },
  {
    module: 'Ticketing & Vouchers',
    description: 'Visitor experience vouchers, gift ticket redemption, and gate verification',
    actions: [
      { key: 'vouchers:read', label: 'View Voucher Directory & Search Vouchers' },
      { key: 'vouchers:scan', label: 'Scan & Redeem QR Tickets at Gate' },
      { key: 'vouchers:manage', label: 'Issue Vouchers, Manual Overrides & View Purchaser PII' },
    ],
  },
  {
    module: 'Logistics & Movements',
    description: 'Internal enclosure moves and external institutional transfers',
    actions: [
      { key: 'transfers:read', label: 'View Movement History & Planned Transfers' },
      { key: 'transfers:write', label: 'Log Internal & External Movements' },
      { key: 'transfers:approve', label: 'Authorize Institutional Dispositions & ZLA Transfers' },
    ],
  },
  {
    module: 'Clinical & Veterinary',
    description: 'Medical history, quarantine monitoring, and prescription management',
    actions: [
      { key: 'clinical:read', label: 'View Medical History & Quarantine Logs' },
      { key: 'clinical:write', label: 'Log Observations, Treatments & MAR Signs' },
      { key: 'clinical:prescribe', label: 'Authorise & Prescribe Controlled Substances' },
      { key: 'clinical:vet', label: 'Attending Vet Clinical Sign-Off' },
    ],
  },
  {
    module: 'Safety & Operations',
    description: 'Incident tracking, first aid reports, and maintenance',
    actions: [
      { key: 'safety:read', label: 'View Incident & Safety Drill Logs' },
      { key: 'safety:write', label: 'Submit Incident & Maintenance Reports' },
      { key: 'safety:manage', label: 'Resolve Incidents & Authorize Risk Assessments' },
      { key: 'maintenance:write', label: 'Log & Update Maintenance Work Orders' },
    ],
  },
  {
    module: 'Staff Hub & Timesheets',
    description: 'Staff scheduling, shift rotas, and leave management',
    actions: [
      { key: 'rota:view', label: 'View Master Staff Rota' },
      { key: 'rota:manage', label: 'Edit Shift Schedules & Staff Allocations' },
      { key: 'timesheet:self', label: 'Log Personal Timesheets & View Own Shifts' },
      { key: 'timesheet:manage', label: 'Approve Staff Timesheets & Overtime' },
      { key: 'hr:read', label: 'View Leave Calendar & Time-Off Requests' },
      { key: 'hr:approve', label: 'Approve Leave & Manage Staff Profile Data' },
    ],
  },
  {
    module: 'System Administration',
    description: 'Global site configuration and security settings',
    actions: [
      { key: 'admin:users', label: 'Manage User Accounts & Role Assignments' },
      { key: 'admin:settings', label: 'Modify System Preferences & Global Lists' },
      { key: 'admin:system', label: 'Full System Control & Audit Logs' },
    ],
  },
];

const ROLES = ['DIRECTOR', 'SENIOR_KEEPER', 'KEEPER', 'VOLUNTEER'] as const;
type AppRole = typeof ROLES[number];

export function RbacSettings() {
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<AppRole>('KEEPER');
  const [matrixState, setMatrixState] = useState<Record<string, Set<string>>>({});
  const [isInitialized, setIsInitialized] = useState(false);

  const { data: dbMatrix = [], isLoading } = useQuery({
    queryKey: ['rbac_matrix'],
    queryFn: async () => {
      const { data, error } = await supabase.from('rbac_matrix').select('*');
      if (error) throw error;
      return data || [];
    },
  });

  // Populate local state cleanly when database records load
  useEffect(() => {
    if (dbMatrix && dbMatrix.length > 0 && !isInitialized) {
      const state: Record<string, Set<string>> = {};
      dbMatrix.forEach((row: any) => {
        let perms: string[] = [];
        if (Array.isArray(row.permissions)) {
          perms = row.permissions;
        } else if (typeof row.permissions === 'string') {
          try {
            perms = JSON.parse(row.permissions);
          } catch (e) {
            perms = [];
          }
        }
        state[row.role] = new Set(perms);
      });
      setMatrixState(state);
      setIsInitialized(true);
    }
  }, [dbMatrix, isInitialized]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates = Object.entries(matrixState).map(([role, permSet]) => ({
        role,
        permissions: Array.from(permSet),
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('rbac_matrix')
        .upsert(updates, { onConflict: 'role' });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Permission matrix successfully updated');
      queryClient.invalidateQueries({ queryKey: ['rbac_matrix'] });
    },
    onError: (err: any) => {
      toast.error(`Failed to update permissions: ${err.message}`);
    },
  });

  const handleToggle = (role: string, permKey: string) => {
    setMatrixState((prev) => {
      const currentSet = new Set(prev[role] || []);
      if (currentSet.has(permKey)) {
        currentSet.delete(permKey);
      } else {
        currentSet.add(permKey);
      }
      return { ...prev, [role]: currentSet };
    });
  };

  const activePermissions = matrixState[selectedRole] || new Set();

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-16 font-sans">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
            <ShieldCheck className="text-emerald-500" size={24} />
            Role-Based Access Control (RBAC)
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Configure granular feature permissions across non-admin staff roles.
          </p>
        </div>

        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || isLoading}
          className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer"
        >
          {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save Matrix
        </button>
      </div>

      {/* ROLE TABS */}
      <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
        {ROLES.map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => setSelectedRole(role)}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer shadow-sm ${
              selectedRole === role
                ? 'bg-slate-900 text-white border border-slate-800'
                : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
            }`}
          >
            {role.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* LOADING STATE */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="animate-spin text-emerald-500 w-8 h-8" />
          <span className="text-xs font-black uppercase tracking-widest text-slate-400">Loading Permission Matrix...</span>
        </div>
      ) : (
        /* PERMISSION MODULES */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {RBAC_MODULES.map((mod) => (
            <div key={mod.module} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">{mod.module}</h3>
                <p className="text-[11px] text-slate-500 font-medium leading-relaxed">{mod.description}</p>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                {mod.actions.map((act) => {
                  const isChecked = activePermissions.has(act.key);
                  return (
                    <label
                      key={act.key}
                      className={`flex items-start gap-3 p-2.5 rounded-xl border transition-all cursor-pointer ${
                        isChecked ? 'bg-emerald-50/60 border-emerald-200 text-slate-900' : 'bg-slate-50/50 border-slate-200 text-slate-600 hover:bg-slate-100/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggle(selectedRole, act.key)}
                        className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold leading-tight">{act.label}</p>
                        <p className="text-[10px] font-mono text-slate-400 mt-0.5">{act.key}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default RbacSettings;