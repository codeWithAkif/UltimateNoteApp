// Bütçe Planı: aylık gelir, sabit giderler, kart ekstreleri ve değişken harcamalar. Bu dosyada yalnızca saf mantık var (yapay zekâ yok):
// not biçimi (okunur/ayrıştırılır), toplamlar, nakit takvimi, kartsız geçiş hesabı, yapay zekâ eylemlerinin doğrulanması ve gizli bilgi temizleme.
// Rakamları HER ZAMAN bu kod hesaplar; yapay zekâ yalnızca kullanıcının söylediğini kalem önerisine çevirir ve yorumlar.
// Veri kasada aylık nota yazılır (Finans/Bütçe/YYYY-MM.md): notlar gibi senkronlanır, elle de okunup düzenlenebilir.

export type BudgetKind = 'gelir' | 'sabit' | 'kart' | 'degisken';

export interface BudgetItem {
  id: string;
  kind: BudgetKind;
  name: string;
  amount: number;
  day?: number;                              // ayın kaçıncı günü (gelir: yattığı gün, gider/kart: ödeme/son ödeme günü)
  taksit?: { left: number; total: number };  // yalnızca sabit: kalan/toplam taksit
  taksitAmount?: number;                     // yalnızca kart: ekstredeki taksitli (kaydırılamayan) kısım
}

export interface Budget { month: string; items: BudgetItem[]; reservePct: number }

export const KIND_LABEL: Record<BudgetKind, string> = { gelir: 'Gelir', sabit: 'Sabit gider', kart: 'Kart ekstresi', degisken: 'Değişken harcama' };
export const KIND_ORDER: BudgetKind[] = ['gelir', 'sabit', 'kart', 'degisken'];
const SECTION_TITLE: Record<BudgetKind, string> = { gelir: 'Gelir', sabit: 'Sabit giderler', kart: 'Kart ekstreleri', degisken: 'Değişken harcamalar (tahmini)' };

export const BUDGET_FOLDER = 'Finans/Bütçe';
export const monthPath = (month: string): string => `${BUDGET_FOLDER}/${month}.md`;
export const isMonth = (s: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const monthOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthOf(d);
};
export const daysIn = (month: string): number => { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate(); };
export const monthLabel = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
};

export const round2 = (n: number): number => Math.round(n * 100) / 100;

