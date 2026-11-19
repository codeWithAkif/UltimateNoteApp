// "Claude başlasın mı?" — bir görev için Claude Code'u PROJE KLASÖRÜNDE çalıştırır. PLAN aşaması yalnızca okur (aşağıda UYGULA aşaması ayrı): araçlar Read/Glob/Grep ile
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

// ---------------------------------------------------------------------------------------------------------------------------------------
// UYGULA aşaması: görevi projenin AYRI bir git çalışma kopyasında (worktree) ve ayrı bir dalda yapar. Ana klasöre ve ana dala dokunulmaz.
// Güvenlik:
//  - Dosya düzenleme yalnızca bu çalışma kopyasında yapılabilir (acceptEdits kendi klasörüyle sınırlıdır); komutlar yalnızca izin listesindekilerdir
//    (git okuma komutları, derleme/test). push, dal değiştirme, silme, ağ, bağımlılık kurma yasaktır; izin listesi dışı komutlar çalışmaz.
//  - Commit'i Claude değil uygulama atar (yerel, ayrı dalda; kimlik "Claude"); push/birleştirme YOK — farkı görüp karar veren kullanıcıdır.
//  - Çalışma kopyası proje klasörünün YANINDA "<proje>-claude-<kod>" olarak açılır; silme yalnızca bu desene uyanlar için çalışır.
// ---------------------------------------------------------------------------------------------------------------------------------------
const { execFile } = require('child_process');

const git = (cwd, args, timeoutMs = 60000) => new Promise((resolve) => {
  execFile('git', args, { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
    resolve({ ok: !error, out: String(stdout || ''), err: String(stderr || (error && error.message) || '') });
  });
});

const ALLOWED_TOOLS = [
  'Read', 'Glob', 'Grep', 'Edit', 'Write',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)',
  'Bash(npm run build:*)', 'Bash(npm run test:*)', 'Bash(npm test:*)', 'Bash(npx tsc:*)', 'Bash(npx vitest:*)',
  'Bash(dotnet build:*)', 'Bash(dotnet test:*)', 'Bash(python -m pytest:*)', 'Bash(pytest:*)', 'Bash(ruff:*)', 'Bash(uv run pytest:*)'
];
const DENIED_TOOLS = [
  'WebFetch', 'WebSearch',
  'Bash(git push:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)', 'Bash(git reset:*)', 'Bash(git clean:*)', 'Bash(git branch:*)',
  'Bash(git worktree:*)', 'Bash(git remote:*)', 'Bash(git commit:*)', 'Bash(git merge:*)', 'Bash(git rebase:*)', 'Bash(git stash:*)',
  'Bash(rm:*)', 'Bash(del:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'Bash(npm install:*)', 'Bash(npm i:*)', 'Bash(gh:*)'
];

const slug = (s) => String(s || 'gorev').toLocaleLowerCase('tr').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28).replace(/-+$/g, '') || 'gorev';

// Bu uygulamanın açtığı çalışma kopyası mı? (proje klasörünün kardeşi, "<proje>-claude-<kod>" adlı)
const isOurWorktree = (repoDir, wtPath) => {
  try {
    const repo = path.resolve(repoDir), wt = path.resolve(wtPath);
    return path.dirname(wt).toLowerCase() === path.dirname(repo).toLowerCase() && path.basename(wt).toLowerCase().startsWith(`${path.basename(repo)}-claude-`.toLowerCase());
  } catch { return false; }
};
const isOurBranch = (b) => typeof b === 'string' && /^claude\/[a-z0-9][a-z0-9-]{0,40}-[a-z0-9]{4}$/.test(b);

// Çalışma kopyasında derleme/kontrol çalışabilsin diye ana klasörün node_modules'u BAĞLANTI (junction) olarak eklenir; kopya silinirken bağlantı ÖNCE
// ayrıca kaldırılır ki hiçbir silme işlemi ana klasörün node_modules'una girmesin.
const LINK_DIRS = ['', 'desktop'];
const linkModules = (repoDir, wt) => {
  for (const rel of LINK_DIRS) {
    try {
      const src = path.join(repoDir, rel, 'node_modules'), dst = path.join(wt, rel, 'node_modules');
      if (fs.existsSync(src) && !fs.existsSync(dst) && fs.existsSync(path.dirname(dst))) fs.symlinkSync(src, dst, 'junction');
    } catch { /* bağlantı kurulamadıysa kontrol "node_modules yok" der */ }
  }
};
const unlinkModules = (wt) => {
  for (const rel of LINK_DIRS) {
    const dst = path.join(wt, rel, 'node_modules');
    try {
      if (fs.lstatSync(dst).isSymbolicLink()) { try { fs.rmdirSync(dst); } catch { fs.unlinkSync(dst); } }
    } catch { /* yok */ }
  }
};

