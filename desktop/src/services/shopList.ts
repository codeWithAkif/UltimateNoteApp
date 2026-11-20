// Canlı alışveriş listesi: Alışveriş/Liste.md. Telefondaki widget bu notu sabitleyip doğrudan okur/yazar, bu yüzden biçim widget'a UYUMLUDUR:
//  - maddeler "- [ ] metin" / "- [x] metin" satırlarıdır (widget satır numarasıyla işaretler, sonuna "- [ ] ..." ekler),
//  - hızlı ekleme (QuickAdd) maddeyi DOSYANIN SONUNA ekler ve altına girintili ayrıntı satırı + [due:..] gibi etiketler yazabilir.
// Bu yüzden burada tam yeniden yazma YOK: yalnızca satır bazlı işlemler yapılır (işaretle, ekle, sil, taşı); bilinmeyen satırlar, etiketler ve
// ayrıntı satırları olduğu gibi korunur. Ürün eşleşmeleri/tercihler satırın içine yazılmaz (widget'ta çirkin görünür), Tercihler.md'de tutulur.
export const LIST_PATH = 'Alışveriş/Liste.md';
export const INBOX_CAT = 'Yeni eklenenler'; // telefondan eklenenler dosya sonuna düşer; bu başlık hep SON bölüm kalır
export const DEFAULT_LIST_CATS = ['Market', 'Araç', 'Ev', 'Kişisel', 'Diğer'];

export interface LItem { line: number; end: number; kat: string; text: string; adet: number; done: boolean; tags: string; detail: string[] }

const ITEM_RE = /^(\s*)[-*]\s+\[([ xX])\]\s?(.*)$/;
const HEAD_RE = /^##\s+(.*?)\s*$/;
const TAG_RE = /\s*\[(?:due|plannedtime|repeat|time|window|started|completed|outcome|project|proje|status|durum|priority|p|gcal|gcalh|hours|session|plan):[^\]]*\]/gi;
const DONE_TAG_RE = /\s*\[(?:completed|outcome):[^\]]*\]/gi;
const clean = (s: string) => s.replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

export const TEMPLATE = `# Alışveriş listesi

Bu not telefondaki widget'ta görünür. Telefondan eklediğiniz maddeler "${INBOX_CAT}" altına düşer; uygulamadaki Alışveriş ekranı bunları sıralar.

## Market

## ${INBOX_CAT}
`;

const splitLines = (c: string): string[] => c.replace(/\r\n/g, '\n').split('\n');
const joinLines = (l: string[]): string => l.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n');
const buildLine = (indent: string, done: boolean, text: string, adet: number, tags: string) => `${indent}- [${done ? 'x' : ' '}] ${text}${adet > 1 ? ` ×${adet}` : ''}${tags}`;

export const parseList = (content: string | undefined): { lines: string[]; items: LItem[] } => {
  const lines = splitLines(content ?? '');
  const items: LItem[] = [];
  let kat = INBOX_CAT;
  for (let i = 0; i < lines.length; i++) {
    const h = HEAD_RE.exec(lines[i]);
    if (h) { kat = clean(h[1]) || INBOX_CAT; continue; }
    const m = ITEM_RE.exec(lines[i]);
    if (!m) continue;
    const tags = (m[3].match(TAG_RE) || []).join('');
    let text = clean(m[3].replace(TAG_RE, ''));
    let adet = 1;
    const q = /^(.*?)\s+[×x]\s?(\d{1,2})$/i.exec(text);
    if (q && q[1]) { text = q[1].trim(); adet = Math.max(1, Number(q[2])); }
    if (!text) continue;
    // ayrıntı satırları: maddeyi izleyen girintili, madde/başlık olmayan satırlar (QuickAdd "detail")
    const detail: string[] = [];
    let end = i;
    while (end + 1 < lines.length && /^(\s{2,}|\t)\S/.test(lines[end + 1]) && !ITEM_RE.test(lines[end + 1])) { end++; detail.push(lines[end]); }
    items.push({ line: i, end, kat, text, adet, done: m[2].toLowerCase() === 'x', tags, detail });
    i = end;
  }
  return { lines, items };
};

// Metinle de doğrulayarak maddeyi bulur (satır numarası, dosya telefondan değiştiyse kaymış olabilir)
const locate = (model: { items: LItem[] }, line: number, text: string): LItem | null =>
  model.items.find(i => i.line === line && i.text === text) || model.items.find(i => i.text === text) || null;

export const ensureList = (content: string | undefined): string => (content && content.trim() ? content : TEMPLATE);

// Bir bölümün (başlık) son içerik satırından sonrası: yeni madde buraya eklenir
const sectionInsertAt = (lines: string[], kat: string): number => {
  let head = -1;
  for (let i = 0; i < lines.length; i++) { const h = HEAD_RE.exec(lines[i]); if (h && clean(h[1]) === kat) { head = i; break; } }
  if (head < 0) return -1;
  let last = head;
  for (let j = head + 1; j < lines.length && !HEAD_RE.test(lines[j]); j++) if (lines[j].trim()) last = j;
  return last + 1;
};

const insertBlock = (lines: string[], kat: string, block: string[]): string[] => {
  const out = [...lines];
  if (kat === INBOX_CAT) {
    // telefondan eklenenler gibi: dosyanın sonuna
    while (out.length && !out[out.length - 1].trim()) out.pop();
    if (sectionInsertAt(out, INBOX_CAT) < 0) out.push('', `## ${INBOX_CAT}`);
    out.push(...block);
    return out;
  }
  const at = sectionInsertAt(out, kat);
  if (at >= 0) { out.splice(at, 0, ...block); return out; }
  // bölüm yok: INBOX bölümünün ÖNÜNE yeni başlıkla ekle (INBOX hep son kalsın)
  const inbox = out.findIndex(l => { const h = HEAD_RE.exec(l); return !!h && clean(h[1]) === INBOX_CAT; });
  const add = ['', `## ${kat}`, ...block, ''];
  if (inbox >= 0) { out.splice(inbox, 0, ...add.slice(1)); return out; }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  out.push(...add, '', `## ${INBOX_CAT}`);
  return out;
};