// Kullanıcının yazdığı tutar ("45.000", "45000,50", "1.250,75 TL", "₺ 3 200") -> sayı. Geçersizse null.
export const parseTL = (raw: string): number | null => {
  let s = String(raw ?? '').replace(/[₺\s]|TL|tl|try/gi, '');
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.250,75 / 45.000
  else s = s.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export const fmtTL = (n: number): string => {
  const v = round2(n);
  return `${v.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₺`;
};

// ---------------- not biçimi ----------------
// - Ad | tutar | gün:5 | taksit:3/9 | taksitli:4000
const num = (s: string): number => { const v = Number(String(s).trim().replace(',', '.')); return Number.isFinite(v) ? v : NaN; };

export const parseBudgetNote = (content: string | undefined, month: string): Budget | null => {
  if (!content || !content.trim()) return null;
  const b: Budget = { month, items: [], reservePct: 5 };
  let kind: BudgetKind | null = null;
  const counters: Record<BudgetKind, number> = { gelir: 0, sabit: 0, kart: 0, degisken: 0 };
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    const rp = line.match(/^Beklenmeyenler payı:\s*%?\s*([\d.,]+)/i);
    if (rp) { const v = num(rp[1]); if (Number.isFinite(v) && v >= 0 && v <= 50) b.reservePct = v; continue; }
    const h = line.match(/^##\s+(.*)$/);
    if (h) {
      const t = h[1].toLowerCase();
      kind = t.startsWith('gelir') ? 'gelir' : t.startsWith('sabit') ? 'sabit' : t.startsWith('kart') ? 'kart' : t.startsWith('değişken') || t.startsWith('degisken') ? 'degisken' : null;
      continue;
    }
    if (!kind || !line.startsWith('- ')) continue;
    const parts = line.slice(2).split('|').map(s => s.trim());
    if (parts.length < 2 || !parts[0]) continue;
    const amount = num(parts[1]);
    if (!Number.isFinite(amount)) continue;
    const it: BudgetItem = { id: `${kind}-${counters[kind]++}`, kind, name: parts[0], amount };
    for (const p of parts.slice(2)) {
      const kv = p.match(/^([a-zçğıöşü]+):\s*(.+)$/i);
      if (!kv) continue;
      const k = kv[1].toLowerCase();
      if (k === 'gün' || k === 'gun') { const d = Math.round(num(kv[2])); if (d >= 1 && d <= 31) it.day = d; }
      else if (k === 'taksit') { const m = kv[2].match(/^(\d+)\s*\/\s*(\d+)$/); if (m) it.taksit = { left: Number(m[1]), total: Number(m[2]) }; }
      else if (k === 'taksitli') { const v = num(kv[2]); if (Number.isFinite(v) && v >= 0) it.taksitAmount = v; }
    }
    b.items.push(it);
  }
  return b;
};

export const serializeBudget = (b: Budget): string => {
  const out: string[] = [`# Bütçe ${b.month}`, '', `Beklenmeyenler payı: %${b.reservePct}`, ''];
  for (const k of KIND_ORDER) {
    out.push(`## ${SECTION_TITLE[k]}`);
    for (const it of b.items.filter(i => i.kind === k && i.name.trim())) { // adı boş (henüz doldurulmamış) satırlar nota yazılmaz
      const bits = [it.name.replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim(), String(round2(it.amount))];
      if (it.day) bits.push(`gün:${it.day}`);
      if (it.kind === 'sabit' && it.taksit) bits.push(`taksit:${it.taksit.left}/${it.taksit.total}`);
      if (it.kind === 'kart' && it.taksitAmount) bits.push(`taksitli:${round2(it.taksitAmount)}`);
      out.push(`- ${bits.join(' | ')}`);
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
};

export const reindex = (items: BudgetItem[]): BudgetItem[] => {
  const c: Record<BudgetKind, number> = { gelir: 0, sabit: 0, kart: 0, degisken: 0 };
  return items.map(i => ({ ...i, id: `${i.kind}-${c[i.kind]++}` }));
};

// Yeni ay: gelirler ve sabit giderler önceki aydan gelir; taksitler bir azalır (bitenler düşer). Kart ve değişken kalemler taşınmaz.
export const rollover = (prev: Budget, month: string): Budget => {
  const items: BudgetItem[] = [];
  for (const it of prev.items) {
    if (it.kind === 'gelir') items.push({ ...it });
    else if (it.kind === 'sabit') {
      if (it.taksit) { if (it.taksit.left > 1) items.push({ ...it, taksit: { left: it.taksit.left - 1, total: it.taksit.total } }); }
      else items.push({ ...it });
    }
  }
  return { month, reservePct: prev.reservePct, items: reindex(items) };
};

export const emptyBudget = (month: string): Budget => ({ month, items: [], reservePct: 5 });

// ---------------- hesaplar ----------------
export interface Totals { gelir: number; sabit: number; kart: number; degisken: number; reserve: number; gider: number; kalan: number }
const sum = (b: Budget, k: BudgetKind) => b.items.filter(i => i.kind === k).reduce((s, i) => s + (Number.isFinite(i.amount) ? i.amount : 0), 0);
export const totals = (b: Budget): Totals => {
  const gelir = sum(b, 'gelir'), sabit = sum(b, 'sabit'), kart = sum(b, 'kart'), degisken = sum(b, 'degisken');
  const reserve = round2(gelir * (b.reservePct || 0) / 100);
  const gider = round2(sabit + kart + degisken + reserve);
  return { gelir: round2(gelir), sabit: round2(sabit), kart: round2(kart), degisken: round2(degisken), reserve, gider, kalan: round2(gelir - gider) };
};

// Nakit takvimi: gün gün bakiye. Günü yazılmayan kalemler ayın 1'inde varsayılır; değişken harcama ve beklenmeyenler payı aya eşit yayılır.
export interface CashPoint { day: number; balance: number; events: string[] }
export interface Cashflow { points: CashPoint[]; min: { day: number; balance: number }; negativeDays: number[]; undated: string[] }
export const cashflow = (b: Budget): Cashflow => {
  const n = daysIn(b.month);
  const t = totals(b);
  const delta = new Array(n + 1).fill(0) as number[];
  const events: string[][] = Array.from({ length: n + 1 }, () => []);
  const undated: string[] = [];
  for (const it of b.items) {
    if (it.kind === 'degisken') continue;
    const d = Math.min(Math.max(it.day || 1, 1), n);
    if (!it.day) undated.push(it.name);
    const sign = it.kind === 'gelir' ? 1 : -1;
    delta[d] += sign * it.amount;
    events[d].push(`${it.kind === 'gelir' ? '+' : '−'}${fmtTL(it.amount)} ${it.name}`);
  }
  const daily = (t.degisken + t.reserve) / n;
  const points: CashPoint[] = [];
  let bal = 0;
  let min = { day: 1, balance: Infinity };
  const neg: number[] = [];
  for (let d = 1; d <= n; d++) {
    bal += delta[d] - daily;
    const p = { day: d, balance: round2(bal), events: events[d] };
    points.push(p);
    if (p.balance < min.balance) min = { day: d, balance: p.balance };
    if (p.balance < 0) neg.push(d);
  }
  return { points, min: min.balance === Infinity ? { day: 1, balance: 0 } : min, negativeDays: neg, undated };
};

// "Plan dışı günlük pay": kalan ÷ ayın kalan günleri (bugün dahil). Bütçe zaten değişken harcamayı içerir; bu, onun üstünde harcanabilecek rahat paydır.
export const dailyAllowance = (b: Budget, today: Date): number | null => {
  if (monthOf(today) !== b.month) return null;
  const left = daysIn(b.month) - today.getDate() + 1;
  const k = totals(b).kalan;
  return left > 0 && k > 0 ? round2(k / left) : 0;
};

// ---------------- kartsız geçiş ----------------
// Her ay kart harcamasının bir kısmı nakde/banka kartına çevrilirse, o ayki ek yük = çevrilen tutar. Aylık kalan (artan) bu yükü karşılayabildiği sürece geçiş sürer.
// Taksitli kısım kartta kalır (bitene kadar kaydırılamaz). Kartlar küçükten büyüğe sırayla kapanır.
export interface TransitionMonth { ay: number; kayan: number; kartKalan: number }
export interface CardClose { name: string; ay: number | null; taksitKalan: number }
export interface TransitionResult { shiftable: number; months: TransitionMonth[]; bitis: number | null; kapanis: CardClose[]; sabitKartYuku: number; neden?: string }
export const transition = (b: Budget, opt: { tampon?: number; kisinti?: number } = {}): TransitionResult => {
  const cards = b.items.filter(i => i.kind === 'kart').map(c => ({ name: c.name, shift: Math.max(0, c.amount - (c.taksitAmount || 0)), taksit: c.taksitAmount || 0 }))
    .sort((a, c) => a.shift - c.shift);
  const shiftable = round2(cards.reduce((s, c) => s + c.shift, 0));
  const sabitKartYuku = round2(cards.reduce((s, c) => s + c.taksit, 0));
  const kalan = Math.max(0, totals(b).kalan) + Math.max(0, opt.kisinti || 0);
  const tampon = Math.max(0, opt.tampon || 0);
  const res: TransitionResult = { shiftable, months: [], bitis: null, kapanis: cards.map(c => ({ name: c.name, ay: null, taksitKalan: c.taksit })), sabitKartYuku };
  if (shiftable <= 0) { res.bitis = 0; res.kapanis.forEach(c => { c.ay = 0; }); return res; }
  if (kalan <= 0 && tampon <= 0) { res.neden = 'Aylık kalan sıfır ya da eksi; önce harcama kısıntısı ya da tampon gerekir.'; return res; }
  let remaining = cards.map(c => c.shift);
  let ay = 0;
  while (remaining.reduce((s, x) => s + x, 0) > 0.009 && ay < 120) {
    ay++;
    let budget = kalan + (ay === 1 ? tampon : 0);
    if (budget <= 0) { res.neden = 'Aylık kalan yetmiyor.'; return res; }
    let moved = 0;
    for (let i = 0; i < remaining.length && budget > 0; i++) {
      const take = Math.min(remaining[i], budget);
      remaining[i] = round2(remaining[i] - take); budget = round2(budget - take); moved = round2(moved + take);
      if (remaining[i] <= 0.009 && res.kapanis[i].ay === null) res.kapanis[i].ay = ay;
    }
    res.months.push({ ay, kayan: moved, kartKalan: round2(remaining.reduce((s, x) => s + x, 0)) });
  }
  if (remaining.reduce((s, x) => s + x, 0) <= 0.009) res.bitis = ay; else res.neden = 'Plan 120 ayda bitmiyor.';
  return res;
};

// ---------------- yapay zekâ eylemleri ----------------
export interface AIAction {
  op: 'ekle' | 'guncelle' | 'sil';
  kind?: BudgetKind;
  id?: string;
  ad?: string;
  tutar?: number;
  gun?: number;
  taksitKalan?: number;
  taksitToplam?: number;
  taksitliTutar?: number;
  neden?: string;
}
export interface CheckedAction { action: AIAction; ok: boolean; problem?: string; label: string }

const KINDS: BudgetKind[] = ['gelir', 'sabit', 'kart', 'degisken'];
const clean = (s: unknown): string => String(s ?? '').replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
const okAmount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 1e8;

export const describeAction = (a: AIAction, b: Budget): string => {
  const cur = a.id ? b.items.find(i => i.id === a.id) : undefined;
  if (a.op === 'sil') return `Sil: ${cur ? `${KIND_LABEL[cur.kind]} · ${cur.name} · ${fmtTL(cur.amount)}` : a.id || '?'}`;
  if (a.op === 'guncelle') {
    const parts: string[] = [];
    if (cur && okAmount(a.tutar) && a.tutar !== cur.amount) parts.push(`${fmtTL(cur.amount)} → ${fmtTL(a.tutar)}`);
    if (a.gun) parts.push(`gün ${a.gun}`);
    if (a.ad && cur && clean(a.ad) !== cur.name) parts.push(`ad: ${clean(a.ad)}`);
    return `Güncelle: ${cur ? cur.name : a.id || '?'}${parts.length ? ' · ' + parts.join(' · ') : ''}`;
  }
  const k = a.kind ? KIND_LABEL[a.kind] : '?';
  return `Ekle: ${k} · ${clean(a.ad)} · ${okAmount(a.tutar) ? fmtTL(a.tutar) : '?'}${a.gun ? ` (ayın ${a.gun}'i)` : ''}${a.taksitKalan && a.taksitToplam ? ` · taksit ${a.taksitKalan}/${a.taksitToplam}` : ''}`;
};

// Yapay zekânın önerdiği eylemleri doğrular; geçersizleri işaretler. Aynı türde aynı adlı kalem varsa "ekle" otomatik "güncelle"ye çevrilir (mükerrer olmasın).
export const checkActions = (b: Budget, acts: AIAction[]): CheckedAction[] => {
  const out: CheckedAction[] = [];
  for (const raw of (Array.isArray(acts) ? acts : []).slice(0, 20)) {
    const a: AIAction = { ...raw };
    const bad = (problem: string) => out.push({ action: a, ok: false, problem, label: describeAction(a, b) });
    if (!['ekle', 'guncelle', 'sil'].includes(a.op)) { bad('Geçersiz işlem'); continue; }
    if (a.op === 'ekle') {
      if (!a.kind || !KINDS.includes(a.kind)) { bad('Tür belirsiz'); continue; }
      const name = clean(a.ad);
      if (!name) { bad('Ad boş'); continue; }
      if (!okAmount(a.tutar)) { bad('Tutar geçersiz'); continue; }
      if (a.gun != null && !(Number.isInteger(a.gun) && a.gun >= 1 && a.gun <= 31)) { bad('Gün geçersiz'); continue; }
      const same = b.items.find(i => i.kind === a.kind && i.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'));
      if (same) { a.op = 'guncelle'; a.id = same.id; a.ad = same.name; } // mevcut kalemin yazımı korunur (yeniden adlandırılmaz)
      else a.ad = name;
    }
    if (a.op === 'guncelle' || a.op === 'sil') {
      const cur = b.items.find(i => i.id === a.id);
      if (!cur) { bad('Kalem bulunamadı'); continue; }
      if (a.op === 'guncelle') {
        if (a.tutar != null && !okAmount(a.tutar)) { bad('Tutar geçersiz'); continue; }
        if (a.gun != null && !(Number.isInteger(a.gun) && a.gun >= 1 && a.gun <= 31)) { bad('Gün geçersiz'); continue; }
      }
    }
    out.push({ action: a, ok: true, label: describeAction(a, b) });
  }
  return out;
};

export const applyAction = (b: Budget, a: AIAction): Budget => {
  let items = b.items.map(i => ({ ...i }));
  if (a.op === 'sil') items = items.filter(i => i.id !== a.id);
  else if (a.op === 'guncelle') {
    items = items.map(i => {
      if (i.id !== a.id) return i;
      const n = { ...i };
      if (okAmount(a.tutar)) n.amount = round2(a.tutar);
      if (a.ad && clean(a.ad)) n.name = clean(a.ad);
      if (a.gun) n.day = a.gun;
      if (n.kind === 'sabit' && a.taksitKalan && a.taksitToplam) n.taksit = { left: a.taksitKalan, total: a.taksitToplam };
      if (n.kind === 'kart' && a.taksitliTutar != null && a.taksitliTutar >= 0) n.taksitAmount = a.taksitliTutar;
      return n;
    });
  } else if (a.op === 'ekle' && a.kind && okAmount(a.tutar)) {
    const it: BudgetItem = { id: '', kind: a.kind, name: clean(a.ad), amount: round2(a.tutar) };
    if (a.gun) it.day = a.gun;
    if (a.kind === 'sabit' && a.taksitKalan && a.taksitToplam && a.taksitKalan <= a.taksitToplam) it.taksit = { left: a.taksitKalan, total: a.taksitToplam };
    if (a.kind === 'kart' && a.taksitliTutar && a.taksitliTutar > 0) it.taksitAmount = a.taksitliTutar;
    items.push(it);
  }
  return { ...b, items: reindex(items) };
};

// Kimlikler (tür-sıra) silmede kayar: önce güncellemeler, sonra eklemeler, en son silmeler (sondan başa) uygulanır.
const idxOf = (id?: string): number => { const m = String(id || '').match(/-(\d+)$/); return m ? Number(m[1]) : 0; };
export const applyActions = (b: Budget, acts: AIAction[]): Budget => {
  const rank = (a: AIAction) => (a.op === 'guncelle' ? 0 : a.op === 'ekle' ? 1 : 2);
  const ordered = [...acts].sort((x, y) => rank(x) - rank(y) || (x.op === 'sil' && y.op === 'sil' ? idxOf(y.id) - idxOf(x.id) : 0));
  return ordered.reduce((acc, a) => applyAction(acc, a), b);
};

// Önceden doğrulanmış bir eylemin hedef kalemini (tür+ad) şimdiki bütçede yeniden bulur; kimlikler kaymış olabilir. Bulunamazsa null.
export const retarget = (b: Budget, a: AIAction, target?: { kind: BudgetKind; name: string }): AIAction | null => {
  if (a.op === 'ekle' || !target) return a;
  const cur = b.items.find(i => i.kind === target.kind && i.name.toLocaleLowerCase('tr') === target.name.toLocaleLowerCase('tr'));
  return cur ? { ...a, id: cur.id } : null;
};

// ---------------- gizlilik ----------------
// Yapay zekâya gitmeden önce: kart/IBAN/TC kimlik gibi uzun rakam dizileri gizlenir.
export const redactSensitive = (text: string): string =>
  String(text ?? '')
    .replace(/\bTR\d{2}(?:[ ]?\d){12,}\b/gi, '[GİZLİ]')
    .replace(/\b(?:\d[ -]?){12,}\d\b/g, '[GİZLİ]')
    .replace(/\b\d{11}\b/g, '[GİZLİ]');
