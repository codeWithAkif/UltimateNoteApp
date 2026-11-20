// Haftalık alışveriş notları: Alışveriş/Haftalık/YYYY-Hww.md. Elle de yazılabilen sade biçim; uygulama ekranı aynı notu okuyup yazar.
// Önemli: görev kutusu ("- [ ]") KULLANILMAZ: uygulamadaki görev taraması her "- [ ]" satırını panoya kart yapar ve alışveriş listesi panoyu doldurur.
// Bunun yerine düz madde ve "✓" işareti kullanılır. Elle "- [ ] süt" yazılırsa okunur, ilk kayıtta düz maddeye çevrilir.
export const SHOP_DIR = 'Alışveriş/Haftalık';
export const DEFAULT_CATS = ['Market', 'Araç', 'Ev', 'Kişisel', 'Diğer'];
export const MARKET_CAT = 'Market'; // fiyat özellikleri yalnızca bu kategoride

export interface ShopItem {
  id: string; kat: string; text: string; done: boolean; adet?: number;
  urun?: { id: string; title: string }; // marketfiyati ürün eşlemesi (yalnızca Market)
  not?: string;
}
export interface ShopWeek { id: string; items: ShopItem[]; extra: { kat: string; text: string }[] } // extra: elle yazılmış serbest satırlar (korunur)

// ISO hafta: Pazartesi başlar, yılın ilk haftası 4 Ocak'ı içeren hafta
export const weekIdOf = (d: Date): string => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-H${String(w).padStart(2, '0')}`;
};
export const weekPath = (id: string): string => `${SHOP_DIR}/${id}.md`;
export const parseWeekId = (id: string): { y: number; w: number } | null => { const m = /^(\d{4})-H(\d{2})$/.exec(id); return m ? { y: Number(m[1]), w: Number(m[2]) } : null; };
export const weekStart = (id: string): Date | null => {
  const p = parseWeekId(id); if (!p) return null;
  const jan4 = new Date(Date.UTC(p.y, 0, 4));
  const mondayW1 = new Date(jan4); mondayW1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1));
  const d = new Date(mondayW1); d.setUTCDate(mondayW1.getUTCDate() + (p.w - 1) * 7);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
export const shiftWeek = (id: string, delta: number): string => { const s = weekStart(id); if (!s) return id; s.setDate(s.getDate() + delta * 7); return weekIdOf(s); };
export const weekLabel = (id: string): string => {
  const s = weekStart(id); if (!s) return id;
  const e = new Date(s); e.setDate(s.getDate() + 6);
  const f = (d: Date) => d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  return `${f(s)} – ${f(e)}`;
};

const clean = (s: string) => s.replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const num = (s: string): number | undefined => { const v = Number(String(s).trim().replace(',', '.')); return Number.isFinite(v) && v > 0 && v <= 999 ? v : undefined; };

export const emptyWeek = (id: string): ShopWeek => ({ id, items: [], extra: [] });

// Not -> yapı. Bilinmeyen/serbest satırlar (başlık dışı, madde olmayan) extra'da kategorisiyle korunur.
export const parseWeek = (content: string | undefined, id: string): ShopWeek => {
  const w = emptyWeek(id);
  if (!content) return w;
  let kat = 'Diğer';
  let n = 0;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || /^#\s/.test(line.trim())) continue;
    const h = line.match(/^##\s+(.*)$/);
    if (h) { kat = clean(h[1]) || 'Diğer'; continue; }
    const m = line.match(/^\s*[-*]\s+(.*)$/);
    if (!m) { w.extra.push({ kat, text: line }); continue; }
    let body = m[1].trim();
    let done = false;
    const cb = body.match(/^\[([ xX])\]\s*(.*)$/); // elle yazılmış görev kutusu: oku, kayıtta düz maddeye çevrilir
    if (cb) { done = cb[1].toLowerCase() === 'x'; body = cb[2]; }
    if (/^✓\s*/.test(body)) { done = true; body = body.replace(/^✓\s*/, ''); }
    const parts = body.split('|').map(s => s.trim());
    const text = parts[0];
    if (!text) continue;
    const it: ShopItem = { id: `s${n++}`, kat, text, done };
    let uid = '', utitle = '';
    for (const p of parts.slice(1)) {
      const kv = p.match(/^([a-zçğıöşü]+):\s*(.+)$/i);
      if (!kv) continue;
      const k = kv[1].toLowerCase();
      if (k === 'adet') it.adet = num(kv[2]);
      else if (k === 'ürün' || k === 'urun') uid = kv[2].trim();
      else if (k === 'başlık' || k === 'baslik') utitle = kv[2].trim();
      else if (k === 'not') it.not = kv[2].trim();
    }
    if (uid) it.urun = { id: uid, title: utitle || text };
    w.items.push(it);
  }
  return w;
};

export const weekCats = (w: ShopWeek): string[] => {
  const seen = new Set<string>(DEFAULT_CATS);
  const extra = [...w.items.map(i => i.kat), ...w.extra.map(e => e.kat)].filter(k => !seen.has(k));
  return [...DEFAULT_CATS, ...[...new Set(extra)]];
};

export const serializeWeek = (w: ShopWeek): string => {
  const out: string[] = [`# Alışveriş ${w.id} (${weekLabel(w.id)})`, ''];
  for (const k of weekCats(w)) {
    const items = w.items.filter(i => i.kat === k && i.text.trim());
    const extra = w.extra.filter(e => e.kat === k);
    if (!items.length && !extra.length && !DEFAULT_CATS.includes(k)) continue;
    if (!items.length && !extra.length) continue;
    out.push(`## ${k}`);
    for (const i of items) {
      const bits = [`${i.done ? '✓ ' : ''}${clean(i.text)}`];
      if (i.adet && i.adet !== 1) bits.push(`adet:${i.adet}`);
      if (i.urun) { bits.push(`ürün:${clean(i.urun.id)}`); bits.push(`başlık:${clean(i.urun.title)}`); }
      if (i.not) bits.push(`not:${clean(i.not)}`);
      out.push(`- ${bits.join(' | ')}`);
    }
    for (const e of extra) out.push(e.text);
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
};

