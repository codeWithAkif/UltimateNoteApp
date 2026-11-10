// Gezi / hafta sonu planlayıcı: tür seçimi -> kısa soru-cevap (+ hava durumu) -> 3 öneri -> seçilene saatli rota -> sayfaya yazma.
// Sorular sabittir (anında, ücretsiz); öneri ve rota yapay zekâ + web aramasıyla üretilir. Ayrıştırma/markdown saf fonksiyonlardır.
import { callGeminiGroundedText } from './geminiMentor';
import { normalizeTr } from './meetingBriefing';
import { mapsRouteUrl, mapsSearchUrl, type Stop } from './errandPlanner';
import { dowName, ymd, weatherLine, type DayWeather } from './weather';

export type TripKind = 'haftasonu' | 'kisa' | 'tatil' | 'eglence' | 'spor';

export const TRIP_KINDS: { key: TripKind; label: string; emoji: string; hint: string }[] = [
  { key: 'haftasonu', label: 'Hafta sonu', emoji: '🌤️', hint: 'Hava ve isteğinize göre günü planlar' },
  { key: 'kisa', label: 'Kısa gezi', emoji: '🚗', hint: 'Günübirlik ya da 1-2 gece' },
  { key: 'tatil', label: 'Tatil', emoji: '🏖️', hint: 'Birkaç günlük, daha uzak' },
  { key: 'eglence', label: 'Eğlence', emoji: '🎉', hint: 'Akşam, sinema, konser, yemek' },
  { key: 'spor', label: 'Spor', emoji: '🏃', hint: 'Koşu, bisiklet, yüzme, doğa' }
];

export interface Question { id: string; text: string; options: string[]; multi?: boolean }

const WHEN_NEAR = ['Bu hafta sonu', 'Yarın', 'Bugün', 'Gelecek hafta sonu'];
const WHO = ['Tek başıma', 'Eşimle / partnerimle', 'Arkadaşlarla', 'Çocuklu aile'];
const HOW = ['Kendi aracımla', 'Toplu taşıma', 'Yürüyüş / bisiklet'];
const BUDGET = ['Düşük', 'Orta', 'Fark etmez'];

