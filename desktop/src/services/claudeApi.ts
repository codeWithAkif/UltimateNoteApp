// Claude (Anthropic) yedek yolu: Gemini'nin ücretsiz kotası dolduğunda ya da Gemini sunucu hatası verdiğinde, kullanıcı
// kendi Claude API anahtarını girdiyse aynı istek Claude'a gider. Anahtar yalnızca bu cihazın localStorage'ında durur
// (Gemini anahtarıyla aynı yaklaşım) ve yalnızca api.anthropic.com'a gönderilir.
// Tarayıcıdan doğrudan çağrı için Anthropic'in "anthropic-dangerous-direct-browser-access" başlığı gerekir; anahtar kullanıcının
// kendi cihazında olduğu için bu kabul edilen bir takas (uygulamanın sunucusu yok).

const KEY_STORAGE = 'claude_api_key';
const MODEL_STORAGE = 'claude_model';
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';
export const CLAUDE_MODEL_OPTIONS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
const API_URL = 'https://api.anthropic.com/v1/messages';

export const getClaudeApiKey = (): string | null => {
  try { return localStorage.getItem(KEY_STORAGE); } catch { return null; }
};
export const setClaudeApiKey = (key: string) => {
  try {
    if (key && key.trim()) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch { /* yoksay */ }
};
export const getClaudeModel = (): string => {
  try { return localStorage.getItem(MODEL_STORAGE) || DEFAULT_CLAUDE_MODEL; } catch { return DEFAULT_CLAUDE_MODEL; }
};
export const setClaudeModel = (model: string) => {
  try {
    if (model && model.trim()) localStorage.setItem(MODEL_STORAGE, model.trim());
    else localStorage.removeItem(MODEL_STORAGE);
  } catch { /* yoksay */ }
};
export const isClaudeConfigured = (): boolean => !!getClaudeApiKey();

async function post(body: any): Promise<any> {
  const key = getClaudeApiKey();
  if (!key) throw new Error('Claude API anahtarı ayarlanmamış. Ayarlar > AI Mentor bölümünden ekleyin.');
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });
  } catch (e: any) {
    throw new Error(`Claude API'ye ulaşılamadı: ${String(e?.message || e)}`);
  }
  if (!res.ok) {
    let errText = '';
    try { errText = await res.text(); } catch { /* yoksay */ }
    throw new Error(`Claude API hatası (${res.status}): ${errText.slice(0, 300)}`);
  }
  return res.json();
}

// Yapılandırılmış JSON: şema bir "araç" olarak verilir ve model onu çağırmaya zorlanır; dönen girdi doğrudan geçerli nesnedir.
export async function claudeJson<T>(prompt: string, schema: any): Promise<T> {
  const data = await post({
    model: getClaudeModel(),
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
    tools: [{ name: 'yanit', description: 'İstenen yapıda yanıtı döndür.', input_schema: schema }],
    tool_choice: { type: 'tool', name: 'yanit' }
  });
  const block = Array.isArray(data?.content) ? data.content.find((b: any) => b?.type === 'tool_use') : null;
  if (!block || typeof block.input !== 'object' || block.input === null) throw new Error('Claude yanıtı beklenen biçimde gelmedi.');
  return block.input as T;
}

// Aramalı düz metin (Dışarı işler gibi): Claude'un web arama aracı. Hesabınızda web aramanın Anthropic Console'dan açık olması gerekir.
export async function claudeGroundedText(prompt: string): Promise<string> {
  const data = await post({
    model: getClaudeModel(),
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]
  });
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n');
}
