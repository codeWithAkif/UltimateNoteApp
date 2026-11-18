// "Atanan işler" eşitlemesi: Electron'dan ham veriyi alır (giriş orada yapılır, şifre buraya gelmez). Görevler, kullanıcının kendi yapısına (Müşteri → Proje → Görev) yazılır:
// kaynakta proje/müşteri bilgisi varsa görev, "{Müşteriler}/{Müşteri}/Projeler/{Proje}.md" notuna (varsa mevcut müşteri/proje notu kullanılır, yoksa oluşturulur);
// bilgi yoksa ekibin "Atananlar/{Ekip}.md" notuna. Yalnızca okur; şirket uygulamasına hiçbir şey yazılmaz. Giriş başarısızsa otomatik çekme DURUR.

import {
  loadCfg, loadState, saveState, rowsFromResult, guessMapping, toTasks, applyTasksToNote, notePathFor, noteFileName, slugOfName, applyFilter,
  type AssignedState, type AssignedTask, type SourceResult
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

export interface Dest { path: string; name: string; header: string; tasks: AssignedTask[]; extra?: { path: string; content: string } }

const nk = (s: string): string => s.replace(/\.md$/i, '').toLocaleLowerCase('tr').replace(/[\s_]+/g, ' ').trim();
const baseOf = (p: string): string => p.split('/').pop() || p;
const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

// Görevleri hedef notlara dağıtır. Proje bilgisi olmayanlar `fallbackName` ekip notuna gider.
export const resolveDestinations = async (
  tasks: AssignedTask[], fallbackName: string,
  deps: { notePaths: string[]; clientsFolder: string; readNote: (p: string) => Promise<string | undefined> }
): Promise<Dest[]> => {
  const groups = new Map<string, { client: string; project: string; tasks: AssignedTask[] }>();
  const loose: AssignedTask[] = [];
  for (const t of tasks) {
    if (!t.project) { loose.push(t); continue; }
    const key = `${nk(t.client || '')}|${nk(t.project)}`;
    const g = groups.get(key) || { client: t.client || '', project: t.project, tasks: [] };
    g.tasks.push(t); groups.set(key, g);
  }
  const out: Dest[] = [];
  if (loose.length) out.push({ path: notePathFor(fallbackName), name: fallbackName, header: '#proje #atananlar', tasks: loose });

  const findNote = async (name: string, tag: string, preferDir?: string): Promise<string | undefined> => {
    const cands = deps.notePaths.filter(p => /\.md$/i.test(p) && nk(baseOf(p)) === nk(name));
    cands.sort((a, b) => Number(!!preferDir && b.includes(preferDir)) - Number(!!preferDir && a.includes(preferDir)));
    for (const p of cands) { const c = await deps.readNote(p); if (c && c.toLowerCase().includes(tag)) return p; }
    return undefined;
  };

  for (const g of groups.values()) {
    const existing = await findNote(g.project, '#proje', '/Projeler/');
    if (existing) { out.push({ path: existing, name: baseOf(existing).replace(/\.md$/i, ''), header: '', tasks: g.tasks }); continue; }
    const projFile = noteFileName(g.project);
    if (!g.client) { out.push({ path: notePathFor(g.project), name: g.project, header: '#proje #atananlar', tasks: g.tasks }); continue; }
    const clientNote = await findNote(g.client, '#müşteri');
    let clientDir: string; let clientName: string; let extra: Dest['extra'];
    if (clientNote) { clientDir = dirOf(clientNote); clientName = baseOf(clientNote).replace(/\.md$/i, ''); }
    else {
      const cf = noteFileName(g.client);
      clientDir = `${deps.clientsFolder}/${cf}`; clientName = cf;
      extra = { path: `${clientDir}/${cf}.md`, content: `# ${g.client}\n\n#müşteri\n` };
    }
    out.push({ path: `${clientDir}/Projeler/${projFile}.md`, name: projFile, header: `#proje #${slugOfName(clientName)}`, tasks: g.tasks, extra });
  }
  return out;
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
    for (const d of await resolveDestinations(tasks, teamName, { notePaths, clientsFolder: deps.clientsFolder || 'Müşteriler', readNote: deps.readNote })) {
      const cur = dests.get(d.path);
      if (!cur) { dests.set(d.path, { ...d, tasks: [...d.tasks] }); continue; }
      const have = new Set(cur.tasks.map(t => t.id));
      d.tasks.forEach(t => { if (!have.has(t.id)) cur.tasks.push(t); });
    }
  }
  for (const d of dests.values()) {
    if (d.extra && !notePaths.includes(d.extra.path) && (await deps.readNote(d.extra.path)) === undefined) await deps.saveNote(d.extra.path, d.extra.content);
    const existing = await deps.readNote(d.path);
    const { content, stats } = applyTasksToNote(existing, d.name, d.tasks, d.header || '#proje');
    if (content !== (existing ?? '')) await deps.saveNote(d.path, content);
    added += stats.added; updated += stats.updated; completed += stats.completed;
  }
  return finish({
    lastSync: Date.now(), lastCode: problems.length ? 'partial' : 'ok', lastError: problems.join(' · '),
    paused: false, summary: `${total} iş okundu · ${added} yeni · ${updated} güncellendi · ${completed} tamamlandı`
  });
};
