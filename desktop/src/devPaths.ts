// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// "Gelişim Yolu" (development path) özelliğinin paylaşılan veri modeli ve rütbe merdiveni.
// App.tsx (XP hesaplama/tarama) ve Sidebar.tsx (rütbe adı/ilerleme çubuğu gösterimi) aynı
// merdiveni kullanır — iki yerde ayrı ayrı tanımlanırsa zamanla birbirinden sapabilirdi.

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Faz 2: AI mentor katmanı eklendi. `mode` alanı hangi davranışın kullanılacağını ayırır —
// 'simple' Faz 1'in jenerik Er->General rütbe/XP mantığı (Gemini anahtarı yoksa/AI Mentor
// kapalıyken kullanılır), 'ai' ise Gemini'nin alana özgü ürettiği seviye/konu müfredatı.
// Eski (Faz 1'de işaretlenmiş) yollar `mode` alanı olmadan da localStorage'da durabilir —
// bu yüzden `mode`, App.tsx'te "mode !== 'ai'" gibi kontrol edilirken eksik olma ihtimaline
// karşı hep 'simple' varsayılır.
export type DevPathMode = 'simple' | 'ai';

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Faz 3: Not oluşturma modu — sihirbazda alan bazında BİR KERE seçilir.
// 'basic': her konu için tek "Başlangıç Notu". 'advanced': ana not + wikilink ile
// bağlı birden fazla alt-not. 'complete': 'advanced' + otomatik soru kartları.
// Eski (bu alan eklenmeden önce işaretlenmiş) yollar için 'basic' varsayılır.
export type DevPathNoteMode = 'basic' | 'advanced' | 'complete';

export interface DevPathTopic {
  title: string;
  description: string;
  folderPath: string;
  status: 'open' | 'testable' | 'passed' | 'flagged_unknown';
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // AI'nin bu konu klasörüne otomatik yazdığı dosya adları (Başlangıç Notu, alt-notlar,
  // Soru Kartları) — "Test Et"i açan / "Son çalışma" gösteren kullanıcı-aktivite
  // sayımlarından HARİÇ tutulmaları gerekir (bkz. App.tsx getUserNotesInTopicFolder,
  // Sidebar.tsx getPathLastActivityDays), yoksa kullanıcı hiçbir şey yazmadan bu
  // durumlar yanlışlıkla tetiklenir.
  systemNoteNames?: string[];
  // "Test Et" öncesi ön koşul: kullanıcının kendi yazdığı özet AI tarafından onaylandı mı.
  summaryApproved?: boolean;
}

export interface DevPathLevel {
  title: string;
  folderPath: string;
  topics: DevPathTopic[];
}

export interface DevPath {
  mode?: DevPathMode;
  label: string;
  updatedAt: string;
  // mode: 'simple' (Faz 1) alanları
  xp?: number;
  lastLinkCount?: number;
  lastTaskCount?: number;
  // mode: 'ai' (Faz 2) alanları
  domainDescription?: string;
  currentLevelIndex?: number;
  levels?: DevPathLevel[];
  // mode: 'ai' (Faz 3) — bu alanın TÜM seviye/konuları için geçerli not oluşturma modu.
  noteMode?: DevPathNoteMode;
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Bir DevPath'in TÜM seviye/konularındaki sistem-üretimi not adlarını (dosya adı,
// uzantısız değil, .md dahil) tek bir kümede toplar — App.tsx ve Sidebar.tsx aynı
// mantığı iki yerde ayrı ayrı yazıp zamanla sapmasın diye burada paylaşılır.
export const getAllSystemNoteNames = (devPath: DevPath): Set<string> => {
  const names = new Set<string>(['Başlangıç Notu.md', 'Seviye Bilgisi.md']);
  (devPath.levels || []).forEach(level => {
    level.topics.forEach(topic => {
      (topic.systemNoteNames || []).forEach(n => names.add(n));
    });
  });
  return names;
};

export const RANK_LADDER: { name: string; minXp: number }[] = [
  { name: 'Er', minXp: 0 },
  { name: 'Onbaşı', minXp: 150 },
  { name: 'Çavuş', minXp: 400 },
  { name: 'Teğmen', minXp: 800 },
  { name: 'Üsteğmen', minXp: 1500 },
  { name: 'Yüzbaşı', minXp: 2600 },
  { name: 'Binbaşı', minXp: 4200 },
  { name: 'Albay', minXp: 6500 },
  { name: 'General', minXp: 10000 },
];

export interface RankInfo {
  index: number;
  name: string;
  minXp: number;
  nextMinXp: number | null;
}

export const getRankForXp = (xp: number): RankInfo => {
  let idx = 0;
  for (let i = 0; i < RANK_LADDER.length; i++) {
    if (xp >= RANK_LADDER[i].minXp) idx = i;
  }
  const next = RANK_LADDER[idx + 1];
  return { index: idx, name: RANK_LADDER[idx].name, minXp: RANK_LADDER[idx].minXp, nextMinXp: next ? next.minXp : null };
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// XP kaynakları: (1) o yol klasörü altındaki notlarda tamamlanan task'lar, (2) o klasördeki
// notlardan çıkan wikilink'ler ([[...]]). İkisi de "son görülen sayı" baseline'ıyla delta
// hesaplanır (spam/tekrar sayımını önler) — eski pet özelliğinin task-sayma desenine benzer.
export const XP_PER_TASK = 20;
export const XP_PER_LINK = 5;

// NotesView.tsx'teki wikilink regex'iyle birebir aynı desen (bkz. NotesView.tsx:2360).
export const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export const countWikilinks = (content: string): number => {
  const matches = content.match(WIKILINK_REGEX);
  return matches ? matches.length : 0;
};
