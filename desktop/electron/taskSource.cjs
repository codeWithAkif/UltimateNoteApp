// Şirket proje yönetim uygulamasından (ASP.NET MVC, e-posta + şifre girişi, API yok) "bana atanan işler"i okur. Yalnızca OKUR: giriş formu dışında hiçbir şey
// gönderilmez. Adımlar: giriş sayfasını aç -> formu (gizli güvenlik alanı dahil) doldurup gönder -> kaynak adreslerini (her ekip için bir tane) aç -> cevap
// JSON ise olduğu gibi, HTML ise tabloyu çıkar. Eşleme (hangi alan başlık/durum) renderer tarafında yapılır.
//
// Güvenlik: tüm adresler giriş adresiyle AYNI sunucuda olmalı; https zorunlu (yalnızca localhost ya da açıkça izin verilen http hariç); giriş en çok BİR
// kez denenir (yanlış şifreyle tekrar tekrar denemek hesabı kilitleyebilir); şifre hiçbir yere yazılmaz.
//
// Ağ katmanı "taşıyıcı" (transport) ile soyutlanmıştır: Electron'da session.fetch (sistem sertifikaları, çerezler otomatik), testlerde Node http.

const { parse } = require('node-html-parser');

class SyncError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const isLocalHost = (h) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(h);

const checkUrls = (cfg) => {
  let login;
  try { login = new URL(cfg.loginUrl); } catch { throw new SyncError('config', 'Giriş adresi geçersiz.'); }
  if (!['http:', 'https:'].includes(login.protocol)) throw new SyncError('config', 'Giriş adresi http(s) olmalı.');
  if (login.protocol === 'http:' && !isLocalHost(login.hostname) && !cfg.allowHttp) throw new SyncError('insecure', 'Giriş adresi güvenli değil (http). Şifre açık gönderilir; yine de kullanmak için "güvensiz bağlantıya izin ver"i işaretleyin.');
  const sources = Array.isArray(cfg.sources) ? cfg.sources : [];
  if (sources.length === 0) throw new SyncError('config', 'En az bir kaynak adresi gerekli.');
  sources.forEach((s) => {
    let u;
    try { u = new URL(s.url); } catch { throw new SyncError('config', `"${s.name || s.url}" adresi geçersiz.`); }
    if (u.origin !== login.origin) throw new SyncError('config', `"${s.name || s.url}" adresi giriş adresiyle aynı sunucuda olmalı.`);
  });
};

// Giriş formu: şifre alanı olan ilk form. Gizli alanlar (güvenlik belirteci) olduğu gibi gönderilir.
const findLoginForm = (doc, baseUrl) => {
  for (const form of doc.querySelectorAll('form')) {
    const pw = form.querySelector('input[type="password"]');
    if (!pw) continue;
    const inputs = form.querySelectorAll('input');
    const user = inputs.find((i) => {
      const t = (i.getAttribute('type') || 'text').toLowerCase();
      return (t === 'email' || t === 'text') && i.getAttribute('name');
    });
    const fields = [];
    for (const i of inputs) {
      const name = i.getAttribute('name');
      if (!name) continue;
      const t = (i.getAttribute('type') || 'text').toLowerCase();
      if (t === 'hidden') fields.push({ name, value: i.getAttribute('value') || '' });
      else if ((t === 'checkbox' || t === 'radio') && i.hasAttribute('checked')) fields.push({ name, value: i.getAttribute('value') || 'on' });
    }
    const action = form.getAttribute('action');
    return {
      action: action ? new URL(action, baseUrl).href : baseUrl,
      method: (form.getAttribute('method') || 'post').toUpperCase(),
      userField: user ? user.getAttribute('name') : null,
      passField: pw.getAttribute('name'),
      fields
    };
  }
  return null;
};

const hasPasswordForm = (text) => { try { return !!parse(text).querySelector('input[type="password"]'); } catch { return false; } };

