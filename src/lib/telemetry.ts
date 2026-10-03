import { supabase } from './supabase';

interface TelemetryPayload {
  error_type: 'UNHANDLED_EXCEPTION' | 'PROMISE_REJECTION' | 'CONSOLE_ERROR';
  message: string;
  stack_trace?: string;
}

const reportedFingerprints = new Set<string>();

export async function getDiagnosticFlags() {
  if (typeof window === 'undefined') return {};
  
  const nav = navigator as any;
  const isPWA = window.matchMedia('(display-mode: standalone)').matches || (nav as any).standalone === true;
  const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
  
  let batteryInfo = 'Unknown';
  if (typeof nav.getBattery === 'function') {
    try {
      const bat = await nav.getBattery();
      batteryInfo = `${Math.round(bat.level * 100)}% (${bat.charging ? 'Charging' : 'Battery'})`;
    } catch (_) {}
  }

  return {
    os: /iPad|iPhone|iPod/.test(nav.userAgent) ? 'iOS' : /Android/.test(nav.userAgent) ? 'Android' : /Mac/.test(nav.userAgent) ? 'macOS' : 'Windows',
    pwa_installed: isPWA,
    net_type: connection?.effectiveType ? connection.effectiveType.toUpperCase() : nav.onLine ? 'ONLINE' : 'OFFLINE',
    downlink_mbps: connection?.downlink || null,
    battery: batteryInfo,
    cores: nav.hardwareConcurrency || null,
    ram_gb: nav.deviceMemory || null,
    screen: `${window.innerWidth}x${window.innerHeight} (DPR: ${window.devicePixelRatio})`
  };
}

export async function logTelemetryError(payload: TelemetryPayload) {
  try {
    if (!navigator.onLine) return;

    const timeBucket = Math.floor(Date.now() / (1000 * 60 * 10));
    const fingerprint = `${payload.error_type}:${payload.message.substring(0, 80)}:${timeBucket}`;
    if (reportedFingerprints.has(fingerprint)) return;
    reportedFingerprints.add(fingerprint);

    if (payload.message.includes('system_error_logs')) return;

    const { data: sessionData } = await supabase.auth.getSession();
    const currentUser = sessionData?.session?.user;
    const flags = await getDiagnosticFlags();

    let userName = 'Anonymous Keeper';
    let userRole = 'GUEST';

    if (currentUser?.id) {
      const { data: userProfile } = await supabase
        .from('users')
        .select('name, role')
        .eq('id', currentUser.id)
        .maybeSingle();

      if (userProfile) {
        userName = userProfile.name || currentUser.email || 'Staff';
        userRole = userProfile.role || 'KEEPER';
      }
    }

    await supabase.from('system_error_logs').insert([
      {
        user_id: currentUser?.id || null,
        user_name: userName,
        user_role: userRole,
        error_type: payload.error_type,
        message: payload.message || 'Exception',
        stack_trace: payload.stack_trace || null,
        route_path: window.location.pathname + window.location.search,
        device_os: `${flags.os} (${flags.pwa_installed ? 'PWA' : 'Browser'} | ${flags.net_type} | Bat: ${flags.battery})`,
        user_agent: navigator.userAgent,
        screen_resolution: flags.screen,
        is_online: navigator.onLine,
      },
    ]);
  } catch (_) {}
}

export function initGlobalTelemetry() {
  if (typeof window === 'undefined' || (window as any).__strixos_telemetry_ready) return;
  (window as any).__strixos_telemetry_ready = true;

  window.addEventListener('error', (event) => {
    logTelemetryError({
      error_type: 'UNHANDLED_EXCEPTION',
      message: event.message || 'Runtime Error',
      stack_trace: event.error?.stack || `${event.filename}:${event.lineno}:${event.colno}`,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    logTelemetryError({
      error_type: 'PROMISE_REJECTION',
      message: `Promise Rejection: ${event.reason?.message || event.reason}`,
      stack_trace: event.reason?.stack,
    });
  });

  const nativeConsoleError = console.error;
  console.error = (...args: any[]) => {
    try {
      const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      if (!message.includes('system_error_logs')) {
        logTelemetryError({
          error_type: 'CONSOLE_ERROR',
          message: message,
          stack_trace: args[0] instanceof Error ? args[0].stack : undefined,
        });
      }
    } catch (_) {}
    nativeConsoleError.apply(console, args);
  };
}