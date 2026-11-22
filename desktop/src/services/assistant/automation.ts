// Otomasyon kuralları: Sistem/Otomasyonlar.md. Basit ve güvenli: "şu zamanda → bildir ya da şu ekranı aç".
// Kurallar asistan tarafından kurulur ama her kural bu notta görünür, tek tek açılıp kapatılır/silinir. Kural yalnızca bildirim gösterir ya da bir ekranı açar;
// not silme, gönderme, yayınlama gibi işlemleri yapmaz.
export const RULES_PATH = 'Sistem/Otomasyonlar.md';

export type Sched =
  | { tur: 'gunluk'; saat: string }
  | { tur: 'haftalik'; gun: number; saat: string }   // gun: 1=Pzt ... 7=Paz
  | { tur: 'aylik'; gun: number; saat: string }      // gun: 1-31 (ayda o gün yoksa ayın son günü)
  | { tur: 'bir'; tarih: string; saat: string };     // YYYY-MM-DD
export type Eylem = { tur: 'bildir'; baslik: string; mesaj?: string } | { tur: 'ac'; ekran: string; mesaj?: string };
export interface Rule { id: string; ad: string; sched: Sched; eylem: Eylem; acik: boolean }

export const GUNLER = ['pzt', 'sal', 'car', 'per', 'cum', 'cmt', 'paz'];
const GUN_AD = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const clean = (s: string) => s.replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const fold = (s: string) => s.replace(/[İIı]/g, 'i').toLowerCase().replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u');
export const validTime = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const gunIndex = (s: string): number => { const i = GUNLER.indexOf(fold(s).slice(0, 3)); return i >= 0 ? i + 1 : 0; };

export const schedText = (s: Sched): string =>
  s.tur === 'gunluk' ? `her-gun ${s.saat}` : s.tur === 'haftalik' ? `haftalik ${GUNLER[s.gun - 1]} ${s.saat}` : s.tur === 'aylik' ? `aylik ${s.gun} ${s.saat}` : `bir ${s.tarih} ${s.saat}`;

