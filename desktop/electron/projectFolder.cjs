// Proje klasörü seçimi için güvenlik denetimi: yanlış yer seçilmesin diye riskli klasörleri reddeder ve seçilen klasör hakkında bilgi verir.
// Reddedilenler: disk kökü, kullanıcı klasörü (ve üstleri), sistem klasörleri, notlar kasasının kendisi/içi/üstü.
// Uyarı: git deposu değilse (Claude'un ayrı bir dalda çalışabilmesi için gerekir).

const fs = require('fs');
const path = require('path');
const os = require('os');

const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
const isSame = (a, b) => norm(a) === norm(b);
const isInside = (child, parent) => { const c = norm(child), p = norm(parent); return c !== p && c.startsWith(p + path.sep.toLowerCase()); };

const systemDirs = () => {
  if (process.platform === 'win32') {
    const env = process.env;
    return [env.SystemRoot || 'C:\\Windows', env.ProgramFiles || 'C:\\Program Files', env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', env.ProgramData || 'C:\\ProgramData'];
  }
  return ['/bin', '/boot', '/dev', '/etc', '/lib', '/proc', '/sbin', '/sys', '/usr', '/var', '/System', '/Library', '/Applications'];
};

// .git klasörü ya da "gitdir:" dosyası (worktree) -> HEAD'den dal adı
const readBranch = (dir) => {
  try {
    let gitDir = path.join(dir, '.git');
    const st = fs.statSync(gitDir);
    if (st.isFile()) {
      const m = fs.readFileSync(gitDir, 'utf-8').match(/^gitdir:\s*(.+)\s*$/m);
      if (!m) return { isGit: true, branch: '' };
      gitDir = path.resolve(dir, m[1]);
    }
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim();
    const b = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return { isGit: true, branch: b ? b[1] : `(ayrık HEAD ${head.slice(0, 7)})` };
  } catch { return { isGit: false, branch: '' }; }
};

// vaultDir: notlar kasasının klasörü. Dönüş: { ok, path, name, isGit, branch, error?, warning? }
const inspect = (dir, vaultDir) => {
  if (typeof dir !== 'string' || !dir.trim()) return { ok: false, error: 'Klasör seçilmedi.' };
  if (!path.isAbsolute(dir)) return { ok: false, error: 'Klasör yolu tam (mutlak) olmalı.' };
  const p = path.resolve(dir);
  let st;
  try { st = fs.statSync(p); } catch { return { ok: false, path: p, error: 'Klasör bulunamadı (taşınmış ya da silinmiş olabilir).' }; }
  if (!st.isDirectory()) return { ok: false, path: p, error: 'Seçilen yol bir klasör değil.' };

  if (path.parse(p).root.replace(/[\\/]+$/, '').toLowerCase() === p.replace(/[\\/]+$/, '').toLowerCase()) return { ok: false, path: p, error: 'Disk kökü seçilemez.' };
  const home = os.homedir();
  if (isSame(p, home) || isInside(home, p)) return { ok: false, path: p, error: 'Kullanıcı klasörü ya da onun üstü seçilemez; projenin kendi klasörünü seçin.' };
  if (systemDirs().some(s => isSame(p, s) || isInside(p, s))) return { ok: false, path: p, error: 'Sistem klasörleri seçilemez.' };
  if (vaultDir && (isSame(p, vaultDir) || isInside(p, vaultDir) || isInside(vaultDir, p))) return { ok: false, path: p, error: 'Notlarınızın bulunduğu klasör (ya da içi/üstü) proje klasörü olamaz.' };

  const g = readBranch(p);
  const res = { ok: true, path: p, name: path.basename(p), isGit: g.isGit, branch: g.branch };
  if (!g.isGit) res.warning = 'Bu klasör bir git deposu değil. Claude\'un ayrı bir dalda güvenle çalışabilmesi için git deposu gerekir.';
  return res;
};

module.exports = { inspect };