export const questionsFor = (kind: TripKind): Question[] => {
  switch (kind) {
    case 'haftasonu':
      return [
        { id: 'zaman', text: 'Ne zaman?', options: ['Bu hafta sonu', 'Gelecek hafta sonu'] },
        { id: 'kim', text: 'Kiminle?', options: WHO },
        { id: 'ulasim', text: 'Ulaşım?', options: HOW },
        { id: 'sure', text: 'Ne kadar zamanınız var?', options: ['Yarım gün', 'Tam gün', 'İki gün (Cumartesi–Pazar)'] },
        { id: 'mesafe', text: 'Ne kadar uzağa?', options: ['Yakın (1 saate kadar)', 'Orta (1-3 saat)', 'Uzak olabilir'] },
        { id: 'ilgi', text: 'Ne istersiniz?', options: ['Doğa / yürüyüş', 'Tarih / kültür', 'Yeme-içme', 'Deniz / plaj', 'Dinlenme / spa', 'Alışveriş', 'Aktivite / macera'], multi: true },
        { id: 'butce', text: 'Bütçe?', options: BUDGET }
      ];
    case 'kisa':
      return [
        { id: 'zaman', text: 'Ne zaman?', options: ['Bu hafta sonu', 'Gelecek hafta sonu', 'Yarın', 'Bugün'] },
        { id: 'kim', text: 'Kiminle?', options: WHO },
        { id: 'ulasim', text: 'Ulaşım?', options: HOW },
        { id: 'sure', text: 'Süre?', options: ['Günübirlik', '1 gece', '2 gece'] },
        { id: 'mesafe', text: 'Ne kadar uzağa?', options: ['Yakın (1 saate kadar)', 'Orta (1-3 saat)', 'Uzak olabilir'] },
        { id: 'ilgi', text: 'Ne istersiniz?', options: ['Doğa / yürüyüş', 'Tarih / kültür', 'Yeme-içme', 'Deniz / plaj', 'Dinlenme / spa', 'Aktivite / macera'], multi: true },
        { id: 'butce', text: 'Bütçe?', options: BUDGET }
      ];
    case 'tatil':
      return [
        { id: 'zaman', text: 'Ne zaman?', options: ['Önümüzdeki 2 hafta', 'Bu ay', 'Gelecek ay', 'Belli değil'] },
        { id: 'kim', text: 'Kiminle?', options: WHO },
        { id: 'sure', text: 'Kaç gün?', options: ['3-4 gün', '5-7 gün', '1 hafta ve üstü'] },
        { id: 'mesafe', text: 'Nereye?', options: ['Türkiye içi', 'Yurt dışı', 'Fark etmez'] },
        { id: 'ilgi', text: 'Nasıl bir tatil?', options: ['Deniz / plaj', 'Doğa', 'Şehir turu / kültür', 'Dinlenme / spa', 'Macera', 'Yeme-içme'], multi: true },
        { id: 'butce', text: 'Bütçe?', options: BUDGET }
      ];
    case 'eglence':
      return [
        { id: 'zaman', text: 'Ne zaman?', options: ['Bugün', 'Yarın', 'Bu hafta sonu', 'Gelecek hafta sonu'] },
        { id: 'kim', text: 'Kiminle?', options: WHO },
        { id: 'ulasim', text: 'Ulaşım?', options: HOW },
        { id: 'sure', text: 'Ne zaman?', options: ['Öğleden sonra', 'Akşam / gece', 'Tam gün'] },
        { id: 'ilgi', text: 'Ne istersiniz?', options: ['Sinema / tiyatro', 'Konser / müzik', 'Restoran / kafe', 'Oyun / eğlence merkezi', 'Sokak / çarşı gezmek', 'Sakin bir akşam'], multi: true },
        { id: 'butce', text: 'Bütçe?', options: BUDGET }
      ];
    case 'spor':
      return [
        { id: 'zaman', text: 'Ne zaman?', options: ['Bugün', 'Yarın', 'Bu hafta sonu', 'Gelecek hafta sonu'] },
        { id: 'kim', text: 'Kiminle?', options: ['Tek başıma', 'Arkadaşlarla', 'Aile ile'] },
        { id: 'ulasim', text: 'Ulaşım?', options: HOW },
        { id: 'sure', text: 'Ne kadar süre?', options: ['1-2 saat', 'Yarım gün', 'Tam gün'] },
        { id: 'ilgi', text: 'Hangi spor?', options: ['Koşu / yürüyüş', 'Bisiklet', 'Yüzme', 'Salon / fitness', 'Takım sporu', 'Doğa sporları', 'Yoga / pilates'], multi: true }
      ];
  }
};

export type Answers = Record<string, string[]>;
export const kindLabel = (k: TripKind) => TRIP_KINDS.find(x => x.key === k)?.label || k;

export const travelModeOf = (answers: Answers): 'driving' | 'transit' | 'walking' => {
  const u = (answers.ulasim?.[0] || '').toLocaleLowerCase('tr');
  if (u.startsWith('toplu')) return 'transit';
  if (u.startsWith('yürüyüş')) return 'walking';
  return 'driving';
};

export interface Suggestion { title: string; where: string; distance: string; why: string; budget: string; weatherNote: string }
export interface Step { time: string; name: string; address: string; what: string; note: string }

const blank = (s: string) => {
  const t = (s || '').trim();
  return /^[-–—?]*$/.test(t) ? '' : t;
};
const clean = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/\[\d+(?:,\s*\d+)*\]/g, '').trim();

export const answersText = (kind: TripKind, answers: Answers, extra: string): string => {
  const lines = questionsFor(kind)
    .map(q => (answers[q.id] && answers[q.id].length ? `- ${q.text} ${answers[q.id].join(', ')}` : ''))
    .filter(Boolean);
  if (extra.trim()) lines.push(`- Ek istek: ${extra.trim()}`);
  return lines.join('\n');
};

