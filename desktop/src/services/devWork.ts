// "Geliştir" bölümü: uygulamanın kendi kodunu Claude Code ile geliştirme, takip etme ve yayınlama (yalnızca masaüstü).
// Akış: istek -> plan -> yapılıyor -> kontrol -> inceleme -> birleştirildi -> yayında. Asıl git/yayın işleri electron/devTools.cjs'te;
// burada istek durumu, kalıcı depo ve istemler var. İstekler bu bilgisayarda (userData/dev-requests.json) tutulur; yayın günlüğü kasaya da yazılır.

export type DevStage = 'istek' | 'plan' | 'yapiliyor' | 'kontrol' | 'inceleme' | 'birlesti' | 'yayinda' | 'reddedildi' | 'hata';

export interface DevRequest {
  id: string;
  title: string;
  detail: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  stage: DevStage;
  plan?: string;
  answers?: string;                 // kullanıcının plandaki sorulara cevapları / ek notları (uygulama istemine eklenir)
  summary?: string;                 // Claude'un son yanıtı (yapılanlar, doğrulama, elle yapılacaklar)
  branch?: string;
  worktree?: string;
  stat?: string;
  files?: { status: string; path: string }[];
  check?: { ok: boolean; output?: string; at: number };
  mergedAt?: number;
  version?: string;                 // yayınlandığı sürüm
  error?: string;
  rounds?: number;                  // Claude tur sayısı (ilk uygulama + düzeltmeler)
  log: { t: number; text: string }[];
}

export interface DevRelease { version: string; at: number; requestIds: string[]; summary: string; ci?: 'none' | 'queued' | 'running' | 'success' | 'failure' | 'cancelled'; ciUrl?: string }
export interface DevStore { requests: DevRequest[]; releases: DevRelease[] }

export const STAGE_LABEL: Record<DevStage, string> = {
  istek: 'İstek', plan: 'Plan hazır', yapiliyor: 'Yapılıyor', kontrol: 'Kontrol', inceleme: 'İnceleme', birlesti: 'Yayına hazır', yayinda: 'Yayında', reddedildi: 'Reddedildi', hata: 'Hata'
};
export const STAGE_COLOR: Record<DevStage, string> = {
  istek: '#94a3b8', plan: '#a855f7', yapiliyor: '#3b82f6', kontrol: '#3b82f6', inceleme: '#eab308', birlesti: '#22c55e', yayinda: '#16a34a', reddedildi: '#64748b', hata: '#ef4444'
};

export const isDevSupported = (): boolean => typeof window !== 'undefined' && !!(window as any).electron?.devStatus;

export const emptyStore = (): DevStore => ({ requests: [], releases: [] });

export const loadDevStore = async (): Promise<DevStore> => {
  try {
    const o = await (window as any).electron?.devStoreGet?.();
    if (o && Array.isArray(o.requests)) return { requests: o.requests, releases: Array.isArray(o.releases) ? o.releases : [] };
  } catch { /* boş depo */ }
  return emptyStore();
};
export const saveDevStore = async (s: DevStore): Promise<void> => {
  try { await (window as any).electron?.devStoreSet?.(s); } catch { /* yoksay */ }
};

export const newDevId = (): string => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const taskText = (r: Pick<DevRequest, 'title' | 'detail'>): string => (r.detail.trim() ? `${r.title}\n\n${r.detail.trim()}` : r.title);

// Çalışırken görülen yeni kod kuralları repo kökündeki CLAUDE.md'den okunur; burada yalnızca bu bölüme özgü hatırlatmalar var.
// Plandaki "emin olmadığım noktalar" için kullanıcı cevap yazdıysa istemde planın varsayımlarından ÖNCELİKLİ bölüm olarak verilir
export const answersBlock = (r: Pick<DevRequest, 'answers'>): string =>
  r.answers && r.answers.trim() ? `\nKULLANICININ PLAN SORULARINA CEVAPLARI / EK NOTLARI (planın varsayımlarından ÖNCELİKLİDİR; plan bunlarla çelişirse bunlara uy):\n${r.answers.trim().slice(0, 6000)}\n` : '';
export const planHasQuestions = (plan: string | undefined): boolean => !!plan && /emin olmad[ıi]ğ[ıi]m|sorular|soru:/i.test(plan);
// Plan istemine eklenecek istek metni: önceki cevaplar varsa planlayıcı da bilsin
export const planRequestText = (r: Pick<DevRequest, 'title' | 'detail' | 'answers'>): string =>
  taskText(r) + (r.answers && r.answers.trim() ? `\n\nKULLANICININ ÖNCEKİ PLANDAKİ SORULARA CEVAPLARI (bunları dikkate alıp planı güncelle):\n${r.answers.trim().slice(0, 6000)}` : '');

