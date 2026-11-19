// ProTracker'dan gelen veri daha önce görülenden farklıysa (yeni iş, durum/başlık/termin değişikliği) bunu kasadaki bir "bildirim günlüğü" notuna yazar.
// Telefon uygulaması (kasa senkronuyla gelen) bu notu okuyup KENDİ yerel bildirimini gösterir — hiçbir dış servise veri gitmez.
// İlk çekme sessiz bir başlangıç noktasıdır (mevcut işler için bildirim yağmuru olmasın).

import type { AssignedTask, StatusKey } from './assignedTasks';

export const NOTIFY_LOG_PATH = 'Sistem/ProTracker Bildirimleri.md';
export const MAX_LOG_LINES = 100;

export interface SeenTask { s: StatusKey; t: string; d?: string }
export type SeenMap = Record<string, SeenTask>;

export interface ChangeEntry { ts: number; label: string; text: string }

const STATUS_TR: Record<StatusKey, string> = { backlog: 'Backlog', inprogress: 'Devam ediyor', review: 'İncelemede', test: 'Test', park: 'Park', blocked: 'Bloklu', done: 'Bitti' };

// `items`: çekilen işler ve ait oldukları proje/ekip etiketi. `prev` undefined ise ilk çekmedir: bildirim üretilmez, yalnızca başlangıç kaydı alınır.
export const diffTasks = (prev: SeenMap | undefined, items: { task: AssignedTask; label: string }[], now: number): { entries: ChangeEntry[]; seen: SeenMap } => {
  const seen: SeenMap = { ...(prev || {}) };
  const entries: ChangeEntry[] = [];
  for (const { task: t, label } of items) {
    const old = prev ? prev[t.id] : undefined;
    if (prev) {
      if (!old) entries.push({ ts: now, label, text: `Yeni iş: ${t.title}` });
      else {
        if (old.s !== t.status) entries.push({ ts: now, label, text: `${t.title}: ${STATUS_TR[old.s] || old.s} → ${STATUS_TR[t.status]}` });
        if (old.t !== t.title) entries.push({ ts: now, label, text: `Başlık değişti: ${old.t} → ${t.title}` });
        if ((old.d || '') !== (t.due || '') && t.due) entries.push({ ts: now, label, text: `Termin: ${t.title} → ${t.due}` });
      }
    }
    seen[t.id] = { s: t.status, t: t.title, d: t.due };
  }
  return { entries, seen };
};

const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const HEADER = '# ProTracker Bildirimleri\n\nProTracker\'dan çekilirken fark edilen değişiklikler. Telefon uygulaması bu listeden bildirim üretir; satırları silmeyin (eskiler kendiliğinden temizlenir).\n\n';
const LINE_RE = /^- (\d{12,14}) · (.*?) · (.+)$/;

export const appendLog = (existing: string | undefined, entries: ChangeEntry[]): string => {
  const lines = (existing || '').split('\n').filter(l => LINE_RE.test(l));
  entries.forEach(e => lines.push(`- ${e.ts} · ${clean(e.label)} · ${clean(e.text)}`));
  return HEADER + lines.slice(-MAX_LOG_LINES).join('\n') + '\n';
};

export const parseLog = (content: string | undefined): ChangeEntry[] =>
  (content || '').split('\n').map(l => l.match(LINE_RE)).filter((m): m is RegExpMatchArray => !!m).map(m => ({ ts: Number(m[1]), label: m[2], text: m[3] }));

// Telefon tarafı: son bildirilen zamandan yeni girdiler. `last` undefined ise (ilk kez) bildirim yok, yalnızca başlangıç noktası döner.
export const pickNew = (entries: ChangeEntry[], last: number | undefined): { fresh: ChangeEntry[]; newLast: number } => {
  const max = entries.reduce((m, e) => Math.max(m, e.ts), last || 0);
  if (last === undefined) return { fresh: [], newLast: max };
  return { fresh: entries.filter(e => e.ts > last), newLast: max };
};

// Bildirim metni: az sayıda değişiklikte hepsi, çoksa özet
export const toNotification = (fresh: ChangeEntry[]): { title: string; body: string } => {
  if (fresh.length === 1) return { title: `ProTracker · ${fresh[0].label}`, body: fresh[0].text };
  return { title: `ProTracker: ${fresh.length} değişiklik`, body: fresh.slice(0, 4).map(e => `${e.label}: ${e.text}`).join('\n') + (fresh.length > 4 ? `\n… +${fresh.length - 4} daha` : '') };
};