export const weatherBlock = (days: DayWeather[], dates: string[]): string => {
  const picked = days.filter(d => dates.includes(d.date));
  return picked.length ? picked.map(weatherLine).join('\n') : '(Hava tahmini alınamadı ya da bu tarih için yok; mevsime göre değerlendir.)';
};

export const buildSuggestPrompt = (o: { kind: TripKind; location: string; answers: Answers; extra: string; weather: string; now: Date; avoid?: string[] }): string =>
  `Sen kullanıcının ${kindLabel(o.kind).toLowerCase()} planını yapan bir yardımcısın. Kullanıcının konumu: "${o.location}". Bugün ${dowName(ymd(o.now))} ${ymd(o.now)}.
Hava tahmini:
${o.weather}

Kullanıcının cevapları:
${answersText(o.kind, o.answers, o.extra)}
${o.avoid && o.avoid.length ? `\nBunları ZATEN önerdin, tekrar etme: ${o.avoid.join('; ')}\n` : ''}
Google aramasını kullanarak GERÇEKTEN var olan, kullanıcının cevaplarına ve havaya uyan 3 farklı öneri ver (biri daha rahat/yakın, biri daha farklı/keşif olsun). Hava açık hava için elverişsizse kapalı alan ağırlıklı öner. Spor için ilgili spora uygun yer ve rota öner. Yer ya da bilgi UYDURMA; emin olmadığını yazma.
Çıktıyı SADECE şu satır biçiminde ver, başka metin ekleme:
ÖNERİ | <başlık> | <nerede: semt/ilçe/şehir> | <konumdan yaklaşık uzaklık ve ulaşım süresi> | <neden bu, 1-2 cümle> | <tahmini bütçe: Düşük, Orta ya da Yüksek> | <hava uyumu notu, kısa>`;

export const parseSuggestions = (text: string): Suggestion[] => {
  const out: Suggestion[] = [];
  text.split('\n').forEach(raw => {
    const line = raw.replace(/^[\s*\-•\d.)]+(?=(ÖNERİ|ONERI)\s*\|)/i, '').trim();
    if (!/^[ÖO]NERİ\s*\|/i.test(line) && !/^ONERI\s*\|/i.test(line)) return;
    const [, title, where, distance, why, budget, weatherNote] = line.split('|').map(x => clean(x));
    if (title) out.push({ title, where: blank(where), distance: blank(distance), why: blank(why), budget: blank(budget), weatherNote: blank(weatherNote) });
  });
  return out.slice(0, 4);
};

export const buildItineraryPrompt = (o: { kind: TripKind; location: string; answers: Answers; extra: string; weather: string; now: Date; pick: Suggestion }): string =>
  `Sen kullanıcının ${kindLabel(o.kind).toLowerCase()} planını yapan bir yardımcısın. Kullanıcının konumu: "${o.location}". Bugün ${dowName(ymd(o.now))} ${ymd(o.now)}.
Kullanıcı şu öneriyi seçti: "${o.pick.title}" (${o.pick.where}).
Hava tahmini:
${o.weather}

Kullanıcının cevapları:
${answersText(o.kind, o.answers, o.extra)}

Google aramasını kullanarak bu öneri için SAATLİ, gerçek duraklardan oluşan bir rota hazırla: çıkış saatinden dönüşe kadar sıralı adımlar (en fazla 8 adım; yemek ve dinlenme araları dahil). Her adımda gerçekten var olan yeri ve adresini yaz; uydurma. Süre, mesafe ve çalışma saatleri mantıklı olsun; çok günlük planda her günü ayrı adımlar olarak, saat alanına "1. gün 09:00" gibi yaz. Hava elverişsizse yağmur için alternatif adımı NOT ile belirt. Ücret/rezervasyon gibi önemli bilgileri not alanına yaz.
Çıktıyı SADECE şu satır biçiminde ver, başka metin ekleme:
ADIM | <saat aralığı> | <yer adı> | <semt ve açık adres> | <ne yapılır, 1 cümle> | <not: ücret, rezervasyon, çalışma saati; yoksa ->
Sonra en fazla 3 satır:
NOT | <ulaşım, kıyafet, yağmur alternatifi gibi önemli bir uyarı>`;

