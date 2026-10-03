import React, { useState } from 'react';
import { 
  Lock, 
  Mail, 
  Loader2, 
  ArrowRight, 
  KeyRound, 
  X, 
  CheckCircle2, 
  Eye, 
  EyeOff,
  ShieldCheck,
  ShieldAlert,
  Scale
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import logoImg from '../../assets/logo.png';

interface LoginScreenProps {
  onSuccess?: () => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const auth = useAuth() as any;

  // Login Form States
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Forgot Password Modal States
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [resetSentSuccess, setResetSentSuccess] = useState(false);

  // Handle Standard Sign-In
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error('Please provide both your email address and password.');
      return;
    }

    setIsLoggingIn(true);
    try {
      if (typeof auth?.login === 'function') {
        await auth.login(email.trim(), password);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        if (!data.session) throw new Error('No active session returned.');
      }

      toast.success('Signed in successfully.');
      if (onSuccess) onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Invalid login credentials.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Handle Password Reset Dispatch
  const handleRequestPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim()) {
      toast.error('Please enter your email address.');
      return;
    }

    setIsSendingReset(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      setResetSentSuccess(true);
      toast.success('Password recovery email dispatched.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to send reset link. Verify the email address.');
    } finally {
      setIsSendingReset(false);
    }
  };

  const closeResetModal = () => {
    setIsResetModalOpen(false);
    setResetSentSuccess(false);
    setResetEmail('');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 selection:bg-emerald-500 selection:text-white font-sans text-left relative overflow-hidden py-10">
      
      {/* Background Ambience Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10 space-y-4">
        
        {/* Main Card */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-sm space-y-6">
          
          {/* Header Branding */}
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-slate-950 border border-slate-800 p-2 flex items-center justify-center shadow-inner">
              <img 
                src={logoImg} 
                alt="StrixOS Logo" 
                className="w-full h-full object-contain" 
              />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white tracking-tight">
                Strix<span className="text-emerald-500">OS</span>
              </h1>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">
                Kent Owl Academy Husbandry Portal
              </p>
            </div>
          </div>

          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-4 pt-2">
            
            {/* Email Field */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 ml-1">
                Staff Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="keeper@kentowlacademy.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-medium text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 shadow-inner transition-all"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <div className="flex justify-between items-center mb-1.5 ml-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setResetEmail(email);
                    setIsResetModalOpen(true);
                  }}
                  className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
                >
                  Forgot Password?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-medium text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 shadow-inner transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-md active:scale-[0.99] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-4"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>

        </div>

        {/* Legal, Statutory Compliance & Computer Misuse Notice Card */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 shadow-xl text-left space-y-3">
          
          {/* Computer Misuse Warning */}
          <div className="flex items-start gap-2.5">
            <ShieldAlert size={14} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                Authorized Access Only • Computer Misuse Act 1990
              </h4>
              <p className="text-[9px] text-slate-400 font-medium leading-relaxed mt-0.5">
                This system is strictly reserved for authorized Kent Owl Academy personnel. Unauthorized access, alteration, or damage to data is a criminal offence under the Computer Misuse Act 1990 and may result in civil proceedings and criminal prosecution.
              </p>
            </div>
          </div>

          <div className="h-px bg-slate-800/60" />

          {/* GDPR & SSSMZP Statutory Processing Notice */}
          <div className="flex items-start gap-2.5">
            <Scale size={14} className="text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                UK GDPR &amp; Statutory Record-Keeping (SSSMZP)
              </h4>
              <p className="text-[9px] text-slate-400 font-medium leading-relaxed mt-0.5">
                User authentication events, access timestamps, and husbandry record entries are monitored and logged to satisfy statutory compliance obligations under the Zoo Licensing Act 1981 and the Data Protection Act 2018 (Article 6(1)(c) Legal Obligation).
              </p>
            </div>
          </div>

        </div>

      </div>

      {/* Forgot Password Modal */}
      {isResetModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200 font-sans text-left">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4 relative">
            
            {/* Modal Header */}
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-slate-800 text-emerald-400 flex items-center justify-center">
                  <KeyRound size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-tight">
                    Reset Password
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Recovery Dispatch
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeResetModal}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            {resetSentSuccess ? (
              <div className="space-y-4 py-2">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-2.5 text-emerald-400">
                  <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
                  <p className="text-xs font-medium leading-relaxed">
                    A recovery link has been dispatched to <strong className="text-white">{resetEmail}</strong>. Please check your inbox and tap the link to reset your credentials.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeResetModal}
                  className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-colors cursor-pointer"
                >
                  Return to Login
                </button>
              </div>
            ) : (
              <form onSubmit={handleRequestPasswordReset} className="space-y-4 pt-1">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Enter your registered staff email address. We will send you a secure link to create a new password.
                </p>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 ml-1">
                    Registered Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={15} />
                    <input
                      type="email"
                      required
                      placeholder="keeper@kentowlacademy.com"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-medium text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 shadow-inner"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeResetModal}
                    className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSendingReset}
                    className="flex-[2] py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {isSendingReset ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <span>Send Reset Link</span>
                    )}
                  </button>
                </div>
              </form>
            )}

          </div>
        </div>
      )}

    </div>
  );
}

export default LoginScreen;