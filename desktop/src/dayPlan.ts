// Günün planı yardımcıları: Outlook/Google takviminden gelen toplantıları taslağa çevirme, günün işlenmiş bloklarını okuma ve
// boşluk hesabı için meşgul aralıkları toplama. Saf işlevler; yalnızca küçük load/save yardımcıları localStorage kullanır.

import { type Interval, MINUTE, mergeIntervals } from './activityLog';
import { type SessionSummary } from './sessionTracker';

export interface ExternalEvent { id: string; content: string; dueDate: string; timeSlot: string; source: 'google' | 'outlook' }
export interface DayBlock { id?: string; title: string; start: number; end: number; source: 'takvim' | 'bekleyen' | 'toplanti' | 'hareket' }

const pad = (n: number) => String(n).padStart(2, '0');

export const parseSlot = (ymd: string, slot: string): Interval | null => {
  const m = slot.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = ymd.split('-').map(Number);
  const start = new Date(y, mo - 1, d, +m[1], +m[2]).getTime();
  let end = new Date(y, mo - 1, d, +m[3], +m[4]).getTime();
  if (end <= start) end += 24 * 60 * MINUTE; // gece yarısını aşan etkinlik
  return { start, end };
};

export const meetingKey = (e: { dueDate: string; timeSlot: string; content: string }) => `${e.dueDate}|${e.timeSlot}|${e.content}`;

export const normTitle = (s: string) => s.toLocaleLowerCase('tr').replace(/[^a-z0-9çğıöşü ]/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/[^a-z0-9çğıöşü ]/g, ' ').replace(/\s+/g, ' ').trim();

// Toplantı başlığından proje tahmini: başlıkta proje adının (ya da ≥4 harfli bir sözcüğünün) geçmesi. Belirsizse boş döner.
export const guessProject = (title: string, projectNames: string[]): string | null => {
  const t = ` ${norm(title)} `;
  let best: string | null = null, bestScore = 0, tie = false;
  for (const name of projectNames) {
    const n = norm(name);
    if (!n) continue;
    let score = 0;
    if (t.includes(` ${n} `)) score = 100 + n.length;
    else n.split(' ').filter(w => w.length >= 4).forEach(w => { if (t.includes(` ${w} `) || t.includes(w)) score += w.length; });
    if (score > bestScore) { best = name; bestScore = score; tie = false; }
    else if (score === bestScore && score > 0) tie = true;
  }
  return tie ? null : best;
};

// Geçmişte biten, kısa/uzun olmayan ve daha önce taslağa çevrilmemiş takvim etkinlikleri -> "Toplantı" taslağı.
export const meetingDrafts = (
  events: ExternalEvent[],
  hiddenTitles: string[],
  seen: Set<string>,
  projectNames: string[],
  nowMs: number,
  daysBack: number = 2,
  titleMap: Record<string, string> = {}
): { drafts: SessionSummary[]; keys: string[] } => {
  const drafts: SessionSummary[] = [];
  const keys: string[] = [];
  const earliest = nowMs - daysBack * 24 * 60 * MINUTE;
  events.forEach(e => {
    if (hiddenTitles.includes(e.content)) return;
    const iv = parseSlot(e.dueDate, e.timeSlot);
    if (!iv || iv.end > nowMs || iv.start < earliest) return;
    const dur = (iv.end - iv.start) / MINUTE;
    if (dur < 10 || dur > 6 * 60) return;
    const key = meetingKey(e);
    if (seen.has(key)) return;
    // Daha önce bu başlık için seçtiğiniz proje hatırlanır; yoksa başlıktaki ad eşleşmesi denenir.
    const project = titleMap[norm(e.content)] || guessProject(e.content, projectNames);
    drafts.push({
      id: `m:${key}`, start: iv.start, end: iv.end, items: [], kind: 'toplanti', ref: key,
      suggestedTitle: e.content, suggestedProject: project, minutes: Math.round(dur)
    });
    keys.push(key);
  });
  return { drafts, keys };
};

