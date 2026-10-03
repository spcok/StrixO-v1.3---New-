import React, { useState, useCallback, useEffect } from 'react';
import Cropper from 'react-easy-crop';
import { X, Check, Image as ImageIcon, WifiOff } from 'lucide-react';

interface ImageUploaderProps {
  value: string | Blob | null;
  onChange: (fileOrUrl: string | Blob | null) => void;
  requireCrop?: boolean;
  defaultAspect?: number;
  allowToggle?: boolean;
}

export function ImageUploader({ 
  value, 
  onChange, 
  requireCrop = false, 
  defaultAspect = 4/3, 
  allowToggle = true // ENTERPRISE FIX: Default to true for map distribution flexibility
}: ImageUploaderProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [currentAspect, setCurrentAspect] = useState(defaultAspect);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  
  // ENTERPRISE FIX: Offline Deadlock Gatekeeper
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

  useEffect(() => {
    if (!value) {
      setPreviewUrl(null);
      return;
    }
    if (typeof value === 'string') {
      setPreviewUrl(value);
    } else if (value instanceof Blob) {
      const url = URL.createObjectURL(value);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [value]);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (requireCrop) {
        const reader = new FileReader();
        reader.addEventListener('load', () => setSelectedImage(reader.result as string));
        reader.readAsDataURL(file);
      } else {
        onChange(file);
      }
    }
  };

  const onCropComplete = useCallback((croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const getCroppedImg = async (imageSrc: string, pixelCrop: any): Promise<Blob> => {
    const image = new Image();
    image.src = imageSrc;
    await new Promise((resolve) => (image.onload = resolve));

    const canvas = document.createElement('canvas');
    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;
    const ctx = canvas.getContext('2d');

    ctx?.drawImage(
      image,
      pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
      0, 0, pixelCrop.width, pixelCrop.height
    );

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.9);
    });
  };

  const handleConfirmCrop = async () => {
    if (!selectedImage || !croppedAreaPixels) return;
    const croppedBlob = await getCroppedImg(selectedImage, croppedAreaPixels);
    onChange(croppedBlob);
    setSelectedImage(null);
  };

  // 1. Render Active Image Preview
  if (previewUrl && !selectedImage) {
    return (
      <div 
        className="relative bg-slate-100 border border-slate-200 rounded-xl overflow-hidden group max-w-sm"
        style={{ aspectRatio: currentAspect, maxHeight: '250px' }}
      >
        <img src={previewUrl} alt="Preview" className="w-full h-full object-contain shadow-inner" />
        <div className="absolute inset-0 bg-slate-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            type="button"
            onClick={() => onChange(null)}
            className="px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest flex items-center gap-2 shadow-lg"
          >
            <X size={14} /> Remove
          </button>
        </div>
      </div>
    );
  }

  // 2. Render Crop Modal
  if (selectedImage && requireCrop) {
    return (
      <div className="fixed inset-0 z-[60] bg-slate-900/95 flex flex-col backdrop-blur-sm">
        
        {/* Orientation Toggle Bar */}
        {allowToggle && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[70] flex bg-slate-900/90 rounded-xl p-1 gap-1 border border-slate-700 shadow-2xl">
            <button
              type="button"
              onClick={() => setCurrentAspect(4/3)}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors ${currentAspect === 4/3 ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              Landscape 4:3
            </button>
            <button
              type="button"
              onClick={() => setCurrentAspect(3/4)}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors ${currentAspect === 3/4 ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              Portrait 3:4
            </button>
            <button
              type="button"
              onClick={() => setCurrentAspect(2/1)}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors ${currentAspect === 2/1 ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              Map 2:1
            </button>
          </div>
        )}

        <div className="relative flex-1">
          <Cropper
            image={selectedImage}
            crop={crop}
            zoom={zoom}
            aspect={currentAspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>
        <div className="h-24 bg-slate-900 border-t border-slate-800 flex items-center justify-between px-6 shrink-0 z-[70]">
          <button type="button" onClick={() => setSelectedImage(null)} className="px-6 py-3 text-slate-300 hover:text-white transition-colors font-bold uppercase text-xs tracking-widest">
            Cancel
          </button>
          <button 
            type="button" 
            onClick={handleConfirmCrop} 
            className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl font-bold uppercase text-xs tracking-widest flex items-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
          >
            <Check size={16} /> Confirm Crop
          </button>
        </div>
      </div>
    );
  }

  // 3. Render Offline Deadlock State
  if (!isOnline) {
    return (
      <div className="w-full relative max-w-sm">
        <div className="w-full p-8 border-2 border-dashed border-slate-300 rounded-xl bg-slate-100 flex flex-col items-center justify-center gap-3 text-slate-400 cursor-not-allowed">
          <WifiOff size={28} className="text-slate-300" />
          <div className="text-center">
            <span className="block text-xs font-black uppercase tracking-widest text-slate-500">Uploads Disabled</span>
            <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">Attachments Require Active Wi-Fi</span>
          </div>
        </div>
      </div>
    );
  }

  // 4. Render Active File Picker
  return (
    <div className="w-full relative max-w-sm">
      <input
        type="file"
        accept="image/jpeg, image/png, image/webp"
        onChange={onFileChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
      />
      <div className="w-full p-8 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 hover:bg-slate-100 hover:border-emerald-500/50 transition-colors flex flex-col items-center justify-center gap-3 text-slate-500">
        <ImageIcon size={28} className="text-slate-400" />
        <div className="text-center">
          <span className="block text-xs font-black uppercase tracking-widest text-slate-700">Tap to Upload Image</span>
          <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">JPEG, PNG up to 10MB</span>
        </div>
      </div>
    </div>
  );
}