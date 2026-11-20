// Market fiyatları (marketfiyati.org.tr, Sanayi ve Teknoloji Bakanlığı / TÜBİTAK platformu) için dar bir istemci.
// Resmi/belgeli bir API değil: uç noktalar sitenin kendi arayüzünün kullandıklarıdır, yapı değişirse bozulabilir.
// Bu yüzden: yalnızca bu tek sunucu, kimliği saklamayan dürüst bir User-Agent, çağrılar arası bekleme (toplu tarama yok),
// sıkı girdi doğrulaması ve yanıt boyutu sınırı. Önbellek renderer tarafındadır (fiyatlar günde bir güncelleniyor).
const https = require('https');

const HOST = 'api.marketfiyati.org.tr';
const UA = 'UltimateNoteFactory/1.0 (kisisel kullanim; gunluk onbellekli)';
const MIN_GAP_MS = 400;           // art arda çağrılar arasında en az bu kadar bekle
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 30000;

let chain = Promise.resolve();    // çağrılar sıraya girer (aynı anda tek istek)
let lastAt = 0;

const post = (path, payload) => new Promise((resolve) => {
  let done = false;
  const finish = (v) => { if (!done) { done = true; resolve(v); } };
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  const req = https.request({
    host: HOST, path, method: 'POST', timeout: TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Accept': 'application/json', 'User-Agent': UA, 'Content-Length': body.length }
  }, (res) => {
    const chunks = []; let size = 0;
    res.on('data', (c) => { size += c.length; if (size > MAX_BYTES) { req.destroy(); finish({ ok: false, error: 'Yanıt çok büyük.' }); } else chunks.push(c); });
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8');
      if (res.statusCode !== 200) return finish({ ok: false, error: `Market fiyat servisi ${res.statusCode} döndürdü.`, status: res.statusCode });
      try { finish({ ok: true, data: JSON.parse(text) }); } catch { finish({ ok: false, error: 'Servis yanıtı okunamadı.' }); }
    });
  });
  req.on('timeout', () => { req.destroy(); finish({ ok: false, error: 'Market fiyat servisi zaman aşımına uğradı.' }); });
  req.on('error', (e) => finish({ ok: false, error: `Bağlanılamadı: ${e.message}` }));
  req.write(body); req.end();
});

const queued = (path, payload) => {
  const run = async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try { return await post(path, payload); } finally { lastAt = Date.now(); }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
};

const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

// req: { latitude, longitude, distance(km) } -> { ok, data: [{ id, sellerName, marketName, distance, location }] }
const nearest = (req) => {
  const latitude = num(req && req.latitude, 35, 43), longitude = num(req && req.longitude, 25, 46), distance = num(req && req.distance, 1, 10);
  if (latitude === null || longitude === null || distance === null) return Promise.resolve({ ok: false, error: 'Konum geçersiz (Türkiye sınırları içinde enlem/boylam girin).' });
  return queued('/api/v2/nearest', { latitude, longitude, distance: Math.round(distance) });
};

// req: { keywords, latitude, longitude, distance, depots: [id], size?, pages? }
const search = (req) => {
  const latitude = num(req && req.latitude, 35, 43), longitude = num(req && req.longitude, 25, 46), distance = num(req && req.distance, 1, 10);
  const keywords = String((req && req.keywords) || '').trim().slice(0, 80);
  const size = num(req && req.size, 1, 60) ?? 24, pages = num(req && req.pages, 0, 5) ?? 0;
  const depots = Array.isArray(req && req.depots) ? req.depots.filter(d => typeof d === 'string' && /^[\w.-]{1,40}$/.test(d)).slice(0, 80) : [];
  if (latitude === null || longitude === null || distance === null) return Promise.resolve({ ok: false, error: 'Konum geçersiz.' });
  if (!keywords) return Promise.resolve({ ok: false, error: 'Aranacak ürün adı boş.' });
  if (!depots.length) return Promise.resolve({ ok: false, error: 'Yakında market bulunamadı (konumu ve yarıçapı kontrol edin).' });
  return queued('/api/v2/search', { keywords, pages: Math.round(pages), size: Math.round(size), latitude, longitude, distance: Math.round(distance), depots });
};

module.exports = { nearest, search };
