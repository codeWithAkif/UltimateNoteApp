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

const NEXT_TEXT = /^(sonraki|ileri|next|›|»|>|>>)$/i;
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

const REQ_HEADERS = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/html;q=0.9, */*;q=0.5' };

// Kaynak: { name, url, method?, body?, contentType? }. Dönüş: { kind: 'json', json } ya da { kind: 'html', table }.
const fetchSource = async (t, source, maxPages) => {
  const method = (source.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new SyncError('config', 'Kaynak yöntemi GET ya da POST olmalı.');
  const res = await t.request(source.url, { method, body: source.body || null, contentType: source.contentType || undefined, headers: REQ_HEADERS });
  if (res.status === 401 || res.status === 403) throw new SyncError('login-required', 'Oturum açık değil (sunucu yetkisiz döndü).');
  const first = res.text.trim();
  if (first.startsWith('{') || first.startsWith('[')) {
    try { return { kind: 'json', json: JSON.parse(first) }; } catch { /* HTML gibi dene */ }
  }
  if (hasPasswordForm(res.text)) throw new SyncError('login-required', 'Oturum açık değil (sunucu giriş sayfasına yönlendirdi).');
  let doc = parse(res.text);
  let table = extractTable(doc, res.url || source.url);
  if (!table) throw new SyncError('no-table', `"${source.name || source.url}" sayfasında tablo bulunamadı (sayfa veriyi sonradan yüklüyor olabilir; JSON adresi gerekebilir).`);
  let url = res.url || source.url;
  for (let p = 1; p < (maxPages || 10); p++) {
    const next = findNextLink(doc, url);
    if (!next || new URL(next).origin !== new URL(source.url).origin) break;
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
      let r;
      try { r = await fetchSource(t, s, cfg.maxPages); }
      catch (e) {
        if (e instanceof SyncError && e.code === 'login-required' && logins < 2) {
          logins++;
          await login(t, cfg, creds);
          r = await fetchSource(t, s, cfg.maxPages);
        } else throw e;
      }
      out.push({ name: s.name, ...r });
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

module.exports = { runSync, SyncError, electronTransport, findLoginForm, extractTable, findNextLink, checkUrls };
