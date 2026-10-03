import React, { useRef, useState, useMemo, useEffect, useTransition } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Animal } from '../../types';
import { 
  X, Download, Info, Loader2, Globe, RefreshCw, 
  LayoutTemplate, Sun, Moon, Sparkles, Droplets, 
  Image as ImageIcon, Edit2, Save, Calendar, CheckCircle2, ShieldCheck, AlertCircle
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';
import { toJpeg } from 'html-to-image';

// --- IUCN BADGE ASSET IMPORTS ---
import imgCR from '../../assets/Critically endangered.png';
import imgDD from '../../assets/Data Deficient.png';
import imgEN from '../../assets/Endangered.png';
import imgEW from '../../assets/extinct in the wild.png';
import imgEX from '../../assets/extinct.png';
import imgLC from '../../assets/Least Concerned.png';
import imgNT from '../../assets/Near Threatened.png';
import imgNE from '../../assets/Not Evaluated.png';
import imgVU from '../../assets/Vulnerable.png';

interface SignGeneratorProps {
  animal: Animal;
  onClose: () => void;
}

const getIUCNBadgeImage = (status?: string) => {
  if (!status) return imgNE;
  const s = status.toUpperCase();
  if (s.includes('CRITICAL')) return imgCR;
  if (s.includes('DATA')) return imgDD;
  if (s.includes('WILD')) return imgEW;
  if (s.includes('ENDANGERED')) return imgEN; 
  if (s.includes('EXTINCT')) return imgEX; 
  if (s.includes('LEAST') || s.includes('LC')) return imgLC;
  if (s.includes('NEAR') || s.includes('NT')) return imgNT;
  if (s.includes('VULNERABLE') || s.includes('VU')) return imgVU;
  return imgNE;
};

// ------------------------------------------------------------------
// SPECIES TAXONOMIC BASELINES (FACT-CHECKED REFERENCE RANGES)
// ------------------------------------------------------------------
const getSpeciesTaxonomicBaseline = (animal: Animal, dimensionLabel: string) => {
  const speciesLower = (animal.species || '').toLowerCase();
  const latinLower = (animal.latin_name || '').toLowerCase();
  const cat = (animal.category || '').toUpperCase();

  // 1. Spiders & Invertebrates
  if (
    speciesLower.includes('tarantula') || 
    speciesLower.includes('spider') || 
    latinLower.includes('lasiodora') || 
    speciesLower.includes('scorpion') ||
    speciesLower.includes('invert')
  ) {
    const isSalmonPink = speciesLower.includes('salmon') || latinLower.includes('parahybana');
    return {
      lifespanWild: isSalmonPink ? '12 - 15 Years (Females)' : '10 - 15 Years',
      lifespanCaptivity: isSalmonPink ? '15 - 20 Years' : '15 - 20 Years',
      dimension: isSalmonPink ? '20 - 25 cm (up to 10")' : '16 - 22 cm',
      speciesWeightRange: isSalmonPink ? '100 - 200g' : '80 - 150g',
      wildOrigin: animal.origin_location || animal.origin || 'Atlantic Rainforests of Eastern Brazil',
      dietText: 'Insects & crickets\nRoaches & locusts\nOccasional small vertebrates',
      habitatText: 'Tropical rainforest floor\nDeep terrestrial burrows and leaf litter',
      didYouKnowText: 'Third largest tarantula in the world by leg span.\nFlicks urticating hairs from its abdomen to defend against predators.\nCan regenerate lost limbs during the molting process.',
      speciesBrief: `${animal.species} is a heavy-bodied terrestrial tarantula known for its impressive size and salmon-hued setae. Despite being called "birdeaters", they feed predominantly on forest-floor invertebrates.`
    };
  }

  // 2. Snakes, Lizards & Reptiles
  if (
    cat === 'EXOTIC' || 
    speciesLower.includes('snake') || 
    speciesLower.includes('python') || 
    speciesLower.includes('boa') || 
    speciesLower.includes('dragon') || 
    speciesLower.includes('gecko') || 
    speciesLower.includes('lizard') || 
    speciesLower.includes('tortoise')
  ) {
    const isSnake = speciesLower.includes('snake') || speciesLower.includes('python') || speciesLower.includes('boa');
    const isBeardedDragon = speciesLower.includes('bearded') || speciesLower.includes('dragon');
    return {
      lifespanWild: '8 - 12 Years',
      lifespanCaptivity: '15 - 25+ Years',
      dimension: isSnake ? '1.2 - 1.8 m' : isBeardedDragon ? '45 - 60 cm' : '30 - 50 cm',
      speciesWeightRange: isSnake ? '1.0 - 2.2 kg' : isBeardedDragon ? '350 - 550g' : '200 - 450g',
      wildOrigin: animal.origin_location || animal.origin || 'Tropical & Subtropical Biomes',
      dietText: isSnake ? 'Rodents & mice\nSmall mammals' : 'Leafy greens & vegetables\nInsects & invertebrates',
      habitatText: 'Warm, micro-regulated environmental zones\nBasking spots and shaded thermal retreats',
      didYouKnowText: 'Ectothermic animals that regulate their internal temperature using external basking zones.\nPeriodically shed their skin (ecdysis) as they grow.\nPossess specialized sensory organs to detect infrared heat signatures.',
      speciesBrief: `${animal.species} is an ectothermic reptile that regulates its core body temperature by moving between ambient and localized basking zones.`
    };
  }

  // 3. Mammals
  if (cat === 'MAMMAL') {
    const isMeerkat = speciesLower.includes('meerkat');
    const isFox = speciesLower.includes('fox');
    return {
      lifespanWild: isMeerkat ? '6 - 8 Years' : '4 - 7 Years',
      lifespanCaptivity: isMeerkat ? '12 - 15 Years' : '12 - 16 Years',
      dimension: isMeerkat ? '25 - 35 cm' : isFox ? '60 - 85 cm' : '35 - 55 cm',
      speciesWeightRange: isMeerkat ? '700 - 950g' : isFox ? '5.0 - 7.5 kg' : '1.2 - 3.5 kg',
      wildOrigin: animal.origin_location || animal.origin || 'Savannahs, scrublands & grasslands',
      dietText: 'Insects & larvae\nSmall vertebrates & eggs\nRoots & seasonal tubers',
      habitatText: 'Underground burrow networks\nOpen terrain with high lookout visibility',
      didYouKnowText: 'Maintain cooperative sentry hierarchies to monitor for aerial and ground predators.\nCommunicate using a wide variety of distinctive alarm vocalizations.',
      speciesBrief: `${animal.species} is a highly social and inquisitive mammal with acute senses and specialized cooperative behaviors.`
    };
  }

  // 4. Owls & Raptors
  const isGoldenEagle = speciesLower.includes('golden eagle') || latinLower.includes('aquila chrysaetos');
  const isLargeEagleOwl = speciesLower.includes('eagle owl') || speciesLower.includes('bubo bubo');
  const isSmallOwl = speciesLower.includes('little') || speciesLower.includes('scops') || speciesLower.includes('burrowing');
  const isHarrisHawk = speciesLower.includes('harris');
  const isFalcon = speciesLower.includes('falcon') || speciesLower.includes('peregrine');
  const isKestrel = speciesLower.includes('kestrel');
  const isBarnOwl = speciesLower.includes('barn');

  if (isGoldenEagle) {
    return {
      lifespanWild: '15 - 30 Years',
      lifespanCaptivity: '40 - 50+ Years (Record: 68 yrs)',
      dimension: '190 - 225 cm',
      speciesWeightRange: '3.0 - 5.5 kg',
      wildOrigin: animal.origin_location || animal.origin || 'Open moorlands, mountains & highlands of the Northern Hemisphere',
      dietText: 'Mountain hares, rabbits & large rodents\nGamebirds & ptarmigan\nCarrion & occasional small ungulates',
      habitatText: 'Remote mountainous terrain, crags & sea cliffs\nOpen upland moors and wilderness',
      didYouKnowText: 'One of the largest apex raptors in the Northern Hemisphere.\nCan dive in hunting stoops at speeds exceeding 150 - 200 mph.\nRoutinely lives 40 to 50+ years in dedicated raptor conservation care.',
      speciesBrief: 'The Golden Eagle is an apex aerial predator, renowned for its immense wingspan, exceptional flight endurance, and remarkable longevity in human care.'
    };
  }

  return {
    lifespanWild: isLargeEagleOwl ? '15 - 20 Years' : isBarnOwl ? '3 - 5 Years' : '4 - 7 Years',
    lifespanCaptivity: isLargeEagleOwl ? '35 - 50+ Years' : isBarnOwl ? '15 - 20+ Years' : '16 - 25 Years',
    dimension: isLargeEagleOwl ? '160 - 190 cm' : isSmallOwl ? '50 - 65 cm' : isHarrisHawk ? '100 - 120 cm' : isKestrel ? '65 - 80 cm' : '85 - 105 cm',
    speciesWeightRange: isLargeEagleOwl ? '2.0 - 3.8 kg' : isSmallOwl ? '140 - 200g' : isHarrisHawk ? '700 - 1050g' : isFalcon ? '600 - 1100g' : isKestrel ? '150 - 250g' : '300 - 450g',
    wildOrigin: animal.origin_location || animal.origin || 'Open farmland, grasslands, woodlands & valleys',
    dietText: 'Small rodents, voles & mice\nSmall amphibians & insects\nOccasional small birds',
    habitatText: 'Hedgerows, woodland borders & open fields\nCavities, barns & craggy rock ledges',
    didYouKnowText: 'Serrated primary flight feather fringes break up air turbulence for completely silent flight.\nAsymmetrical ear placements allow precise triangulation of sound in total darkness.',
    speciesBrief: `${animal.species} is a specialized bird of prey equipped with acute eyesight, silent plumage, and powerful talons adapted for hunting.`
  };
};

export function SignGenerator({ animal, onClose }: SignGeneratorProps) {
  const queryClient = useQueryClient();
  const signRef = useRef<HTMLDivElement>(null);
  const [mapLayout, setMapLayout] = useState<'side' | 'bottom' | 'card'>('bottom');
  const [isExporting, setIsExporting] = useState(false);
  const [customName, setCustomName] = useState(animal.name || 'Specimen');
  const [isEditingText, setIsEditingText] = useState(false);
  const [isSavingMaster, setIsSavingMaster] = useState(false);
  const [isVerifiedMaster, setIsVerifiedMaster] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Organization settings for branding
  const { data: orgProfile } = useQuery({
    queryKey: ['org_settings'],
    queryFn: async () => {
      const { data } = await supabase.from('organization_profile').select('*').single();
      return data;
    },
    staleTime: 1000 * 60 * 60,
    networkMode: 'offlineFirst',
  });

  // Dynamic morphological dimension label
  const dynamicDimensionLabel = useMemo(() => {
    const s = (animal.species || '').toLowerCase();
    const c = (animal.category || '').toUpperCase();
    if (s.includes('spider') || s.includes('tarantula') || s.includes('scorpion') || s.includes('invert') || s.includes('millipede')) {
      return 'LEG SPAN';
    }
    if (c === 'MAMMAL') {
      return 'BODY LENGTH';
    }
    if (c === 'EXOTIC' || s.includes('snake') || s.includes('lizard') || s.includes('python') || s.includes('boa') || s.includes('dragon') || s.includes('gecko') || s.includes('tortoise')) {
      return 'TOTAL LENGTH';
    }
    return 'WINGSPAN';
  }, [animal.species, animal.category]);

  // Initial Content State based on fact-checked baseline
  const [content, setContent] = useState(() => {
    const defaults = getSpeciesTaxonomicBaseline(animal, dynamicDimensionLabel);
    return {
      dietText: animal.special_requirements || defaults.dietText,
      habitatText: defaults.habitatText,
      didYouKnowText: defaults.didYouKnowText,
      speciesBrief: animal.description || defaults.speciesBrief,
      wildOrigin: animal.origin_location || animal.origin || defaults.wildOrigin,
      lifespanWild: defaults.lifespanWild,
      lifespanCaptivity: defaults.lifespanCaptivity,
      wingspan: defaults.dimension,
      weight: defaults.speciesWeightRange
    };
  });

  // Query Institution Master Knowledge Base (Zero Hallucination Cache)
  const { data: masterRecord } = useQuery({
    queryKey: ['species_signage_master', animal.species],
    queryFn: async () => {
      if (!animal.species) return null;
      const { data, error } = await supabase
        .from('species_signage_master')
        .select('*')
        .ilike('species_name', animal.species.trim())
        .maybeSingle();

      if (error) {
        console.warn('[Signage Master] Error querying master table:', error.message);
        return null;
      }
      return data;
    },
    staleTime: 1000 * 60 * 15,
  });

  // Apply Master Standard if present
  useEffect(() => {
    if (masterRecord) {
      setContent({
        dietText: Array.isArray(masterRecord.diet) ? masterRecord.diet.join('\n') : (masterRecord.diet || ''),
        habitatText: Array.isArray(masterRecord.habitat) ? masterRecord.habitat.join('\n') : (masterRecord.habitat || ''),
        didYouKnowText: Array.isArray(masterRecord.did_you_know) ? masterRecord.did_you_know.join('\n') : (masterRecord.did_you_know || ''),
        speciesBrief: masterRecord.species_brief || '',
        wildOrigin: masterRecord.wild_origin || '',
        lifespanWild: masterRecord.lifespan_wild || '',
        lifespanCaptivity: masterRecord.lifespan_captivity || '',
        wingspan: masterRecord.dimension_value || '',
        weight: masterRecord.species_weight_range || ''
      });
      setIsVerifiedMaster(Boolean(masterRecord.is_verified));
    }
  }, [masterRecord]);

  // AI Content Generator with Grounding & Taxon-Aware Validation
  const fetchContent = () => {
    if (!navigator.onLine) {
      toast.error("Offline: AI Signage Generation requires an internet connection.");
      return;
    }
    
    startTransition(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('generate-signage', {
          body: { 
            species: animal.species,
            latinName: animal.latin_name,
            category: animal.category,
            dimensionType: dynamicDimensionLabel
          }
        });

        if (error) throw new Error(error.message);
        if (!data) throw new Error("No data returned from AI engine.");

        const baseline = getSpeciesTaxonomicBaseline(animal, dynamicDimensionLabel);

        // Sanitize and guard against ungrounded raptor defaults
        let resolvedDimension = data.wingspan || data.dimensionValue || data.legSpan || data.totalLength || data.length || '';
        let resolvedWeight = data.weight || data.speciesWeightRange || data.averageWeight || '';
        let resolvedWild = data.lifespanWild || data.lifespan_wild || '';
        let resolvedCaptivity = data.lifespanCaptivity || data.lifespan_captivity || '';

        const isGenericRaptorWeight = typeof resolvedWeight === 'string' && /800\s*-\s*1200\s*g/i.test(resolvedWeight);
        const isGenericRaptorDimension = typeof resolvedDimension === 'string' && /80\s*-\s*120\s*cm/i.test(resolvedDimension) && dynamicDimensionLabel !== 'WINGSPAN';
        const isNonRaptor = animal.category === 'EXOTIC' || animal.category === 'MAMMAL' || /spider|tarantula|snake|gecko|lizard|invert/i.test(animal.species || '');

        if (!resolvedWeight || (isGenericRaptorWeight && isNonRaptor)) {
          resolvedWeight = baseline.speciesWeightRange;
        }
        if (!resolvedDimension || (isGenericRaptorDimension && isNonRaptor)) {
          resolvedDimension = baseline.dimension;
        }
        if (!resolvedWild || (resolvedWild.includes('4') && resolvedWild.includes('7') && isNonRaptor)) {
          resolvedWild = baseline.lifespanWild;
        }
        if (!resolvedCaptivity || (resolvedCaptivity.includes('15') && resolvedCaptivity.includes('20') && isNonRaptor)) {
          resolvedCaptivity = baseline.lifespanCaptivity;
        }

        // Special protection: Golden Eagle captive lifespan accuracy
        if ((animal.species || '').toLowerCase().includes('golden eagle')) {
          if (!resolvedCaptivity || resolvedCaptivity.includes('20') || resolvedCaptivity.includes('30')) {
            resolvedCaptivity = baseline.lifespanCaptivity;
          }
        }

        setContent({ 
          dietText: Array.isArray(data.diet) ? data.diet.join('\n') : (data.diet || baseline.dietText),
          habitatText: Array.isArray(data.habitat) ? data.habitat.join('\n') : (data.habitat || baseline.habitatText),
          didYouKnowText: Array.isArray(data.didYouKnow) ? data.didYouKnow.join('\n') : (data.didYouKnow || baseline.didYouKnowText),
          speciesBrief: data.brief || data.speciesBrief || baseline.speciesBrief,
          wildOrigin: data.wildOrigin || data.wild_origin || animal.origin_location || animal.origin || baseline.wildOrigin,
          lifespanWild: resolvedWild || baseline.lifespanWild,
          lifespanCaptivity: resolvedCaptivity || baseline.lifespanCaptivity,
          wingspan: resolvedDimension || baseline.dimension,
          weight: resolvedWeight || baseline.speciesWeightRange
        });

        setIsVerifiedMaster(Boolean(data.isVerifiedMaster));
        toast.success(data.isVerifiedMaster ? "Loaded Verified Institution Master Record!" : "AI Content Generated with Fact Checking!");
      } catch (error: any) {
        console.error("SignGenerator Error:", error);
        toast.error(`Generation Failed: ${error.message}`);
      }
    });
  };

  // Commit curator-verified numbers to the Institution Master Standard Table
  const handleSaveAsMaster = async () => {
    setIsSavingMaster(true);
    try {
      const payload = {
        species_name: animal.species.trim(),
        latin_name: animal.latin_name?.trim() || null,
        category: animal.category || null,
        dimension_label: dynamicDimensionLabel,
        dimension_value: content.wingspan,
        species_weight_range: content.weight,
        lifespan_wild: content.lifespanWild,
        lifespan_captivity: content.lifespanCaptivity,
        wild_origin: content.wildOrigin,
        diet: content.dietText.split('\n').map(s => s.trim()).filter(Boolean),
        habitat: content.habitatText.split('\n').map(s => s.trim()).filter(Boolean),
        did_you_know: content.didYouKnowText.split('\n').map(s => s.trim()).filter(Boolean),
        species_brief: content.speciesBrief,
        is_verified: true,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('species_signage_master')
        .upsert(payload, { onConflict: 'species_name' });

      if (error) throw error;

      setIsVerifiedMaster(true);
      queryClient.invalidateQueries({ queryKey: ['species_signage_master', animal.species] });
      toast.success(`Verified master standard saved for ${animal.species}!`);
    } catch (err: any) {
      console.error('[Save Master Error]:', err);
      toast.error(err.message || 'Failed to save master record. Ensure the species_signage_master table exists.');
    } finally {
      setIsSavingMaster(false);
    }
  };

  const handleDownload = async () => {
    if (!signRef.current) return;
    setIsExporting(true);
    
    await new Promise(resolve => setTimeout(resolve, 150));
    
    try {
      const dataUrl = await toJpeg(signRef.current, { 
        quality: 0.95,
        pixelRatio: 3, 
        backgroundColor: '#ffffff',
        style: { transform: 'none' }
      });
      
      const link = document.createElement('a');
      link.download = `KOA_${customName.replace(/\s+/g, '_')}_Sign.jpg`;
      link.href = dataUrl;
      link.click();
      toast.success('Sign downloaded successfully');
    } catch (err) {
      console.error("Export Error:", err);
      toast.error('Failed to generate image. Ensure all photos are fully loaded.');
    } finally {
      setIsExporting(false);
    }
  };

  const formatDate = (date?: any) => {
    if (!date) return 'Unknown';
    const dateStr = String(date);
    if (dateStr.startsWith('1900-01-01')) return 'Unknown';
    return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const getArrivalYear = (date?: any) => {
    if (!date) return 'Unknown';
    const dateStr = String(date);
    if (dateStr.startsWith('1900-01-01')) return 'Unknown';
    return new Date(date).getFullYear();
  };

  const theme = useMemo(() => {
    if (animal.is_venomous || animal.hazard_rating === 'HIGH') {
      return { bg: 'bg-rose-500', text: 'text-rose-500', textDark: 'text-rose-700', containerBg: 'bg-rose-50', border: 'border-rose-200' };
    }
    if (animal.hazard_rating === 'MEDIUM') {
      return { bg: 'bg-orange-500', text: 'text-orange-500', textDark: 'text-orange-700', containerBg: 'bg-orange-50', border: 'border-orange-200' };
    }
    return { bg: 'bg-[#10b981]', text: 'text-[#10b981]', textDark: 'text-emerald-800', containerBg: 'bg-[#f0fdf4]', border: 'border-emerald-200' };
  }, [animal.hazard_rating, animal.is_venomous]);

  const adoptionUrl = orgProfile?.adoptionurl || 'https://kentowlacademy.com';
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(adoptionUrl)}&color=ffffff&bgcolor=10b981`;

  const containerStyle = useMemo(() => {
    if (mapLayout === 'card') return { width: '800px', height: '600px', minWidth: '800px', minHeight: '600px' };
    return { width: '794px', height: '1123px', minWidth: '794px', minHeight: '1123px' }; 
  }, [mapLayout]);

  const isHighRisk = animal.hazard_rating === 'HIGH' || animal.is_venomous;

  const renderBullets = (text: string, limit?: number) => {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const visibleLines = limit ? lines.slice(0, limit) : lines;
    if (visibleLines.length === 0) return <li>{isPending ? 'Verifying facts...' : 'Content pending...'}</li>;
    return visibleLines.map((line, i) => <li key={i}>{line}</li>);
  };

  const renderBriefBullets = (text: string) => {
    if (!text) return <li>{isPending ? 'Verifying facts...' : 'Content pending...'}</li>;
    const items = text.split(/(?:\n|\.\s+)/).filter(l => l.trim().length > 0);
    return items.map((item, i) => (
      <li key={i} className="mb-1">{item.trim()}{item.trim().endsWith('.') ? '' : '.'}</li>
    ));
  };

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    e.currentTarget.style.display = 'none';
    e.currentTarget.parentElement?.classList.add('bg-slate-100', 'flex', 'items-center', 'justify-center');
  };

  const InputLabel = ({ children }: { children: React.ReactNode }) => (
    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{children}</label>
  );

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-[100] flex flex-col p-4 font-sans text-left">
      
      {/* HEADER BAR */}
      <div className="flex flex-wrap justify-between items-center bg-white p-4 rounded-xl shadow-lg gap-4 shrink-0 mb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2 uppercase tracking-tight">
            <LayoutTemplate className="text-emerald-600"/> Signage Studio
          </h2>
          <div className="h-6 w-px bg-slate-200" />
          
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button 
              type="button"
              onClick={() => setMapLayout('side')} 
              className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded transition-all cursor-pointer ${mapLayout === 'side' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
            >
              Portrait A4
            </button>
            <button 
              type="button"
              onClick={() => setMapLayout('bottom')} 
              className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded transition-all cursor-pointer ${mapLayout === 'bottom' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
            >
              Landscape A4
            </button>
            <button 
              type="button"
              onClick={() => setMapLayout('card')} 
              className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded transition-all cursor-pointer ${mapLayout === 'card' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
            >
              Registry Card
            </button>
          </div>

          <button 
            type="button"
            onClick={fetchContent} 
            disabled={isPending} 
            className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg font-black hover:bg-purple-100 transition-colors text-[10px] uppercase tracking-widest disabled:opacity-50 cursor-pointer"
          >
            {isPending ? <Loader2 size={14} className="animate-spin"/> : <RefreshCw size={14}/>}
            Auto-Fill via AI
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button 
            type="button"
            onClick={() => setIsEditingText(!isEditingText)} 
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-bold transition-colors text-[10px] uppercase tracking-widest border-2 cursor-pointer ${isEditingText ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'}`}
          >
            {isEditingText ? <Save size={14}/> : <Edit2 size={14}/>}
            {isEditingText ? "Preview Mode" : "Manual Edit Mode"}
          </button>
          <button 
            type="button"
            onClick={handleDownload} 
            disabled={isExporting} 
            className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-lg font-black hover:bg-emerald-500 transition-all shadow-md active:scale-95 text-[10px] uppercase tracking-widest disabled:opacity-50 cursor-pointer"
          >
            {isExporting ? <Loader2 size={16} className="animate-spin"/> : <Download size={16}/>} 
            {isExporting ? 'Processing...' : 'Download (.JPG)'}
          </button>
          <button 
            type="button"
            onClick={onClose} 
            className="p-2.5 text-slate-400 hover:text-slate-800 transition-colors bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
          >
            <X size={18}/>
          </button>
        </div>
      </div>

      {/* SPLIT SCREEN WORKSPACE */}
      <div className="flex flex-1 min-h-0 gap-4">
        
        {/* LEFT PANE: CONTENT & FACT-CHECKING EDITOR */}
        <div className="w-[400px] bg-white rounded-xl shadow-lg flex flex-col overflow-hidden shrink-0 border border-slate-200">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit2 size={16} className="text-blue-600" />
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-900">Content Editor</h3>
              </div>
              {isPending && (
                <span className="flex items-center gap-1.5 text-[9px] font-bold text-purple-600 uppercase tracking-widest">
                  <Loader2 size={11} className="animate-spin" /> Grounding data...
                </span>
              )}
            </div>

            {/* Verification Status & Save Master Action */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-200/80">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${
                isVerifiedMaster 
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300' 
                  : 'bg-amber-50 text-amber-800 border-amber-300'
              }`}>
                {isVerifiedMaster ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                {isVerifiedMaster ? 'Master Standard' : 'Draft Numbers'}
              </span>

              <button
                type="button"
                onClick={handleSaveAsMaster}
                disabled={isSavingMaster}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[9px] font-black uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer shadow-sm active:scale-95"
                title="Lock in verified numbers as the permanent institutional baseline"
              >
                {isSavingMaster ? <Loader2 size={10} className="animate-spin" /> : <ShieldCheck size={11} />}
                <span>Save as Master</span>
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
            <div>
              <InputLabel>Display Name(s)</InputLabel>
              <input 
                value={customName} 
                onChange={(e) => setCustomName(e.target.value)} 
                className="w-full bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm font-black focus:ring-2 focus:ring-blue-500 outline-none text-blue-900" 
                placeholder="e.g. Dawn &amp; Dusk"
              />
            </div>

            <div>
              <InputLabel>Species Brief (Paragraph)</InputLabel>
              <textarea 
                value={content.speciesBrief} 
                onChange={(e) => setContent(p => ({...p, speciesBrief: e.target.value}))} 
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none custom-scrollbar" 
              />
            </div>
            
            {/* SPECIES-LEVEL BIOMETRIC AND LIFESPAN MATRIX */}
            <div className="grid grid-cols-2 gap-4 border-y border-slate-100 py-6">
              <div>
                <InputLabel>Natural Habitat</InputLabel>
                <input 
                  value={content.wildOrigin} 
                  onChange={(e) => setContent(p => ({...p, wildOrigin: e.target.value}))} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" 
                  placeholder={isPending ? "Verifying..." : "--"}
                />
              </div>
              <div>
                <InputLabel>Wild Lifespan</InputLabel>
                <input 
                  value={content.lifespanWild} 
                  onChange={(e) => setContent(p => ({...p, lifespanWild: e.target.value}))} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" 
                  placeholder={isPending ? "Verifying..." : "--"}
                />
              </div>
              <div>
                <InputLabel>Captive Lifespan</InputLabel>
                <input 
                  value={content.lifespanCaptivity} 
                  onChange={(e) => setContent(p => ({...p, lifespanCaptivity: e.target.value}))} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" 
                  placeholder={isPending ? "Verifying..." : "--"}
                />
              </div>
              <div>
                <InputLabel>{dynamicDimensionLabel}</InputLabel>
                <input 
                  value={content.wingspan} 
                  onChange={(e) => setContent(p => ({...p, wingspan: e.target.value}))} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" 
                  placeholder={isPending ? "Verifying..." : "--"}
                />
              </div>
              <div className="col-span-2">
                <InputLabel>Average Species Weight Range</InputLabel>
                <input 
                  value={content.weight} 
                  onChange={(e) => setContent(p => ({...p, weight: e.target.value}))} 
                  placeholder={isPending ? "Verifying..." : "e.g. 100 - 200g"}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none" 
                />
              </div>
            </div>

            <div>
              <InputLabel>Diet (One point per line)</InputLabel>
              <textarea 
                value={content.dietText} 
                onChange={(e) => setContent(p => ({...p, dietText: e.target.value}))} 
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none custom-scrollbar" 
              />
            </div>
            <div>
              <InputLabel>Habitat (One point per line)</InputLabel>
              <textarea 
                value={content.habitatText} 
                onChange={(e) => setContent(p => ({...p, habitatText: e.target.value}))} 
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none custom-scrollbar" 
              />
            </div>
            <div>
              <InputLabel>Did You Know? (One point per line)</InputLabel>
              <textarea 
                value={content.didYouKnowText} 
                onChange={(e) => setContent(p => ({...p, didYouKnowText: e.target.value}))} 
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none custom-scrollbar" 
              />
            </div>
          </div>
        </div>

        {/* RIGHT PANE: LIVE PREVIEW CANVAS */}
        <div className="flex-1 bg-slate-800/80 rounded-xl overflow-auto flex items-start justify-center p-8 custom-scrollbar border border-slate-700 shadow-inner">
          <div 
            ref={signRef} 
            className={`bg-white relative shadow-2xl flex flex-col overflow-hidden shrink-0 origin-top transform-gpu ${mapLayout === 'card' ? 'border-2 border-black' : ''}`} 
            style={containerStyle}
          >
            {mapLayout === 'card' ? (
              <div className="p-8 h-full flex flex-col relative bg-white pt-10">
                <div className={`absolute top-0 left-0 right-0 h-6 ${theme.bg}`} />
                
                <div className="grid grid-cols-12 gap-6 flex-1 min-h-0 pb-2">
                  <div className="col-span-6 flex flex-col gap-3 min-h-0">
                    <div className="shrink-0 mb-1">
                      <h1 className="text-5xl font-black text-slate-900 uppercase tracking-tighter mb-1 flex items-center gap-4 flex-wrap leading-none">
                        {customName}
                        {isHighRisk && <span className="bg-rose-500 text-white text-xs px-2 py-1 rounded tracking-widest align-middle font-bold shadow-sm">HIGH RISK</span>}
                      </h1>
                      <h2 className={`text-2xl font-bold uppercase tracking-wide mt-1 ${theme.text}`}>{animal.species}</h2>
                      <p className="text-lg font-serif italic text-slate-400 mt-0 leading-tight">{animal.latin_name}</p>
                    </div>
                    
                    <div className={`${theme.containerBg} border ${theme.border} p-4 rounded-xl relative flex-1 min-h-0 flex flex-col`}>
                      <h3 className={`text-[10px] font-black uppercase tracking-widest mb-2 flex items-center gap-1.5 shrink-0 ${theme.textDark}`}>
                        <Sparkles size={12}/> SPECIES BRIEF
                      </h3>
                      <ul className={`list-disc list-outside pl-4 text-sm font-bold leading-relaxed ${theme.textDark} opacity-90 overflow-hidden`}>
                        {renderBriefBullets(content.speciesBrief)}
                      </ul>
                    </div>
                    
                    <div className="flex flex-col gap-2.5 mt-auto shrink-0">
                      <div className="grid grid-cols-2 gap-x-4">
                        <div>
                          <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">DATE OF BIRTH</h4>
                          <p className="font-black text-slate-800 text-base">{formatDate(animal.date_of_birth)}</p>
                        </div>
                        <div>
                          <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">GENDER</h4>
                          <p className="font-black text-slate-800 uppercase text-base">{animal.gender || 'Unknown'}</p>
                        </div>
                      </div>
                      <div>
                        <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">NATURAL HABITAT</h4>
                        <p className="font-black text-slate-800 text-sm truncate">{content.wildOrigin || (isPending ? 'Verifying...' : 'Pending...')}</p>
                      </div>
                      {(animal.category === 'MAMMAL' || animal.category === 'EXOTIC') ? (
                        <div>
                          <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">HAZARD CLASS</h4>
                          <div className="flex items-center gap-2">
                            <p className={`font-black text-sm uppercase ${animal.hazard_rating === 'HIGH' ? 'text-rose-600' : animal.hazard_rating === 'MEDIUM' ? 'text-amber-600' : 'text-slate-800'}`}>{animal.hazard_rating || 'LOW'}</p>
                            {animal.is_venomous && <span className="bg-rose-600 text-white text-[8px] px-1.5 py-0.5 rounded font-black uppercase tracking-wider">VENOMOUS</span>}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">CHIP/RING</h4>
                          <p className="font-black text-slate-800 font-mono text-sm">{animal.microchip_id || animal.ring_number || 'N/A'}</p>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="col-span-6 flex flex-col h-full gap-4 min-h-0">
                    <div className="flex items-center justify-end gap-5 shrink-0">
                      <div className="w-56 aspect-[4/3] rounded-xl overflow-hidden border-2 border-slate-200 shadow-lg bg-slate-100 shrink-0 relative flex items-center justify-center">
                        <ImageIcon size={32} className="text-slate-300 absolute" />
                        <img src={animal.profile_image_url || ''} alt={animal.name} className="w-full h-full object-cover object-center relative z-10" crossOrigin="anonymous" onError={handleImageError}/>
                      </div>
                      <div className="shrink-0">
                        <img 
                          src={getIUCNBadgeImage(animal.red_list_status)} 
                          alt="IUCN Status" 
                          className="h-24 w-auto object-contain drop-shadow-sm" 
                        />
                      </div>
                    </div>
                    
                    <div className="flex-1 flex flex-col min-h-0">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-0.5 shrink-0">NATIVE RANGE</h3>
                      <div className="flex-1 w-full bg-slate-50 rounded-xl border border-slate-100 overflow-hidden flex items-center justify-center relative min-h-0">
                        {animal.distribution_map_url ? (
                          <img src={animal.distribution_map_url} alt="Range Map" className="w-full h-full object-contain p-2" crossOrigin="anonymous" onError={handleImageError}/>
                        ) : (
                          <div className="flex flex-col items-center justify-center text-slate-300">
                            <Globe size={32} className="mb-1"/><span className="text-[8px] font-black uppercase">No Map Data</span>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex flex-col gap-3 shrink-0">
                      <div className="flex gap-3">
                        <div className="flex-1 bg-orange-500 text-white p-4 rounded-xl shadow-lg flex items-center gap-4">
                          <Sun size={32} className="shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[9px] font-black opacity-90 uppercase tracking-widest whitespace-nowrap">DAY TARGET</p>
                            <p className="text-4xl font-black leading-none mt-1">{animal.target_day_temp_c ? `${animal.target_day_temp_c}°C` : '--'}</p>
                          </div>
                        </div>
                        <div className="flex-1 bg-emerald-600 text-white p-4 rounded-xl shadow-lg flex items-center gap-4">
                          <Moon size={32} className="shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[9px] font-black opacity-90 uppercase tracking-widest whitespace-nowrap">NIGHT TARGET</p>
                            <p className="text-4xl font-black leading-none mt-1">{animal.target_night_temp_c ? `${animal.target_night_temp_c}°C` : '--'}</p>
                          </div>
                        </div>
                      </div>
                      {(animal.target_humidity_min_percent || animal.target_humidity_max_percent) && (
                        <div className="bg-cyan-600 text-white p-4 rounded-xl shadow-lg flex items-center gap-4">
                          <Droplets size={32} className="shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[9px] font-black opacity-90 uppercase tracking-widest whitespace-nowrap">HUMIDITY RANGE</p>
                            <p className="text-4xl font-black leading-none mt-1">{animal.target_humidity_min_percent || '?'}-{animal.target_humidity_max_percent || '?'}%</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="h-28 bg-[#1e293b] flex items-center justify-between px-10 text-white shrink-0">
                  <h1 className="text-3xl font-black uppercase tracking-[0.2em]">{orgProfile?.org_name || 'KENT OWL ACADEMY'}</h1>
                  {orgProfile?.logo_url ? (
                    <img src={orgProfile.logo_url} alt="Logo" className="h-20 w-auto object-contain bg-white rounded-xl p-2 shadow-lg" crossOrigin="anonymous" onError={handleImageError} />
                  ) : (
                    <div className="h-16 w-16 bg-white rounded-xl flex items-center justify-center text-slate-900 font-bold text-2xl">KOA</div>
                  )}
                </div>
                
                <div className="flex-1 min-h-0 py-8 pl-5 pr-8 grid grid-cols-12 gap-8 overflow-hidden">
                  {/* LEFT COLUMN */}
                  <div className={`col-span-5 flex flex-col min-h-0 ${mapLayout === 'bottom' ? 'gap-4' : 'gap-5'}`}>
                    <div className="aspect-[4/3] w-full rounded-[1.5rem] overflow-hidden border-4 border-[#1e293b] shadow-xl relative shrink-0 flex items-center justify-center bg-slate-100">
                      <ImageIcon size={32} className="text-slate-300 absolute z-0" />
                      <img src={animal.profile_image_url || ''} alt={animal.name} className="w-full h-full object-cover object-center relative z-10" crossOrigin="anonymous" onError={handleImageError}/>
                    </div>
                    <div className="bg-[#1e293b] rounded-2xl p-4 flex items-center justify-between shadow-lg text-white shrink-0">
                      <span className="text-xs font-black uppercase tracking-[0.25em] pl-2">STATUS</span>
                      <div className="origin-right">
                        <img 
                          src={getIUCNBadgeImage(animal.red_list_status)} 
                          alt="IUCN Status" 
                          className="h-12 w-auto object-contain drop-shadow-sm" 
                        />
                      </div>
                    </div>
                    
                    {mapLayout === 'side' ? (
                      <div className="bg-slate-50 rounded-2xl p-4 border-2 border-slate-200 shadow-sm flex flex-col items-center flex-1 min-h-0">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.25em] w-full text-left mb-2 pl-1 shrink-0">NATIVE RANGE</h3>
                        <div className="rounded-xl overflow-hidden border border-slate-200 w-full bg-white relative flex items-center justify-center flex-1 min-h-0">
                          {animal.distribution_map_url ? (
                            <img src={animal.distribution_map_url} alt="Range Map" className="w-full h-full object-contain" crossOrigin="anonymous" onError={handleImageError}/>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-300"><Globe size={48} /></div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-col gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-sm shrink-0">
                          <div className="flex items-center gap-3 border-b border-slate-200 pb-2">
                            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-slate-500 shadow-sm border border-slate-200 shrink-0"><Info size={16}/></div>
                            <div><p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">DOB</p><p className="font-bold text-slate-800 text-sm">{formatDate(animal.date_of_birth)}</p></div>
                          </div>
                          <div className="flex items-center gap-3 border-b border-slate-200 pb-2">
                            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-slate-500 shadow-sm border border-slate-200 shrink-0"><Info size={16}/></div>
                            <div><p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">GENDER</p><p className="font-bold text-slate-800 text-sm uppercase">{animal.gender || 'Unknown'}</p></div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-slate-500 shadow-sm border border-slate-200 shrink-0"><Calendar size={16}/></div>
                            <div><p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">ARRIVED</p><p className="font-bold text-slate-800 text-sm">{getArrivalYear(animal.acquisition_date)}</p></div>
                          </div>
                        </div>

                        {/* 4 BIOLOGICAL METRICS DRAWN DIRECTLY FROM EDGE FUNCTION */}
                        <div className="grid grid-cols-1 gap-3 bg-[#f0fdf4] p-3 rounded-xl border border-emerald-100 flex-1 min-h-0 content-start overflow-auto no-scrollbar mb-6">
                          <div className="bg-white/50 p-2.5 rounded-lg border border-emerald-100 flex flex-col justify-center">
                            <p className="text-[7px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">WILD LIFESPAN</p>
                            <p className="text-sm font-bold text-slate-800 leading-tight">
                              {content.lifespanWild || (isPending ? '...' : '-')}
                            </p>
                          </div>
                          <div className="bg-white/50 p-2.5 rounded-lg border border-emerald-100 flex flex-col justify-center">
                            <p className="text-[7px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">CAPTIVE LIFESPAN</p>
                            <p className="text-sm font-bold text-slate-800 leading-tight">
                              {content.lifespanCaptivity || (isPending ? '...' : '-')}
                            </p>
                          </div>
                          <div className="bg-white/50 p-2.5 rounded-lg border border-emerald-100 flex flex-col justify-center">
                            <p className="text-[7px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">{dynamicDimensionLabel}</p>
                            <p className="text-sm font-bold text-slate-800 leading-tight">
                              {content.wingspan || (isPending ? '...' : '-')}
                            </p>
                          </div>
                          <div className="bg-white/50 p-2.5 rounded-lg border border-emerald-100 flex flex-col justify-center">
                            <p className="text-[7px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">AVERAGE SPECIES WEIGHT</p>
                            <p className="text-sm font-bold text-slate-800 leading-tight">
                              {content.weight || (isPending ? '...' : '-')}
                            </p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  
                  {/* RIGHT COLUMN */}
                  <div className={`col-span-7 flex flex-col min-h-0 ${mapLayout === 'bottom' ? 'gap-6' : 'gap-8'}`}>
                    <div className="shrink-0">
                      <h2 className="text-[4rem] font-black text-[#1e293b] uppercase leading-[0.8] tracking-tight mb-2">{customName}</h2>
                      <h3 className="text-2xl font-bold text-[#10b981] uppercase tracking-wider">{animal.species}</h3>
                      <p className="text-lg text-slate-400 font-serif italic mt-1 mb-4">{animal.latin_name}</p>
                      <div className="h-1.5 w-32 bg-[#10b981] mb-2 rounded-full" />
                      
                      {mapLayout === 'side' && (
                        <>
                          <div className="flex gap-8 mb-6 mt-6 bg-slate-50 p-3 rounded-xl border border-slate-100">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-slate-500 shadow-sm border border-slate-200"><Info size={20}/></div>
                              <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">DOB</p><p className="font-bold text-slate-800">{formatDate(animal.date_of_birth)}</p></div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-slate-500 shadow-sm border border-slate-200"><Info size={20}/></div>
                              <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">GENDER</p><p className="font-bold text-slate-800 uppercase">{animal.gender || 'Unknown'}</p></div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-slate-500 shadow-sm border border-slate-200"><Calendar size={20}/></div>
                              <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">ARRIVED</p><p className="font-bold text-slate-800">{getArrivalYear(animal.acquisition_date)}</p></div>
                            </div>
                          </div>
                          <div className="grid grid-cols-4 gap-2 bg-[#f0fdf4] p-3 rounded-xl border border-emerald-100">
                            <div className="text-center">
                              <p className="text-[8px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">WILD LIFESPAN</p>
                              <p className="text-sm font-bold text-slate-800 leading-tight">{content.lifespanWild || (isPending ? '...' : '-')}</p>
                            </div>
                            <div className="text-center border-l border-emerald-200">
                              <p className="text-[8px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">CAPTIVE LIFESPAN</p>
                              <p className="text-sm font-bold text-slate-800 leading-tight">{content.lifespanCaptivity || (isPending ? '...' : '-')}</p>
                            </div>
                            <div className="text-center border-l border-emerald-200">
                              <p className="text-[8px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">{dynamicDimensionLabel}</p>
                              <p className="text-sm font-bold text-slate-800 leading-tight">{content.wingspan || (isPending ? '...' : '-')}</p>
                            </div>
                            <div className="text-center border-l border-emerald-200">
                              <p className="text-[8px] font-black text-emerald-700 uppercase tracking-widest mb-0.5">AVERAGE WEIGHT</p>
                              <p className="text-sm font-bold text-slate-800 leading-tight">{content.weight || (isPending ? '...' : '-')}</p>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    
                    {/* DYNAMIC TEXT BLOCKS */}
                    <div className="flex flex-col gap-3 flex-1 min-h-0 justify-between overflow-hidden">
                      <div className="flex-1 min-h-0 flex flex-col">
                        <h4 className="text-xs font-black text-[#1e293b] uppercase tracking-widest mb-1.5 border-b border-slate-200 pb-1 shrink-0">DIET</h4>
                        <ul className="list-disc list-outside pl-4 text-sm text-slate-700 space-y-1 font-medium leading-snug marker:text-[#10b981] overflow-hidden">
                          {renderBullets(content.dietText)}
                        </ul>
                      </div>
                      <div className="flex-1 min-h-0 flex flex-col">
                        <h4 className="text-xs font-black text-[#1e293b] uppercase tracking-widest mb-1.5 border-b border-slate-200 pb-1 shrink-0">HABITAT</h4>
                        <ul className="list-disc list-outside pl-4 text-sm text-slate-700 space-y-1 font-medium leading-snug marker:text-[#10b981] overflow-hidden">
                          {renderBullets(content.habitatText)}
                        </ul>
                      </div>
                      <div className="flex-1 min-h-0 flex flex-col">
                        <h4 className="text-xs font-black text-[#1e293b] uppercase tracking-widest mb-1.5 border-b border-slate-200 pb-1 shrink-0">DID YOU KNOW?</h4>
                        <ul className="list-disc list-outside pl-4 text-sm text-slate-700 space-y-1 font-medium leading-snug marker:text-[#10b981] overflow-hidden">
                          {renderBullets(content.didYouKnowText)}
                        </ul>
                      </div>
                    </div>
                    
                    {mapLayout === 'bottom' && (
                      <div className="h-56 bg-slate-50 rounded-2xl p-3 border-2 border-slate-200 shadow-sm shrink-0 flex flex-col mt-auto">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.25em] w-full text-left mb-1 pl-1 shrink-0">NATIVE RANGE</h3>
                        <div className="rounded-xl overflow-hidden border border-slate-200 w-full bg-white relative flex items-center justify-center flex-1 min-h-0">
                          {animal.distribution_map_url ? (
                            <img src={animal.distribution_map_url} alt="Range Map" className="w-full h-full object-contain" crossOrigin="anonymous" onError={handleImageError}/>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-300"><Globe size={32} /></div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* FOOTER BAR */}
                <div className="h-28 bg-[#10b981] flex items-center justify-between px-10 text-white relative overflow-hidden shrink-0">
                  <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #fff 2px, transparent 2.5px)', backgroundSize: '24px 24px' }} />
                  <div className="relative z-10 max-w-[70%]">
                    <h2 className="text-2xl font-black uppercase italic tracking-wide mb-1 shadow-black drop-shadow-sm">ADOPT {customName} TODAY!</h2>
                    <p className="text-xs font-medium opacity-95 leading-snug">Scan the code to adopt {customName}. Your support helps provide food, care, and enrichment for our collection.</p>
                  </div>
                  <div className="relative z-10 bg-white p-1.5 rounded-xl shadow-2xl shrink-0 flex items-center justify-center">
                    <ImageIcon size={24} className="text-slate-300 absolute z-0" />
                    <img src={qrCodeUrl} alt="Adoption QR" className="w-20 h-20 relative z-10" crossOrigin="anonymous" onError={handleImageError}/>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SignGenerator;