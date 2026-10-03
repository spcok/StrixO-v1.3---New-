import React, { useState, useEffect } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Lock, CheckCircle2, AlertCircle, Loader2, KeyRound, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import logoImg from '../assets/logo.png';

export const Route = createFileRoute('/reset-password')({
  component: ResetPasswordPage,
});

// Strong password validator
const validatePassword = (pass: string): { valid: boolean; message?: string } => {
  if (pass.length < 10) return { valid: false, message: 'Password must be at least 10 characters long.' };
  if (!/[A-Z]/.test(pass)) return { valid: false, message: 'Must include at least one uppercase letter.' };
  if (!/[a-z]/.test(pass)) return { valid: false, message: 'Must include at least one lowercase letter.' };
  if (!/[0-9]/.test(pass)) return { valid: false, message: 'Must include at least one number.' };
  if (!/[^A-Za-z0-9]/.test(pass)) return { valid: false, message: 'Must include at least one special character.' };
  return { valid: true };
};

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const cleanUrlTokens = () => {
      // Strip token fragments from browser history and URL bar to prevent leakage
      if (window.location.hash || window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    };

    const processRecoveryTokens = async () => {
      try {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const searchParams = new URLSearchParams(window.location.search);

        const errorDesc = hashParams.get('error_description') || searchParams.get('error_description');
        if (errorDesc) {
          if (isMounted) {
            setErrorMessage(errorDesc.replace(/\+/g, ' '));
            setCheckingSession(false);
          }
          cleanUrlTokens();
          return;
        }

        // Handle PKCE (?code=...)
        const code = searchParams.get('code');
        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          cleanUrlTokens();
          if (!error && data.session && isMounted) {
            setIsAuthenticated(true);
            setCheckingSession(false);
            return;
          }
        }

        // Handle Implicit Hash (#access_token=...)
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        if (accessToken && refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          cleanUrlTokens();
          if (!error && data.session && isMounted) {
            setIsAuthenticated(true);
            setCheckingSession(false);
            return;
          }
        }

        // Fallback: Check existing session in storage
        const { data: { session } } = await supabase.auth.getSession();
        if (session && isMounted) {
          setIsAuthenticated(true);
          setCheckingSession(false);
          cleanUrlTokens();
          return;
        }

        const timer = setTimeout(() => {
          if (isMounted && !isAuthenticated) {
            setCheckingSession(false);
            cleanUrlTokens();
          }
        }, 1500);

        return () => clearTimeout(timer);
      } catch (err: any) {
        if (isMounted) {
          setErrorMessage(err.message || 'Token verification failed.');
          setCheckingSession(false);
        }
        cleanUrlTokens();
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session && isMounted) {
        setIsAuthenticated(true);
        setCheckingSession(false);
        cleanUrlTokens();
      }
    });

    processRecoveryTokens();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = validatePassword(password);
    if (!validation.valid) {
      toast.error(validation.message);
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      toast.success('Password updated successfully. All previous sessions revoked.');
      
      // Global invalidation: Revokes refresh tokens on all devices
      await supabase.auth.signOut({ scope: 'global' });
      
      navigate({ to: '/' });
    } catch (err: any) {
      toast.error(err.message || 'Failed to update credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
          Securing authentication context...
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-sans text-left">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-4 text-center">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
            <AlertCircle size={24} />
          </div>
          <h2 className="text-lg font-black text-white uppercase tracking-tight">Recovery Token Invalid</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            {errorMessage || 'This recovery token has expired, been revoked, or already consumed.'}
          </p>
          <button
            type="button"
            onClick={() => navigate({ to: '/' })}
            className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-colors cursor-pointer"
          >
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-sans text-left">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <img src={logoImg} alt="StrixOS Logo" className="w-12 h-12 object-contain mb-1" />
          <h1 className="text-xl font-black text-white tracking-tight">Create Secure Password</h1>
          <p className="text-xs text-slate-400">
            Set an enterprise-grade password for your keeper credentials.
          </p>
        </div>

        <form onSubmit={handlePasswordUpdate} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 ml-1">
              New Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={15} />
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-medium text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 shadow-sm"
              />
            </div>
            <p className="text-[9px] text-slate-500 mt-1.5 ml-1">
              Minimum 10 chars, uppercase, lowercase, number, and special character.
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 ml-1">
              Confirm Password
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={15} />
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-medium text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 shadow-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            <span>{isSubmitting ? 'Updating System...' : 'Enforce & Save Credentials'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}

export default ResetPasswordPage;