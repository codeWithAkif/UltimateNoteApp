// "Günümü anlat": notlardan sahne sahne bir gün özeti üretir. YAPAY ZEKÂ KULLANMAZ: her sayı ve cümle doğrudan not verisinden hesaplanır,
// bu yüzden uydurma rakam çıkamaz. Ekranda gösterilen metin ile sesli okunan metin aynı değişkenlerden üretilir.
import { parseDayNote } from '../../components/DayNoteCards';
import { parseReminders } from './assistantAI';

export interface BriefScene { id: string; baslik: string; buyuk: string; etiket: string; satirlar: string[]; oku: string }

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plain = (t: string) => t.replace(/\*\*|==/g, '').replace(/\s+/g, ' ').trim();
const short = (t: string, n = 70) => { const s = plain(t); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const prettySlug = (s: string) => s.split('-').map(w => w.charAt(0).toLocaleUpperCase('tr') + w.slice(1)).join(' ');
const trDate = (d: Date) => d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
const dk = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} saat${m % 60 ? ` ${m % 60} dakika` : ''}` : `${m} dakika`);

export const greeting = (now: Date): string => { const h = now.getHours(); return h < 5 ? 'İyi geceler' : h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : 'İyi akşamlar'; };

/** Bir günün kartlarından, kayıtlı süre (başlangıç ve tamamlanma ikisi de olan, aynı gün içindeki işler). Ertesi gün girilen/aşırı uzun kayıtlar sayılmaz. */
const minutesOf = (c: { started?: string; completed?: string }): number => {
  if (!c.started || !c.completed) return 0;
  const a = new Date(c.started).getTime(), b = new Date(c.completed).getTime();
  const m = Math.round((b - a) / 60000);
  return m >= 5 && m <= 12 * 60 ? m : 0;
};

export function buildBriefing(files: Record<string, string>, now: Date): BriefScene[] {
  const scenes: BriefScene[] = [];
  const todayKey = ymd(now);
  const today = parseDayNote(files[`Günlükler/${todayKey}.md`] || '').cards;
  const open = today.filter(c => c.status !== 'x');
  const done = today.filter(c => c.status === 'x');

  // Sahne 1: bugünün işleri
  {
    const lines = open.slice(0, 5).map(c => `${c.planned ? c.planned.replace('-', '–') + ' · ' : ''}${short(c.title)}${c.slug ? ` (${prettySlug(c.slug)})` : ''}`);
    const first = open[0];
    const oku = `${greeting(now)}. Bugün ${trDate(now)}. ` + (today.length === 0
      ? 'Günlük notunuzda bugün için kayıt yok.'
      : `Bugün ${today.length} işiniz var: ${done.length} tanesi bitti, ${open.length} tanesi açık.` + (first ? ` Sıradaki: ${short(first.title, 90)}.` : ' Hepsi tamam.'));
    scenes.push({ id: 'bugun', baslik: trDate(now), buyuk: String(open.length), etiket: open.length === 1 ? 'açık iş' : 'açık iş', satirlar: lines.length ? lines : [today.length ? 'Bugünkü tüm işler bitti.' : 'Bugün için kayıt yok.'], oku });
  }

  // Sahne 2: bugünkü hatırlatmalar (saati henüz geçmemiş olanlar)
  {
    const nowHM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const rem = parseReminders(files).filter(r => r.tarih === todayKey && r.saat >= nowHM).sort((a, b) => a.saat.localeCompare(b.saat));
    if (rem.length) {
      const lines = rem.slice(0, 6).map(r => `${r.saat} · ${short(r.baslik)}`);
      scenes.push({ id: 'hatirlatma', baslik: 'Bugünkü hatırlatmalar', buyuk: String(rem.length), etiket: 'hatırlatma kaldı', satirlar: lines,
        oku: `Bugün ${rem.length} hatırlatmanız kaldı. İlki saat ${rem[0].saat}: ${short(rem[0].baslik, 80)}.` });
    }
  }

  // Sahne 3: önceki kayıtlı gün (en çok 7 gün geriye)
  {
    let prev: Date | null = null;
    for (let i = 1; i <= 7 && !prev; i++) { const d = new Date(now); d.setDate(d.getDate() - i); if (files[`Günlükler/${ymd(d)}.md`]) prev = d; }
    if (prev) {
      const cards = parseDayNote(files[`Günlükler/${ymd(prev)}.md`]).cards;
      const doneP = cards.filter(c => c.status === 'x');
      const perProject = new Map<string, number>();
      let total = 0;
      for (const c of doneP) { const m = minutesOf(c); if (!m) continue; total += m; const k = c.slug ? prettySlug(c.slug) : 'Projesiz'; perProject.set(k, (perProject.get(k) || 0) + m); }
      const lines = [...perProject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, m]) => `${k} · ${dk(m)}`);
      const when = ymd(prev) === ymd(new Date(now.getTime() - 86400000)) ? 'Dün' : trDate(prev);
      scenes.push({ id: 'dun', baslik: `${when}: biten işler`, buyuk: String(doneP.length), etiket: 'iş bitti', satirlar: lines.length ? lines : doneP.slice(0, 5).map(c => short(c.title)),
        oku: `${when} ${doneP.length} işi bitirdiniz.` + (total ? ` Kayıtlı çalışma süreniz ${dk(total)}.` + (lines.length ? ` En çok ${[...perProject.entries()].sort((a, b) => b[1] - a[1])[0][0]} üzerinde çalıştınız.` : '') : '') });
    }
  }
  return scenes;
}
