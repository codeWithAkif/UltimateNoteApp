// Hava durumu: ücretsiz, anahtarsız Open-Meteo servisi (konum adı -> koordinat -> günlük tahmin). Yalnızca konum adı ve koordinat
// gönderilir. Ağ hatası olursa çağıran taraf havasız devam eder; hiçbir özellik buna bağlı kalmaz.

export interface DayWeather {
  date: string; // YYYY-MM-DD
  code: number;
  tmax: number;
  tmin: number;
  rainChance: number; // %
  wind: number; // km/sa
}
export interface GeoPoint { lat: number; lon: number; name: string }

export const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// "Taşdelen, Çekmeköy, İstanbul" gibi bir metinde Open-Meteo yalnızca tek bir yer adını bilir ve aynı adlı başka şehirdeki yeri
// getirebilir (Taşdelen -> Malatya). Bu yüzden her parça ayrı aranır, sonuçlar ÖTEKİ parçalarla (il/ilçe) eşleşiyorsa kabul edilir.
export const geocodeParts = (location: string): string[] => location.split(',').map(p => p.trim()).filter(Boolean);

const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/[^a-z0-9]+/g, ' ').trim();

// Sonuçlar arasında il/ilçe bilgisi diğer parçalardan biriyle örtüşeni seçer; yoksa null.
export const pickGeoResult = (results: any[], others: string[]): any | null => {
  const want = others.map(norm).filter(Boolean);
  if (want.length === 0) return null;
  return results.find(r => {
    const fields = [r.admin1, r.admin2, r.admin3, r.admin4, r.name].filter(Boolean).map(norm);
    return want.some(w => fields.some(f => f === w || f.includes(w) || w.includes(f)));
  }) || null;
};

async function geoSearch(q: string): Promise<any[]> {
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=tr&format=json`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.results) ? data.results : [];
  } catch { return []; }
}

export async function geocode(location: string): Promise<GeoPoint | null> {
  const parts = geocodeParts(location);
  const toPoint = (r: any, fallback: string): GeoPoint | null =>
    r && typeof r.latitude === 'number' && typeof r.longitude === 'number' ? { lat: r.latitude, lon: r.longitude, name: r.name || fallback } : null;
  let lastResults: any[] = [];
  for (let i = 0; i < parts.length; i++) {
    const results = await geoSearch(parts[i]);
    if (i === parts.length - 1) lastResults = results;
    const hit = pickGeoResult(results, parts.filter((_, k) => k !== i));
    const p = toPoint(hit, parts[i]);
    if (p) return p;
  }
  // Hiçbir parça diğerini doğrulamadıysa (tek parça ya da il adı) en genel parçanın ilk sonucu.
  return toPoint(lastResults[0], parts[parts.length - 1] || location);
}

export const parseForecast = (data: any): DayWeather[] => {
  const d = data?.daily;
  if (!d || !Array.isArray(d.time)) return [];
  return d.time.map((date: string, i: number) => ({
    date,
    code: Number(d.weather_code?.[i] ?? 0),
    tmax: Math.round(Number(d.temperature_2m_max?.[i] ?? 0)),
    tmin: Math.round(Number(d.temperature_2m_min?.[i] ?? 0)),
    rainChance: Math.round(Number(d.precipitation_probability_max?.[i] ?? 0)),
    wind: Math.round(Number(d.wind_speed_10m_max?.[i] ?? 0))
  }));
};

export async function fetchForecast(p: GeoPoint): Promise<DayWeather[]> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=auto&forecast_days=14`
    );
    if (!res.ok) return [];
    return parseForecast(await res.json());
  } catch { return []; }
}

export const describeCode = (c: number): string => {
  if (c === 0) return 'açık';
  if (c <= 2) return 'az bulutlu';
  if (c === 3) return 'kapalı';
  if (c === 45 || c === 48) return 'sisli';
  if (c >= 51 && c <= 57) return 'çisenti';
  if (c >= 61 && c <= 67) return 'yağmurlu';
  if (c >= 71 && c <= 77) return 'karlı';
  if (c >= 80 && c <= 82) return 'sağanak yağışlı';
  if (c >= 85 && c <= 86) return 'kar sağanaklı';
  if (c >= 95) return 'fırtınalı';
  return 'değişken';
};

// Dışarıda vakit geçirmeye uygun mu? (kaba bir işaret; yalnızca öneri metnine bilgi olarak girer)
export const outdoorFriendly = (w: DayWeather): boolean =>
  w.rainChance < 40 && w.code < 61 && w.tmax >= 8 && w.tmax <= 33 && w.wind < 40;

const DOW = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
export const dowName = (date: string): string => DOW[new Date(`${date}T12:00:00`).getDay()];

export const weatherLine = (w: DayWeather): string =>
  `${dowName(w.date)} ${w.date}: ${describeCode(w.code)}, ${w.tmin}–${w.tmax}°C, yağış olasılığı %${w.rainChance}, rüzgâr ${w.wind} km/sa (${outdoorFriendly(w) ? 'açık hava için uygun' : 'açık hava için elverişsiz olabilir'})`;

// "Bu hafta sonu": bugün Cumartesi ise Cumartesi+Pazar, Pazar ise yalnızca bugün, değilse gelecek Cumartesi+Pazar.
export const upcomingWeekend = (now: Date, weeksAhead = 0): string[] => {
  const dow = now.getDay();
  let sat: Date;
  if (dow === 6) sat = now; else if (dow === 0) return weeksAhead === 0 ? [ymd(now)] : [ymd(addDays(now, 6 + 7 * (weeksAhead - 1))), ymd(addDays(now, 7 + 7 * (weeksAhead - 1)))];
  else sat = addDays(now, 6 - dow);
  sat = addDays(sat, 7 * weeksAhead);
  return [ymd(sat), ymd(addDays(sat, 1))];
};

export const datesForWhen = (when: string, now: Date): string[] => {
  const w = when.toLocaleLowerCase('tr');
  if (w.startsWith('bugün')) return [ymd(now)];
  if (w.startsWith('yarın')) return [ymd(addDays(now, 1))];
  if (w.startsWith('gelecek hafta sonu') || w.startsWith('önümüzdeki hafta sonu')) return upcomingWeekend(now, 1);
  if (w.startsWith('bu hafta sonu')) return upcomingWeekend(now, 0);
  return [];
};