export const newItem = (w: ShopWeek, kat: string, text: string): ShopWeek => {
  const t = clean(text);
  if (!t) return w;
  return { ...w, items: [...w.items, { id: `s${Date.now().toString(36)}${w.items.length}`, kat: clean(kat) || 'Diğer', text: t, done: false }] };
};

// ---- klasördeki haftalar (en yeni önce)
export const listWeeks = (files: Record<string, string>): string[] => {
  const ids: string[] = [];
  const re = new RegExp('^' + SHOP_DIR.replace(/[/\\]/g, '\\/') + '\\/(\\d{4}-H\\d{2})\\.md$');
  for (const p of Object.keys(files)) { const m = re.exec(p); if (m) ids.push(m[1]); }
  return ids.sort().reverse();
};

// Yapay zekâya geçmiş haftaların özeti ("neye ihtiyacım var"): en çok n hafta, madde adları + alındı mı
export const recentHistory = (files: Record<string, string>, beforeId: string, n = 5): { id: string; items: { kat: string; text: string; done: boolean }[] }[] =>
  listWeeks(files).filter(id => id < beforeId).slice(0, n).map(id => ({ id, items: parseWeek(files[weekPath(id)], id).items.map(i => ({ kat: i.kat, text: i.text, done: i.done })) }));

// ---- fiyat planı bloğu: haftalık nota "## Fiyat planı" altında DÜZ SATIRLAR olarak yazılır (madde/görev kutusu değil → panoya kart düşmez,
// ve ekran bunu madde olarak okumaz). Yeniden planlanınca eski blok değişir.
export const PLAN_CAT = 'Fiyat planı';
export const withPlanBlock = (w: ShopWeek, lines: string[]): ShopWeek => ({
  ...w,
  extra: [...w.extra.filter(e => e.kat !== PLAN_CAT), ...lines.map(l => l.replace(/^\s*[-*#]+\s*/, '').trim()).filter(Boolean).map(text => ({ kat: PLAN_CAT, text }))]
});
// Ekleme listesinde sistem bölümü (Fiyat planı) görünmez
export const addableCats = (w: ShopWeek): string[] => weekCats(w).filter(k => k !== PLAN_CAT);
