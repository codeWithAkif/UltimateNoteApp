// Kart ekstresi PDF'inden metin çıkarma. PDF bu bilgisayarda metne çevrilir; yapay zekâya ham dosya değil, kart/IBAN/TC gizlenmiş METİN gider.
// Bu yüzden Gemini'de de Claude Code'da da aynı şekilde çalışır ve kimlik numaraları dışarı çıkmaz.
import { redactSensitive } from './budget';

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_STATEMENT_CHARS = 14000; // istemi şişirmemek için; ekstrenin özeti genelde ilk sayfalardadır

export interface StatementText { name: string; text: string; pages: number; truncated: boolean }

// pdf.js metin parçalarını satırlara dizer: aynı yükseklikteki parçalar yan yana, yukarıdan aşağı
export const itemsToText = (items: Array<{ str?: string; transform?: number[] }>): string => {
  const parts = items.filter(i => typeof i.str === 'string' && i.str.trim() && Array.isArray(i.transform))
    .map(i => ({ s: i.str as string, x: i.transform![4], y: i.transform![5] }));
  parts.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));
  const lines: string[] = [];
  let curY: number | null = null, cur: string[] = [];
  for (const p of parts) {
    if (curY === null || Math.abs(p.y - curY) > 2) { if (cur.length) lines.push(cur.join(' ')); cur = []; curY = p.y; }
    cur.push(p.s.trim());
  }
  if (cur.length) lines.push(cur.join(' '));
  return lines.join('\n');
};

// Okunan metni gizle + kısalt (saf fonksiyon; testte doğrudan denenir)
export const prepareStatement = (name: string, raw: string, pages: number): StatementText => {
  // Puan özeti ve ücret/faiz açıklamaları (yasal metin) tutar çıkarmaya yaramaz; metnin yarısını kaplayıp istemi şişirir
  const cut = raw.search(/PUAN ÖZETİ|WORLDPUAN DETAYI|KULLANIMIYLA İLGİLİ ALINAN ÜCRETLER|FAİZ NASIL HESAPLANIYOR/i);
  const body = cut > 300 ? raw.slice(0, cut) : raw;
  const clean = redactSensitive(body)
    .replace(/(Müşteri\s*(?:No|Numarası)\s*:?\s*)\d{5,}/gi, '$1[GİZLİ]')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const truncated = clean.length > MAX_STATEMENT_CHARS;
  return { name: name.slice(0, 80), text: truncated ? clean.slice(0, MAX_STATEMENT_CHARS) : clean, pages, truncated };
};

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((res, rej) => { const t = setTimeout(() => rej(new Error('ZAMAN_ASIMI')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });

export async function readStatementPdf(file: File): Promise<StatementText> {
  if (file.size > MAX_PDF_BYTES) throw new Error('PDF çok büyük (en çok 15 MB).');
  // pdf.js yalnızca gerekince yüklensin (açılış hızı ve telefon paketi için)
  // "legacy" derleme şart: yeni derleme Promise.try kullanır (Chromium 128+), uygulamanın Electron 29'unda yok → sonsuza dek takılıyordu.
  // İşçi dosyası da ana iş parçacığında çalışır: paketli uygulama file:// ile açıldığı için ayrı Worker güvenilir değil.
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!(globalThis as any).pdfjsWorker) (globalThis as any).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  let doc: any;
  try {
    doc = await withTimeout(pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise, 25000);
  } catch (e: any) {
    if (e?.message === 'ZAMAN_ASIMI') throw new Error('PDF 25 saniyede açılamadı. Dosyayı yeniden indirip deneyin ya da tutarları yazarak girin.');
    if (e?.name === 'PasswordException') throw new Error('Bu PDF şifreli (bankalar ekstreyi çoğu zaman şifreli gönderir). Şifreyi PDF okuyucuda kaldırıp ("şifresiz kaydet") yeniden ekleyin; şifreyi uygulamaya yazmayın.');
    throw new Error('PDF açılamadı: dosya bozuk olabilir.');
  }
  const chunks: string[] = [];
  const pages = Math.min(doc.numPages, 8);
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const tc = await withTimeout<any>(page.getTextContent(), 25000).catch((e: any) => { throw new Error(e?.message === 'ZAMAN_ASIMI' ? 'PDF metni 25 saniyede okunamadı.' : 'PDF okunamadı.'); });
    chunks.push(itemsToText(tc.items as any));
  }
  const st = prepareStatement(file.name, chunks.join('\n\n'), doc.numPages);
  if (st.text.replace(/\s/g, '').length < 40) throw new Error('PDF\'den metin okunamadı (taranmış/resim bir PDF olabilir). Bankanın indirdiği asıl PDF\'i deneyin ya da tutarları yazarak girin.');
  return st;
}
