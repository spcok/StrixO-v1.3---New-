import * as XLSX from 'xlsx';

export const GRAMS_PER_OZ = 28.349523125;
export const GRAMS_PER_LB = 453.59237;

export interface ParsedWeightRecord {
  raw: string;
  grams: number;
  detectedUnit: 'oz' | 'g' | 'lb' | 'kg';
  am_pm: 'AM' | 'PM';
  has_cast: boolean;
  time: string; // Defaults to "10:00"
}

export interface ParsedFeedItem {
  raw: string;
  foodItem: string;
  feedMethod: string;
  quantity: number;
  unit: 'whole_item' | 'grams';
  outcome: 'EATEN' | 'REFUSED' | 'FASTING' | 'NOT_CAST' | 'REGURGITATED';
  calci_dust_added: boolean;
  time: string;
  isEstimatedTime: boolean;
}

export interface ParsedFacilityRecord {
  id: string;
  rawName: string;
  matchedAnimalId: string | null;
  matchedAnimalName: string | null;
  animalCategory: string;
  animalUnit: 'g' | 'oz' | 'lb' | 'kg';
  sheetDate: string; // YYYY-MM-DD
  weight: ParsedWeightRecord | null;
  feed: ParsedFeedItem | null;
  cast: string | null;
  training: string | null;
  activity: string | null;
  keeperInitials: string | null;
  matchedKeeperId: string | null;
  matchedKeeperName: string | null;
  notes: string | null;
  status: 'valid' | 'warning' | 'error';
  warnings: string[];
}

export const FEED_ALIAS_MATRIX: Record<string, { foodItem: string; feedMethod: string }> = {
  'yolked chick':    { foodItem: 'Day Old Chick', feedMethod: 'Yolked' },
  'yolked chicks':   { foodItem: 'Day Old Chick', feedMethod: 'Yolked' },
  'whole chick':     { foodItem: 'Day Old Chick', feedMethod: 'Whole' },
  'whole chicks':    { foodItem: 'Day Old Chick', feedMethod: 'Whole' },
  'skinned chick':   { foodItem: 'Day Old Chick', feedMethod: 'Skinned' },
  'skinned chicks':  { foodItem: 'Day Old Chick', feedMethod: 'Skinned' },
  'doc':             { foodItem: 'Day Old Chick', feedMethod: 'Whole' },
  'docs':            { foodItem: 'Day Old Chick', feedMethod: 'Whole' },
  'quail':           { foodItem: 'Quail',         feedMethod: 'Whole' },
  'mice':            { foodItem: 'Mouse',         feedMethod: 'Whole' },
  'mouse':           { foodItem: 'Mouse',         feedMethod: 'Whole' },
  'fluff':           { foodItem: 'Mouse',         feedMethod: 'Fluff' },
  'weaner':          { foodItem: 'Rat',           feedMethod: 'Weaner' },
  'rat':             { foodItem: 'Rat',           feedMethod: 'Whole' },
};

