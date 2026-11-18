// "Atanan işler" eşitlemesi: Electron'dan ham veriyi alır (giriş orada yapılır, şifre buraya gelmez). Görevler, kullanıcının kendi yapısına (Müşteri → Proje → Görev) yazılır:
// kaynakta proje/müşteri bilgisi varsa görev, "{Müşteriler}/{Müşteri}/Projeler/{Proje}.md" notuna (varsa mevcut müşteri/proje notu kullanılır, yoksa oluşturulur);
// bilgi yoksa ekibin "Atananlar/{Ekip}.md" notuna. Yalnızca okur; şirket uygulamasına hiçbir şey yazılmaz. Giriş başarısızsa otomatik çekme DURUR.

import {
  loadCfg, loadState, saveState, rowsFromResult, guessMapping, toTasks, applyTasksToNote, notePathFor, noteFileName, slugOfName, applyFilter,
  nk, mapKey, type AssignedState, type AssignedTask, type SourceResult, type ProjectMapEntry, type PendingItem
} from './assignedTasks';

export const isAssignedSupported = (): boolean => typeof window !== 'undefined' && !!(window as any).electron?.taskSourceSync;

export interface SyncDeps {
  readNote: (path: string) => Promise<string | undefined>;
  saveNote: (path: string, content: string) => Promise<void>;
  notePaths?: () => string[];   // mevcut tüm not yolları (müşteri/proje notunu bulmak için)
  clientsFolder?: string;       // Ayarlar > Clients kök klasörü
}

// Bu hatalarda aynı ayarla tekrar denemek anlamsız (ya da zararlı): kullanıcı düzeltene kadar otomatik çekme durur.
const PAUSE_CODES = new Set(['login-failed', 'no-credentials', 'config', 'insecure', 'login-form', 'no-table']);

export interface Dest { path: string; name: string; header: string; tasks: AssignedTask[] }

const baseOf = (p: string): string => p.split('/').pop() || p;

// Görevleri hedef notlara dağıtır. Proje bilgisi olmayanlar `fallbackName` ekip notuna gider. Proje bilgisi olanlar YALNIZCA kullanıcının elle yaptığı eşlemeye göre
// (ProTracker müşteri/proje → kendi müşteri/projesi) yazılır; eşlenmemişler yazılmaz, `pending` olarak döner. Hiçbir müşteri/proje kendiliğinden oluşturulmaz
// (yalnızca eşlemede seçilen/yazılan PROJE, seçilen müşterinin altında yoksa o müşterinin Projeler klasöründe açılır).
export const resolveDestinations = async (
  tasks: AssignedTask[], fallbackName: string,
  deps: { notePaths: string[]; clientsFolder: string; readNote: (p: string) => Promise<string | undefined>; projectMap?: Record<string, ProjectMapEntry> }
): Promise<{ dests: Dest[]; pending: PendingItem[] }> => {
  const groups = new Map<string, { client?: string; project: string; tasks: AssignedTask[] }>();
  const loose: AssignedTask[] = [];
  for (const t of tasks) {
    if (!t.project) { loose.push(t); continue; }
    const key = mapKey(t.client, t.project);
    const g = groups.get(key) || { client: t.client, project: t.project, tasks: [] };
    g.tasks.push(t); groups.set(key, g);
  }
  const dests: Dest[] = [];
  const pending: PendingItem[] = [];
  if (loose.length) dests.push({ path: notePathFor(fallbackName), name: fallbackName, header: '#proje #atananlar', tasks: loose });

  const root = deps.clientsFolder;
  for (const [key, g] of groups) {
    const m = deps.projectMap?.[key];
    if (!m || !m.client || !m.project) { pending.push({ client: g.client, project: g.project, count: g.tasks.length }); continue; }
    const clientDir = `${root}/${noteFileName(m.client)}`;
    const inClient = deps.notePaths.filter(p => /\.md$/i.test(p) && p.toLowerCase().startsWith(clientDir.toLowerCase() + '/'));
    if (inClient.length === 0) { pending.push({ client: g.client, project: g.project, count: g.tasks.length }); continue; } // müşteri klasörü yok: kendiliğinden açılmaz
    // müşterinin mevcut proje notu (aynı ad, #proje)
    let found: string | undefined;
    for (const p of inClient.filter(p => nk(baseOf(p)) === nk(m.project))) { const c = await deps.readNote(p); if (c && c.toLowerCase().includes('#proje')) { found = p; break; } }
    if (found) { dests.push({ path: found, name: baseOf(found).replace(/\.md$/i, ''), header: '', tasks: g.tasks }); continue; }
    // yeni proje notu: müşterinin kendi notunun adından etiket (Borusan → #borusan)
    const clientNote = inClient.find(p => !p.toLowerCase().includes('/projeler/') && /\.md$/i.test(p));
    const slugBase = clientNote ? baseOf(clientNote).replace(/\.md$/i, '') : m.client;
    const projFile = noteFileName(m.project);
    dests.push({ path: `${clientDir}/Projeler/${projFile}.md`, name: projFile, header: `#proje #${slugOfName(slugBase)}`, tasks: g.tasks });
  }
  return { dests, pending };
};

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
  const pendingAll = new Map<string, PendingItem>();
  const dests = new Map<string, Dest>(); // aynı notaya giden görevler birleştirilir (tek yazım)
  const notePaths = deps.notePaths ? deps.notePaths() : [];
  for (let i = 0; i < results.length; i++) {
    const src = cfg.sources[(results[i] as any).sourceIndex ?? i];
    if (!src) continue;
    const teamName = results[i].name || src.name;
    const { fields, rows } = rowsFromResult(results[i]);
    const mapping = { ...guessMapping(fields), ...(src.mapping || {}) };
    if (!mapping.title) { problems.push(`"${teamName}": başlık alanı bulunamadı`); continue; }
    const tasks = toTasks(applyFilter(rows, src.filter), mapping, src.statusMap);
    total += tasks.length;
    if (tasks.length === 0) continue; // boş sonuç notu değiştirmez
    const resolved = await resolveDestinations(tasks, teamName, { notePaths, clientsFolder: deps.clientsFolder || 'Müşteriler', readNote: deps.readNote, projectMap: cfg.projectMap });
    for (const p of resolved.pending) {
      const k = mapKey(p.client, p.project);
      const ex = pendingAll.get(k);
      if (ex) ex.count += p.count; else pendingAll.set(k, { ...p });
    }
    for (const d of resolved.dests) {
      const cur = dests.get(d.path);
      if (!cur) { dests.set(d.path, { ...d, tasks: [...d.tasks] }); continue; }
      const have = new Set(cur.tasks.map(t => t.id));
      d.tasks.forEach(t => { if (!have.has(t.id)) cur.tasks.push(t); });
    }
  }
  for (const d of dests.values()) {
    const existing = await deps.readNote(d.path);
    const { content, stats } = applyTasksToNote(existing, d.name, d.tasks, d.header || '#proje');
    if (content !== (existing ?? '')) await deps.saveNote(d.path, content);
    added += stats.added; updated += stats.updated; completed += stats.completed;
  }
  const pending = [...pendingAll.values()];
  const waiting = pending.reduce((n, p) => n + p.count, 0);
  return finish({
    lastSync: Date.now(), lastCode: problems.length ? 'partial' : 'ok', lastError: problems.join(' · '),
    paused: false, pending,
    summary: `${total} iş okundu · ${added} yeni · ${updated} güncellendi · ${completed} tamamlandı${waiting ? ` · ${waiting} iş eşleme bekliyor` : ''}`
  });
};