export const parseItinerary = (text: string): { steps: Step[]; notes: string[] } => {
  const steps: Step[] = [];
  const notes: string[] = [];
  text.split('\n').forEach(raw => {
    const line = raw.replace(/^[\s*\-•\d.)]+(?=(ADIM|NOT)\b)/i, '').trim();
    if (/^ADIM\s*\|/i.test(line)) {
      const [, time, name, address, what, note] = line.split('|').map(x => clean(x));
      if (name) steps.push({ time: blank(time), name, address: blank(address), what: blank(what), note: blank(note) });
    } else if (/^NOT\s*\|/i.test(line)) {
      const n = clean(line.replace(/^NOT\s*\|/i, ''));
      if (n) notes.push(n);
    }
  });
  return { steps: steps.slice(0, 12), notes: notes.slice(0, 3) };
};

export const stepsToStops = (steps: Step[]): Stop[] =>
  steps.filter(s => s.name).map(s => ({ name: s.name, address: s.address, errandNumbers: [], why: s.what }));

export const GEZI_PAGE_PATH = 'Asistan/Gezi.md';

export const tripMarkdown = (o: {
  now: Date; kind: TripKind; location: string; answers: Answers; extra: string; weather: string;
  pick: Suggestion; steps: Step[]; notes: string[];
}): string => {
  const { now, kind, location, answers, extra, weather, pick, steps, notes } = o;
  const stops = stepsToStops(steps);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${ymd(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  let md = `# ${kindLabel(kind)}: ${pick.title}\n\nOluşturma: ${stamp} · Çıkış: ${location}${pick.where ? ` · Yer: ${pick.where}` : ''}\n`;
  if (pick.distance) md += `Uzaklık: ${pick.distance}\n`;
  md += '\n';
  if (stops.length) md += `[Tüm rotayı Haritalar'da aç](${mapsRouteUrl(stops, location, travelModeOf(answers))})\n\n`;
  if (pick.why) md += `${pick.why}\n\n`;
  if (weather && !weather.startsWith('(')) md += `## Hava\n${weather.split('\n').map(l => `- ${l}`).join('\n')}\n\n`;
  md += `## Plan\n`;
  steps.forEach(s => {
    md += `- **${s.time ? `${s.time} · ` : ''}${s.name}**${s.address ? ` — ${s.address}` : ''} · [Harita](${mapsSearchUrl({ name: s.name, address: s.address, errandNumbers: [], why: '' }, location)})\n`;
    if (s.what) md += `  - ${s.what}\n`;
    if (s.note) md += `  - Not: ${s.note}\n`;
  });
  if (notes.length) md += `\n## Notlar\n${notes.map(n => `- ${n}`).join('\n')}\n`;
  const ans = answersText(kind, answers, extra);
  if (ans) md += `\n## Tercihleriniz\n${ans}\n`;
  md += `\n> Yer, saat ve fiyat bilgileri web aramasından geldi ve hatalı olabilir; gitmeden doğrulayın.\n`;
  return md;
};

// Gezi arşivi: her seçilen plan tarihli bir nota da kaydedilir; en sonuncusu ayrıca sabit Gezi.md sayfasındadır.
export const archivePath = (now: Date, title: string): string => {
  const safe = title.replace(/[\\/:*?"<>|#\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) || 'Gezi';
  return `Asistan/Geziler/${ymd(now)} ${safe}.md`;
};

export const suggestTrips = async (o: Parameters<typeof buildSuggestPrompt>[0]): Promise<{ suggestions: Suggestion[]; raw: string }> => {
  const raw = await callGeminiGroundedText(buildSuggestPrompt(o));
  return { suggestions: parseSuggestions(raw), raw };
};

export const planItinerary = async (o: Parameters<typeof buildItineraryPrompt>[0]): Promise<{ steps: Step[]; notes: string[]; raw: string }> => {
  const raw = await callGeminiGroundedText(buildItineraryPrompt(o));
  return { ...parseItinerary(raw), raw };
};

export const sameTitle = (a: string, b: string) => normalizeTr(a) === normalizeTr(b);