export function getUserInitials(name: string): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function matchKeeper(rawSignOff: string | null, usersList: any[] = []): { id: string; name: string; initials: string } | null {
  if (!rawSignOff || !usersList.length) return null;
  const cleanSign = rawSignOff.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleanSign) return null;

  for (const u of usersList) {
    const init = (u.initials || getUserInitials(u.name || '')).toLowerCase();
    if (init === cleanSign) {
      return { id: u.id, name: u.name, initials: u.initials || getUserInitials(u.name) };
    }
  }

  for (const u of usersList) {
    const uName = (u.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const uEmail = (u.email || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (uName === cleanSign || uEmail.startsWith(cleanSign) || uName.includes(cleanSign)) {
      return { id: u.id, name: u.name, initials: u.initials || getUserInitials(u.name) };
    }
  }

  return null;
}

export function parseSheetDateFromFilename(filename: string): string {
  const match = filename.match(/(\d{1,2})[-_](\d{1,2})[-_](\d{2,4})/);
  if (!match) return new Date().toISOString().split('T')[0];

  const day = match[1].padStart(2, '0');
  const month = match[2].padStart(2, '0');
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${month}-${day}`;
}

export function parseFractionNumber(val: string | number | undefined | null): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;

  const clean = String(val).replace(/[^\d\s\/\.]/g, '').trim();
  if (!clean) return null;

  const mixedMatch = clean.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch) {
    const whole = parseInt(mixedMatch[1], 10);
    const num = parseInt(mixedMatch[2], 10);
    const den = parseInt(mixedMatch[3], 10);
    return den > 0 ? whole + num / den : whole;
  }

  const fractionMatch = clean.match(/^(\d+)\/(\d+)$/);
  if (fractionMatch) {
    const num = parseInt(fractionMatch[1], 10);
    const den = parseInt(fractionMatch[2], 10);
    return den > 0 ? num / den : null;
  }

  const parsed = parseFloat(clean);
  return isNaN(parsed) ? null : parsed;
}

export function parseKeeperWeightToGrams(
  rawWeight: string | number | undefined | null,
  targetUnit?: 'g' | 'oz' | 'lb' | 'kg'
): ParsedWeightRecord | null {
  if (rawWeight === undefined || rawWeight === null) return null;
  const raw = String(rawWeight).trim();
  if (!raw || raw === '-' || raw.toLowerCase() === 'n/w') return null;

  const compoundLbOz = raw.match(/^(\d+)(?:\.|\s+lb\s*)(\d+(?:\s+\d+\/\d+|\/\d+|\.\d+)?)/i);
  if (compoundLbOz) {
    const lbs = parseInt(compoundLbOz[1], 10);
    const oz = parseFractionNumber(compoundLbOz[2]) ?? 0;
    const totalGrams = Math.round((lbs * 16 + oz) * GRAMS_PER_OZ);
    return {
      raw,
      grams: totalGrams,
      detectedUnit: 'lb',
      am_pm: 'AM',
      has_cast: false,
      time: '10:00',
    };
  }

  const numericVal = parseFractionNumber(raw);
  if (numericVal === null || numericVal <= 0) return null;

  if (targetUnit === 'oz') {
    return {
      raw,
      grams: Math.round(numericVal * GRAMS_PER_OZ),
      detectedUnit: 'oz',
      am_pm: 'AM',
      has_cast: false,
      time: '10:00',
    };
  }
  if (targetUnit === 'g') {
    return {
      raw,
      grams: Math.round(numericVal),
      detectedUnit: 'g',
      am_pm: 'AM',
      has_cast: false,
      time: '10:00',
    };
  }
  if (targetUnit === 'lb') {
    return {
      raw,
      grams: Math.round(numericVal * GRAMS_PER_LB),
      detectedUnit: 'lb',
      am_pm: 'AM',
      has_cast: false,
      time: '10:00',
    };
  }

  const hasFraction = raw.includes('/');
  if (numericVal < 50 || hasFraction) {
    return {
      raw,
      grams: Math.round(numericVal * GRAMS_PER_OZ),
      detectedUnit: 'oz',
      am_pm: 'AM',
      has_cast: false,
      time: '10:00',
    };
  }

  return {
    raw,
    grams: Math.round(numericVal),
    detectedUnit: 'g',
    am_pm: 'AM',
    has_cast: false,
    time: '10:00',
  };
}

// ------------------------------------------------------------------
// ROBUST TIME NORMALIZER (HANDLES EXCEL FLOATS, STRINGS, AND AM/PM)
// ------------------------------------------------------------------
export function normalizeFeedTime(rawTime: any): { timeStr: string; hasExplicitTime: boolean } {
  if (rawTime === undefined || rawTime === null || rawTime === '') {
    return { timeStr: '15:00', hasExplicitTime: false };
  }

  // 1. Date Object
  if (rawTime instanceof Date && !isNaN(rawTime.getTime())) {
    const h = rawTime.getHours();
    const m = rawTime.getMinutes();
    return {
      timeStr: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      hasExplicitTime: true,
    };
  }

  // 2. Numeric Excel Time Representation (Day fraction, e.g. 0.635416666 = 15:15)
  if (typeof rawTime === 'number') {
    if (isNaN(rawTime)) {
      return { timeStr: '15:00', hasExplicitTime: false };
    }
    if (rawTime >= 0 && rawTime < 1) {
      const totalSeconds = Math.round(rawTime * 86400);
      const hours = Math.floor(totalSeconds / 3600) % 24;
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      return {
        timeStr: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
        hasExplicitTime: true,
      };
    }
    if (rawTime >= 1 && rawTime <= 24 && Number.isInteger(rawTime)) {
      const hours = rawTime === 24 ? 0 : rawTime;
      return {
        timeStr: `${String(hours).padStart(2, '0')}:00`,
        hasExplicitTime: true,
      };
    }
    if (rawTime > 1) {
      const fraction = rawTime % 1;
      const totalSeconds = Math.round(fraction * 86400);
      const hours = Math.floor(totalSeconds / 3600) % 24;
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      return {
        timeStr: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
        hasExplicitTime: true,
      };
    }
  }

  // 3. String Parsing
  const str = String(rawTime).trim();
  if (!str || str === '-' || str.toLowerCase() === 'none') {
    return { timeStr: '15:00', hasExplicitTime: false };
  }

  // Check if string contains a float number
  const asNumber = Number(str);
  if (!isNaN(asNumber) && !str.includes(':')) {
    return normalizeFeedTime(asNumber);
  }

  // AM / PM formats (e.g. "3:15 PM", "3pm", "11:30am")
  const ampmMatch = str.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1], 10);
    const m = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
    const isPm = ampmMatch[3].toLowerCase() === 'pm';
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return {
      timeStr: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      hasExplicitTime: true,
    };
  }

  // 24-hour time string (e.g. "15:15", "15:15:00", "09:30", "9:30")
  const timeMatch = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (timeMatch) {
    const h = parseInt(timeMatch[1], 10);
    const m = parseInt(timeMatch[2], 10);
    if (h >= 0 && h < 24 && m >= 0 && m < 60) {
      return {
        timeStr: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
        hasExplicitTime: true,
      };
    }
  }

  // ISO string
  if (str.includes('T')) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const h = d.getHours();
      const m = d.getMinutes();
      return {
        timeStr: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
        hasExplicitTime: true,
      };
    }
  }

  // Generic HH:MM pattern match
  const genericMatch = str.match(/(\d{1,2}):(\d{2})/);
  if (genericMatch) {
    const h = parseInt(genericMatch[1], 10);
    const m = parseInt(genericMatch[2], 10);
    if (h >= 0 && h < 24 && m >= 0 && m < 60) {
      return {
        timeStr: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
        hasExplicitTime: true,
      };
    }
  }

  return { timeStr: '15:00', hasExplicitTime: false };
}

// ------------------------------------------------------------------
// RESOLVE FOOD & METHOD AGAINST ANIMAL'S OPERATIONAL LIST
// ------------------------------------------------------------------
export function resolveFoodAndMethod(
  rawFeed: string,
  foodOptions: { value: string; label: string }[],
  methodOptions: { value: string; label: string }[]
): { foodItem: string; feedMethod: string; isMatched: boolean } {
  const cleanRaw = rawFeed.toLowerCase().trim();

  // 1. Resolve Food Item (including preparations like Yolked, Skinned, Whole)
  let matchedFood = '';

  const isChick = cleanRaw.includes('chick') || cleanRaw.includes('doc');
  const isYolked = cleanRaw.includes('yolk');
  const isSkinned = cleanRaw.includes('skin');
  const isWhole = cleanRaw.includes('whole');

  if (isChick) {
    if (isYolked) {
      const found = foodOptions.find(f => {
        const val = f.value.toLowerCase();
        return (val.includes('chick') || val.includes('doc')) && val.includes('yolk');
      });
      if (found) matchedFood = found.value;
    } else if (isSkinned) {
      const found = foodOptions.find(f => {
        const val = f.value.toLowerCase();
        return (val.includes('chick') || val.includes('doc')) && val.includes('skin');
      });
      if (found) matchedFood = found.value;
    } else if (isWhole) {
      const found = foodOptions.find(f => {
        const val = f.value.toLowerCase();
        return (val.includes('chick') || val.includes('doc')) && val.includes('whole');
      });
      if (found) matchedFood = found.value;
    }

    if (!matchedFood) {
      const found = foodOptions.find(f => {
        const val = f.value.toLowerCase();
        return val.includes('chick') || val.includes('doc');
      });
      if (found) matchedFood = found.value;
    }
  }

  // Quail, Mouse, Rat options
  if (!matchedFood) {
    if (cleanRaw.includes('quail')) {
      const found = foodOptions.find(f => f.value.toLowerCase().includes('quail'));
      if (found) matchedFood = found.value;
    } else if (cleanRaw.includes('mouse') || cleanRaw.includes('mice')) {
      if (cleanRaw.includes('fluff')) {
        const found = foodOptions.find(f => {
          const val = f.value.toLowerCase();
          return (val.includes('mouse') || val.includes('mice')) && val.includes('fluff');
        });
        if (found) matchedFood = found.value;
      }
      if (!matchedFood) {
        const found = foodOptions.find(f => f.value.toLowerCase().includes('mouse') || f.value.toLowerCase().includes('mice'));
        if (found) matchedFood = found.value;
      }
    } else if (cleanRaw.includes('rat')) {
      if (cleanRaw.includes('weaner')) {
        const found = foodOptions.find(f => {
          const val = f.value.toLowerCase();
          return val.includes('rat') && val.includes('weaner');
        });
        if (found) matchedFood = found.value;
      }
      if (!matchedFood) {
        const found = foodOptions.find(f => f.value.toLowerCase().includes('rat'));
        if (found) matchedFood = found.value;
      }
    }
  }

  // Generic fallback match
  if (!matchedFood) {
    for (const f of foodOptions) {
      const fLower = f.value.toLowerCase();
      if (cleanRaw.includes(fLower) || fLower.includes(cleanRaw)) {
        matchedFood = f.value;
        break;
      }
    }
  }

  if (!matchedFood && foodOptions.length > 0) {
    matchedFood = foodOptions[0].value;
  }

  // 2. Resolve Feed Method (strictly from methodOptions)
  let matchedMethod = '';
  for (const m of methodOptions) {
    const mLower = m.value.toLowerCase();
    const regex = new RegExp(`\\b${mLower}\\b`, 'i');
    if (regex.test(cleanRaw)) {
      matchedMethod = m.value;
      break;
    }
  }

  return {
    foodItem: matchedFood,
    feedMethod: matchedMethod,
    isMatched: Boolean(matchedFood),
  };
}

export function parseFeedString(
  rawFeed: string | undefined | null,
  rawTimeFed: any,
  foodOptions: { value: string; label: string }[] = [],
  methodOptions: { value: string; label: string }[] = []
): { feed: ParsedFeedItem; isMatched: boolean } | null {
  if (!rawFeed) return null;
  const feedText = String(rawFeed).trim();
  if (!feedText || feedText === '-' || feedText.toLowerCase() === 'none') return null;

  const match = feedText.match(/^(\d+(?:\s+\d+\/\d+|\/\d+|\.\d+)?)\s*(.*)$/);
  let quantity = 1;
  let foodDesc = feedText;

  if (match && match[1]) {
    quantity = parseFractionNumber(match[1]) ?? 1;
    foodDesc = match[2].trim();
  }

  const { foodItem, feedMethod, isMatched } = resolveFoodAndMethod(foodDesc, foodOptions, methodOptions);
  const { timeStr, hasExplicitTime } = normalizeFeedTime(rawTimeFed);

  return {
    feed: {
      raw: feedText,
      foodItem,
      feedMethod,
      quantity,
      unit: 'whole_item',
      outcome: 'EATEN',
      calci_dust_added: false,
      time: timeStr,
      isEstimatedTime: !hasExplicitTime,
    },
    isMatched,
  };
}

export function parseFacilitySheet(
  fileBuffer: ArrayBuffer,
  filename: string,
  animalsList: any[] = [],
  usersList: any[] = [],
  opLists: any[] = []
): ParsedFacilityRecord[] {
  const workbook = XLSX.read(fileBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  if (!rawRows || rawRows.length === 0) return [];

  let headerRowIdx = -1;
  const colMap: Record<string, number> = {};

  for (let r = 0; r < Math.min(rawRows.length, 15); r++) {
    const row = rawRows[r];
    if (!Array.isArray(row)) continue;

    const nameIdx = row.findIndex((cell: any) => String(cell).trim().toLowerCase() === 'name');
    if (nameIdx !== -1) {
      headerRowIdx = r;
      row.forEach((cell: any, cIdx: number) => {
        const h = String(cell).trim().toLowerCase();
        if (h === 'name') colMap['name'] = cIdx;
        else if (h.includes('species')) colMap['species'] = cIdx;
        else if (h.includes('latin')) colMap['latin'] = cIdx;
        else if (h.includes('weight')) colMap['weight'] = cIdx;
        else if (h.includes('cast')) colMap['cast'] = cIdx;
        else if (h.includes('flying') || h.includes('training')) colMap['training'] = cIdx;
        else if (h.includes('feed') && !h.includes('time')) colMap['feed'] = cIdx;
        else if (h.includes('time')) colMap['time_fed'] = cIdx;
        else if (h.includes('sign') || h.includes('initial')) colMap['sign_off'] = cIdx;
        else if (h.includes('activit')) colMap['activities'] = cIdx;
        else if (h.includes('note')) colMap['notes'] = cIdx;
      });
      break;
    }
  }

  if (headerRowIdx === -1) {
    headerRowIdx = 0;
    colMap['name'] = 0;
    colMap['species'] = 1;
    colMap['latin'] = 2;
    colMap['weight'] = 3;
    colMap['cast'] = 4;
    colMap['training'] = 5;
    colMap['feed'] = 6;
    colMap['time_fed'] = 7;
    colMap['sign_off'] = 8;
    colMap['activities'] = 9;
    colMap['notes'] = 10;
  }

  const sheetDate = parseSheetDateFromFilename(filename);
  const records: ParsedFacilityRecord[] = [];
  const STOP_KEYWORDS = ['date', 'weather', 'tempature', 'temperature', 'sign off', 'sign-off', 'signed', 'summary', 'total', 'notes:'];

  for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || !Array.isArray(row)) continue;

    const rawName = colMap['name'] !== undefined ? String(row[colMap['name']] || '').trim() : '';
    if (!rawName) continue;

    const lowerName = rawName.toLowerCase();

    // Stop at metadata block
    if (STOP_KEYWORDS.some((kw) => lowerName === kw || lowerName.startsWith(kw))) {
      break;
    }

    // Disregard stray numeric and fractional template rows
    const isPureNumber = /^(\d+(\.\d+|\s+\d+\/\d+|\/\d+)?)$/.test(rawName);
    if (isPureNumber || !/[a-zA-Z]/.test(rawName)) {
      continue;
    }

    const rawWeight = colMap['weight'] !== undefined ? row[colMap['weight']] : '';
    const rawFeed = colMap['feed'] !== undefined ? row[colMap['feed']] : '';
    const rawTimeFed = colMap['time_fed'] !== undefined ? row[colMap['time_fed']] : '';
    const rawCast = colMap['cast'] !== undefined ? String(row[colMap['cast']] || '').trim() : null;
    const rawTraining = colMap['training'] !== undefined ? String(row[colMap['training']] || '').trim() : null;
    const rawActivities = colMap['activities'] !== undefined ? String(row[colMap['activities']] || '').trim() : null;
    const rawNotes = colMap['notes'] !== undefined ? String(row[colMap['notes']] || '').trim() : null;
    const rawSignOff = colMap['sign_off'] !== undefined ? String(row[colMap['sign_off']] || '').trim() : null;

    // Specimen matching
    const cleanTarget = rawName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const matchedAnimal = animalsList.find((a: any) => {
      if (!a || !a.name) return false;
      const aName = a.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (aName === cleanTarget) return true;
      if (a.ring_number) {
        const aRing = a.ring_number.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (aRing === cleanTarget) return true;
      }
      return false;
    });

    const animalUnit = (matchedAnimal?.preferred_weight_unit || matchedAnimal?.weight_unit || 'oz').toLowerCase() as 'g' | 'oz' | 'lb' | 'kg';
    const animalCategory = (matchedAnimal?.category || '').toUpperCase().trim();

    // Filter operational lists for this animal's section
    const animalFoodOptions = opLists
      .filter((l: any) => {
        if (l.category?.toLowerCase() !== 'food_type') return false;
        const targetCategory = l.animal_category?.toUpperCase().trim();
        return targetCategory && animalCategory ? targetCategory.includes(animalCategory) : true;
      })
      .map((f: any) => ({ value: f.name, label: f.name }));

    const animalMethodOptions = opLists
      .filter((l: any) => {
        if (l.category?.toLowerCase() !== 'feed_method') return false;
        const targetCategory = l.animal_category?.toUpperCase().trim();
        return targetCategory && animalCategory ? targetCategory.includes(animalCategory) : true;
      })
      .map((f: any) => ({ value: f.name, label: f.name }));

    // Keeper matching from users table
    const keeperMatch = matchKeeper(rawSignOff, usersList);

    const weight = parseKeeperWeightToGrams(rawWeight, animalUnit);
    if (weight && rawCast) {
      weight.has_cast = true;
      weight.am_pm = rawCast.toUpperCase().includes('PM') ? 'PM' : 'AM';
    }

    const feedResult = parseFeedString(rawFeed, rawTimeFed, animalFoodOptions, animalMethodOptions);

    const warnings: string[] = [];
    if (!matchedAnimal) warnings.push('Unmatched specimen name');
    if (rawSignOff && !keeperMatch) warnings.push(`Unmatched keeper initials (${rawSignOff})`);
    if (feedResult && !feedResult.isMatched) warnings.push(`Unmatched food item in section list ("${rawFeed}")`);
    if (feedResult?.feed.isEstimatedTime) warnings.push('Feed time estimated (15:00)');
    if (rawWeight && !weight) warnings.push('Could not parse weight');

    const status: ParsedFacilityRecord['status'] = !matchedAnimal
      ? 'error'
      : warnings.length > 0
      ? 'warning'
      : 'valid';

    records.push({
      id: `record-${sheetDate}-${r}-${Date.now()}`,
      rawName,
      matchedAnimalId: matchedAnimal?.id ?? null,
      matchedAnimalName: matchedAnimal?.name ?? null,
      animalCategory,
      animalUnit,
      sheetDate,
      weight,
      feed: feedResult ? feedResult.feed : null,
      cast: rawCast || null,
      training: rawTraining || null,
      activity: rawActivities || null,
      keeperInitials: rawSignOff ? rawSignOff.toUpperCase() : null,
      matchedKeeperId: keeperMatch?.id ?? null,
      matchedKeeperName: keeperMatch?.name ?? null,
      notes: rawNotes || null,
      status,
      warnings,
    });
  }

  return records;
}