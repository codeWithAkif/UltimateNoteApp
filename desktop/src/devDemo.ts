// Geliştir ekranının DEMO kipi. Yalnızca "Geliştir > Önizle" önizlemesi adresine eklediği `?onizleme=1` ile (ve masaüstü API'si yokken) etkinleşir.
// Önizleme tarayıcı modunda çalıştığı için gerçek Geliştir sekmesi (yalnızca masaüstü) orada yoktur; bu demo, ekrana yapılan değişikliklerin
// örnek verilerle görülebilmesi için sahte bir masaüstü API'si kurar. Hiçbir gerçek işlem yapmaz: git, Claude, dosya, ağ YOK; her şey bellekte örnektir.
// Not: window.electron, uygulama modülleri yüklendikten SONRA tanımlanır; böylece uygulama tarayıcı modunda (isElectron=false) çalışmaya devam eder.

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const PX = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="260" height="160"><rect width="260" height="160" fill="#1f2937"/><text x="130" y="85" fill="#9ca3af" font-size="14" text-anchor="middle" font-family="sans-serif">örnek ekran görüntüsü</text></svg>');

export const installDevDemo = (): void => {
  try {
    if (typeof window === 'undefined' || (window as any).electron) return;
    if (new URLSearchParams(window.location.search).get('onizleme') !== '1') return;
    const now = Date.now();
    const mk = (id: string, title: string, stage: string, extra: any = {}) => ({ id, title, detail: '', model: 'sonnet', createdAt: now - 3600e3, updatedAt: now, stage, log: [{ t: now - 60000, text: 'Örnek kayıt' }], ...extra });
    const store: any = {
      requests: [
        mk('d1', 'Örnek: yeni istek', 'istek'),
        mk('d2', 'Örnek: plan hazır', 'plan', { plan: '## 1. Anlaşılan\n- örnek plan\n\n## 6. Emin olmadığım noktalar\n1. Hangi bölüm?\n2. Ne zaman görünsün?' }),
        mk('d3', 'Örnek: Claude çalışıyor', 'yapiliyor'),
        mk('d4', 'Örnek: kontrol', 'kontrol'),
        mk('d5', 'Örnek: inceleme', 'inceleme', { branch: 'claude/ornek-ab12', worktree: 'C:\\demo\\repo-claude-ab12', rounds: 1, stat: '2 files changed, 12 insertions(+)', files: [{ status: 'M', path: 'desktop/src/ornek.tsx' }, { status: 'A', path: 'desktop/src/yeni.ts' }], check: { ok: true, at: now }, summary: '1. Yapılanlar\n- örnek özet' }),
        mk('d6', 'Örnek: yayına hazır', 'birlesti'),
        mk('d7', 'Örnek: yayında', 'yayinda', { version: '1.0.0' })
      ],
      releases: [{ version: '1.0.0', at: now - 86400e3, requestIds: ['d7'], summary: '', ci: 'success' }]
    };
    const progress = new Set<(d: any) => void>();
    const emit = async (runId: string, lines: string[]) => { for (const t of lines) { await sleep(700); progress.forEach(cb => cb({ runId, text: t })); } };
    const api: any = {
      devStoreGet: async () => JSON.parse(JSON.stringify(store)),
      devStoreSet: async (d: any) => { store.requests = d.requests; store.releases = d.releases; return { ok: true }; },
      devStatus: async () => ({ ok: true, path: 'C:\\demo\\repo', name: 'repo (DEMO)', branch: 'master', version: '1.0.0', lastTag: 'v1.0.0', dirty: 0, ahead: 1, behind: 0 }),
      devCheck: async () => { await sleep(1500); return { ok: true }; },
      devDiff: async (r: any) => ({ ok: true, files: [{ added: 12, removed: 1, path: r.file || 'desktop/src/ornek.tsx' }], text: 'diff --git a/x b/x\n@@ -1,2 +1,3 @@\n-eski satır\n+yeni satır\n+bir satır daha\n bağlam' }),
      devMerge: async () => { await sleep(1500); return { ok: true, head: 'abc1234', commits: 1 }; },
      devReleasePlan: async () => ({ ok: true, latest: '1.0.0', lastTag: 'v1.0.0', current: '1.0.0', branch: 'master', next: { patch: '1.0.1', minor: '1.1.0', major: '2.0.0' }, commits: ['feat: örnek özellik', 'fix: örnek düzeltme'], fileCount: 3, files: [], findings: [], ahead: 1, pulled: 0 }),
      devReleaseDo: async (r: any) => { await sleep(1500); return { ok: true, tag: 'v' + r.version, version: r.version }; },
      devCi: async () => ({ ok: true, state: 'running' }),
      devPreviewStart: async () => { await sleep(600); return { ok: true, url: 'about:blank', port: 0 }; },
      devPreviewStop: async () => ({ ok: true }),
      devPreviewShot: async () => ({ ok: true, path: 'C:\\demo\\shot-' + Date.now() + '.png', thumb: PX }),
      getAppVersion: async () => '1.0.0',
      onDevProgress: () => () => { /* demo */ },
      onUpdateStatus: () => () => { /* demo */ },
      claudeCliRun: async () => ({ ok: true, text: '' }),
      claudeCliStatus: async () => ({ available: true, loggedIn: true, version: 'demo', authMethod: 'demo' }),
      claudeAgentPlan: async (r: any) => { await emit(r.runId, ['Dosya okunuyor: örnek.tsx', 'Kodda aranıyor: örnek', 'Plan yazılıyor…']); return { ok: true, text: '## 1. Anlaşılan\n- (demo) örnek plan metni', ms: 2100 }; },
      claudeAgentApply: async (r: any) => { await emit(r.runId, ['Ayrı dal ve çalışma kopyası hazırlanıyor…', 'Düzenleniyor: örnek.tsx', 'Komut: git diff', 'Yanıt yazılıyor…']); return { ok: true, changed: true, text: '1. Yapılanlar\n- (demo) örnek değişiklik', branch: 'claude/ornek-cd34', worktree: 'C:\\demo\\repo-claude-cd34', stat: '1 file changed', files: [{ status: 'M', path: 'desktop/src/ornek.tsx' }], ms: 2800 }; },
      claudeAgentCancel: async () => ({ ok: true }),
      claudeAgentDiscard: async () => ({ ok: true }),
      claudeAgentOpenFolder: async () => ({ ok: true }),
      onClaudeAgentProgress: (cb: (d: any) => void) => { progress.add(cb); return () => { progress.delete(cb); }; },
      pickProjectFolder: async () => ({ canceled: true }),
      inspectProjectFolder: async () => ({ ok: true, path: 'C:\\demo\\repo', name: 'repo (DEMO)', isGit: true, branch: 'master' })
    };
    (window as any).electron = api;
    (window as any).__devDemo = true;
    try {
      localStorage.setItem('project_folders_v1', JSON.stringify({ 'uygulama-gelistirme': 'C:\\demo\\repo' }));
      localStorage.setItem('active_tab', 'develop');
      localStorage.setItem('onboarding_completed_v1', '1'); // boş tarayıcıda karşılama notu açılıp Notlar'a atlamasın
    } catch { /* yoksay */ }
  } catch { /* demo kurulamazsa uygulama normal açılır */ }
};