// Günün işlenmiş blokları: tamamlanmış ([x]) ve [due:gün] + [plannedtime:] taşıyan satırlar (oturum bloklarımız dahil).
export const completedBlocksOfDay = (contents: Record<string, string | undefined>, ymd: string): DayBlock[] => {
  const out: DayBlock[] = [];
  const seen = new Set<string>();
  Object.values(contents).forEach(text => {
    if (!text || !text.includes(`[due:${ymd}`)) return;
    text.split('\n').forEach(line => {
      const m = line.match(/^\s*[*-]\s+\[[xX]\]\s*(.*)$/);
      if (!m || !m[1].includes(`[due:${ymd}`)) return;
      const slot = (m[1].match(/\[plannedtime:(\d{2}:\d{2}-\d{2}:\d{2})\]/) || [])[1];
      if (!slot) return;
      const iv = parseSlot(ymd, slot);
      if (!iv) return;
      const title = m[1].replace(/\[[^\]]*:[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
      const k = `${title}|${slot}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ title: title || 'İş', start: iv.start, end: iv.end, source: 'takvim' });
    });
  });
  return out.sort((a, b) => a.start - b.start);
};

export const overlapsOf = (blocks: DayBlock[], start: number, end: number): DayBlock[] =>
  blocks.filter(b => b.start < end && b.end > start);

// Boşluk hesabı için meşgul aralıklar: hareket seansları, işlenmiş bloklar, bekleyen taslaklar, takvim toplantıları.
export const busyIntervals = (parts: { start: number; end: number }[][]): Interval[] => mergeIntervals(parts.flat());

export const hmOfMs = (ms: number): string => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// ---------------- küçük kalıcı kümeler (bu cihaz) ----------------
const loadSet = (key: string): Set<string> => {
  try { const raw = localStorage.getItem(key); const a = raw ? JSON.parse(raw) : []; return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); }
};
const saveSet = (key: string, s: Set<string>, cap: number = 500) => {
  try { localStorage.setItem(key, JSON.stringify([...s].slice(-cap))); } catch { /* yoksay */ }
};
export const MEETINGS_SEEN_KEY = 'session_meetings_seen_v1';
export const GAPS_IGNORED_KEY = 'session_gaps_ignored_v1';
export const CALLS_ADDED_KEY = 'session_calls_added_v1';
export const loadMeetingsSeen = () => loadSet(MEETINGS_SEEN_KEY);
export const saveMeetingsSeen = (s: Set<string>) => saveSet(MEETINGS_SEEN_KEY, s);
export const loadGapsIgnored = () => loadSet(GAPS_IGNORED_KEY);
export const saveGapsIgnored = (s: Set<string>) => saveSet(GAPS_IGNORED_KEY, s);
export const loadCallsAdded = () => loadSet(CALLS_ADDED_KEY);
export const saveCallsAdded = (s: Set<string>) => saveSet(CALLS_ADDED_KEY, s);

const CALL_MAP_KEY = 'session_call_person_project_v1';
export const loadCallMap = (): Record<string, string> => {
  try { const raw = localStorage.getItem(CALL_MAP_KEY); const o = raw ? JSON.parse(raw) : {}; return o && typeof o === 'object' ? o : {}; } catch { return {}; }
};
export const saveCallMap = (m: Record<string, string>) => { try { localStorage.setItem(CALL_MAP_KEY, JSON.stringify(m)); } catch { /* yoksay */ } };

const CONSUMED_KEY = 'session_consumed_v1';
export const loadConsumed = (): number => { try { return parseInt(localStorage.getItem(CONSUMED_KEY) || '0', 10) || 0; } catch { return 0; } };
export const saveConsumed = (ms: number) => { try { localStorage.setItem(CONSUMED_KEY, String(ms)); } catch { /* yoksay */ } };

const PROJECTLESS_KEY = 'session_count_projectless_v1';
export const loadIncludeProjectless = (): boolean => { try { return localStorage.getItem(PROJECTLESS_KEY) === '1'; } catch { return false; } };
export const saveIncludeProjectless = (v: boolean) => { try { localStorage.setItem(PROJECTLESS_KEY, v ? '1' : '0'); } catch { /* yoksay */ } };


// Başlık -> proje hafızası (toplantı başlığını bir kez bir projeye bağladığınızda sonraki toplantılarda kendiliğinden gelir).
const TITLE_MAP_KEY = 'session_title_project_v1';
export const loadTitleMap = (): Record<string, string> => {
  try { const raw = localStorage.getItem(TITLE_MAP_KEY); const o = raw ? JSON.parse(raw) : {}; return o && typeof o === 'object' ? o : {}; } catch { return {}; }
};
export const rememberTitleProject = (title: string, project: string) => {
  try {
    const m = loadTitleMap();
    if (project) m[normTitle(title)] = project; else delete m[normTitle(title)];
    const keys = Object.keys(m);
    if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(k => delete m[k]);
    localStorage.setItem(TITLE_MAP_KEY, JSON.stringify(m));
  } catch { /* yoksay */ }
};

// Toplantı transkripti özetini bulur: "Toplantılar/<gün> <başlık>.md" notu (Teams transkript aracının yazdığı) ve içindeki "## Özet" bölümü.
// Yapay zekâ gerekmez; özet zaten transkript aracı tarafından üretilmiş ve nota yazılmıştır.
export const findTranscriptSummary = (contents: Record<string, string | undefined>, ymd: string, title: string): { path: string; lines: string[] } | null => {
  const t = normTitle(title);
  if (t.length < 3) return null;
  for (const path of Object.keys(contents)) {
    const m = path.match(/(?:^|\/)Toplantılar\/(\d{4}-\d{2}-\d{2}) (.+?)(?: \(\d+\))?\.md$/i);
    if (!m || m[1] !== ymd) continue;
    const nt = normTitle(m[2]);
    if (!(nt.includes(t) || t.includes(nt)) || nt.length < 3) continue;
    const text = contents[path] || '';
    const all = text.split('\n');
    const at = all.findIndex(l => /^##\s+Özet\s*$/.test(l.trim()));
    if (at < 0) continue;
    const lines: string[] = [];
    for (let j = at + 1; j < all.length && lines.length < 6; j++) {
      if (/^#{1,6}\s/.test(all[j])) break;
      const l = all[j].replace(/^[-*>\s]+/, '').trim();
      if (l) lines.push(l);
    }
    if (lines.length > 0) return { path, lines };
  }
  return null;
};
