// Oturum özeti için yapay zekâ katmanı: bloğu "olayı anlatan" kısa bir özete çevirir, görevleri temalara ayırıp kısa etiketler verir,
// günlük/haftalık rapor ve müşteri durum e-postası taslağı üretir, belirsiz toplantı için proje tahmin eder.
// Gizlilik: yapay zekâya YALNIZCA görev başlıkları ve yapılandırılmış olgular (tür, nereden→nereye, süre) gider; not içeriği, sizin yazdığınız
// özet/ayrıntı metni, kişi adları gitmez. "Müşteri/proje adlarını gizle" açıkken (varsayılan) ad yerine PROJE_A / MUSTERI_A gibi jetonlar gider,
// cevap gelince jetonlar gerçek adlarla geri eşleştirilir. Çağrı mevcut yolu kullanır: önce ücretsiz Gemini, kota/hata olursa ücretli Claude.
// Kural tabanlı çıktı her zaman yedek kalır; buradaki saf işlevler ağ kullanmaz (yalnızca ai* sarmalayıcıları çağırır).

import { callAIJson } from './services/geminiMentor';
import type { SessionItem } from './sessionTracker';

// ---------------- ayar ----------------
const HIDE_KEY = 'session_ai_hide_names_v1';
export const loadHideNames = (): boolean => { try { return localStorage.getItem(HIDE_KEY) !== '0'; } catch { return true; } }; // varsayılan: gizle
export const saveHideNames = (v: boolean) => { try { localStorage.setItem(HIDE_KEY, v ? '1' : '0'); } catch { /* yoksay */ } };
// Gizlenecek ek adlar (kişi adları; virgül/satırla ayrılmış) ve "özel adları otomatik gizle" seçeneği (varsayılan kapalı).
const EXTRA_KEY = 'session_ai_extra_names_v1';
const PROPER_KEY = 'session_ai_mask_proper_v1';
export const loadExtraNames = (): string => { try { return localStorage.getItem(EXTRA_KEY) || ''; } catch { return ''; } };
export const saveExtraNames = (v: string) => { try { localStorage.setItem(EXTRA_KEY, v); } catch { /* yoksay */ } };
export const loadMaskProper = (): boolean => { try { return localStorage.getItem(PROPER_KEY) === '1'; } catch { return false; } };
export const saveMaskProper = (v: boolean) => { try { localStorage.setItem(PROPER_KEY, v ? '1' : '0'); } catch { /* yoksay */ } };
export const splitNames = (v: string): string[] => v.split(/[,\n;]/).map(x => x.trim()).filter(Boolean);

// ---------------- adları gizleme (jeton) ----------------
export interface Anonymizer { enc: (s: string) => string; dec: (s: string) => string; active: boolean }

const letters = (n: number): string => {
  let s = ''; let x = n + 1;
  while (x > 0) { x--; s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26); }
  return s;
};
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface AnonOptions { people?: string[]; maskProper?: boolean }

