// "Claude başlasın mı?": görev kartı Devam Ediyor'a geçince (ya da karttaki ✨ düğmesiyle) Claude Code proje klasöründe görev için PLAN çıkarır.
// PLAN aşaması yalnızca okur; UYGULA aşaması görevi projenin ayrı bir git dalında/çalışma kopyasında yapar (push/birleştirme yok, farkı kullanıcı görür).
// Asıl iş electron/claudeAgent.cjs'te; burada ayarlar ve istem kurma var.

import { claudeCliStatus } from './claudeCli';

const ASK_OFF_KEY = 'claude_task_ask_off_v1';
const MODEL_KEY = 'claude_task_model';
export const CLAUDE_TASK_MODELS: { value: string; label: string }[] = [
  { value: 'haiku', label: 'haiku (hızlı, ucuz)' },
  { value: 'sonnet', label: 'sonnet (önerilen)' },
  { value: 'opus', label: 'opus (en güçlü, yavaş)' }
];

export const isClaudeTaskSupported = (): boolean => typeof window !== 'undefined' && !!(window as any).electron?.claudeAgentPlan;

const norm = (p: string) => p.trim().toLocaleLowerCase('tr');
const loadOff = (): Record<string, boolean> => { try { const o = JSON.parse(localStorage.getItem(ASK_OFF_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
// Projede kart Devam Ediyor'a geçince sorulsun mu? (varsayılan evet; yalnızca klasör seçilmiş projelerde sorulur)
export const isAskEnabled = (project: string): boolean => !loadOff()[norm(project)];
export const setAskEnabled = (project: string, on: boolean) => {
  try { const m = loadOff(); if (on) delete m[norm(project)]; else m[norm(project)] = true; localStorage.setItem(ASK_OFF_KEY, JSON.stringify(m)); } catch { /* yoksay */ }
};
export const getTaskModel = (): string => { try { return localStorage.getItem(MODEL_KEY) || 'sonnet'; } catch { return 'sonnet'; } };
export const setTaskModel = (m: string) => { try { localStorage.setItem(MODEL_KEY, m); } catch { /* yoksay */ } };

// Claude Code kurulu ve giriş yapılmış mı? (her kart sürüklemesinde sormamak için 5 dakika önbelleklenir)
let readyCache: { at: number; ok: boolean } | null = null;
export const isClaudeReady = async (): Promise<boolean> => {
  if (readyCache && Date.now() - readyCache.at < 5 * 60000) return readyCache.ok;
  try { const st = await claudeCliStatus(); const ok = !!(st.available && st.loggedIn); readyCache = { at: Date.now(), ok }; return ok; }
  catch { return false; }
};

export const buildPlanPrompt = (o: { title: string; project: string }): string =>
  `Sen bu klasördeki yazılım projesinde (${o.project}) çalışan deneyimli bir geliştiricisin. Aşağıdaki görev için bir UYGULAMA PLANI hazırla.
Bu aşamada hiçbir dosyayı DEĞİŞTİRME (zaten yalnızca okuma araçların var); yalnızca kodu incele ve planı yaz.

GÖREV: ${o.title}

Planı Türkçe, kısa ve madde madde yaz; şu başlıkları kullan:
1. Görevin anlaşılan hâli (1-2 cümle) ve yaptığın varsayımlar
2. İlgili dosyalar ve neden (dosya:satır olarak)
3. Yapılacak değişiklikler (adım adım)
4. Riskler / dikkat edilecekler
5. Nasıl test edilir
6. Emin olmadığın noktalar (kullanıcıya sorulacak sorular)
Görev metni belirsizse bunu açıkça yaz; tahminle ilerleme, soru olarak listele.`;

export const buildApplyPrompt = (o: { title: string; project: string; plan?: string }): string =>
  `Sen bu klasördeki yazılım projesinde (${o.project}) çalışan deneyimli bir geliştiricisin. Aşağıdaki görevi UYGULA.
Şu an projenin ayrı bir git dalındaki çalışma kopyasındasın; değişiklikler yalnızca burada kalır, kullanıcı sonra farkı görüp karar verecek.

GÖREV: ${o.title}
${o.plan ? `\nONAYLANAN PLAN (buna uy; ayrıldığın yerde nedenini son yanıtta yaz):\n${o.plan.slice(0, 20000)}\n` : ''}
KURALLAR:
- Yalnızca görevin gerektirdiği dosyaları değiştir; kapsam dışı iyileştirme ya da yeniden düzenleme yapma.
- Bu klasörün dışındaki hiçbir şeye dokunma. git push, dal değiştirme/silme, commit, birleştirme, bağımlılık kurma (npm install vb.), ağ erişimi YAPMA (zaten kapalı); commit'i uygulama atar.
- Görev bu klasörün dışında bir eylem gerektiriyorsa (ör. GitHub'da uzak dal silme, deploy, PR açma, mesaj gönderme) onu YAPMA; "Elle yapılacaklar" başlığı altında çalıştırılacak tam komutlarla listele.
- Derleme/test komutu varsa çalıştır (npm run build, npx tsc --noEmit, testler). Bağımlılıklar yoksa ya da komut izinli değilse bunu açıkça yaz; çalışmış gibi davranma.
- Görev belirsizse tahminle büyük değişiklik yapma; yapabildiğini yap, geri kalanı soru olarak yaz.

SON YANITINI Türkçe, kısa ve şu başlıklarla yaz:
1. Yapılanlar
2. Değişen dosyalar (neden)
3. Doğrulama (çalıştırdığın komutlar ve sonuçları)
4. Yapılmayanlar / Elle yapılacaklar / Sorular`;

export interface ApplyResult {
  ok: boolean; text?: string; error?: string; cancelled?: boolean; ms?: number; cost?: number;
  changed?: boolean; partial?: boolean; dirtyBase?: boolean; branch?: string; worktree?: string; base?: string; stat?: string; files?: { status: string; path: string }[];
}

export const applyTask = async (runId: string, req: PlanRequest & { plan?: string; prompt?: string; reuse?: { worktree: string; branch: string } }, onProgress: (text: string) => void): Promise<ApplyResult> => {
  const api = (window as any).electron;
  if (!api?.claudeAgentApply) return { ok: false, error: 'Yalnızca masaüstü uygulamasında kullanılabilir.' };
  const unsub = api.onClaudeAgentProgress?.((d: { runId?: string; text: string }) => { if (d.runId === runId) onProgress(d.text); });
  try {
    return await api.claudeAgentApply({ runId, dir: req.dir, title: req.title, prompt: req.prompt || buildApplyPrompt({ title: req.title, project: req.project, plan: req.plan }), attachments: req.attachments, model: req.model, reuse: req.reuse });
  } finally { try { unsub?.(); } catch { /* yoksay */ } }
};

export const discardWork = async (dir: string, worktree: string, branch: string): Promise<{ ok: boolean; error?: string }> => {
  try { return (await (window as any).electron?.claudeAgentDiscard?.({ dir, worktree, branch })) || { ok: false, error: 'Kullanılamıyor.' }; }
  catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
};

export const openWorkFolder = async (dir: string, worktree: string): Promise<{ ok: boolean; error?: string }> => {
  try { return (await (window as any).electron?.claudeAgentOpenFolder?.({ dir, worktree })) || { ok: false, error: 'Kullanılamıyor.' }; }
  catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
};

export interface PlanRequest { dir: string; title: string; project: string; attachments: string[]; model: string }
export interface PlanResult { ok: boolean; text?: string; error?: string; cancelled?: boolean; ms?: number; cost?: number }

export const planTask = async (runId: string, req: PlanRequest, onProgress: (text: string) => void): Promise<PlanResult> => {
  const api = (window as any).electron;
  if (!api?.claudeAgentPlan) return { ok: false, error: 'Yalnızca masaüstü uygulamasında kullanılabilir.' };
  const unsub = api.onClaudeAgentProgress?.((d: { runId?: string; text: string }) => { if (d.runId === runId) onProgress(d.text); });
  try {
    return await api.claudeAgentPlan({ runId, dir: req.dir, prompt: buildPlanPrompt({ title: req.title, project: req.project }), attachments: req.attachments, model: req.model });
  } finally { try { unsub?.(); } catch { /* yoksay */ } }
};

export const cancelPlan = async (runId: string): Promise<void> => {
  try { await (window as any).electron?.claudeAgentCancel?.(runId); } catch { /* yoksay */ }
};
