// "Geliştir" bölümünün git/yayın işleri: kontrol (tsc), fark, birleştirme, yayın (sürüm + commit + etiket + push) ve derleme (CI) takibi.
// Bu işleri Claude DEĞİL, uygulama yapar; yalnızca kullanıcının düğmeye basmasıyla.
//
// Güvenlik:
//  - Her işlem proje klasörünü projectFolder.cjs ile yeniden denetler; çalışma kopyası/dal yalnızca uygulamanın açtığı desene uymalıdır.
//  - Birleştirme: ana klasör temiz olmalı; yalnızca hızlı ileri sarma (fast-forward) yapılır, çakışmada her şey geri alınır ve durulur.
//  - Yayın: uzak dalda yeni commit varsa durur; zorla push (--force) YOKTUR; sürüm numarası uzaktaki etiketlerden hesaplanır (çakışma olmasın);
//    gönderilecek farkta anahtar/şifre örüntüsü bulunursa YAYIN ENGELLENİR (repo herkese açık olabilir); yayından önce tsc çalışır.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const projectFolder = require('./projectFolder.cjs');
const agent = require('./claudeAgent.cjs');

const git = agent.git;
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
const VER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const parseVer = (s) => { const m = String(s || '').match(/^v?(\d+)\.(\d+)\.(\d+)$/); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
const cmpVer = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
const fmtVer = (v) => `${v[0]}.${v[1]}.${v[2]}`;
const tail = (s, n) => (s.length > n ? '…' + s.slice(-n) : s);

// Uygulamanın package.json'ının bulunduğu klasör (bu depoda "desktop"; yoksa kök)
const appDirOf = (root) => (fs.existsSync(path.join(root, 'desktop', 'package.json')) ? path.join(root, 'desktop') : root);
const readVersion = (root) => {
  try { const m = fs.readFileSync(path.join(appDirOf(root), 'package.json'), 'utf-8').match(/"version"\s*:\s*"([^"]+)"/); return m ? m[1] : ''; } catch { return ''; }
};

const repoOf = (req) => {
  const info = projectFolder.inspect(req && req.dir, req && req.vaultDir);
  if (!info.ok) return { error: `Proje klasörü kullanılamaz: ${info.error}` };
  if (!info.isGit) return { error: 'Proje klasörü bir git deposu değil.' };
  return { info };
};
const ownedWt = (info, wt, branch) => agent.isOurWorktree(info.path, wt) && agent.isOurBranch(branch) && fs.existsSync(wt);

const remoteTags = async (cwd) => {
  const r = await git(cwd, ['ls-remote', '--tags', 'origin'], 60000);
  if (!r.ok) return { ok: false, error: `Uzak depoya ulaşılamadı: ${r.err.slice(0, 200)}` };
  const tags = [];
  for (const l of r.out.split('\n')) {
    const m = l.match(/refs\/tags\/(v\d+\.\d+\.\d+)$/);
    if (m) tags.push(m[1]);
  }
  return { ok: true, tags };
};
const maxTag = (tags) => tags.map(parseVer).filter(Boolean).sort(cmpVer).pop() || null;

// ---------------------------------------------------------------------------------------------------------------------------------------
// Anahtar/şifre taraması (yalnızca YÜKSEK güvenli örüntüler; yanlış alarm az olsun). Bulunan değer maskelenerek gösterilir.
// ---------------------------------------------------------------------------------------------------------------------------------------
const SECRET_PATTERNS = [
  { name: 'Anthropic API anahtarı', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'Google API anahtarı', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'GitHub erişim jetonu', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: 'GitHub ince ayarlı jeton', re: /github_pat_[A-Za-z0-9_]{40,}/ },
  { name: 'Özel anahtar (PEM)', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'Slack jetonu', re: /\bxox[abprs]-[A-Za-z0-9-]{20,}/ },
  { name: 'AWS erişim anahtarı', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'OpenAI anahtarı', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/ }
];
const SECRET_FILES = /(^|\/)\.env(\.[A-Za-z0-9_-]+)?$|\.(pem|pfx|p12|jks|keystore)$|(^|\/)id_(rsa|ed25519|ecdsa)$|(^|\/)task-source-credentials/i;
const mask = (s) => (s.length <= 10 ? '****' : `${s.slice(0, 6)}…(${s.length} karakter)`);

// Birleşik fark metninden (git diff -U0) eklenen satırlarda ve yeni dosya adlarında tarar.
const scanDiff = (diffText, addedFiles) => {
  const findings = [];
  let file = '';
  for (const line of String(diffText || '').split('\n')) {
    if (line.startsWith('+++ ')) { file = line.replace(/^\+\+\+ (b\/)?/, ''); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    for (const p of SECRET_PATTERNS) {
      const m = line.match(p.re);
      if (m) { findings.push({ kind: p.name, file, sample: mask(m[0]) }); break; }
    }
  }
  for (const f of addedFiles || []) if (SECRET_FILES.test(f)) findings.push({ kind: 'Gizli dosya adı', file: f, sample: '' });
  // aynı dosya+tür tekrarını sadeleştir
  const seen = new Set();
  return findings.filter(f => { const k = `${f.kind}|${f.file}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 30);
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// tsc (tür denetimi): Electron'un kendi Node'u ile (ELECTRON_RUN_AS_NODE) çalıştırılır
// ---------------------------------------------------------------------------------------------------------------------------------------
const runTsc = (appDir, timeoutMs = 6 * 60000) => new Promise((resolve) => {
  const started = Date.now();
  const tsc = path.join(appDir, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!fs.existsSync(tsc)) return resolve({ ok: false, error: 'TypeScript bulunamadı (node_modules yok); kontrol çalıştırılamadı.', ms: 0 });
  let out = '', finished = false;
  let child;
  try { child = spawn(process.execPath, [tsc, '--noEmit'], { cwd: appDir, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }); }
  catch (e) { return resolve({ ok: false, error: String(e.message || e), ms: 0 }); }
  const fin = (v) => { if (finished) return; finished = true; clearTimeout(timer); resolve({ ms: Date.now() - started, ...v }); };
  const timer = setTimeout(() => { try { child.kill(); } catch { /* yoksay */ } fin({ ok: false, error: 'Kontrol zaman aşımına uğradı.', output: tail(out, 4000) }); }, timeoutMs);
  child.stdout.on('data', d => { out += d; if (out.length > 200000) out = out.slice(-100000); });
  child.stderr.on('data', d => { out += d; if (out.length > 200000) out = out.slice(-100000); });
  child.on('error', e => fin({ ok: false, error: String(e.message || e) }));
  child.on('close', code => fin(code === 0 ? { ok: true, output: '' } : { ok: false, error: 'Tür denetimi hata verdi.', output: tail(out.trim(), 6000) }));
});

// Kontrol: çalışma kopyasında tür denetimi
const check = async (req) => {
  const r = repoOf(req); if (r.error) return { ok: false, error: r.error };
  const wt = path.resolve(String(req.worktree || ''));
  if (!ownedWt(r.info, wt, req.branch)) return { ok: false, error: 'Çalışma kopyası bulunamadı ya da uygulamaya ait değil.' };
  agent.linkModules(r.info.path, wt);
  try { return await runTsc(appDirOf(wt)); }
  finally { agent.unlinkModules(wt); }
};

// Fark: ana dala göre; dosya verilirse yalnızca o dosya
const diff = async (req) => {
  const r = repoOf(req); if (r.error) return { ok: false, error: r.error };
  const wt = path.resolve(String(req.worktree || ''));
  if (!ownedWt(r.info, wt, req.branch)) return { ok: false, error: 'Çalışma kopyası bulunamadı ya da uygulamaya ait değil.' };
  const base = r.info.branch && !r.info.branch.startsWith('(') ? r.info.branch : 'HEAD~1';
  const range = `${base}...${req.branch}`;
  const args = ['diff', '--no-color', range];
  if (req.file && typeof req.file === 'string' && !req.file.startsWith('-')) args.push('--', req.file);
  const d = await git(r.info.path, args, 60000);
  if (!d.ok) return { ok: false, error: d.err.slice(0, 300) };
  const ns = await git(r.info.path, ['diff', '--numstat', range], 60000);
  const files = ns.out.split('\n').filter(Boolean).slice(0, 300).map(l => { const [a, b, ...p] = l.split('\t'); return { added: Number(a) || 0, removed: Number(b) || 0, path: p.join('\t') }; });
  const MAX = 300 * 1024;
  return { ok: true, text: d.out.length > MAX ? d.out.slice(0, MAX) + '\n… (kısaltıldı)' : d.out, truncated: d.out.length > MAX, files };
};

// Ana klasörü yayın/birleştirme için hazırla: dal adı, temizlik, uzakla eşitlik (gerekirse hızlı ileri sarma)
const prepareMain = async (info) => {
  const branch = info.branch;
  if (!branch || branch.startsWith('(')) return { error: 'Ana klasör bir dalda değil (ayrık HEAD); önce ana dala geçin.' };
  const st = await git(info.path, ['status', '--porcelain'], 30000);
  if (!st.ok) return { error: `git durumu okunamadı: ${st.err.slice(0, 200)}` };
  const dirty = st.out.split('\n').filter(Boolean);
  if (dirty.length) return { error: `Ana klasörde kaydedilmemiş değişiklik var (${dirty.length} dosya): ${dirty.slice(0, 5).map(l => l.slice(3)).join(', ')}${dirty.length > 5 ? '…' : ''}. Önce bunları commit edin ya da kaldırın.`, dirty: dirty.slice(0, 30) };
  const f = await git(info.path, ['fetch', '--tags', 'origin'], 90000);
  if (!f.ok) return { error: `Uzak depodan çekilemedi: ${f.err.slice(0, 200)}` };
  const has = await git(info.path, ['rev-parse', '--verify', `origin/${branch}`], 15000);
  if (!has.ok) return { error: `Uzak dalda "${branch}" bulunamadı.` };
  const cnt = await git(info.path, ['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`], 15000);
  const [ahead, behind] = cnt.out.trim().split(/\s+/).map(Number);
  if (behind > 0 && ahead > 0) return { error: `Yerel dal ile uzak dal ayrışmış (${ahead} yerel, ${behind} uzak commit). Elle birleştirin; uygulama dokunmaz.` };
  if (behind > 0) {
    const ff = await git(info.path, ['merge', '--ff-only', `origin/${branch}`], 60000);
    if (!ff.ok) return { error: `Uzaktaki yeni commit'ler alınamadı: ${ff.err.slice(0, 200)}` };
    return { branch, ahead: 0, pulled: behind };
  }
  return { branch, ahead: ahead || 0, pulled: 0 };
};

// Birleştir: çalışma dalını güncel ana dalın üstüne alır (çakışmada geri alır), sonra hızlı ileri sarma ile ana dala katar; kopya ve dal silinir.
// Push YAPMAZ (yayın ayrı adım).
const merge = async (req) => {
  const r = repoOf(req); if (r.error) return { ok: false, error: r.error };
  const wt = path.resolve(String(req.worktree || ''));
  if (!ownedWt(r.info, wt, req.branch)) return { ok: false, error: 'Çalışma kopyası bulunamadı ya da uygulamaya ait değil.' };
  const prep = await prepareMain(r.info);
  if (prep.error) return { ok: false, error: prep.error, dirty: prep.dirty };
  agent.unlinkModules(wt);
  const wtStatus = await git(wt, ['status', '--porcelain'], 30000);
  if (wtStatus.out.trim()) return { ok: false, error: 'Çalışma kopyasında kaydedilmemiş değişiklik var; önce Claude turunu bitirin.' };
  const rb = await git(wt, ['rebase', prep.branch], 120000);
  if (!rb.ok) {
    const conf = await git(wt, ['diff', '--name-only', '--diff-filter=U'], 15000);
    await git(wt, ['rebase', '--abort'], 30000);
    return { ok: false, conflict: true, files: conf.out.split('\n').filter(Boolean).slice(0, 30), error: 'Bu değişiklik, ana daldaki yeni değişikliklerle çakışıyor. Hiçbir şey birleştirilmedi (çalışma kopyası korundu). "Claude çakışmayı çözsün" ya da dosyaları elle düzeltin.' };
  }
  const cnt = await git(r.info.path, ['rev-list', '--count', `${prep.branch}..${req.branch}`], 15000);
  const mg = await git(r.info.path, ['merge', '--ff-only', req.branch], 60000);
  if (!mg.ok) return { ok: false, error: `Birleştirilemedi: ${mg.err.slice(0, 300)}` };
  await agent.removeWork(r.info.path, wt, req.branch);
  const head = await git(r.info.path, ['rev-parse', '--short', 'HEAD'], 15000);
  return { ok: true, head: head.out.trim(), commits: Number(cnt.out.trim()) || 0, pulled: prep.pulled };
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// Yayın
// ---------------------------------------------------------------------------------------------------------------------------------------
const lastTagLocal = async (cwd) => {
  const r = await git(cwd, ['tag', '--sort=-v:refname', '--merged', 'HEAD'], 15000);
  return r.out.split('\n').map(s => s.trim()).find(s => TAG_RE.test(s)) || '';
};

// Yayın planı: ana dal hazır mı, sürüm adayları, son yayından beri commit'ler, gizli bilgi taraması
const releasePlan = async (req) => {
  const r = repoOf(req); if (r.error) return { ok: false, error: r.error };
  const prep = await prepareMain(r.info);
  if (prep.error) return { ok: false, error: prep.error, dirty: prep.dirty };
  const rt = await remoteTags(r.info.path);
  if (!rt.ok) return { ok: false, error: rt.error };
  const lt = await git(r.info.path, ['tag'], 15000);
  const localTags = lt.out.split('\n').map(s => s.trim()).filter(s => TAG_RE.test(s));
  const latest = maxTag([...rt.tags, ...localTags]);
  const pkg = parseVer(readVersion(r.info.path));
  if (!latest) return { ok: false, error: 'Hiç sürüm etiketi bulunamadı; ilk sürümü elle verin.' };
  const lastTag = await lastTagLocal(r.info.path) || `v${fmtVer(latest)}`;
  const log = await git(r.info.path, ['log', `${lastTag}..HEAD`, '--pretty=%s'], 30000);
  const commits = log.out.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 80);
  const ns = await git(r.info.path, ['diff', '--name-status', `${lastTag}..HEAD`], 30000);
  const files = ns.out.split('\n').filter(Boolean).map(l => { const [s, ...p] = l.split('\t'); return { status: s, path: p.join('\t') }; });
  const dd = await git(r.info.path, ['diff', '-U0', '--no-color', `${lastTag}..HEAD`], 90000);
  const findings = scanDiff(dd.out, files.filter(f => f.status === 'A').map(f => f.path));
  // Yayınlanmamış sürüm artışı (package.json etiketten büyük): aynı numara yeniden kullanılır
  const unpublished = pkg && cmpVer(pkg, latest) > 0 ? fmtVer(pkg) : '';
  const next = {
    patch: unpublished || fmtVer([latest[0], latest[1], latest[2] + 1]),
    minor: fmtVer([latest[0], latest[1] + 1, 0]),
    major: fmtVer([latest[0] + 1, 0, 0])
  };
  return { ok: true, branch: prep.branch, latest: fmtVer(latest), lastTag, current: pkg ? fmtVer(pkg) : '', next, unpublished, commits, files: files.slice(0, 300), fileCount: files.length, findings, ahead: prep.ahead, pulled: prep.pulled };
};

const bumpPackageJson = (root, version) => {
  const p = path.join(appDirOf(root), 'package.json');
  const raw = fs.readFileSync(p, 'utf-8');
  if (!/"version"\s*:\s*"[^"]+"/.test(raw)) throw new Error('package.json içinde sürüm bulunamadı.');
  fs.writeFileSync(p, raw.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${version}"`), 'utf-8');
  return p;
};

// Yayınla: yeniden denetler -> tsc -> sürüm artır -> commit -> etiket -> push (zorlamasız, atomik). req: { dir, version, summary, vaultDir }
const releaseDo = async (req, onProgress) => {
  const say = (t) => { if (typeof onProgress === 'function') { try { onProgress(t); } catch { /* yoksay */ } } };
  const r = repoOf(req); if (r.error) return { ok: false, error: r.error };
  const version = String(req && req.version || '').replace(/^v/, '');
  if (!VER_RE.test(version)) return { ok: false, error: 'Sürüm numarası geçersiz (örn. 1.66.0).' };
  say('Depo ve uzak etiketler denetleniyor…');
  const plan = await releasePlan(req);
  if (!plan.ok) return plan;
  if (plan.findings.length) return { ok: false, error: 'Gönderilecek değişikliklerde gizli bilgi olabilecek içerik bulundu; yayın ENGELLENDİ.', findings: plan.findings };
  const want = parseVer(version), latest = parseVer(plan.latest);
  if (cmpVer(want, latest) <= 0) return { ok: false, error: `v${version}, mevcut son sürümden (v${plan.latest}) büyük olmalı.` };
  const tag = `v${version}`;
  const exists = await git(r.info.path, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], 15000);
  if (exists.ok) return { ok: false, error: `${tag} etiketi zaten var.` };
  say('Tür denetimi (tsc) çalışıyor…');
  const ts = await runTsc(appDirOf(r.info.path));
  if (!ts.ok) return { ok: false, error: `Yayın durduruldu: ${ts.error || 'tür denetimi başarısız'}`, output: ts.output };
  say('Sürüm numarası ve commit hazırlanıyor…');
  let pkgPath;
  try { pkgPath = bumpPackageJson(r.info.path, version); } catch (e) { return { ok: false, error: String(e.message || e) }; }
  const summary = String(req.summary || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 180);
  const msg = `release: ${tag}${summary ? ` - ${summary}` : ''}\n\nCo-Authored-By: Claude (UltimateNotes) <noreply@anthropic.com>`;
  await git(r.info.path, ['add', '--', pkgPath], 15000);
  const staged = await git(r.info.path, ['diff', '--cached', '--quiet'], 15000);
  if (!staged.ok) { // değişiklik var -> commit
    const cm = await git(r.info.path, ['commit', '-m', msg], 60000);
    if (!cm.ok) return { ok: false, error: `Commit atılamadı: ${cm.err.slice(0, 300)}` };
  }
  const tg = await git(r.info.path, ['tag', tag], 15000);
  if (!tg.ok) return { ok: false, error: `Etiket oluşturulamadı: ${tg.err.slice(0, 200)}` };
  say('Uzak depoya gönderiliyor…');
  const push = await git(r.info.path, ['push', '--atomic', 'origin', plan.branch, tag], 120000);
  if (!push.ok) {
    await git(r.info.path, ['tag', '-d', tag], 15000);
    return { ok: false, error: `Gönderilemedi (yerelde commit duruyor, etiket silindi): ${push.err.slice(-300)}`, committed: true };
  }
  const head = await git(r.info.path, ['rev-parse', '--short', 'HEAD'], 15000);
  return { ok: true, tag, version, head: head.out.trim(), commits: plan.commits, fileCount: plan.fileCount };
};

// Derleme (CI) durumu: gh ile etikete bağlı "release.yml" çalışması
const ci = (req) => new Promise((resolve) => {
  const r = repoOf(req); if (r.error) return resolve({ ok: false, error: r.error });
  const tag = String(req && req.tag || '');
  if (!TAG_RE.test(tag)) return resolve({ ok: false, error: 'Etiket geçersiz.' });
  const { execFile } = require('child_process');
  execFile('gh', ['run', 'list', '--workflow', 'release.yml', '--branch', tag, '--limit', '1', '--json', 'status,conclusion,url,createdAt'], { cwd: r.info.path, windowsHide: true, timeout: 40000 }, (err, stdout, stderr) => {
    if (err) return resolve({ ok: false, error: /ENOENT/.test(String(err.code || err.message)) ? 'GitHub CLI (gh) bulunamadı.' : `gh hatası: ${String(stderr || err.message).slice(0, 200)}` });
    let arr = []; try { arr = JSON.parse(stdout || '[]'); } catch { /* boş */ }
    if (!arr.length) return resolve({ ok: true, state: 'none' });
    const x = arr[0];
    const state = x.status !== 'completed' ? (x.status === 'queued' ? 'queued' : 'running') : (x.conclusion === 'success' ? 'success' : x.conclusion === 'cancelled' ? 'cancelled' : 'failure');
    resolve({ ok: true, state, url: x.url, createdAt: x.createdAt });
  });
});

// Ana klasörün özeti (üst şerit): dal, sürüm, temizlik, uzakla durum
const status = async (req) => {
  const r = repoOf(req); if (r.error) return { ok: false, error: r.error };
  const f = await git(r.info.path, ['fetch', '--tags', 'origin'], 60000);
  const st = await git(r.info.path, ['status', '--porcelain'], 15000);
  const dirty = st.out.split('\n').filter(Boolean).length;
  let ahead = 0, behind = 0;
  if (r.info.branch) {
    const cnt = await git(r.info.path, ['rev-list', '--left-right', '--count', `HEAD...origin/${r.info.branch}`], 15000);
    if (cnt.ok) [ahead, behind] = cnt.out.trim().split(/\s+/).map(Number);
  }
  const lt = await lastTagLocal(r.info.path);
  return { ok: true, path: r.info.path, name: r.info.name, branch: r.info.branch, version: readVersion(r.info.path), lastTag: lt, dirty, ahead, behind, offline: !f.ok };
};

module.exports = { status, check, diff, merge, releasePlan, releaseDo, ci, scanDiff, parseVer, cmpVer, SECRET_PATTERNS };