export const parseSched = (txt: string): Sched | null => {
  // Model "9:00", "09.00", "10'u", "her ay" gibi serbest biçimler yazabiliyor; katı ayrıştırıcıya girmeden önce kanonik biçime çevrilir,
  // yoksa kural sessizce düşüyordu.
  const norm = fold(txt).replace(/\b(\d{1,2})[.:](\d{2})\b/g, (_m, h, mi) => `${h.padStart(2, '0')}:${mi}`)
    .replace(/^her[\s-]+ay(in)?\b/, 'aylik').replace(/^her[\s-]+hafta\b/, 'haftalik').replace(/^her[\s-]+gun\b/, 'her-gun')
    .replace(/(\d+)\s*(?:'|’)?\s*(?:inci|unda|inda|u|i|\.)(?=\s|$)/g, '$1').replace(/(?<![-\w])gunu?\b/g, ' ').replace(/[,]/g, ' ');
  const t = norm.trim().split(/\s+/);
  if ((t[0] === 'her-gun' || t[0] === 'gunluk') && validTime(t[1] || '')) return { tur: 'gunluk', saat: t[1] };
  if (t[0] === 'haftalik') { const g = gunIndex(t[1] || ''); if (g && validTime(t[2] || '')) return { tur: 'haftalik', gun: g, saat: t[2] }; }
  if (t[0] === 'aylik') { const g = Number(t[1]); if (Number.isInteger(g) && g >= 1 && g <= 31 && validTime(t[2] || '')) return { tur: 'aylik', gun: g, saat: t[2] }; }
  if (t[0] === 'bir' && /^\d{4}-\d{2}-\d{2}$/.test(t[1] || '') && validTime(t[2] || '')) return { tur: 'bir', tarih: t[1], saat: t[2] };
  return null;
};
export const schedLabel = (s: Sched): string =>
  s.tur === 'gunluk' ? `Her gün ${s.saat}` : s.tur === 'haftalik' ? `Her ${GUN_AD[s.gun - 1]} ${s.saat}` : s.tur === 'aylik' ? `Her ayın ${s.gun}'i ${s.saat}` : `${s.tarih} ${s.saat}`;

const eylemText = (e: Eylem) => (e.tur === 'bildir' ? `bildir ${clean(e.baslik)}${e.mesaj ? ` :: ${clean(e.mesaj)}` : ''}` : `ac ${clean(e.ekran)}${e.mesaj ? ` :: ${clean(e.mesaj)}` : ''}`);
const parseEylem = (txt: string): Eylem | null => {
  const m = /^(bildir|ac)\s+(.+?)(?:\s*::\s*(.+))?$/i.exec(txt.trim());
  if (!m) return null;
  return m[1].toLowerCase() === 'bildir' ? { tur: 'bildir', baslik: clean(m[2]).slice(0, 80), mesaj: m[3] ? clean(m[3]).slice(0, 160) : undefined } : { tur: 'ac', ekran: clean(m[2]).slice(0, 30), mesaj: m[3] ? clean(m[3]).slice(0, 160) : undefined };
};

// - Ad | zaman:haftalik pzt 09:00 | eylem:bildir Başlık :: mesaj | durum:acik
export const parseRules = (content: string | undefined): Rule[] => {
  const out: Rule[] = [];
  let n = 0;
  for (const raw of String(content || '').split(/\r?\n/)) {
    const m = raw.trim().match(/^[-*]\s+(.+)$/);
    if (!m) continue;
    const parts = m[1].split('|').map(s => s.trim());
    const ad = clean(parts[0] || '');
    let sched: Sched | null = null, eylem: Eylem | null = null, acik = true;
    for (const p of parts.slice(1)) {
      const kv = /^([a-zçğıöşü]+):\s*(.+)$/i.exec(p);
      if (!kv) continue;
      const k = fold(kv[1]);
      if (k === 'zaman') sched = parseSched(kv[2]);
      else if (k === 'eylem') eylem = parseEylem(kv[2]);
      else if (k === 'durum') acik = fold(kv[2]).startsWith('ac');
    }
    if (ad && sched && eylem) out.push({ id: `k${n++}`, ad: ad.slice(0, 60), sched, eylem, acik });
  }
  return out;
};
export const serializeRules = (rules: Rule[]): string =>
  '# Otomasyonlar\n\nAsistanın kurduğu kurallar. Her satır: ad | zaman | eylem | durum. Kurallar yalnızca bildirim gösterir ya da bir ekranı açar. Elle düzenleyebilir, "durum:kapali" yapabilir ya da silebilirsiniz.\n\n' +
  rules.map(r => `- ${clean(r.ad)} | zaman:${schedText(r.sched)} | eylem:${eylemText(r.eylem)} | durum:${r.acik ? 'acik' : 'kapali'}`).join('\n') + '\n';

export const addRule = (rules: Rule[], r: Omit<Rule, 'id'>): Rule[] => {
  if (rules.length >= 40) return rules;
  if (rules.some(x => fold(x.ad) === fold(r.ad) && schedText(x.sched) === schedText(r.sched))) return rules; // aynı kural iki kez eklenmez
  return [...rules, { ...r, id: `k${rules.length}` }];
};

const at = (y: number, mo: number, d: number, saat: string) => { const [h, mi] = saat.split(':').map(Number); return new Date(y, mo, d, h, mi, 0, 0); };

// "after" anından SONRAKİ ilk zaman (yoksa null: tek seferlik geçmişte kaldıysa)
// Aylık kuralda gün (29-31) o ayda yoksa kural ayın SON gününde çalışır; aksi halde kısa aylarda hiç tetiklenmezdi.
export const nextOccurrence = (s: Sched, after: Date): Date | null => {
  if (s.tur === 'bir') { const [y, m, d] = s.tarih.split('-').map(Number); const t = at(y, m - 1, d, s.saat); return t.getTime() > after.getTime() ? t : null; }
  for (let i = 0; i < 400; i++) {
    const d = new Date(after.getFullYear(), after.getMonth(), after.getDate() + i);
    const ok = s.tur === 'gunluk' || (s.tur === 'haftalik' && ((d.getDay() + 6) % 7) + 1 === s.gun) || (s.tur === 'aylik' && d.getDate() === Math.min(s.gun, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    if (!ok) continue;
    const t = at(d.getFullYear(), d.getMonth(), d.getDate(), s.saat);
    if (t.getTime() > after.getTime()) return t;
  }
  return null;
};

// (from, to] aralığındaki tüm zamanlar (en çok max)
export const occurrencesBetween = (s: Sched, from: Date, to: Date, max = 50): Date[] => {
  const out: Date[] = [];
  let cur = from;
  while (out.length < max) { const n = nextOccurrence(s, cur); if (!n || n.getTime() > to.getTime()) break; out.push(n); cur = n; }
  return out;
};

// Uygulama kapalıyken kaçan kurallar: (lastRun, now] aralığında zamanı gelmiş kurallar; her kural için yalnızca EN SON zamanı (yığılma olmasın)
export const dueRules = (rules: Rule[], lastRun: Date, now: Date): { rule: Rule; at: Date }[] => {
  const out: { rule: Rule; at: Date }[] = [];
  for (const r of rules) {
    if (!r.acik) continue;
    const list = occurrencesBetween(r.sched, lastRun, now, 400);
    if (list.length) out.push({ rule: r, at: list[list.length - 1] });
  }
  return out;
};