export const listAdd = (content: string | undefined, kat: string, text: string, adet = 1): string => {
  const t = clean(text);
  if (!t) return ensureList(content);
  const lines = splitLines(ensureList(content));
  return joinLines(insertBlock(lines, clean(kat) || INBOX_CAT, [buildLine('', false, t, adet, '')]));
};

export const listToggle = (content: string, line: number, text: string): string => {
  const model = parseList(content);
  const it = locate(model, line, text);
  if (!it) return content;
  const lines = [...model.lines];
  const m = ITEM_RE.exec(lines[it.line])!;
  const done = !it.done;
  let body = m[3];
  if (!done) body = body.replace(DONE_TAG_RE, ''); // işareti kaldırınca "tamamlandı" etiketleri de gider
  lines[it.line] = `${m[1]}- [${done ? 'x' : ' '}] ${body}`;
  return joinLines(lines);
};

export const listRemove = (content: string, line: number, text: string): string => {
  const model = parseList(content);
  const it = locate(model, line, text);
  if (!it) return content;
  const lines = [...model.lines];
  lines.splice(it.line, it.end - it.line + 1);
  return joinLines(lines);
};

export const listSetQty = (content: string, line: number, text: string, qty: number): string => {
  const model = parseList(content);
  const it = locate(model, line, text);
  if (!it) return content;
  const lines = [...model.lines];
  const m = ITEM_RE.exec(lines[it.line])!;
  lines[it.line] = buildLine(m[1], it.done, it.text, Math.max(1, Math.min(99, Math.round(qty) || 1)), it.tags);
  return joinLines(lines);
};

export const listMove = (content: string, line: number, text: string, kat: string): string => {
  const model = parseList(content);
  const it = locate(model, line, text);
  const target = clean(kat);
  if (!it || !target || it.kat === target) return content;
  const lines = [...model.lines];
  const block = lines.splice(it.line, it.end - it.line + 1);
  return joinLines(insertBlock(lines, target, block));
};

// Alınanları (x) listeden çıkarır; arşive yazılmak üzere döndürür. Alınmayanlar ve diğer satırlar aynen kalır.
export const archiveDone = (content: string): { content: string; done: LItem[] } => {
  const model = parseList(content);
  const done = model.items.filter(i => i.done);
  if (!done.length) return { content, done: [] };
  const drop = new Set<number>();
  for (const d of done) for (let k = d.line; k <= d.end; k++) drop.add(k);
  return { content: joinLines(model.lines.filter((_, i) => !drop.has(i))), done };
};

// Eski notlardaki (ör. alınacaklar/Market.md) açık "- [ ]" maddeleri: harcama kayıtları ve boş satırlar atlanır, etiketler ayıklanır
export const legacyOpenItems = (content: string | undefined): string[] => {
  const out: string[] = [];
  for (const raw of splitLines(content ?? '')) {
    const m = ITEM_RE.exec(raw);
    if (!m || m[2] !== ' ') continue;
    if (/^\[harcama/i.test(m[3].trim())) continue;
    const t = clean(m[3].replace(TAG_RE, ''));
    if (t && !out.some(x => x.toLocaleLowerCase('tr') === t.toLocaleLowerCase('tr'))) out.push(t);
  }
  return out;
};

// Basit kategori tahmini (öğrenilmiş kategoriler önceliklidir); bilinmeyenler null döner → Yeni eklenenler'de kalır
// Türkçe harflerde \b güvenilir değil: sınırlar Unicode ile aranır. Uzun kökler ek alabilir ("lastiği", "lambası"; ünsüz yumuşaması için kök kısa tutulur),
// kısa sözcükler ("su", "et", "un") tam eşleşmelidir ("suluk", "unutma" Market sayılmasın).
const kw = (stems: string, exact: string): RegExp =>
  new RegExp(String.raw`(?<![\p{L}\p{N}])(?:(?:` + stems + String.raw`)` + (exact ? String.raw`|(?:` + exact + String.raw`)(?![\p{L}\p{N}])` : '') + ')', 'u');
const KEYWORDS: [string, RegExp][] = [
  ['Araç', kw('lasti|silecek|akü|araba|ara[cç]|motor yağ|balata|yağ değişim|cam suyu', 'oto')],
  ['Kişisel', kw('şampuan|deodorant|sabun|krem|tıraş|kuaför|parfüm|makyaj', 'diş')],
  ['Ev', kw('ampul|lamba|kapı kol|musluk|tadilat|boya|vida|priz|perde|halı|çekmece|mobilya', '')],
  ['Market', kw('süt|yumurta|ekmek|peynir|zeytin|çay|kahve|şeker|makarna|pirinç|bulgur|domates|salatalık|patates|soğan|tavuk|balık|meyve|sebze|deterjan|tuvalet kağıd|kağıt havlu|yoğurt', 'su|et|un|yağ')]
];
export const guessCat = (text: string, learned?: Record<string, string>): string | null => {
  const key = clean(text).toLocaleLowerCase('tr');
  if (learned && learned[key]) return learned[key];
  for (const [cat, re] of KEYWORDS) if (re.test(key)) return cat;
  return null;
};
