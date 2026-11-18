// "Claude başlasın mı?" — bir görev için Claude Code'u PROJE KLASÖRÜNDE çalıştırır. Bu sürümde yalnızca PLAN çıkarır: araçlar Read/Glob/Grep ile
// sınırlıdır, yani dosya değiştiremez ve komut çalıştıramaz. Canlı ilerleme (hangi dosyayı okuyor) olay akışından çıkarılır.
//
// Güvenlik:
//  - Klasör, renderer'a güvenmeden burada yeniden denetlenir (projectFolder.cjs: disk kökü, kullanıcı klasörü, sistem klasörleri, notlar kasası reddedilir).
//  - Görev ekleri yalnızca kasadaki "Ekler/..." altından ve en çok 10 MB olanlar geçici bir klasöre kopyalanır; Claude yalnızca o kopyayı görür.
//  - ANTHROPIC_API_KEY ortamdan silinir (abonelik kullanılır), zaman aşımında ve iptalde süreç öldürülür, geçici klasör her durumda silinir.
//  - Aynı anda tek çalışma.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const projectFolder = require('./projectFolder.cjs');
const { findExe, cleanEnv } = require('./claudeCli.cjs');

const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
const MAX_PROMPT = 60000;

let current = null; // { id, child, cancelled }

const relTo = (dir, p) => {
  try { const r = path.relative(dir, p); return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : p; } catch { return p; }
};

const progressText = (dir, name, input) => {
  const i = input || {};
  switch (name) {
    case 'Read': { const fp = String(i.file_path || ''); return fp.includes('claude-task-') ? `Ek okunuyor: ${path.basename(fp)}` : `Dosya okunuyor: ${relTo(dir, fp)}`; }
    case 'Glob': return `Dosya aranıyor: ${String(i.pattern || '')}`;
    case 'Grep': return `Kodda aranıyor: ${String(i.pattern || '')}`;
    default: return `Araç: ${name}`;
  }
};

// Ekleri kasadan (yalnızca Ekler/ altı) geçici klasöre kopyalar; kopyalanan dosyaların mutlak yollarını döndürür.
const copyAttachments = (vaultDir, rels, destDir) => {
  const copied = [];
  if (!Array.isArray(rels) || !vaultDir) return copied;
  fs.mkdirSync(destDir, { recursive: true });
  for (const rel of rels.slice(0, 20)) {
    if (typeof rel !== 'string') continue;
    const norm = rel.replace(/\\/g, '/');
    if (!norm.startsWith('Ekler/') || norm.split('/').some(s => s === '..' || s === '')) continue;
    const src = path.resolve(vaultDir, norm);
    if (!src.toLowerCase().startsWith(path.resolve(vaultDir, 'Ekler').toLowerCase() + path.sep.toLowerCase())) continue;
    try {
      const st = fs.statSync(src);
      if (!st.isFile() || st.size > MAX_ATTACH_BYTES) continue;
      const dest = path.join(destDir, path.basename(src));
      fs.copyFileSync(src, dest);
      copied.push(dest);
    } catch { /* eksik dosya atlanır */ }
  }
  return copied;
};

// req: { runId, dir, prompt, attachments?: string[], model?, timeoutMs?, vaultDir }
const plan = (req, onProgress) => new Promise((resolve) => {
  const started = Date.now();
  const done = (v) => resolve({ ms: Date.now() - started, ...v });
  if (!req || typeof req.runId !== 'string' || !req.runId) return done({ ok: false, error: 'Geçersiz istek.' });
  if (typeof req.prompt !== 'string' || !req.prompt.trim() || req.prompt.length > MAX_PROMPT) return done({ ok: false, error: 'İstem boş ya da çok uzun.' });
  if (current) return done({ ok: false, error: 'Başka bir Claude çalışması sürüyor; bitmesini bekleyin.' });
  const model = req.model ? String(req.model) : '';
  if (model && !/^[A-Za-z0-9._\[\]-]{1,60}$/.test(model)) return done({ ok: false, error: 'Geçersiz model adı.' });

  const info = projectFolder.inspect(req.dir, req.vaultDir);
  if (!info.ok) return done({ ok: false, error: `Proje klasörü kullanılamaz: ${info.error}` });
  const exe = findExe();
  if (!exe) return done({ ok: false, error: 'Claude Code komutu bulunamadı (bu bilgisayarda kurulu değil).' });

  let tmpDir = '';
  let prompt = req.prompt;
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--tools', 'Read,Glob,Grep', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config'];
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-task-'));
    const copied = copyAttachments(req.vaultDir, req.attachments, path.join(tmpDir, 'ekler'));
    if (copied.length) {
      args.push('--add-dir', path.join(tmpDir, 'ekler'));
      prompt += `\n\nGÖREVE EKLİ DOSYALAR (ekran görüntüsü/belge; okuyabilirsin, bunlara bak):\n${copied.map(f => `- ${f}`).join('\n')}`;
    }
  } catch (e) {
    if (tmpDir) try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* yoksay */ }
    return done({ ok: false, error: `Ekler hazırlanamadı: ${String(e.message || e)}` });
  }
  if (model) args.push('--model', model);
  const timeoutMs = Math.min(Math.max(Number(req.timeoutMs) || 15 * 60000, 30000), 30 * 60000);

  const cleanup = () => { if (tmpDir) try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* yoksay */ } };
  let child;
  try { child = spawn(exe, args, { cwd: info.path, windowsHide: true, env: cleanEnv() }); }
  catch (e) { cleanup(); return done({ ok: false, error: String(e.message || e) }); }
  const run = { id: req.runId, child, cancelled: false };
  current = run;

  let buf = '', err = '', result = null, finished = false;
  const finish = (v) => { if (finished) return; finished = true; clearTimeout(timer); if (current === run) current = null; cleanup(); done(v); };
  const timer = setTimeout(() => { try { child.kill(); } catch { /* yoksay */ } finish({ ok: false, error: 'Claude zaman aşımına uğradı.' }); }, timeoutMs);

  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
        for (const c of ev.message.content) {
          if (c.type === 'tool_use' && typeof onProgress === 'function') { try { onProgress(progressText(info.path, c.name, c.input)); } catch { /* yoksay */ } }
          else if (c.type === 'text' && c.text && typeof onProgress === 'function') { try { onProgress('Plan yazılıyor…'); } catch { /* yoksay */ } }
        }
      } else if (ev.type === 'result') result = ev;
    }
  });
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', (e) => finish({ ok: false, error: String(e.message || e) }));
  child.on('close', (code) => {
    if (run.cancelled) return finish({ ok: false, cancelled: true, error: 'Durduruldu.' });
    if (!result) return finish({ ok: false, error: `Claude yanıtı alınamadı (çıkış ${code}). ${err.slice(0, 300)}` });
    if (result.is_error) return finish({ ok: false, error: String(result.result || 'Claude hata verdi.').slice(0, 400) });
    finish({ ok: true, text: typeof result.result === 'string' ? result.result : '', cost: result.total_cost_usd, turns: result.num_turns });
  });
  child.stdin.on('error', () => { /* süreç erken kapandıysa close bildirir */ });
  child.stdin.write(prompt);
  child.stdin.end();
});

const cancel = (runId) => {
  if (current && current.id === runId) { current.cancelled = true; try { current.child.kill(); } catch { /* yoksay */ } return { ok: true }; }
  return { ok: false };
};
const cancelAll = () => { if (current) { current.cancelled = true; try { current.child.kill(); } catch { /* yoksay */ } } };

module.exports = { plan, cancel, cancelAll };