const removeWork = async (repoDir, wtPath, branch) => {
  try { require('./devPreview.cjs').stopAll(); } catch { /* önizleme modülü yoksa yoksay */ } // çalışan önizleme node_modules bağlantısını kullanır
  unlinkModules(wtPath);
  await git(repoDir, ['worktree', 'remove', '--force', wtPath]);
  try { fs.rmSync(wtPath, { recursive: true, force: true }); } catch { /* yoksay */ }
  await git(repoDir, ['worktree', 'prune']);
  if (branch) await git(repoDir, ['branch', '-D', branch]);
};

const applyProgressText = (dir, name, input) => {
  const i = input || {};
  switch (name) {
    case 'Edit': case 'Write': return `Düzenleniyor: ${relTo(dir, String(i.file_path || ''))}`;
    case 'Bash': return `Komut: ${String(i.command || '').slice(0, 90)}`;
    default: return progressText(dir, name, input);
  }
};

// Önizlemeden alınan ekran görüntüleri: yalnızca uygulamanın kendi geçici klasöründeki .png dosyaları (en çok 6, her biri en çok 8 MB) geçici ek klasörüne kopyalanır.
const SHOTS_DIR = path.join(os.tmpdir(), 'ultimatenotes-dev-shots');
const copyShots = (paths, destDir) => {
  const out = [];
  if (!Array.isArray(paths)) return out;
  for (const p of paths.slice(0, 6)) {
    try {
      const abs = path.resolve(String(p));
      if (path.dirname(abs).toLowerCase() !== SHOTS_DIR.toLowerCase() || !/\.png$/i.test(abs)) continue;
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > 8 * 1024 * 1024) continue;
      fs.mkdirSync(destDir, { recursive: true });
      const dst = path.join(destDir, path.basename(abs));
      fs.copyFileSync(abs, dst);
      out.push(dst);
    } catch { /* geç */ }
  }
  return out;
};

