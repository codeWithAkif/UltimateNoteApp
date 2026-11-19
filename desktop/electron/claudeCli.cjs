// "Claude Code (yerel)" sağlayıcısı: bu bilgisayarda kurulu ve giriş yapılmış Claude Code komut satırını tek seferlik (print) modda çalıştırır.
// Böylece uygulamadaki yapay zekâ özellikleri API parası yerine kişisel Claude aboneliğini kullanabilir. Yalnızca kişisel kullanım içindir.
// Güvenlik: yalnızca sabit yoldaki claude programı çalıştırılır; istem stdin'den, şema ve model doğrulanarak verilir; araçlar kapalıdır
// (dosyaya/komuta erişemez), geçici klasörde çalışır, zaman aşımında öldürülür. ANTHROPIC_API_KEY ortamdan silinir ki çağrı API'ye
// (ücretli) değil aboneliğe yazılsın.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_PROMPT = 200000;

const candidates = () => process.platform === 'win32'
  ? [path.join(os.homedir(), '.local', 'bin', 'claude.exe')]
  : [path.join(os.homedir(), '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude'];

const findExe = () => candidates().find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;

const cleanEnv = () => {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
};

// Kısa süreli komut çalıştırır (sürüm / giriş durumu için).
const runShort = (exe, args, timeoutMs) => new Promise((resolve) => {
  let out = '', err = '', done = false;
  const finish = (v) => { if (!done) { done = true; resolve(v); } };
  let child;
  try { child = spawn(exe, args, { cwd: os.tmpdir(), windowsHide: true, env: cleanEnv() }); }
  catch (e) { return finish({ code: -1, out: '', err: String(e.message || e) }); }
  const timer = setTimeout(() => { try { child.kill(); } catch { /* yoksay */ } finish({ code: -2, out, err: 'zaman aşımı' }); }, timeoutMs);
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  child.on('error', e => { clearTimeout(timer); finish({ code: -1, out, err: String(e.message || e) }); });
  child.on('close', code => { clearTimeout(timer); finish({ code, out, err }); });
});

const status = async () => {
  const exe = findExe();
  if (!exe) return { available: false, error: 'Claude Code komutu bulunamadı. Kurulum: irm https://claude.ai/install.ps1 | iex' };
  const v = await runShort(exe, ['--version'], 20000);
  const a = await runShort(exe, ['auth', 'status'], 20000);
  let loggedIn = false, authMethod = '';
  try { const j = JSON.parse(a.out); loggedIn = !!j.loggedIn; authMethod = String(j.authMethod || ''); } catch { /* yoksay */ }
  return { available: true, version: v.out.trim().split('\n')[0] || '', loggedIn, authMethod };
};

// req: { prompt: string, schema?: object, model?: string, timeoutMs?: number }
const run = (req) => new Promise((resolve) => {
  const started = Date.now();
  const fail = (error) => resolve({ ok: false, error, ms: Date.now() - started });
  if (!req || typeof req.prompt !== 'string' || !req.prompt.trim()) return fail('İstem boş.');
  if (req.prompt.length > MAX_PROMPT) return fail('İstem çok uzun.');
  const model = req.model ? String(req.model) : '';
  if (model && !/^[A-Za-z0-9._\[\]-]{1,60}$/.test(model)) return fail('Geçersiz model adı.');
  const exe = findExe();
  if (!exe) return fail('Claude Code komutu bulunamadı (bu bilgisayarda kurulu değil).');

  // Araçlar kapalıdır (dosya/komut erişimi yok). Yalnızca req.search ise SADECE web arama aracı açılır (aramalı metin: Dışarı işler, video bulma).
  const args = ['-p', '--output-format', 'json', '--tools', req.search ? 'WebSearch' : '', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config'];
  if (req.search) args.push('--allowedTools', 'WebSearch');
  if (req.schema && typeof req.schema === 'object') args.push('--json-schema', JSON.stringify(req.schema));
  if (model) args.push('--model', model);
  const timeoutMs = Math.min(Math.max(Number(req.timeoutMs) || 90000, 5000), 180000);

  let out = '', err = '', done = false;
  const finish = (v) => { if (!done) { done = true; resolve(v); } };
  let child;
  try { child = spawn(exe, args, { cwd: os.tmpdir(), windowsHide: true, env: cleanEnv() }); }
  catch (e) { return fail(String(e.message || e)); }
  const timer = setTimeout(() => { try { child.kill(); } catch { /* yoksay */ } finish({ ok: false, error: 'Claude Code zaman aşımına uğradı.', ms: Date.now() - started }); }, timeoutMs);
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  child.on('error', e => { clearTimeout(timer); finish({ ok: false, error: String(e.message || e), ms: Date.now() - started }); });
  child.on('close', (code) => {
    clearTimeout(timer);
    const ms = Date.now() - started;
    let j = null;
    try { j = JSON.parse(out); } catch { /* aşağıda */ }
    if (!j) return finish({ ok: false, error: `Claude Code yanıtı okunamadı (çıkış ${code}). ${(err || out).slice(0, 300)}`, ms });
    if (j.is_error) return finish({ ok: false, error: String(j.result || 'Claude Code hata verdi.').slice(0, 400), ms });
    finish({ ok: true, structured: j.structured_output ?? null, text: typeof j.result === 'string' ? j.result : '', ms });
  });
  child.stdin.on('error', () => { /* süreç erken kapandıysa close olayı hatayı bildirir */ });
  child.stdin.write(req.prompt);
  child.stdin.end();
});

module.exports = { run, status, findExe, cleanEnv };
