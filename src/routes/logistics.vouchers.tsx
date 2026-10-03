import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { readBarcodesFromImageData } from 'zxing-wasm';
import { 
  QrCode, 
  Search, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Calendar, 
  WifiOff, 
  Flashlight, 
  RefreshCw
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Voucher } from '../types';

// ------------------------------------------------------------------
// 1. EMBEDDED ZXING-WASM CAMERA SCANNER ENGINE
// ------------------------------------------------------------------
interface ZXingWasmScannerProps {
  onScan: (codes: { rawValue: string }[]) => void;
  paused?: boolean;
}

function ZXingWasmScanner({ onScan, paused = false }: ZXingWasmScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef<boolean>(false);
  const [hasCameraError, setHasCameraError] = useState<{ title: string; detail: string } | null>(null);
  const [torchAvailable, setTorchAvailable] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  const startCamera = useCallback(async () => {
    setIsInitializing(true);
    setHasCameraError(null);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('SECURE_CONTEXT_REQUIRED');
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (err: unknown) {
        const errorObj = err as Error;
        if (errorObj.name === 'OverconstrainedError' || errorObj.name === 'ConstraintNotSatisfiedError') {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } else {
          throw err;
        }
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const track = stream.getVideoTracks()[0];
      if (track && 'getCapabilities' in track) {
        const capabilities = (track as any).getCapabilities?.() || {};
        if ('torch' in capabilities) {
          setTorchAvailable(true);
        }
      }

      setIsInitializing(false);
    } catch (err: unknown) {
      setIsInitializing(false);
      const errorObj = err as Error;

      if (errorObj.name === 'NotAllowedError' || errorObj.message.includes('Permission denied')) {
        setHasCameraError({
          title: 'Camera Access Blocked',
          detail: 'Check device/browser camera permissions or embedded preview frame settings.',
        });
      } else if (errorObj.message === 'SECURE_CONTEXT_REQUIRED' || !window.isSecureContext) {
        setHasCameraError({
          title: 'HTTPS Required',
          detail: 'Camera access requires HTTPS or localhost.',
        });
      } else if (errorObj.name === 'NotFoundError' || errorObj.name === 'DevicesNotFoundError') {
        setHasCameraError({
          title: 'No Camera Found',
          detail: 'No compatible video capture hardware was detected.',
        });
      } else {
        setHasCameraError({
          title: 'Camera Unavailable',
          detail: errorObj.message || 'An unexpected hardware error occurred.',
        });
      }
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [startCamera]);

  const toggleTorch = useCallback(async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track && 'applyConstraints' in track) {
      try {
        const nextState = !torchOn;
        await (track as any).applyConstraints({
          advanced: [{ torch: nextState }],
        });
        setTorchOn(nextState);
      } catch (err) {
        console.warn('[ZXing-Wasm Scanner] Flashlight constraint failed:', err);
      }
    }
  }, [torchOn]);

  useEffect(() => {
    let animationFrameId: number;
    let lastScanTime = 0;
    const SCAN_INTERVAL_MS = 120; // 8.3 FPS throttle

    const scanFrame = async () => {
      const now = performance.now();

      if (
        !paused &&
        !scanningRef.current &&
        now - lastScanTime >= SCAN_INTERVAL_MS &&
        videoRef.current &&
        canvasRef.current &&
        videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
          const targetWidth = Math.min(video.videoWidth, 640);
          const targetHeight = Math.round((video.videoHeight / video.videoWidth) * targetWidth);

          if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
          }

          ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
          const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);

          scanningRef.current = true;
          lastScanTime = now;

          try {
            const results = await readBarcodesFromImageData(imageData, {
              formats: ['QRCode'],
              tryHarder: true,
              maxNumberOfSymbols: 1,
            });

            if (results && results.length > 0 && results[0]?.text) {
              const detectedText = results[0].text.trim();
              if (detectedText) {
                onScan([{ rawValue: detectedText }]);
              }
            }
          } catch {
            // No symbol detected
          } finally {
            scanningRef.current = false;
          }
        }
      }

      animationFrameId = requestAnimationFrame(scanFrame);
    };

    animationFrameId = requestAnimationFrame(scanFrame);
    return () => cancelAnimationFrame(animationFrameId);
  }, [paused, onScan]);

  return (
    <div className="w-full h-full relative overflow-hidden bg-slate-950 flex items-center justify-center">
      <canvas ref={canvasRef} className="hidden" />

      {hasCameraError ? (
        <div className="p-4 sm:p-6 text-center text-slate-300 flex flex-col items-center justify-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
            <XCircle size={22} />
          </div>
          <p className="text-xs font-black uppercase tracking-widest text-white">{hasCameraError.title}</p>
          <p className="text-[10px] text-slate-400 max-w-[240px] leading-relaxed font-medium">{hasCameraError.detail}</p>
          <button
            type="button"
            onClick={startCamera}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-black uppercase tracking-widest border border-slate-700 transition-all cursor-pointer active:scale-95"
          >
            <RefreshCw size={12} />
            <span>Retry Camera</span>
          </button>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            playsInline
            autoPlay
            muted
            className="w-full h-full object-cover"
          />

          <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-8">
            <div className="w-48 h-48 sm:w-56 sm:h-56 border-2 border-emerald-400/80 rounded-3xl relative shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]">
              <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-emerald-400 -mt-1 -ml-1 rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-emerald-400 -mt-1 -mr-1 rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-emerald-400 -mb-1 -ml-1 rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-emerald-400 -mb-1 -mr-1 rounded-br-xl" />
            </div>
          </div>

          {torchAvailable && (
            <button
              type="button"
              onClick={toggleTorch}
              className={`absolute top-3 right-3 p-2 rounded-xl border backdrop-blur-md transition-all shadow-md z-20 cursor-pointer active:scale-95 ${
                torchOn
                  ? 'bg-amber-400 text-slate-950 border-amber-300'
                  : 'bg-slate-900/70 text-white border-slate-700/60 hover:bg-slate-800'
              }`}
              title="Toggle Flashlight"
            >
              <Flashlight size={16} />
            </button>
          )}

          {isInitializing && (
            <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center text-white gap-2 z-20">
              <Loader2 size={28} className="animate-spin text-emerald-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                Calibrating ZXing Engine...
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// 2. ROUTE DEFINITION
// ------------------------------------------------------------------
export const Route = createFileRoute('/logistics/vouchers')({
  component: VouchersScannerPage,
});

export function VouchersScannerPage() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  const [manualCode, setManualCode] = useState('');
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isScannerPaused, setIsScannerPaused] = useState(false);

  const [successFlash, setSuccessFlash] = useState<{
    show: boolean;
    voucherCode: string;
    participants: number;
    guests: number;
    experienceName: string;
    purchaserName: string;
  }>({ show: false, voucherCode: '', participants: 0, guests: 0, experienceName: '', purchaserName: '' });

  const [errorFlash, setErrorFlash] = useState<{ show: boolean; message: string }>({
    show: false,
    message: '',
  });

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

  const redeemMutation = useMutation({
    mutationFn: async ({ code, type }: { code: string; type: 'UUID' | 'MANUAL' }) => {
      if (!user?.id && !profile?.id) throw new Error('Authentication required');

      const { data: voucher, error: fetchError } = await supabase
        .from('vouchers')
        .select('*')
        .eq(type === 'UUID' ? 'id' : 'voucher_code', code)
        .single();

      if (fetchError || !voucher) throw new Error(`VOUCHER NOT FOUND: ${code}`);
      if (voucher.status === 'REDEEMED') {
        const redeemedDate = voucher.redeemed_at
          ? new Date(voucher.redeemed_at).toLocaleString('en-GB')
          : 'earlier date';
        throw new Error(`ALREADY REDEEMED on ${redeemedDate}`);
      }
      if (voucher.status === 'CANCELLED') throw new Error('TICKET CANCELLED. This voucher is void.');
      if (voucher.status === 'EXPIRED') throw new Error('TICKET EXPIRED. This voucher is no longer valid.');

      const { error: updateError } = await supabase
        .from('vouchers')
        .update({
          status: 'REDEEMED',
          redeemed_at: new Date().toISOString(),
          redeemed_by: user?.id || profile?.id || null,
        })
        .eq('id', voucher.id);

      if (updateError) throw updateError;
      return voucher as Voucher;
    },
    onSuccess: (redeemedVoucher) => {
      setSuccessFlash({
        show: true,
        voucherCode: redeemedVoucher.voucher_code,
        participants: redeemedVoucher.participants,
        guests: redeemedVoucher.guests,
        experienceName: redeemedVoucher.item_name || (redeemedVoucher as any).experience_type || 'Experience Booking',
        purchaserName: redeemedVoucher.purchaser_name,
      });

      setTimeout(() => {
        setSuccessFlash({ show: false, voucherCode: '', participants: 0, guests: 0, experienceName: '', purchaserName: '' });
      }, 3500);

      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['all_vouchers_directory'] });
      setManualCode('');
      setIsScannerPaused(true);
      setTimeout(() => setIsScannerPaused(false), 1200);
    },
    onError: (error: unknown) => {
      const msg = error instanceof Error ? error.message : 'Validation failed';
      setErrorFlash({ show: true, message: msg });
      setTimeout(() => setErrorFlash({ show: false, message: '' }), 4000);

      setIsScannerPaused(true);
      setTimeout(() => setIsScannerPaused(false), 2000);
    },
  });

  const handleScan = useCallback((detectedCodes: { rawValue: string }[]) => {
    if (isScannerPaused || redeemMutation.isPending || !detectedCodes || detectedCodes.length === 0) return;
    const scannedCode = detectedCodes[0]?.rawValue?.trim() || '';
    if (!scannedCode) return;
    const isUUID = scannedCode.length === 36 && scannedCode.includes('-');
    redeemMutation.mutate({ code: scannedCode, type: isUUID ? 'UUID' : 'MANUAL' });
  }, [isScannerPaused, redeemMutation]);

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    redeemMutation.mutate({ code: manualCode.trim().toUpperCase(), type: 'MANUAL' });
  };

  if (!isOnline) {
    return (
      <div className="bg-rose-50 border border-rose-200 p-8 rounded-2xl shadow-xs flex flex-col items-center justify-center min-h-[50vh] text-center max-w-xl mx-auto my-12 font-sans">
        <WifiOff size={40} className="text-rose-600 mb-3" />
        <h2 className="text-sm font-black text-rose-900 uppercase tracking-widest mb-1">
          Network Connection Required
        </h2>
        <p className="text-xs font-medium text-rose-700 max-w-md leading-relaxed">
          Voucher check-in and redemption require a live server connection to prevent ticket duplication. Please reconnect to Wi-Fi.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex-1 flex flex-col min-h-0 overflow-hidden space-y-2 lg:space-y-2.5 font-sans">
      {/* SUCCESS FLASH */}
      {successFlash.show && (
        <div className="fixed inset-0 z-50 animate-in slide-in-from-top-4 fade-in duration-300 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-emerald-600 text-white p-8 md:p-12 shadow-2xl rounded-3xl flex flex-col items-center justify-center border-b-8 border-emerald-800 w-full max-w-xl mx-auto">
            <CheckCircle2 className="w-16 h-16 md:w-20 md:h-20 mb-3 animate-bounce" />
            <h2 className="text-2xl md:text-3xl font-black uppercase tracking-widest text-center">
              Ticket Valid &amp; Redeemed
            </h2>
            <p className="text-sm md:text-base font-mono font-bold mt-2 text-center bg-emerald-700/60 px-4 py-1.5 rounded-xl border border-emerald-500">
              {successFlash.voucherCode}
            </p>
            <p className="text-sm font-black uppercase tracking-widest text-emerald-100 mt-2 text-center">
              {successFlash.purchaserName} &bull; {successFlash.experienceName}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2.5">
              <div className="bg-emerald-800 px-5 py-2 rounded-full text-xs md:text-sm font-black flex items-center gap-1.5 shadow-inner">
                <Calendar className="w-4 h-4" />
                <span>{successFlash.participants} Participant{successFlash.participants > 1 ? 's' : ''}</span>
              </div>
              {successFlash.guests > 0 && (
                <div className="bg-emerald-700 px-5 py-2 rounded-full text-xs md:text-sm font-black flex items-center gap-1.5 border border-emerald-400 shadow-inner">
                  <span>+ {successFlash.guests} Guest{successFlash.guests > 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ERROR FLASH */}
      {errorFlash.show && (
        <div className="fixed inset-0 z-50 animate-in slide-in-from-top-4 fade-in duration-300 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-rose-600 text-white p-8 md:p-10 shadow-2xl rounded-3xl flex flex-col items-center justify-center border-b-8 border-rose-800 w-full max-w-xl mx-auto">
            <XCircle className="w-16 h-16 md:w-20 md:h-20 mb-3 animate-pulse" />
            <h2 className="text-2xl md:text-3xl font-black uppercase tracking-widest text-center">
              Validation Failed
            </h2>
            <div className="mt-4 bg-rose-900/60 border border-rose-400 p-4 rounded-2xl w-full text-center">
              <p className="text-xs md:text-sm font-bold leading-relaxed">{errorFlash.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center w-full shrink-0">
        <div>
          <h1 className="text-lg lg:text-xl font-black text-slate-900 tracking-tight leading-none flex items-center gap-2">
            Gate Voucher Scanner
          </h1>
          <p className="text-[10px] lg:text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">
            WASM-Accelerated Digital Ticket Check-in
          </p>
        </div>
      </div>

      {/* Scanner Center Stage */}
      <div className="flex-1 flex flex-col justify-start items-center min-h-0 overflow-y-auto custom-scrollbar p-1">
        <div className="w-full space-y-3 my-auto flex flex-col items-center" style={{ maxWidth: 'clamp(320px, 85vw, 480px)' }}>
          {/* Camera View */}
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden w-full flex flex-col">
            <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-800 flex items-center gap-1.5">
                <QrCode size={14} className="text-slate-700" /> Camera Scanner
              </h2>
              {isScannerPaused && (
                <span className="text-[9px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded uppercase tracking-widest animate-pulse">
                  Ready...
                </span>
              )}
            </div>

            <div className="p-3 sm:p-4 bg-slate-50/40 flex items-center justify-center">
              <div
                className="aspect-square rounded-2xl overflow-hidden bg-slate-950 relative shadow-inner flex items-center justify-center border-2 border-slate-200"
                style={{
                  width: 'clamp(230px, 60vw, 360px)',
                  height: 'clamp(230px, 60vw, 360px)',
                }}
              >
                <ZXingWasmScanner
                  onScan={handleScan}
                  paused={isScannerPaused || redeemMutation.isPending}
                />

                {(isScannerPaused || redeemMutation.isPending) && (
                  <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center z-20">
                    <Loader2 size={32} className="text-white animate-spin" />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Manual Validation Input */}
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden w-full flex flex-col">
            <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 shrink-0">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-800 flex items-center gap-1.5">
                <Search size={14} className="text-slate-700" /> Manual Validation
              </h2>
            </div>
            <form onSubmit={handleManualSubmit} className="p-4 space-y-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                  Enter Voucher Code
                </label>
                <input
                  type="text"
                  placeholder="e.g. OE2008260100-A1B2"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-black text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-slate-900 outline-none uppercase tracking-widest shadow-xs"
                />
              </div>
              <button
                type="submit"
                disabled={!manualCode.trim() || redeemMutation.isPending}
                className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black uppercase tracking-widest text-xs transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-xs active:scale-95 cursor-pointer"
              >
                {redeemMutation.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={13} />
                )}
                <span>Validate Code</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VouchersScannerPage;