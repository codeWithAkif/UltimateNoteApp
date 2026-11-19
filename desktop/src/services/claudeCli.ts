// "Claude Code (yerel)" sağlayıcısı (yalnızca masaüstü): bu bilgisayarda kurulu ve giriş yapılmış Claude Code'u çağırır; çağrılar API parası
// yerine kişisel Claude aboneliğinden harcanır. Varsayılan KAPALI; Ayarlar > AI Mentor'dan açılır. Yalnızca kişisel kullanım içindir.
// Asıl iş electron/claudeCli.cjs'te yapılır (araçlar kapalı, geçici klasör, zaman aşımı). Burada ayarlar ve çağrı sarmalayıcısı var.

const ENABLED_KEY = 'claude_cli_enabled';
const FIRST_KEY = 'claude_cli_first';
const MODEL_KEY = 'claude_cli_model';
export const CLAUDE_CLI_MODELS = ['haiku', 'sonnet', 'opus'];
export const DEFAULT_CLAUDE_CLI_MODEL = 'haiku';

export const isClaudeCliSupported = (): boolean => typeof window !== 'undefined' && !!(window as any).electron?.claudeCliRun;

const getBool = (k: string): boolean => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const setBool = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* yoksay */ } };

export const isClaudeCliEnabled = (): boolean => isClaudeCliSupported() && getBool(ENABLED_KEY);
export const setClaudeCliEnabled = (v: boolean) => setBool(ENABLED_KEY, v);
export const isClaudeCliFirst = (): boolean => getBool(FIRST_KEY);
export const setClaudeCliFirst = (v: boolean) => setBool(FIRST_KEY, v);
export const getClaudeCliModel = (): string => { try { return localStorage.getItem(MODEL_KEY) || DEFAULT_CLAUDE_CLI_MODEL; } catch { return DEFAULT_CLAUDE_CLI_MODEL; } };
export const setClaudeCliModel = (m: string) => { try { localStorage.setItem(MODEL_KEY, m); } catch { /* yoksay */ } };

export const claudeCliStatus = async () => {
  if (!isClaudeCliSupported()) return { available: false, error: 'Yalnızca masaüstü uygulamasında kullanılabilir.' };
  return (window as any).electron.claudeCliStatus();
};

// Aramalı düz metin (Dışarı işler, video bulma): yalnızca web arama aracı açık olarak çağrılır.
export async function claudeCliGroundedText(prompt: string): Promise<string> {
  if (!isClaudeCliSupported()) throw new Error('Claude Code (yerel) yalnızca masaüstü uygulamasında çalışır.');
  const r = await (window as any).electron.claudeCliRun({ prompt, model: getClaudeCliModel(), search: true, timeoutMs: 150000 });
  if (!r?.ok) throw new Error(r?.error || 'Claude Code çağrısı başarısız.');
  return String(r.text || '');
}

// Yapılandırılmış JSON isteği: şema --json-schema ile verilir; yanıt structured_output'tan, yoksa metinden ayrıştırılır.
export async function claudeCliJson<T>(prompt: string, schema: any): Promise<T> {
  if (!isClaudeCliSupported()) throw new Error('Claude Code (yerel) yalnızca masaüstü uygulamasında çalışır.');
  const r = await (window as any).electron.claudeCliRun({ prompt, schema, model: getClaudeCliModel() });
  if (!r?.ok) throw new Error(r?.error || 'Claude Code çağrısı başarısız.');
  if (r.structured && typeof r.structured === 'object') return r.structured as T;
  try {
    const m = String(r.text || '').match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
  } catch { /* aşağıda hata */ }
  throw new Error('Claude Code yanıtı beklenen biçimde gelmedi.');
}
