// Asistanın ikinci aşama araçları: kart üretme, Gelen Kutusu'nu projelere dağıtma, verimlilik özeti.
// Model yalnızca ÖNERİ üretir; dosyaya yazma kullanıcı onayından sonra, satırın hâlâ aynı olduğu doğrulanarak yapılır.
import { callGemini } from '../geminiMentor';
import { foldTr, slugOf } from './projectOps';

type Call = <T>(p: string, s: any) => Promise<T>;
const one = (s: unknown, n: number) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------------- Ezber kartları ([card: soru || cevap] [srs: box1, tarih], bkz. FlashcardView) ----------------
export interface CardPair { s: string; c: string }
// "]" ve "||" kart biçimini bozar; satır sonu kartı böler.
const cardText = (v: string) => one(v, 200).replace(/\|\|/g, '|').replace(/[\[\]]/g, '');
export const cleanPairs = (list: unknown): CardPair[] => {
  const out: CardPair[] = [];
  for (const p of Array.isArray(list) ? list : []) {
    const s = cardText((p as any)?.s), c = cardText((p as any)?.c);
    if (s && c && !out.some(o => foldTr(o.s) === foldTr(s))) out.push({ s, c });
    if (out.length >= 20) break;
  }
  return out;
};
export const appendCards = (existing: string | undefined, pairs: CardPair[], today: string): string => {
  const base = existing && existing.trim() ? existing.replace(/\s*$/, '\n') : '';
  const have = new Set((base.match(/\[card:\s*([^\]]+?)\s*\|\|/g) || []).map(x => foldTr(x.replace(/^\[card:\s*/, '').replace(/\s*\|\|$/, ''))));
  const add = pairs.filter(p => !have.has(foldTr(p.s))).map(p => `[card: ${p.s} || ${p.c}] [srs: box1, ${today}]`);
  return add.length ? `${base}${base ? '\n' : ''}${add.join('\n')}\n` : base;
};
export const proposeCards = async (noteText: string, talimat: string, call: Call = callGemini): Promise<CardPair[]> => {
  const prompt = `Aşağıdaki not içeriğinden aralıklı tekrar için ezber kartları üret. Her kart kısa bir soru (s) ve kısa bir cevap (c) olsun; yalnızca notta yazan bilgiyi kullan, uydurma. En çok 12 kart. ${talimat ? `Kullanıcının isteği: ${one(talimat, 200)}\n` : ''}
NOT:
${noteText.slice(0, 6000)}

Sadece JSON döndür: {"kartlar":[{"s":"...","c":"..."}]}`;
  const r = await call<any>(prompt, { type: 'object', properties: { kartlar: { type: 'array', items: { type: 'object', properties: { s: { type: 'string' }, c: { type: 'string' } }, required: ['s', 'c'] } } }, required: ['kartlar'] });
  return cleanPairs(r?.kartlar);
};

// ---------------- Gelen Kutusu: projesiz açık görevleri projelere dağıt ----------------
export interface InboxTask { path: string; lineIdx: number; title: string }
export const inboxOpenTasks = (files: Record<string, string>): InboxTask[] => {
  const out: InboxTask[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!(path === 'inbox.md' || path.endsWith('/inbox.md')) || !content) continue;
    content.split('\n').forEach((raw, lineIdx) => {
      const l = raw.replace(/\r$/, '');
      if (!/^\s*[*\-]\s+\[ \]\s+\S/.test(l) || /\[project:/i.test(l)) return;
      const title = l.replace(/^\s*[*\-]\s+\[ \]\s+/, '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
      if (title) out.push({ path, lineIdx, title: title.slice(0, 120) });
    });
  }
  return out.slice(0, 30);
};
export interface InboxMove extends InboxTask { proje: string; on: boolean }
export const proposeInbox = async (tasks: InboxTask[], projeler: string[], call: Call = callGemini): Promise<InboxMove[]> => {
  if (!tasks.length || !projeler.length) return [];
  const prompt = `Aşağıdaki Gelen Kutusu görevlerini, açıkça uyuyorsa, PROJELER listesindeki bir projeye ata. Emin değilsen proje alanını boş bırak. Proje adını listeden AYNEN yaz.
PROJELER: ${projeler.slice(0, 60).join(', ')}
GÖREVLER:
${tasks.map((t, i) => `${i}: ${t.title}`).join('\n')}

Sadece JSON döndür: {"atamalar":[{"i":0,"proje":"..."}]}`;
  const r = await call<any>(prompt, { type: 'object', properties: { atamalar: { type: 'array', items: { type: 'object', properties: { i: { type: 'number' }, proje: { type: 'string' } }, required: ['i', 'proje'] } } }, required: ['atamalar'] });
  const out: InboxMove[] = [];
  for (const a of Array.isArray(r?.atamalar) ? r.atamalar : []) {
    const t = tasks[Number(a?.i)];
    const proje = projeler.find(p => foldTr(p) === foldTr(one(a?.proje, 60)));
    if (t && proje && !out.some(o => o.path === t.path && o.lineIdx === t.lineIdx)) out.push({ ...t, proje, on: true });
  }
  return out;
};
export const tagLineProject = (line: string, proje: string): string => {
  const cr = line.endsWith('\r') ? '\r' : '';
  return `${line.replace(/\r$/, '')} [project:${slugOf(proje)}]${cr}`;
};

// ---------------- Verimlilik özeti (Asistan "geçen haftaya göre nasıldım?" sorusunu buradan cevaplar) ----------------
const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const productivitySummary = (files: Record<string, string>, now: Date): string => {
  const day = (n: number) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n); return ymdOf(d); };
  const thisFrom = day(6), prevFrom = day(13), today = day(0);
  let done7 = 0, donePrev = 0, overdue = 0, open = 0;
  for (const [path, content] of Object.entries(files)) {
    if (!/\.md$/i.test(path) || !content || path.startsWith('Sistem/') || !content.includes('- [')) continue;
    for (const l of content.split('\n')) {
      const m = /^\s*[*\-]\s+\[([ xX\/])\]/.exec(l);
      if (!m) continue;
      if (m[1].toLowerCase() === 'x') {
        const c = /\[completed:(\d{4}-\d{2}-\d{2})/.exec(l)?.[1];
        if (!c) continue;
        if (c >= thisFrom && c <= today) done7++; else if (c >= prevFrom && c < thisFrom) donePrev++;
      } else {
        open++;
        const d = /\[due:(\d{4}-\d{2}-\d{2})\]/.exec(l)?.[1];
        if (d && d < today) overdue++;
      }
    }
  }
  return `son 7 günde tamamlanan görev: ${done7}, önceki 7 günde: ${donePrev}, açık görev: ${open}, vadesi geçmiş: ${overdue} (yalnızca tamamlanma tarihi kayıtlı görevler sayılır)`;
};

// ---------------- Günün özeti: "bugün ne var?" sorusu bu satırdan cevaplanır ----------------
export const daySummary = (files: Record<string, string>, now: Date, alarmsToday: { saat: string; baslik: string }[]): string => {
  const today = ymdOf(now);
  const items: string[] = [];
  let overdue = 0;
  for (const [path, content] of Object.entries(files)) {
    if (!/\.md$/i.test(path) || !content || path.startsWith('Sistem/') || !content.includes('[due:')) continue;
    for (const l of content.split('\n')) {
      if (!/^\s*[*\-]\s+\[[ \/]\]/.test(l)) continue;
      const d = /\[due:(\d{4}-\d{2}-\d{2})\]/.exec(l)?.[1];
      if (!d) continue;
      if (d < today) { overdue++; continue; }
      if (d !== today) continue;
      const t = /\[plannedtime:(\d{2}:\d{2})/.exec(l)?.[1];
      const title = l.replace(/^\s*[*\-]\s+\[[ \/]\]\s*/, '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (title) items.push(`${t ? t + ' ' : ''}${title}`);
    }
  }
  items.sort();
  return `bugünkü görevler (${items.length}): ${items.slice(0, 10).join('; ') || 'yok'}; bugünkü alarmlar: ${alarmsToday.map(a => `${a.saat} ${a.baslik}`).join('; ') || 'yok'}; vadesi geçmiş açık görev: ${overdue}`;
};