// req: { runId, dir, prompt, title, attachments?, shots?, model?, timeoutMs?, vaultDir }
const apply = (req, onProgress) => new Promise((resolve) => {
  const started = Date.now();
  const done = (v) => resolve({ ms: Date.now() - started, ...v });
  const say = (t) => { if (typeof onProgress === 'function') { try { onProgress(t); } catch { /* yoksay */ } } };
  (async () => {
    if (!req || typeof req.runId !== 'string' || !req.runId) return done({ ok: false, error: 'Geçersiz istek.' });
    if (typeof req.prompt !== 'string' || !req.prompt.trim() || req.prompt.length > MAX_PROMPT) return done({ ok: false, error: 'İstem boş ya da çok uzun.' });
    if (current) return done({ ok: false, error: 'Başka bir Claude çalışması sürüyor; bitmesini bekleyin.' });
    const model = req.model ? String(req.model) : '';
    if (model && !/^[A-Za-z0-9._\[\]-]{1,60}$/.test(model)) return done({ ok: false, error: 'Geçersiz model adı.' });
    const info = projectFolder.inspect(req.dir, req.vaultDir);
    if (!info.ok) return done({ ok: false, error: `Proje klasörü kullanılamaz: ${info.error}` });
    if (!info.isGit) return done({ ok: false, error: 'Uygulama için proje klasörü bir git deposu olmalı (ayrı dalda çalışılır).' });
    const exe = findExe();
    if (!exe) return done({ ok: false, error: 'Claude Code komutu bulunamadı (bu bilgisayarda kurulu değil).' });
    const gv = await git(info.path, ['--version']);
    if (!gv.ok) return done({ ok: false, error: 'git komutu bulunamadı.' });
    const reuse = !!(req.reuse && req.reuse.worktree && req.reuse.branch);
    if (reuse && !(isOurWorktree(info.path, req.reuse.worktree) && isOurBranch(req.reuse.branch) && fs.existsSync(req.reuse.worktree))) return done({ ok: false, error: 'Devam edilecek çalışma kopyası bulunamadı ya da uygulamaya ait değil.' });
    const head = await git(info.path, ['rev-parse', '--verify', 'HEAD']);
    if (!head.ok) return done({ ok: false, error: 'Depoda henüz commit yok; önce bir commit atın.' });

    // Ana klasörde kaydedilmemiş değişiklik varsa ayrı kopyaya GİRMEZ (kopya son commit'ten açılır); kullanıcıya bildirilir.
    const mainStatus = await git(info.path, ['status', '--porcelain']);
    const dirtyBase = mainStatus.ok && mainStatus.out.trim().length > 0;

    // 1) ayrı dal + çalışma kopyası (ana klasöre dokunmaz)
    const code = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
    const branch = reuse ? req.reuse.branch : `claude/${slug(req.title)}-${code}`;
    const wt = reuse ? path.resolve(req.reuse.worktree) : path.join(path.dirname(info.path), `${info.name}-claude-${code}`);
    if (!reuse) {
      if (fs.existsSync(wt)) return done({ ok: false, error: 'Çalışma klasörü zaten var; tekrar deneyin.' });
      say('Ayrı dal ve çalışma kopyası hazırlanıyor…');
      const add = await git(info.path, ['worktree', 'add', '-b', branch, wt]);
      if (!add.ok) return done({ ok: false, error: `Çalışma kopyası açılamadı: ${add.err.slice(0, 300)}` });
    } else say('Mevcut çalışma kopyasında devam ediliyor…');
    try { require('./devPreview.cjs').stopAll(); } catch { /* yoksay */ } // düzeltme turunda dosyalar değişir ve bağlantı sonda kaldırılır
    linkModules(info.path, wt);

    // 2) ekleri geçici klasöre kopyala
    let tmpDir = '';
    let prompt = req.prompt;
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
      '--tools', 'Read,Glob,Grep,Edit,Write,Bash', '--allowedTools', ALLOWED_TOOLS.join(','), '--disallowedTools', DENIED_TOOLS.join(','),
      '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config'];
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-task-'));
      const copied = copyAttachments(req.vaultDir, req.attachments, path.join(tmpDir, 'ekler'));
      copied.push(...copyShots(req.shots, path.join(tmpDir, 'ekler')));
      if (copied.length) {
        args.push('--add-dir', path.join(tmpDir, 'ekler'));
        prompt += `\n\nGÖREVE EKLİ DOSYALAR (ekran görüntüsü/belge; okuyabilirsin, bunlara bak):\n${copied.map(f => `- ${f}`).join('\n')}`;
      }
    } catch (e) {
      if (tmpDir) try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* yoksay */ }
      if (!reuse) await removeWork(info.path, wt, branch);
      return done({ ok: false, error: `Ekler hazırlanamadı: ${String(e.message || e)}` });
    }
    if (model) args.push('--model', model);
    const timeoutMs = Math.min(Math.max(Number(req.timeoutMs) || 25 * 60000, 60000), 45 * 60000);
    const cleanTmp = () => { if (tmpDir) try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* yoksay */ } };

    // 3) Claude'u çalışma kopyasında çalıştır
    let child;
    try { child = spawn(exe, args, { cwd: wt, windowsHide: true, env: cleanEnv() }); }
    catch (e) { cleanTmp(); if (!reuse) await removeWork(info.path, wt, branch); return done({ ok: false, error: String(e.message || e) }); }
    const run = { id: req.runId, child, cancelled: false };
    current = run;
    say('Claude çalışıyor…');

    let buf = '', err = '', result = null, finished = false, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* yoksay */ } }, timeoutMs);
    const finish = async (v) => {
      if (finished) return;
      finished = true; clearTimeout(timer); if (current === run) current = null; cleanTmp();
      // Değişiklik var mı? Yoksa kopya ve dal silinir.
      const st = await git(wt, ['status', '--porcelain']);
      const changed = st.ok && st.out.trim().length > 0;
      if (v.cancelled || (v.ok === false && !changed)) { if (!reuse) await removeWork(info.path, wt, branch); return done(v); }
      if (!changed) {
        if (!reuse) { await removeWork(info.path, wt, branch); return done({ ...v, ok: true, changed: false }); }
        return done({ ...v, ok: true, changed: false, branch, worktree: wt, base: info.branch || '' }); // düzeltme turunda yeni değişiklik olmadı; önceki commit'ler duruyor
      }
      say('Değişiklikler kaydediliyor (yerel dalda)…');
      unlinkModules(wt); // bağlantı commit'e girmesin
      await git(wt, ['add', '-A']);
      const msg = `Claude: ${String(req.title || 'görev').slice(0, 120)}\n\nUltimateNotes "Claude başlasın mı?" ile otomatik yapıldı; gözden geçirilmeden birleştirilmemeli.`;
      const cm = await git(wt, ['-c', 'user.name=Claude (UltimateNotes)', '-c', 'user.email=noreply@anthropic.com', 'commit', '-m', msg]);
      if (!cm.ok) return done({ ok: false, error: `Değişiklikler commit edilemedi (çalışma kopyası korundu: ${wt}). ${cm.err.slice(0, 200)}`, worktree: wt, branch });
      const baseRef = info.branch && !info.branch.startsWith('(') ? `${info.branch}...HEAD` : 'HEAD~1..HEAD';
      const names = await git(wt, ['diff', '--name-status', baseRef]);
      const stat = await git(wt, ['diff', '--shortstat', baseRef]);
      const files = names.out.split('\n').filter(Boolean).slice(0, 200).map(l => { const [s, ...p] = l.split('\t'); return { status: s, path: p.join('\t') }; });
      return done({ ...v, changed: true, branch, worktree: wt, base: info.branch || '', files, stat: stat.out.trim(), partial: v.ok === false, dirtyBase });
    };

    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
          for (const c of ev.message.content) {
            if (c.type === 'tool_use') say(applyProgressText(wt, c.name, c.input));
            else if (c.type === 'text' && c.text) say('Yanıt yazılıyor…');
          }
        } else if (ev.type === 'result') result = ev;
      }
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { void finish({ ok: false, error: String(e.message || e) }); });
    child.on('close', (code) => {
      if (run.cancelled) return void finish({ ok: false, cancelled: true, error: 'Durduruldu.' });
      if (timedOut) return void finish({ ok: false, error: 'Claude zaman aşımına uğradı (yapılanlar dalda korundu).' });
      if (!result) return void finish({ ok: false, error: `Claude yanıtı alınamadı (çıkış ${code}). ${err.slice(0, 300)}` });
      if (result.is_error) return void finish({ ok: false, error: String(result.result || 'Claude hata verdi.').slice(0, 400) });
      void finish({ ok: true, text: typeof result.result === 'string' ? result.result : '', cost: result.total_cost_usd, turns: result.num_turns });
    });
    child.stdin.on('error', () => { /* süreç erken kapandıysa close bildirir */ });
    child.stdin.write(prompt);
    child.stdin.end();
  })().catch((e) => done({ ok: false, error: String((e && e.message) || e) }));
});

// Beğenilmeyen işi siler: yalnızca bu uygulamanın açtığı çalışma kopyası ve "claude/…" dalı.
const discard = async ({ dir, worktree, branch }) => {
  const info = projectFolder.inspect(dir, null);
  if (!info.ok) return { ok: false, error: info.error };
  if (!isOurWorktree(info.path, worktree) || !isOurBranch(branch)) return { ok: false, error: 'Bu çalışma kopyası/dal uygulamaya ait görünmüyor; silinmedi.' };
  await removeWork(info.path, path.resolve(worktree), branch);
  return { ok: true };
};

// Çalışma kopyasının yolunu doğrular (klasörü açmak için); uygulamaya ait değilse null.
const ownedWorktree = (dir, worktree) => {
  const info = projectFolder.inspect(dir, null);
  return info.ok && isOurWorktree(info.path, worktree) && fs.existsSync(worktree) ? path.resolve(worktree) : null;
};

module.exports = { plan, apply, discard, ownedWorktree, cancel, cancelAll, git, isOurWorktree, isOurBranch, removeWork, linkModules, unlinkModules };

