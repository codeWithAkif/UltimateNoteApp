// Toplantı öncesi brifing: takvimdeki bir etkinliğin başlığından ilgili MÜŞTERİ/PROJE'yi bulur, notlardan ve
// görevlerden bağlamı toplar, Gemini'ye yalnızca bu seçili bağlamı gönderip kısa bir brifing üretir.
// Veri toplama ve eşleştirme saf fonksiyonlardır (ağ yok) — ayrı ayrı test edilebilir.
import { callAIJson } from './geminiMentor';

export interface BriefNote { path: string; name: string; updatedAt: number; type?: string }
export interface BriefTask {
  content: string;
  isChecked: boolean;
  dueDate?: string;
  noteName: string;
  filePath: string;
  ownTags?: string[];
}

export interface BriefingContext {
  matchedClients: string[];
  matchedProjects: string[];
  recentNotes: { name: string; path: string; excerpt: string }[];
  openTasks: string[];
  recentlyDone: string[];
  usedFallbackSearch: boolean;
}

// Türkçe karakter ve büyük/küçük harf duyarsız karşılaştırma için sadeleştirme.
export const normalizeTr = (s: string): string =>
  s.toLocaleLowerCase('tr')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const STOP = new Set(['toplanti', 'toplantisi', 'gorusme', 'gorusmesi', 'meeting', 'call', 'sync', 'ile', 'icin', 've', 'bir', 'haftalik', 'gunluk', 'online', 'teams', 'zoom', 'meet', 'proje', 'projesi', 'kickoff']);
const tokensOf = (s: string): string[] => normalizeTr(s).split(' ').filter(t => t.length >= 3 && !STOP.has(t));

// Etkinlik başlığındaki anlamlı kelimeler bir ismin tüm anlamlı kelimelerini içeriyorsa (ya da isim başlığın içinde
// geçiyorsa) eşleşme sayılır. "Borusan Datahub sync" -> "Borusan" (müşteri) ve "Datahub" (proje).
const nameMatchesTitle = (name: string, titleTokens: string[], titleNorm: string): boolean => {
  const nt = tokensOf(name);
  if (nt.length === 0) return false;
  if (titleNorm.includes(normalizeTr(name)) && normalizeTr(name).length >= 3) return true;
  return nt.every(t => titleTokens.includes(t));
};

const stripMeta = (text: string): string =>
  text
    .replace(/\[(?:due|plannedtime|time|window|started|completed|outcome|project|proje|status|durum|gcal|gcalh|hours|session|plan|repeat|priority|p):[^\]]*\]/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Uzun notlarda başlıklar + son kısım (en güncel içerik genelde sonda) tutulur.
const excerptOf = (content: string, max = 1400): string => {
  const clean = stripMeta(content);
  if (clean.length <= max) return clean;
  const head = clean.slice(0, Math.floor(max * 0.35));
  const tail = clean.slice(-Math.floor(max * 0.65));
  return `${head}\n[...]\n${tail}`;
};

export interface GatherInput {
  title: string;
  notes: BriefNote[];
  fileContents: Record<string, string>;
  tasks: BriefTask[];
  clientsFolder?: string;
  now?: Date;
}

