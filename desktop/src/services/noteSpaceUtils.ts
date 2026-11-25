// Not uzayı ve Çalışma masası için ortak, saf yardımcılar (arayüzsüz): etiket, bağlantı, başlık ve özet çıkarma.

/** Etiketler: uygulamanın kendisiyle aynı kural (#etiket, kod blokları dışında, küçük harf). Yalnızca rakamdan oluşanlar ve tek harfliler gürültü sayılır. */
export const noteTags = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const m of text.replace(/```[\s\S]*?```/g, ' ').matchAll(/#([a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+)/g)) { const t = m[1].toLowerCase(); if (t.length > 1 && !/^\d+$/.test(t)) out.add(t); }
  return out;
};

export const folderOf = (p: string): string => { const i = p.indexOf('/'); return i < 0 ? '' : p.slice(0, i); };
export const titleOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '');

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const hueOf = (folder: string): number => (folder ? hash(folder) % 360 : 200);

const noFront = (t: string) => t.replace(/^---[\s\S]*?---\s*/, '');

/** Notun başlıkları (ilk satırdaki ana başlık hariç), en çok max tane */
export const outline = (text: string, max = 6): string[] => {
  const out: string[] = [];
  const lines = noFront(text).split(/\r?\n/);
  lines.forEach((ln, i) => {
    const m = /^(#{1,4})\s+(.+?)\s*#*$/.exec(ln);
    if (m && !(i === 0 && m[1].length === 1) && out.length < max) out.push(m[2].replace(/[*_`]/g, ''));
  });
  return out;
};

/** Notun ilk anlamlı cümleleri: işaretler ve etiketler atılır, boşluklar tekleşir */
export const excerpt = (text: string, n = 300): string => {
  const body = noFront(text).replace(/```[\s\S]*?```/g, ' ').split(/\r?\n/).filter((l, i) => !(i === 0 && /^#\s/.test(l))).join(' ');
  return body.replace(/\[\[([^\]|#]+)(?:[#|]([^\]]*))?\]\]/g, (_m, a, b) => b || a).replace(/#[a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ]+/g, ' ').replace(/[#*`>_]|- \[[ xX]\]|^- /gm, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
};

/** [[Not adı]], [[Not adı|takma ad]], [[Not adı#başlık]] bağlantılarının hedef adları (klasörsüz, küçük harf) */
export const linkTargets = (text: string): string[] => {
  const out = new Set<string>();
  for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) out.add(m[1].trim().replace(/^.*\//, '').replace(/\.md$/i, '').toLowerCase());
  return [...out];
};

/** Bir notun verdiği ve aldığı bağlantılar (not yolları). Ad eşleşmesi klasörsüz ve büyük/küçük harfsiz. */
export const resolveLinks = (files: Record<string, string>, path: string): { out: string[]; back: string[] } => {
  const byTitle = new Map<string, string>();
  const paths = Object.keys(files).filter(p => p.endsWith('.md') && !p.split('/').some(s => s.startsWith('.')));
  for (const p of paths) { const k = titleOf(p).toLowerCase(); if (!byTitle.has(k)) byTitle.set(k, p); }
  const out = linkTargets(files[path] || '').map(t => byTitle.get(t)).filter((x): x is string => !!x && x !== path);
  const mine = titleOf(path).toLowerCase();
  const back = paths.filter(p => p !== path && linkTargets(files[p] || '').includes(mine));
  return { out: [...new Set(out)], back };
};

/** Ezber kartları: notta `[card: soru || cevap]` (isteğe bağlı `[srs: boxN, tarih]`) biçiminde yazılır (FlashcardView ile aynı biçim). */
export interface DeskCard { q: string; a: string; box: number }
export const parseCards = (text: string): DeskCard[] => {
  const out: DeskCard[] = [], re = /\[card:\s*([^\]]+?)\s*\|\|\s*([^\]]+?)\s*\](?:\s*\[srs:\s*box(\d+),\s*\d{4}-\d{2}-\d{2}\s*\])?/;
  for (const line of text.split('\n')) { const m = re.exec(line); if (m) out.push({ q: m[1].trim(), a: m[2].trim(), box: m[3] ? parseInt(m[3]) : 1 }); }
  return out;
};
