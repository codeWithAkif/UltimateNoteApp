// "Geliştir" önizlemesi: bir isteğin çalışma kopyasındaki uygulamayı geliştirme sunucusuyla (vite) tarayıcı modunda çalıştırır; uygulama bunu kendi içinde
// bir <webview> ile gösterir ve ekran görüntüsü alabilir. Böylece Claude'un yaptığı değişiklik birleştirmeden ÖNCE çalışırken görülür.
//
// Güvenlik:
//  - Yalnızca uygulamanın açtığı çalışma kopyası için çalışır (claudeAgent'taki ad/dal denetimi); sunucu yalnızca 127.0.0.1'e bağlanır, rastgele boş portta.
//  - Önizleme TARAYICI modunda çalışır: window.electron yoktur, gerçek notlar kasasına/dosya sistemine erişemez; <webview> bellekte tutulan ayrı bir bölümde
//    (partition) açılır, hiçbir şey kalıcı olmaz.
//  - Aynı anda tek önizleme; çalışma kopyası değişmeden/silinmeden önce (kontrol, birleştirme, düzeltme turu, silme) sunucu durdurulur.
//  - Ekran görüntüsü yalnızca bu önizlemenin kendi sayfasından alınır ve uygulamanın geçici "ultimatenotes-dev-shots" klasörüne yazılır.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const http = require('http');
const projectFolder = require('./projectFolder.cjs');
const agent = require('./claudeAgent.cjs');

let current = null; // { child, port, worktree, url, logs }

const appDirOf = (root) => (fs.existsSync(path.join(root, 'desktop', 'package.json')) ? path.join(root, 'desktop') : root);
const SHOTS_DIR = path.join(os.tmpdir(), 'ultimatenotes-dev-shots');

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

const killTree = (child) => {
  try {
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => { /* yoksay */ });
    else child.kill('SIGTERM');
  } catch { /* yoksay */ }
};

const stopAll = () => {
  if (!current) return false;
  const c = current; current = null;
  killTree(c.child);
  try { agent.unlinkModules(c.worktree); } catch { /* yoksay */ }
  return true;
};

const httpOk = (port) => new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2500 }, (res) => { res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 400); });
  req.on('error', () => resolve(false));
  req.on('timeout', () => { req.destroy(); resolve(false); });
});

// req: { dir, worktree, branch, vaultDir }
const start = async (req) => {
  const info = projectFolder.inspect(req && req.dir, req && req.vaultDir);
  if (!info.ok) return { ok: false, error: `Proje klasörü kullanılamaz: ${info.error}` };
  if (!info.isGit) return { ok: false, error: 'Proje klasörü bir git deposu değil.' };
  const wt = path.resolve(String((req && req.worktree) || ''));
  if (!(agent.isOurWorktree(info.path, wt) && agent.isOurBranch(req.branch) && fs.existsSync(wt))) return { ok: false, error: 'Çalışma kopyası bulunamadı ya da uygulamaya ait değil.' };
  stopAll();
  agent.linkModules(info.path, wt);
  const appDir = appDirOf(wt);
  const vite = path.join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) { agent.unlinkModules(wt); return { ok: false, error: 'Önizleme için "vite" bulunamadı (ana klasörde node_modules kurulu olmalı).' }; }
  let port;
  try { port = await freePort(); } catch (e) { return { ok: false, error: `Boş port bulunamadı: ${String(e.message || e)}` }; }

  let child;
  try {
    child = spawn(process.execPath, [vite, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
      cwd: appDir, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', BROWSER: 'none', FORCE_COLOR: '0' }
    });
  } catch (e) { agent.unlinkModules(wt); return { ok: false, error: String((e && e.message) || e) }; }
  const run = { child, port, worktree: wt, url: `http://127.0.0.1:${port}/`, logs: '', exited: false };
  current = run;
  const add = (d) => { run.logs += String(d); if (run.logs.length > 8000) run.logs = run.logs.slice(-4000); };
  child.stdout.on('data', add); child.stderr.on('data', add);
  child.on('exit', () => { run.exited = true; if (current === run) current = null; });
  child.on('error', (e) => { add(String((e && e.message) || e)); run.exited = true; });

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (run.exited) return { ok: false, error: `Önizleme sunucusu açılmadan kapandı:\n${run.logs.replace(/\u001b\[[0-9;]*m/g, '').trim().slice(-600)}` };
    if (current !== run) return { ok: false, error: 'Önizleme durduruldu.' };
    if (await httpOk(port)) return { ok: true, url: run.url + '?onizleme=1', port }; // ?onizleme=1: önizlemede Geliştir ekranı örnek verilerle açılır (bkz. src/devDemo.ts)
    await new Promise(r => setTimeout(r, 400));
  }
  stopAll();
  return { ok: false, error: 'Önizleme sunucusu 90 saniyede hazır olmadı.' };
};

const status = () => (current ? { running: true, url: current.url, worktree: current.worktree } : { running: false });
// Bu adres şu an çalışan önizlemeye mi ait? (ekran görüntüsü yalnızca buradan alınır)
const isPreviewUrl = (u) => !!current && typeof u === 'string' && u.startsWith(current.url.replace(/\/$/, ''));

// Ekran görüntüsünü dosyaya yazar: { path, thumb } (webContents, çağıran tarafından doğrulanmış önizleme sayfasıdır)
const saveShot = async (wc) => {
  if (!wc || wc.isDestroyed() || !isPreviewUrl(wc.getURL())) return { ok: false, error: 'Önizleme sayfası bulunamadı.' };
  let img = await wc.capturePage();
  if (!img || img.isEmpty()) return { ok: false, error: 'Ekran görüntüsü alınamadı (sayfa henüz çizilmemiş olabilir).' };
  const size = img.getSize();
  if (size.width > 1600) img = img.resize({ width: 1600 });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const file = path.join(SHOTS_DIR, `onizleme-${Date.now()}.png`);
  fs.writeFileSync(file, img.toPNG());
  const thumb = img.resize({ width: 260 }).toDataURL();
  return { ok: true, path: file, thumb };
};

// Eski ekran görüntüleri temizlenir (1 günden eski)
const cleanShots = () => {
  try {
    for (const f of fs.readdirSync(SHOTS_DIR)) {
      const p = path.join(SHOTS_DIR, f);
      if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) fs.rmSync(p, { force: true });
    }
  } catch { /* klasör yok */ }
};

module.exports = { start, stopAll, status, isPreviewUrl, saveShot, cleanShots, SHOTS_DIR };