export const gatherBriefingContext = (input: GatherInput): BriefingContext => {
  const { title, notes, fileContents, tasks } = input;
  const clientsFolder = (input.clientsFolder || 'Müşteriler').replace(/\/+$/, '');
  const now = input.now || new Date();
  const titleNorm = normalizeTr(title);
  const titleTokens = tokensOf(title);

  const visible = notes.filter(n => !n.path.split('/').some(seg => seg.startsWith('.')) && (n.type === undefined || n.type === 'note'));
  const baseName = (n: BriefNote) => n.name.replace(/\.md$/i, '');

  // Müşteri ve proje notları (kasadaki mevcut kurallarla aynı: #müşteri / #proje etiketi).
  const isClientNote = (n: BriefNote) => /#müşteri/i.test(fileContents[n.path] || '');
  const isProjectNote = (n: BriefNote) => /(^|[\s,;(])#proje(?![0-9A-Za-zçğıöşüÇĞİÖŞÜ_-])/i.test(fileContents[n.path] || '');

  const clientNotes = visible.filter(isClientNote).filter(n => nameMatchesTitle(baseName(n), titleTokens, titleNorm));
  const projectNotes = visible.filter(isProjectNote).filter(n => nameMatchesTitle(baseName(n), titleTokens, titleNorm));

  // Müşteri eşleştiyse onun klasöründeki projeler de dahil (ör. Müşteriler/Borusan/Projeler/*).
  const clientFolders = clientNotes.map(c => `${clientsFolder}/${baseName(c)}/`);
  const clientProjectNotes = clientFolders.length
    ? visible.filter(isProjectNote).filter(n => clientFolders.some(f => n.path.startsWith(f)))
    : [];

  const projectSet = new Map<string, BriefNote>();
  [...projectNotes, ...clientProjectNotes].forEach(p => projectSet.set(p.path, p));
  const projects = Array.from(projectSet.values());

  // Bağlam notları: eşleşen müşteri/proje notları + müşteri klasöründeki en yeni notlar.
  const candidateMap = new Map<string, BriefNote>();
  [...clientNotes, ...projects].forEach(n => candidateMap.set(n.path, n));
  clientFolders.forEach(f => {
    visible
      .filter(n => n.path.startsWith(f) && !candidateMap.has(n.path))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 4)
      .forEach(n => candidateMap.set(n.path, n));
  });

  let usedFallbackSearch = false;
  if (candidateMap.size === 0 && titleTokens.length > 0) {
    // İsimle eşleşme yoksa: başlıktaki kelimeleri en çok içeren birkaç not (kaba, ama bağlamsız kalmasın).
    usedFallbackSearch = true;
    const scored = visible.map(n => {
      const c = normalizeTr(fileContents[n.path] || '');
      const nm = normalizeTr(baseName(n));
      let score = 0;
      for (const t of titleTokens) {
        if (nm.includes(t)) score += 5;
        const hits = c.split(t).length - 1;
        score += Math.min(hits, 10);
      }
      return { n, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 4);
    scored.forEach(x => candidateMap.set(x.n.path, x.n));
  }

  const ordered = Array.from(candidateMap.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 7);
  const recentNotes = ordered
    .map(n => ({ name: baseName(n), path: n.path, excerpt: excerptOf(fileContents[n.path] || '') }))
    .filter(n => n.excerpt.length > 0);

  // Görevler: eşleşen proje notlarının içindekiler ya da [project:slug] ile bağlı olanlar.
  const slugs = projects.map(p => baseName(p).toLocaleLowerCase('tr').replace(/\s+/g, '-'));
  const projectPaths = new Set(projects.map(p => p.path));
  const belongs = (t: BriefTask) =>
    projectPaths.has(t.filePath) || (t.ownTags || []).some(tag => slugs.includes(tag)) ||
    clientNotes.some(c => t.filePath === c.path);
  const relevantTasks = tasks.filter(belongs);
  const open = relevantTasks.filter(t => !t.isChecked);
  const openTasks = open
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    .slice(0, 15)
    .map(t => `${stripMeta(t.content)}${t.dueDate ? ` (son tarih ${t.dueDate})` : ''}`);

  // Son 14 günde biten işler: not satırlarındaki [completed:ISO] etiketinden.
  const cutoff = now.getTime() - 14 * 24 * 3600 * 1000;
  const doneSet: string[] = [];
  [...projects, ...clientNotes].forEach(n => {
    (fileContents[n.path] || '').split('\n').forEach(line => {
      const m = line.match(/^\s*[*\-]\s+\[[xX]\]\s*(.*?)\[completed:(\d{4}-\d{2}-\d{2}T[^\]]+)\]/);
      if (!m) return;
      const ts = Date.parse(m[2]);
      if (!isNaN(ts) && ts >= cutoff) doneSet.push(stripMeta(`${m[1]}`).trim());
    });
  });
  const recentlyDone = Array.from(new Set(doneSet.filter(Boolean))).slice(0, 12);

  return {
    matchedClients: clientNotes.map(baseName),
    matchedProjects: projects.map(baseName),
    recentNotes,
    openTasks,
    recentlyDone,
    usedFallbackSearch
  };
};

export interface Briefing {
  ozet: string;
  sonDurum: string[];
  acikIsler: string[];
  kararlar: string[];
  sorular: string[];
  riskler: string[];
  kaynaklar: string[];
}

const BRIEFING_SCHEMA = {
  type: 'object',
  properties: {
    ozet: { type: 'string' },
    sonDurum: { type: 'array', items: { type: 'string' } },
    acikIsler: { type: 'array', items: { type: 'string' } },
    kararlar: { type: 'array', items: { type: 'string' } },
    sorular: { type: 'array', items: { type: 'string' } },
    riskler: { type: 'array', items: { type: 'string' } },
    kaynaklar: { type: 'array', items: { type: 'string' } }
  },
  required: ['ozet', 'sonDurum', 'acikIsler', 'kararlar', 'sorular', 'riskler', 'kaynaklar']
};

export const buildBriefingPrompt = (title: string, when: string, ctx: BriefingContext): string => {
  const notesBlock = ctx.recentNotes.length
    ? ctx.recentNotes.map(n => `--- Not: "${n.name}" ---\n${n.excerpt}`).join('\n\n')
    : '(İlgili not bulunamadı.)';
  return `Sen kullanıcının toplantı öncesi hazırlık asistanısın. Kullanıcı birazdan şu toplantıya girecek: "${title}"${when ? ` (${when})` : ''}.
Aşağıda yalnızca kullanıcının kendi notlarından ve görevlerinden seçilmiş bağlam var. SADECE bu bağlama dayan: bilgi uydurma, varsayım yapma. Bir şey bağlamda yoksa o alanı boş bırak ya da "notlarda yok" de.

Eşleşen müşteri: ${ctx.matchedClients.join(', ') || '—'}
Eşleşen proje: ${ctx.matchedProjects.join(', ') || '—'}
${ctx.usedFallbackSearch ? '(Müşteri/proje adıyla eşleşme bulunamadı; bağlam kelime aramasıyla seçildi, ilgisiz olabilir.)\n' : ''}
Açık görevler:
${ctx.openTasks.map(t => `- ${t}`).join('\n') || '- (yok)'}

Son 14 günde biten işler:
${ctx.recentlyDone.map(t => `- ${t}`).join('\n') || '- (yok)'}

Notlar:
${notesBlock}

Görev: Türkçe, kısa ve somut bir brifing hazırla.
- ozet: 2 cümleyi geçmeyen genel durum.
- sonDurum: son zamanlarda ne oldu (en fazla 4 madde).
- acikIsler: toplantıda konuşulması gereken açık işler (en fazla 5 madde).
- kararlar: notlarda geçen alınmış kararlar (yoksa boş dizi).
- sorular: karşı tarafa sorulması ya da netleştirilmesi gereken 3-4 net soru (bağlamdaki belirsizlik, tarihi olmayan iş, bloklu görev gibi eksiklerden türet).
- riskler: bağlamdan çıkan riskler (yoksa boş dizi).
- kaynaklar: gerçekten kullandığın not adları.
Sadece JSON döndür.`;
};

export const generateBriefing = async (title: string, when: string, ctx: BriefingContext): Promise<Briefing> => {
  const b = await callAIJson<Briefing>(buildBriefingPrompt(title, when, ctx), BRIEFING_SCHEMA);
  const arr = (x: any) => (Array.isArray(x) ? x.filter(s => typeof s === 'string' && s.trim()) : []);
  return {
    ozet: typeof b.ozet === 'string' ? b.ozet : '',
    sonDurum: arr(b.sonDurum), acikIsler: arr(b.acikIsler), kararlar: arr(b.kararlar),
    sorular: arr(b.sorular), riskler: arr(b.riskler), kaynaklar: arr(b.kaynaklar)
  };
};

// Brifingi nota kaydetmek için markdown metni.
export const briefingToMarkdown = (title: string, when: string, b: Briefing, ctx: BriefingContext): string => {
  const sec = (h: string, items: string[]) => (items.length ? `## ${h}\n${items.map(i => `- ${i}`).join('\n')}\n\n` : '');
  return `# Brifing: ${title}\n\n${when ? `Toplantı: ${when}\n\n` : ''}${b.ozet ? `${b.ozet}\n\n` : ''}` +
    sec('Son durum', b.sonDurum) + sec('Açık işler', b.acikIsler) + sec('Kararlar', b.kararlar) +
    sec('Sorulacaklar', b.sorular) + sec('Riskler', b.riskler) +
    sec('Kaynaklar', (b.kaynaklar.length ? b.kaynaklar : ctx.recentNotes.map(n => n.name)).map(n => `[[${n}]]`));
};