export const makeAnonymizer = (enabled: boolean, projects: string[], clients: string[], opts: AnonOptions = {}): Anonymizer => {
  if (!enabled) return { enc: s => s, dec: s => s, active: false };
  interface Ent { name: string; token: string; variants: string[] }
  const ents: Ent[] = [];
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  const add = (raw: string, prefix: string) => {
    const name = raw.trim();
    if (!name) return;
    const k = name.toLocaleLowerCase('tr').replace(/_/g, ' ');
    if (seen.has(k)) return;
    seen.add(k);
    const n = counts[prefix] || 0; counts[prefix] = n + 1;
    ents.push({ name, token: `${prefix}_${letters(n)}`, variants: [...new Set([name, name.replace(/_/g, ' ')])] });
  };
  // Müşteri: tam ad + ilk sözcük ("Zorlu Enerji" -> "Zorlu"); proje: yalnızca tam ad (sıradan sözcükleri bozmamak için).
  clients.forEach(c => { add(c, 'MUSTERI'); const first = c.split(/[\s_]+/)[0]; if (first && first.length >= 4) add(first, 'MUSTERI'); });
  projects.forEach(p => add(p, 'PROJE'));
  // Kişi adları: tam ad + her sözcük ayrı ("Betül Ünlü" -> "Betül", "Ünlü"; başlıkta tek başına geçebilir).
  (opts.people || []).forEach(p => { add(p, 'KISI'); p.split(/[\s_]+/).filter(w => w.length >= 3).forEach(w => add(w, 'KISI')); });

  const lookup = new Map<string, Ent>();
  ents.forEach(e => e.variants.forEach(v => lookup.set(v.toLocaleLowerCase('tr'), e)));
  const all = [...lookup.keys()].sort((a, b) => b.length - a.length);
  // Uzun adlar sözcük başından eşleşir (Türkçe ek alabilir: "Zorlu'nun", "Zorlunun"); kısa adlar (<5) yalnızca tam sözcük.
  const longAlt = all.filter(v => v.length >= 5).map(escRe).join('|');
  const shortAlt = all.filter(v => v.length < 5).map(escRe).join('|');
  const longRe = longAlt ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${longAlt})`, 'giu') : null;
  const shortRe = shortAlt ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${shortAlt})(?![\\p{L}\\p{N}_])`, 'giu') : null;
  const byToken = new Map(ents.map(e => [e.token, e]));
  // Seçime bağlı: cümle içinde büyük harfle başlayan her özel ad (kişi, ürün, tablo adı) de jetonlanır; daha güvenli, anlatı daha az doğal olur.
  const properRe = opts.maskProper ? /(?<=[\p{L}\p{N}'’,;:)]\s+)\p{Lu}[\p{L}\p{N}_.]*[\p{L}\p{N}]/gu : null;
  const properSeen = new Map<string, Ent>();
  const TOKEN_RE = /^(PROJE|MUSTERI|KISI|AD)_[A-Z]+$/;

  return {
    active: true,
    enc: (s: string) => {
      let out = s;
      if (longRe) out = out.replace(longRe, m => lookup.get(m.toLocaleLowerCase('tr'))?.token || m);
      if (shortRe) out = out.replace(shortRe, m => lookup.get(m.toLocaleLowerCase('tr'))?.token || m);
      if (properRe) {
        out = out.replace(properRe, m => {
          if (TOKEN_RE.test(m)) return m;
          const k = m.toLocaleLowerCase('tr');
          let e = properSeen.get(k);
          if (!e) {
            const n = counts.AD || 0; counts.AD = n + 1;
            e = { name: m, token: `AD_${letters(n)}`, variants: [m] };
            properSeen.set(k, e); byToken.set(e.token, e);
          }
          return e.token;
        });
      }
      return out;
    },
    dec: (s: string) => s.replace(/(MUSTERI|PROJE|KISI|AD)_([A-Z]+)/g, (m, p: string, l: string) => {
      const full = byToken.get(`${p}_${l}`);
      if (full) return full.name;
      const one = byToken.get(`${p}_${l[0]}`); // "PROJE_AB" gibi bitişik büyük harf eki: ilk harf jeton, kalanı ek
      return one ? one.name + l.slice(1) : m;
    })
  };
};

export const clientNamesFrom = (paths: string[], clientsFolder: string): string[] => {
  const root = (clientsFolder || 'Müşteriler').replace(/\/+$/, '') + '/';
  const set = new Set<string>();
  paths.forEach(p => { if (p.startsWith(root)) { const seg = p.slice(root.length).split('/')[0]; if (seg && !seg.endsWith('.md')) set.add(seg); } });
  return [...set];
};

// ---------------- olgular ----------------
export interface AiFact { i: number; tur: string; nereden?: string; nereye?: string; baslik: string }
const KIND_LABEL: Record<NonNullable<SessionItem['kind']>, string> = {
  done: 'tamamlandı', added: 'eklendi', 'added-done': 'eklendi ve tamamlandı', moved: 'sütun değiştirdi', reopened: 'yeniden açıldı', cal: 'takvim zamanı değişti'
};
// Yalnızca görev kaynaklı öğeler (başlığı ve türü olanlar); not içeriği taşıyan öğeler yapay zekâya gitmez.
export const factItems = (items: SessionItem[]): SessionItem[] => items.filter(i => i.title && i.kind);
export const factsFrom = (items: SessionItem[], enc: (s: string) => string = s => s): AiFact[] =>
  factItems(items).map((it, i) => ({ i, tur: KIND_LABEL[it.kind!], nereden: it.from, nereye: it.to, baslik: enc(it.title!) }));

const phraseOf = (it: SessionItem): string => {
  switch (it.kind) {
    case 'done': return it.from === 'Test' ? 'test edildi, kapatıldı' : it.from === 'İncelemede' ? 'incelendi, kapatıldı' : 'kapatıldı';
    case 'added': return 'eklendi';
    case 'added-done': return 'eklendi, kapatıldı';
    case 'moved': return `${it.from} → ${it.to}`;
    case 'reopened': return 'yeniden açıldı';
    case 'cal': return 'takvim zamanı değişti';
    default: return '';
  }
};

// ---------------- anlatı + tema + etiket ----------------
export interface NarrativeResult { anlati: string; temalar: { ad: string; ogeler: number[] }[]; etiketler: string[] }

export const NARRATIVE_SCHEMA = {
  type: 'object',
  properties: {
    anlati: { type: 'string' },
    temalar: { type: 'array', items: { type: 'object', properties: { ad: { type: 'string' }, ogeler: { type: 'array', items: { type: 'integer' } } }, required: ['ad', 'ogeler'] } },
    etiketler: { type: 'array', items: { type: 'string' } }
  },
  required: ['anlati', 'temalar', 'etiketler']
};

export const buildNarrativePrompt = (o: { project: string | null; minutes: number | null; start: string; end: string; kind: 'calisma' | 'toplanti'; facts: AiFact[] }): string => {
  const lines = o.facts.map(f => JSON.stringify(f)).join('\n');
  return `Sen bir yazılım danışmanının günlük çalışma kaydını yazan yardımcısın. Aşağıda bir çalışma seansında gerçekleşen OLGULAR var (her satır bir görev olayı).
Seans: ${o.start}–${o.end}${o.minutes ? `, ${o.minutes} dakika` : ''}${o.project ? `, proje: ${o.project}` : ''}.

GÖREVLER (JSON satırları; i = sıra numarası, tur = olay, nereden/nereye = sütun değişimi, baslik = görevin kendi başlığı):
${lines}

İSTENEN ÇIKTI (JSON):
1. "anlati": 2-4 cümlelik Türkçe özet. OLAYI anlat; "A görevi test'e alındı, A görevi bitti" gibi sıralama yerine "A önce test edildi, sonra kapatıldı" gibi akış kur. Aynı konudaki görevleri tek cümlede topla. Geçmiş zaman, sade ve resmi olmayan ama profesyonel bir dil kullan.
2. "temalar": görevleri konularına göre gruplayan en çok 5 tema. Her tema {"ad": kısa konu adı (en çok 4 sözcük), "ogeler": ilgili görevlerin i numaraları}. Her görev en çok bir temada olsun.
3. "etiketler": i sırasına göre uzunluğu ${o.facts.length} olan dizi; her görev için en çok 8 sözcüklük kısa etiket (başlığın özü, olay türünü yazma).

KURALLAR:
- YALNIZCA verilen olgulara dayan; yeni olay, sayı, kişi ya da neden uydurma. Verilmeyen süre/sayı yazma.
- PROJE_A, MUSTERI_A gibi büyük harfli jetonları AYNEN koru, değiştirme.
- Teknik terimleri ve özel adları olduğu gibi bırak.`;
};

export const parseNarrative = (raw: any, n: number): NarrativeResult | null => {
  if (!raw || typeof raw !== 'object') return null;
  const anlati = typeof raw.anlati === 'string' ? raw.anlati.trim().slice(0, 900) : '';
  if (!anlati) return null;
  const used = new Set<number>();
  const temalar = (Array.isArray(raw.temalar) ? raw.temalar : []).slice(0, 6).map((t: any) => {
    const ad = typeof t?.ad === 'string' ? t.ad.trim().slice(0, 60) : '';
    const ogeler = (Array.isArray(t?.ogeler) ? t.ogeler : []).filter((x: any) => Number.isInteger(x) && x >= 0 && x < n && !used.has(x));
    ogeler.forEach((x: number) => used.add(x));
    return { ad, ogeler: [...new Set<number>(ogeler)] };
  }).filter((t: { ad: string; ogeler: number[] }) => t.ad && t.ogeler.length > 0);
  const etiketler = Array.from({ length: n }, (_, i) => (typeof raw.etiketler?.[i] === 'string' ? raw.etiketler[i].trim().slice(0, 80) : ''));
  return { anlati, temalar, etiketler };
};

// Sonucu pencereye uygular: anlatı "Genel özet" olur; ayrıntılar temalara göre gruplanır (alt maddeler: kısa etiket — olay).
// Olgu olmayan öğeler (not satırı, oluşturma cümlesi) olduğu gibi altta kalır. dec: jetonları gerçek adlara çevirir.
export const applyNarrative = (items: SessionItem[], res: NarrativeResult, dec: (s: string) => string): { summary: string; details: string[] } => {
  const fi = factItems(items);
  const rest = items.filter(i => !(i.title && i.kind));
  const line = (idx: number) => {
    const it = fi[idx];
    const label = dec(res.etiketler[idx] || '') || it.title!;
    const ph = phraseOf(it);
    return ph ? `${label} — ${ph}` : label;
  };
  const details: string[] = [];
  const placed = new Set<number>();
  res.temalar.forEach(t => {
    const mem = t.ogeler.filter(i => i < fi.length);
    if (mem.length === 0) return;
    mem.forEach(i => placed.add(i));
    if (mem.length === 1) details.push(`${dec(t.ad)}: ${line(mem[0])}`);
    else { details.push(`${dec(t.ad)} (${mem.length} görev)`); mem.forEach(i => details.push(`  ${line(i)}`)); }
  });
  fi.forEach((_, i) => { if (!placed.has(i)) details.push(line(i)); });
  rest.forEach(i => details.push(i.text));
  return { summary: dec(res.anlati), details };
};

// ---------------- blok kayıtları (rapor için, bu cihaz) ----------------
export interface FactRecord { tur: string; nereden?: string; nereye?: string; baslik: string }
export interface BlockRecord { id: string; date: string; start: string; end: string; project: string; minutes: number; kind: 'calisma' | 'toplanti' | 'gorusme' | 'bosluk'; facts: FactRecord[] }

const REC_KEY = 'session_block_records_v1';
export const loadBlockRecords = (): BlockRecord[] => {
  try { const raw = localStorage.getItem(REC_KEY); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; } catch { return []; }
};
export const addBlockRecord = (rec: BlockRecord) => {
  try {
    const cutoff = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const next = [...loadBlockRecords().filter(r => r.id !== rec.id && r.date >= cutoff), rec].slice(-800);
    localStorage.setItem(REC_KEY, JSON.stringify(next));
  } catch { /* yoksay */ }
};
export const recordFactsOf = (items: SessionItem[]): FactRecord[] =>
  factItems(items).map(it => ({ tur: KIND_LABEL[it.kind!], nereden: it.from, nereye: it.to, baslik: it.title! }));
export const minutesBetween = (start: string, end: string): number => {
  const [a, b] = [start, end].map(t => { const m = t.match(/^(\d{2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : 0; });
  return Math.max(0, b - a);
};

// ---------------- rapor ----------------
export interface ReportAgg { toplamDakika: number; projeler: { proje: string; dakika: number; bloklar: { tarih: string; dakika: number; tur: string; olgular: FactRecord[] }[] }[] }

export const aggregateRecords = (recs: BlockRecord[], fromYmd: string, toYmd: string, project?: string): ReportAgg => {
  const by = new Map<string, ReportAgg['projeler'][number]>();
  recs.filter(r => r.date >= fromYmd && r.date <= toYmd && (!project || r.project === project)).forEach(r => {
    const key = r.project || '(Projesiz)';
    const e = by.get(key) || { proje: key, dakika: 0, bloklar: [] };
    e.dakika += r.minutes;
    e.bloklar.push({ tarih: r.date, dakika: r.minutes, tur: r.kind, olgular: r.facts });
    by.set(key, e);
  });
  const projeler = [...by.values()].sort((a, b) => b.dakika - a.dakika);
  return { toplamDakika: projeler.reduce((n, p) => n + p.dakika, 0), projeler };
};

export const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    ozet: { type: 'string' },
    projeler: { type: 'array', items: { type: 'object', properties: { proje: { type: 'string' }, anlati: { type: 'string' } }, required: ['proje', 'anlati'] } }
  },
  required: ['ozet', 'projeler']
};
export const REPORT_MAIL_SCHEMA = {
  type: 'object',
  properties: {
    ozet: { type: 'string' },
    projeler: REPORT_SCHEMA.properties.projeler,
    eposta: { type: 'object', properties: { konu: { type: 'string' }, govde: { type: 'string' } }, required: ['konu', 'govde'] }
  },
  required: ['ozet', 'projeler', 'eposta']
};

export const buildReportPrompt = (agg: ReportAgg, scope: string, wantMail: boolean, enc: (s: string) => string): string => {
  const data = agg.projeler.map(p => ({
    proje: enc(p.proje),
    dakika: p.dakika,
    bloklar: p.bloklar.map(b => ({ tarih: b.tarih, dakika: b.dakika, tur: b.tur, olgular: b.olgular.map(o => ({ tur: o.tur, nereden: o.nereden, nereye: o.nereye, baslik: enc(o.baslik) })) }))
  }));
  return `Sen bir yazılım danışmanının çalışma raporunu yazan yardımcısın. Dönem: ${scope}. Aşağıda projeler, uygulamanın hesapladığı süreler (dakika) ve görev olguları var.

VERİ (JSON):
${JSON.stringify(data)}

İSTENEN ÇIKTI (JSON):
1. "ozet": dönemi 2-4 cümleyle özetleyen Türkçe paragraf (olay akışı anlat: "önce test edildi, sonra kapatıldı" gibi; görev başlıklarını tek tek sayma, konuya göre topla).
2. "projeler": her proje için {"proje": veride yazıldığı gibi ad, "anlati": 1-3 cümle}.${wantMail ? `
3. "eposta": müşteriye gidecek kısa, nazik, profesyonel bir durum e-postası: {"konu": ..., "govde": ...}. Hitabı "Merhaba," ile yap, kişi adı uydurma. Yapılanları sade bir dille, madde işaretleri kullanmadan 3-6 cümlede anlat; teknik ayrıntıya boğma. Süre yazma. En sona "İyi çalışmalar." ekle, imza yazma.` : ''}

KURALLAR:
- YALNIZCA verilen olgulara dayan; yeni iş, sayı, kişi ya da neden uydurma.
- Süreleri (dakika) kendin hesaplama, yazman gerekirse verilen sayıyı kullan.
- PROJE_A, MUSTERI_A gibi büyük harfli jetonları AYNEN koru.`;
};

export interface ReportResult { ozet: string; projeler: { proje: string; anlati: string }[]; eposta?: { konu: string; govde: string } }
export const parseReport = (raw: any, wantMail: boolean): ReportResult | null => {
  if (!raw || typeof raw !== 'object') return null;
  const ozet = typeof raw.ozet === 'string' ? raw.ozet.trim() : '';
  if (!ozet) return null;
  const projeler = (Array.isArray(raw.projeler) ? raw.projeler : []).map((p: any) => ({ proje: String(p?.proje || '').trim(), anlati: String(p?.anlati || '').trim() })).filter((p: any) => p.proje && p.anlati);
  let eposta: ReportResult['eposta'];
  if (wantMail && raw.eposta && typeof raw.eposta.govde === 'string' && raw.eposta.govde.trim()) {
    eposta = { konu: String(raw.eposta.konu || '').trim(), govde: raw.eposta.govde.trim() };
  }
  return { ozet, projeler, eposta };
};

// ---------------- proje tahmini ----------------
// Adlar gizliyken de çalışır: her projeye jeton + o projede daha önce çalıştığınız görev/toplantı başlıkları (örnekler) verilir; yapay zekâ
// başlığın konusuna en yakın projeyi jetonla söyler, cevap burada gerçek ada çevrilir. Örneği olmayan proje yalnızca adıyla (ya da jetonuyla) listelenir.
export interface GuessCandidate { proje: string; ornekler: string[] }
export const GUESS_SCHEMA = { type: 'object', properties: { proje: { type: 'string' } }, required: ['proje'] };
export const buildGuessPrompt = (title: string, cands: GuessCandidate[]): string =>
  `Bir toplantı/çalışma başlığı hangi projeye ait?\nBaşlık: "${title}"\n\nPROJELER (her birinin daha önce çalışılmış örnek başlıkları):\n${cands.map(c => JSON.stringify(c)).join('\n')}\n\nKURALLAR:\n- Başlığın konusuna en yakın projeyi seç ve yalnızca o projenin adını (listede yazdığı gibi, PROJE_A gibi jetonlar dahil) "proje" alanına yaz.\n- Emin değilsen boş metin ("") döndür; tahmin uydurma.\n- Jetonları değiştirme.`;
export const parseGuess = (raw: any, names: string[], dec: (s: string) => string = s => s): string | null => {
  const v = typeof raw?.proje === 'string' ? dec(raw.proje.trim()).trim() : '';
  if (!v) return null;
  return names.find(n => n.toLocaleLowerCase('tr') === v.toLocaleLowerCase('tr')) || null;
};

// ---------------- ağ sarmalayıcıları ----------------
export const aiNarrate = async (o: { project: string | null; minutes: number | null; start: string; end: string; kind: 'calisma' | 'toplanti'; items: SessionItem[]; anon: Anonymizer }): Promise<{ summary: string; details: string[] }> => {
  const facts = factsFrom(o.items, o.anon.enc);
  if (facts.length === 0) throw new Error('Anlatılacak görev olayı yok (yalnızca görev hareketleri yapay zekâya gönderilir).');
  const prompt = buildNarrativePrompt({ project: o.project ? o.anon.enc(o.project) : null, minutes: o.minutes, start: o.start, end: o.end, kind: o.kind, facts });
  const raw = await callAIJson<any>(prompt, NARRATIVE_SCHEMA);
  const parsed = parseNarrative(raw, facts.length);
  if (!parsed) throw new Error('Yapay zekâ yanıtı okunamadı, tekrar deneyin.');
  return applyNarrative(o.items, parsed, o.anon.dec);
};

export const aiReport = async (agg: ReportAgg, scope: string, wantMail: boolean, anon: Anonymizer): Promise<ReportResult> => {
  if (agg.projeler.length === 0) throw new Error('Bu dönemde işlenmiş blok yok.');
  const raw = await callAIJson<any>(buildReportPrompt(agg, scope, wantMail, anon.enc), wantMail ? REPORT_MAIL_SCHEMA : REPORT_SCHEMA);
  const parsed = parseReport(raw, wantMail);
  if (!parsed) throw new Error('Yapay zekâ yanıtı okunamadı, tekrar deneyin.');
  return {
    ozet: anon.dec(parsed.ozet),
    projeler: parsed.projeler.map(p => ({ proje: anon.dec(p.proje), anlati: anon.dec(p.anlati) })),
    eposta: parsed.eposta ? { konu: anon.dec(parsed.eposta.konu), govde: anon.dec(parsed.eposta.govde) } : undefined
  };
};

export const aiGuessProject = async (title: string, cands: GuessCandidate[], anon: Anonymizer): Promise<string | null> => {
  const encoded = cands.map(c => ({ proje: anon.enc(c.proje), ornekler: c.ornekler.map(anon.enc) }));
  const raw = await callAIJson<any>(buildGuessPrompt(anon.enc(title), encoded), GUESS_SCHEMA);
  return parseGuess(raw, cands.map(c => c.proje), anon.dec);
};