const encodeForm = (pairs) => pairs.map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`).join('&');

// Giriş: oturum zaten açıksa (giriş formu yoksa) atlanır. Başarısızsa 'login-failed' fırlatır (tekrar denenmez).
const login = async (t, cfg, creds) => {
  const page = await t.request(cfg.loginUrl);
  const form = findLoginForm(parse(page.text), page.url || cfg.loginUrl);
  if (!form) return { skipped: true };
  if (!form.userField) throw new SyncError('login-form', 'Giriş formunda kullanıcı/e-posta alanı bulunamadı.');
  if (form.method !== 'POST') throw new SyncError('login-form', 'Giriş formu POST değil; desteklenmiyor.');
  if (new URL(form.action).origin !== new URL(cfg.loginUrl).origin) throw new SyncError('config', 'Giriş formu başka bir sunucuya gönderiliyor; güvenlik nedeniyle durduruldu.');
  const pairs = [...form.fields, { name: form.userField, value: creds.username }, { name: form.passField, value: creds.password }];
  const res = await t.request(form.action, { method: 'POST', body: encodeForm(pairs), contentType: 'application/x-www-form-urlencoded' });
  if (hasPasswordForm(res.text)) throw new SyncError('login-failed', 'Giriş başarısız: e-posta ya da şifre yanlış olabilir. Şifreyi güncelleyin (hesap kilitlenmesin diye otomatik tekrar denenmez).');
  return { skipped: false };
};

// HTML tablosu: en çok satırı olan tablo. Üst bilgi: thead/th ya da ilk satır. Her satırda ilk bağlantı (görev detayı) da alınır.
const extractTable = (doc, baseUrl) => {
  let best = null;
  for (const table of doc.querySelectorAll('table')) {
    const trs = table.querySelectorAll('tr');
    if (trs.length < 2) continue;
    let headers = table.querySelectorAll('thead th').map((th) => norm(th.text));
    let bodyRows = table.querySelectorAll('tbody tr');
    if (headers.length === 0) {
      const first = trs[0];
      const ths = first.querySelectorAll('th');
      headers = (ths.length ? ths : first.querySelectorAll('td')).map((c) => norm(c.text));
      bodyRows = trs.slice(1);
    } else if (bodyRows.length === 0) bodyRows = trs.slice(1);
    const rows = bodyRows.map((tr) => {
      const cells = tr.querySelectorAll('td').map((c) => norm(c.text));
      const a = tr.querySelector('a[href]');
      let href = '';
      if (a) { try { href = new URL(a.getAttribute('href'), baseUrl).href; } catch { href = ''; } }
      return { cells, href };
    }).filter((r) => r.cells.length > 0 && r.cells.some(Boolean));
    if (!best || rows.length > best.rows.length) best = { headers, rows };
  }
  return best;
};

// div tabanlı liste (ProTracker): her görev satırı data-task-id taşır (.effort-row). Tablo gibi { headers, rows } döndürülür.
// Satır: [Key, Başlık, Durum, Bölüm, Proje, Atanan]. Durum = tür/öncelik dışındaki etiket; yoksa bölüm (backlog -> Backlog).
const TYPE_PRIORITY = /^(feature|bug|task|story|epic|improvement|support|chore|low|medium|high|critical|urgent|blocker|minor|major|normal|lowest|highest)$/i;
const GRID_HEADERS = ['Key', 'Başlık', 'Durum', 'Bölüm', 'Proje', 'Atanan'];
const extractGrid = (doc, baseUrl) => {
  const nodes = doc.querySelectorAll('.effort-row[data-task-id], .sortable-item[data-task-id]');
  if (nodes.length === 0) return null;
  // Sayfadaki "MT-90480" biçimli numaralardan önek öğren (data-task-id yalnızca sayı)
  const prefix = {};
  for (const m of String(doc.toString()).matchAll(/\b([A-Z]{2,6})-(\d{2,})\b/g)) prefix[m[2]] = m[1];
  const seen = new Set();
  const rows = [];
  for (const n of nodes) {
    const id = n.getAttribute('data-task-id');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    let sec = '';
    for (let p = n.parentNode; p; p = p.parentNode) { const s = p.getAttribute && p.getAttribute('data-status'); if (s) { sec = s; break; } }
    const nameCell = n.querySelector('.table-cell');
    const title = norm((nameCell && nameCell.querySelector('a') ? nameCell.querySelector('a') : nameCell || n).text);
    const badges = (nameCell ? nameCell.querySelectorAll('.badge') : []).map((b) => norm(b.text)).filter(Boolean);
    const status = badges.filter((b) => !TYPE_PRIORITY.test(b)).pop() || (/backlog/i.test(sec) ? 'Backlog' : sec ? 'Sprint' : '');
    const cells = n.querySelectorAll('.table-cell');
    const project = cells[1] ? norm(cells[1].text) : '';
    const people = [...new Set(n.querySelectorAll('[data-bs-title]').map((e) => norm(e.getAttribute('data-bs-title'))).filter(Boolean))];
    rows.push({ cells: [`${prefix[id] || 'MT'}-${id}`, title, status, sec, project, people.join(', ')], href: '' });
  }
  return rows.length ? { headers: GRID_HEADERS, rows } : null;
};

// Ekip menüsü: her ekibin ŞU ANKİ sprint'ine giden bağlantılar (sprintId her sprint'te değişir, ekip adı sabit kalır).
const teamLinks = (doc, baseUrl) => {
  const out = [];
  for (const a of doc.querySelectorAll('a.dropdown-item[href*="sprintId="]')) {
    try { out.push({ team: norm(a.text), url: new URL(a.getAttribute('href'), baseUrl).href }); } catch { /* geç */ }
  }
  return out;
};

const NEXT_TEXT =/^(sonraki|ileri|next|›|»|>|>>)$/i;
const findNextLink = (doc, baseUrl) => {
  const rel = doc.querySelector('a[rel="next"]');
  const cands = rel ? [rel] : doc.querySelectorAll('a[href]').filter((a) => NEXT_TEXT.test(norm(a.text)) || /\bnext\b/i.test(a.getAttribute('class') || '') || /\bnext\b/i.test(a.getAttribute('title') || ''));
  for (const a of cands) {
    const li = a.parentNode;
    const disabled = /disabled/i.test(a.getAttribute('class') || '') || (li && /disabled/i.test(li.getAttribute ? li.getAttribute('class') || '' : ''));
    const href = a.getAttribute('href');
    if (disabled || !href || href === '#' || href.startsWith('javascript:')) continue;
    try { return new URL(href, baseUrl).href; } catch { /* sıradaki */ }
  }
  return null;
};

// Kaynağa eklenebilen "görünüm çerezi" (örn. taskViewPreference=list): site liste/board görünümünü çerezle hatırlıyorsa tablo görünümünü almak için.
// Oturum/giriş/güvenlik çerezleri YAZILAMAZ (yalnızca zararsız tercih çerezleri).
const SENSITIVE_COOKIE = /(identity|auth|session|sess|token|antiforgery|affinity|aspxauth|csrf|xsrf|login|credential|key|secret)/i;
const parseViewCookies = (str) => {
  if (!str || !String(str).trim()) return [];
  const out = [];
  for (const part of String(str).split(';')) {
    const p = part.trim();
    if (!p) continue;
    const i = p.indexOf('=');
    const name = i > 0 ? p.slice(0, i).trim() : '';
    const value = i > 0 ? p.slice(i + 1).trim() : '';
    if (!/^[A-Za-z0-9_.-]{1,60}$/.test(name) || value.length > 100 || /[;\s,]/.test(value)) throw new SyncError('config', `Görünüm çerezi geçersiz: "${p.slice(0, 40)}" (ad=değer biçiminde olmalı).`);
    if (SENSITIVE_COOKIE.test(name)) throw new SyncError('config', `"${name}" bir oturum/güvenlik çerezi gibi görünüyor; yalnızca görünüm tercihi çerezleri eklenebilir.`);
    out.push({ name, value });
  }
  return out.slice(0, 5);
};

const REQ_HEADERS = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/html;q=0.9, */*;q=0.5' };

// Kaynak: { name, url, method?, body?, contentType? }. Dönüş: { kind: 'json', json } ya da { kind: 'html', table }.
// Kaynakta `team` varsa: adres bir ekip menüsü içeren sayfadır; menüden o ekibin güncel sprint sayfası bulunur (`*` = menüdeki tüm ekipler).
// Dönüş her zaman liste: [{ name?, kind, ... }] (tek ekip/adres için tek öğe).
const fetchSource = async (t, source, maxPages) => {
  const team = norm(source.team);
  if (!team) return [await fetchOne(t, source, source.url, maxPages)];
  const start = await fetchOne(t, source, source.url, maxPages, true);
  const links = teamLinks(start.doc, start.url);
  if (links.length === 0) throw new SyncError('config', `"${source.name || source.url}" sayfasında ekip menüsü bulunamadı; ekip adıyla bulma kullanılamıyor (adresi doğrudan sprint sayfası olarak verin).`);
  let picked;
  if (team === '*') picked = links;
  else {
    const q = team.toLocaleLowerCase('tr');
    picked = links.filter((l) => l.team.toLocaleLowerCase('tr') === q);
    if (picked.length === 0) picked = links.filter((l) => l.team.toLocaleLowerCase('tr').includes(q));
    if (picked.length === 0) throw new SyncError('config', `"${team}" adlı ekip menüde yok. Menüdeki ekipler: ${links.map((l) => l.team).join(', ')}`);
  }
  const out = [];
  for (const l of picked.slice(0, 15)) {
    if (new URL(l.url).origin !== new URL(source.url).origin) continue;
    const r = await fetchOne(t, source, l.url, maxPages, false, true);
    out.push({ ...r, name: l.team });
  }
  return out;
};

const fetchOne = async (t, source, pageUrl, maxPages, rawDoc, lenient) => {
  const viewCookies = parseViewCookies(source.cookies);
  for (const c of viewCookies) { if (typeof t.setCookie === 'function') await t.setCookie(pageUrl, c.name, c.value); }
  const method = (source.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new SyncError('config', 'Kaynak yöntemi GET ya da POST olmalı.');
  const isStart = !!rawDoc;
  const res = await t.request(pageUrl, { method: isStart ? 'GET' : method, body: isStart ? null : (source.body || null), contentType: isStart ? undefined : (source.contentType || undefined), headers: REQ_HEADERS });
  if (res.status === 401 || res.status === 403) throw new SyncError('login-required', 'Oturum açık değil (sunucu yetkisiz döndü).');
  const first = res.text.trim();
  if (rawDoc) {
    if (hasPasswordForm(res.text)) throw new SyncError('login-required', 'Oturum açık değil (sunucu giriş sayfasına yönlendirdi).');
    return { doc: parse(res.text), url: res.url || pageUrl };
  }
  if (first.startsWith('{') || first.startsWith('[')) {
    try { return { kind: 'json', json: JSON.parse(first) }; } catch { /* HTML gibi dene */ }
  }
  if (hasPasswordForm(res.text)) throw new SyncError('login-required', 'Oturum açık değil (sunucu giriş sayfasına yönlendirdi).');
  let doc = parse(res.text);
  let table = extractTable(doc, res.url || pageUrl) || extractGrid(doc, res.url || pageUrl);
  if (!table && lenient) return { kind: 'html', table: { headers: GRID_HEADERS, rows: [] } }; // ekip menüsünden gelen boş sprint hata değildir
  if (!table && teamLinks(doc, res.url || pageUrl).length > 0) {
    throw new SyncError('no-table', `"${source.name || pageUrl}" sayfasında iş listesi yok; burası ekip menüsü olan genel bir sayfa. Kaynağın "Ekip adı" kutusuna ekip adını (ya da tüm ekipler için *) yazın.`);
  }
  if (!table) {
    const ids = new Set((res.text.match(/\b[A-Z]{2,6}-\d{2,}\b/g) || []));
    const name = source.name || source.url;
    if (ids.size > 0) throw new SyncError('no-table', `"${name}" sayfasında tablo yok ama ${ids.size} iş numarası (örn. ${[...ids][0]}) var: işler tablo değil kart olarak geliyor. Sitede liste (tablo) görünümü varsa kaynağa görünüm çerezini ekleyin (örn. taskViewPreference=list).`);
    throw new SyncError('no-table', `"${name}" sayfasında tablo ve iş numarası bulunamadı (sayfa veriyi sonradan yüklüyor olabilir; JSON adresi gerekebilir).`);
  }
  let url = res.url || pageUrl;
  const gridOnly = table.headers === GRID_HEADERS;
  for (let p = 1; !gridOnly && p < (maxPages || 10); p++) {
    const next = findNextLink(doc, url);
    if (!next || new URL(next).origin !== new URL(pageUrl).origin) break;
    const r = await t.request(next, { headers: REQ_HEADERS });
    doc = parse(r.text);
    const more = extractTable(doc, r.url || next);
    if (!more || more.rows.length === 0) break;
    table = { headers: table.headers, rows: table.rows.concat(more.rows) };
    url = r.url || next;
  }
  return { kind: 'html', table };
};

// cfg: { loginUrl, allowHttp, maxPages, sources: [{name,url,method,body,contentType}] }; creds: { username, password }
// Giriş TEMBEL yapılır: önce var olan oturum (çerez) denenir, sunucu giriş istediğinde giriş yapılır. Bir çekmede en çok İKİ giriş denemesi vardır
// (ilk giriş + oturum ortada düşerse bir yeniden giriş); giriş başarısızsa hemen durulur.
const runSync = async (cfg, creds, t) => {
  try {
    checkUrls(cfg);
    if (!creds || !creds.username || !creds.password) throw new SyncError('no-credentials', 'E-posta ve şifre kaydedilmemiş.');
    let logins = 0;
    const out = [];
    for (const s of cfg.sources) {
      let rs;
      try { rs = await fetchSource(t, s, cfg.maxPages); }
      catch (e) {
        if (e instanceof SyncError && e.code === 'login-required' && logins < 2) {
          logins++;
          await login(t, cfg, creds);
          rs = await fetchSource(t, s, cfg.maxPages);
        } else throw e;
      }
      for (const r of rs) out.push({ name: s.name, sourceIndex: cfg.sources.indexOf(s), ...r });
    }
    return { ok: true, sources: out };
  } catch (e) {
    if (e instanceof SyncError) return { ok: false, code: e.code, error: e.message };
    const msg = String((e && e.message) || e);
    const net = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|fetch failed|net::ERR|network|timeout|zaman aşımı/i.test(msg);
    return { ok: false, code: net ? 'unreachable' : 'error', error: net ? 'Sunucuya ulaşılamıyor (VPN bağlı mı?).' : msg.slice(0, 300) };
  }
};

// ---- taşıyıcılar ----
// Electron: oturum bölümü (çerezler bellekte tutulur, uygulama kapanınca silinir); sistem sertifika deposu kullanılır.
const electronTransport = (ses) => ({
  async setCookie(url, name, value) { await ses.cookies.set({ url: new URL(url).origin, name, value, path: '/' }); },
  async request(url, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const headers = { ...(opts.headers || {}) };
      if (opts.contentType) headers['Content-Type'] = opts.contentType;
      const res = await ses.fetch(url, { method: opts.method || 'GET', headers, body: opts.body || undefined, redirect: 'follow', credentials: 'include', signal: ctrl.signal });
      const text = await res.text();
      if (text.length > 8 * 1024 * 1024) throw new Error('Cevap çok büyük.');
      return { status: res.status, url: res.url || url, text };
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('zaman aşımı');
      throw e;
    } finally { clearTimeout(timer); }
  }
});

module.exports = { runSync, SyncError, electronTransport, findLoginForm, extractTable, extractGrid, teamLinks,findNextLink, checkUrls, parseViewCookies };
