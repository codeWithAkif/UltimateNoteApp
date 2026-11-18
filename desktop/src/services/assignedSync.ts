// "Atanan işler" eşitlemesi: Electron'dan ham veriyi alır (giriş orada yapılır, şifre buraya gelmez), her ekip için görevleri ilgili proje notuna yazar.
// Yalnızca okur; şirket uygulamasına hiçbir şey yazılmaz. Giriş başarısızsa otomatik çekme DURUR (hesap kilitlenmesin diye tekrar denenmez).

import {
  loadCfg, loadState, saveState, rowsFromResult, guessMapping, toTasks, applyTasksToNote, notePathFor, applyFilter, type AssignedState, type SourceResult
} from './assignedTasks';

export const isAssignedSupported = (): boolean => typeof window !== 'undefined' && !!(window as any).electron?.taskSourceSync;

export interface SyncDeps {
  readNote: (path: string) => Promise<string | undefined>;
  saveNote: (path: string, content: string) => Promise<void>;
}

// Bu hatalarda aynı ayarla tekrar denemek anlamsız (ya da zararlı): kullanıcı düzeltene kadar otomatik çekme durur.
const PAUSE_CODES = new Set(['login-failed', 'no-credentials', 'config', 'insecure', 'login-form', 'no-table']);

export const runAssignedSync = async (deps: SyncDeps): Promise<AssignedState> => {
  const prev = loadState();
  if (!isAssignedSupported()) return prev;
  const cfg = loadCfg();
  const finish = (st: AssignedState) => { saveState(st); return st; };
  if (!cfg.loginUrl || cfg.sources.length === 0) return finish({ ...prev, lastSync: Date.now(), lastCode: 'config', lastError: 'Giriş adresi ve en az bir kaynak gerekli.', paused: true });

  const res = await (window as any).electron.taskSourceSync({
    loginUrl: cfg.loginUrl, allowHttp: cfg.allowHttp, maxPages: 10,
    sources: cfg.sources.map(s => ({ name: s.name, url: s.url, method: s.method, body: s.body, contentType: s.contentType, cookies: s.cookies, team: s.team }))
  });
  if (!res.ok) return finish({ ...prev, lastSync: Date.now(), lastCode: res.code, lastError: res.error, paused: PAUSE_CODES.has(res.code || '') });

  let total = 0, added = 0, updated = 0, completed = 0;
  const problems: string[] = [];
  const results: SourceResult[] = res.sources || [];
  for (let i = 0; i < results.length; i++) {
    const src = cfg.sources[(results[i] as any).sourceIndex ?? i];
    if (!src) continue;
    const noteName = results[i].name || src.name; // ekip adıyla bulunan kaynaklarda not adı ekibin adıdır
    const { fields, rows } = rowsFromResult(results[i]);
    const mapping = { ...guessMapping(fields), ...(src.mapping || {}) };
    if (!mapping.title) { problems.push(`"${noteName}": başlık alanı bulunamadı`); continue; }
    const tasks = toTasks(applyFilter(rows, src.filter), mapping, src.statusMap);
    total += tasks.length;
    if (tasks.length === 0) continue; // boş sonuç notu değiştirmez
    const path = notePathFor(noteName);
    const existing = await deps.readNote(path);
    const { content, stats } = applyTasksToNote(existing, noteName, tasks);
    if (content !== (existing ?? '')) await deps.saveNote(path, content);
    added += stats.added; updated += stats.updated; completed += stats.completed;
  }
  return finish({
    lastSync: Date.now(), lastCode: problems.length ? 'partial' : 'ok', lastError: problems.join(' · '),
    paused: false, summary: `${total} iş okundu · ${added} yeni · ${updated} güncellendi · ${completed} tamamlandı`
  });
};