export const buildDevApplyPrompt = (r: Pick<DevRequest, 'title' | 'detail' | 'plan' | 'answers'>): string =>
  `Sen bu klasördeki uygulamayı (Ultimate NoteFactory) geliştiren deneyimli bir geliştiricisin. Aşağıdaki isteği UYGULA.
Şu an ayrı bir git dalındaki çalışma kopyasındasın; değişiklikler yalnızca burada kalır, kullanıcı farkı görüp karar verecek.

İSTEK: ${taskText(r)}
${r.plan ? `\nONAYLANAN PLAN (buna uy; ayrıldığın yerde nedenini son yanıtta yaz):\n${r.plan.slice(0, 20000)}\n` : ''}${answersBlock(r)}
KURALLAR:
- Repo kökündeki CLAUDE.md kurallarına uy.
- Yalnızca isteğin gerektirdiği dosyaları değiştir; kapsam dışı iyileştirme yapma.
- package.json sürümünü DEĞİŞTİRME, commit/etiket/push YAPMA: sürüm ve yayın işini uygulama yapar.
- Tür denetimini (tsc) sen ÇALIŞTIRMA: komut izni yoktur, onay istenir ve takılır. Uygulama değişiklikten sonra kendisi denetler ve hata varsa sana geri bildirir. Kodu yazarken tür doğruluğuna dikkat et.

SON YANITINI Türkçe, kısa ve şu başlıklarla yaz:
1. Yapılanlar
2. Değişen dosyalar (neden)
3. Doğrulama
4. Yapılmayanlar / Elle yapılacaklar / Sorular`;

export const buildDevFixPrompt = (r: Pick<DevRequest, 'title' | 'detail'>, problem: string): string =>
  `Aynı çalışma kopyasında devam ediyorsun. Önceki turda şu isteği uyguladın:

İSTEK: ${taskText(r)}

Uygulama, değişiklikleri kontrol etti ve şu sorunu buldu:
${problem.slice(0, 8000)}

Yalnızca bu sorunu düzelt; başka bir şeyi değiştirme. Tür denetimini sen çalıştırma (uygulama yeniden denetler). Kurallar önceki turdakiyle aynı (commit/push yok, sürüme dokunma).
SON YANITINI Türkçe, 3-5 satırla yaz: ne düzelttin, doğrulama sonucu.`;

export const buildDevFeedbackPrompt = (r: Pick<DevRequest, 'title' | 'detail'>, note: string, shotCount: number): string =>
  `Aynı çalışma kopyasında devam ediyorsun. Önceki turda şu isteği uyguladın:

İSTEK: ${taskText(r)}

Kullanıcı değişikliği çalışırken önizlemede inceledi ve şunu söylüyor:
${note.slice(0, 4000)}
${shotCount > 0 ? `\nÖnizlemeden ${shotCount} ekran görüntüsü ekte (eklenen dosyaları oku ve gerçekte ne göründüğüne bak).\n` : ''}
Yalnızca bu geri bildirimi uygula; başka bir şeyi değiştirme. Tür denetimini sen çalıştırma (uygulama denetler). Kurallar önceki turdakiyle aynı (commit/push yok, sürüme dokunma).
SON YANITINI Türkçe, 3-5 satırla yaz: ne değiştirdin, doğrulama sonucu.`;

export const buildDevRedoPrompt = (r: Pick<DevRequest, 'title' | 'detail' | 'plan' | 'answers'>, conflictFiles: string[]): string =>
  `${buildDevApplyPrompt(r)}

NOT: Bu isteği daha önce bir kez uygulamıştın ama ana daldaki yeni değişikliklerle şu dosyalarda ÇAKIŞTI: ${conflictFiles.join(', ') || '(bilinmiyor)'}.
Şimdi GÜNCEL koddan başlıyorsun; bu dosyalardaki mevcut (ana daldaki) değişiklikleri koruyarak isteği yeniden uygula.`;

export const fmtDuration = (ms: number): string => { const s = Math.round(ms / 1000); return s < 60 ? `${s} sn` : `${Math.floor(s / 60)} dk ${s % 60} sn`; };

// Yayın günlüğü (kasaya yazılan, telefonda da görünen kayıt): en yeni üstte
export const DEV_LOG_PATH = 'Sistem/Geliştirme Günlüğü.md';
export const appendReleaseLog = (existing: string | undefined, rel: DevRelease, titles: string[]): string => {
  const head = '# Geliştirme Günlüğü\n\nUygulamanın "Geliştir" bölümünden yayınlanan sürümler (en yeni üstte).\n';
  const idx = (existing || '').indexOf('\n## ');
  const body = idx >= 0 ? (existing as string).slice(idx).trim() : '';
  const d = new Date(rel.at).toLocaleString('tr-TR');
  const entry = `\n## v${rel.version} — ${d}\n${rel.summary ? `${rel.summary}\n` : ''}${titles.map(t => `- ${t.replace(/[\r\n]+/g, ' ').trim()}`).join('\n')}\n`;
  return `${head}${entry}${body ? `\n${body}\n` : ''}`;
};
