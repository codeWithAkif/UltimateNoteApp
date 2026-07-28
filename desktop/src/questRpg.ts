// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// "Görev Macerası" (zaman yönetimi RPG'si) özelliğinin paylaşılan veri modeli. Mevcut
// görevler/checklist satırları birer "quest" olur — zorluk/tahmini süre/başlangıç/tamamlanma
// bilgisi, [p:]/[due:]/[time:]/[repeat:] etiketleriyle AYNI satır-içi etiket deseniyle
// saklanır (bkz. TasksView.tsx:227-266) — yeni bir depolama katmanı YOK, tamamen düz
// markdown'da kalıyor (bu uygulamanın temel felsefesi). Sadece karakter kağıdı (altın/xp/
// envanter/dünya durumu/chronicle) devPaths.ts'teki gibi kendi localStorage anahtarı + kendi
// Supabase tablosunda tutulur — metadata.json Supabase'e SENKRONLANMAZ, bu tuzağa bu oturumda
// zaten bir kere düşülmüştü (bkz. dev_paths'in kendi yorumu).

export type QuestDifficulty = 'kolay' | 'orta' | 'zor';
export type QuestOutcome = 'fast' | 'ontime' | 'failed';
export type ItemRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface InventoryItem {
  id: string;
  name: string;
  emoji: string;
  rarity: ItemRarity;
  damaged?: boolean;
  obtainedAt: string;
}

export interface ChronicleEntry {
  weekStart: string;
  text: string;
}

export interface QuestRpgState {
  gold: number;
  xp: number;
  inventory: InventoryItem[];
  worldState: Record<string, string>;
  chronicles: ChronicleEntry[];
  updatedAt: string;
}

export const createDefaultQuestRpgState = (): QuestRpgState => ({
  gold: 0,
  xp: 0,
  inventory: [],
  worldState: {},
  chronicles: [],
  updatedAt: new Date().toISOString()
});

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Zorluğa bağlı sabit altın ödülü — tahmine değil zorluk etiketine bağlanır, yoksa
// kullanıcı "hızlı bitirdim" demek için tahminini şişirip sistemi kandırabilir.
export const DIFFICULTY_BASE_GOLD: Record<QuestDifficulty, number> = {
  kolay: 15,
  orta: 35,
  zor: 70
};

export const XP_PER_QUEST = 25;
export const FAST_SPEED_MULTIPLIER = 1.5;

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Mağaza: biriken altının harcanacağı bir yer olmadan ekonomi anlamsızlaşırdı. İki basit
// harcama kalemi — rastgele eşya çekilişi (sadece "hızlı" tamamlamaya bağlı şans faktörünü
// azaltır) ve hasarlı eşya tamiri (bkz. computeQuestOutcome'daki "failed" cezası).
export const ITEM_PULL_COST = 30;
export const ITEM_REPAIR_COST = 20;

// Envanterdeki eşyaları mağazada satıp altına çevirmek için nadirliğe bağlı taban fiyat.
// Bilerek ITEM_PULL_COST'un altında tutulur (ağırlıklı ortalama ~16 altın) — aksi halde
// "rastgele çek, hemen sat" hiçbir riski olmayan bedava altın kaynağına dönerdi.
export const ITEM_SELL_PRICES: Record<ItemRarity, number> = {
  common: 8,
  rare: 18,
  epic: 35,
  legendary: 70
};

// Hasarlı bir eşya yarı fiyatına satılır — tamir etmeden elden çıkarmak isteyenler için.
export const getItemSellPrice = (item: InventoryItem): number =>
  item.damaged ? Math.floor(ITEM_SELL_PRICES[item.rarity] / 2) : ITEM_SELL_PRICES[item.rarity];

// RANK_LADDER (devPaths.ts:74) ile AYNI eşikler, RPG temalı yeni isimlerle.
export const RPG_LEVEL_TITLES: { name: string; minXp: number }[] = [
  { name: 'Çırak Maceracı', minXp: 0 },
  { name: 'Gezgin', minXp: 150 },
  { name: 'Silahşor', minXp: 400 },
  { name: 'Şövalye', minXp: 800 },
  { name: 'Kahraman', minXp: 1500 },
  { name: 'Usta Kahraman', minXp: 2600 },
  { name: 'Efsanevi Savaşçı', minXp: 4200 },
  { name: 'Yarı-Tanrı', minXp: 6500 },
  { name: 'Efsane', minXp: 10000 }
];

export interface RpgLevelInfo {
  index: number;
  name: string;
  minXp: number;
  nextMinXp: number | null;
}

export const getRpgLevel = (xp: number): RpgLevelInfo => {
  let idx = 0;
  for (let i = 0; i < RPG_LEVEL_TITLES.length; i++) {
    if (xp >= RPG_LEVEL_TITLES[i].minXp) idx = i;
  }
  const next = RPG_LEVEL_TITLES[idx + 1];
  return { index: idx, name: RPG_LEVEL_TITLES[idx].name, minXp: RPG_LEVEL_TITLES[idx].minXp, nextMinXp: next ? next.minXp : null };
};

// Mağazasız, kaybedilebilir olmayan kozmetik eşya havuzu — "fast" tamamlamada rastgele
// birinden bir tane düşer. Mekanik avantaj vermez, sadece koleksiyon/görsel tatmin.
export const ITEM_DROP_TABLE: { name: string; emoji: string; rarity: ItemRarity }[] = [
  { name: 'Paslı Kılıç', emoji: '🗡️', rarity: 'common' },
  { name: 'Deri Zırh', emoji: '🛡️', rarity: 'common' },
  { name: 'Gezgin Pelerini', emoji: '🧥', rarity: 'common' },
  { name: 'Büyülü Asa', emoji: '🪄', rarity: 'rare' },
  { name: 'Ejderha Pulu', emoji: '🐉', rarity: 'rare' },
  { name: 'Kristal Amulet', emoji: '💎', rarity: 'epic' },
  { name: 'Anka Tüyü', emoji: '🪶', rarity: 'epic' },
  { name: 'Kutsal Taç', emoji: '👑', rarity: 'legendary' }
];

export const rollRandomItem = (): InventoryItem => {
  const roll = Math.random();
  // Nadir eşyalar daha az sıklıkla düşsün diye ağırlıklı seçim.
  const rarityWeights: { rarity: ItemRarity; weight: number }[] = [
    { rarity: 'common', weight: 0.55 },
    { rarity: 'rare', weight: 0.3 },
    { rarity: 'epic', weight: 0.12 },
    { rarity: 'legendary', weight: 0.03 }
  ];
  let acc = 0;
  let chosenRarity: ItemRarity = 'common';
  for (const rw of rarityWeights) {
    acc += rw.weight;
    if (roll <= acc) { chosenRarity = rw.rarity; break; }
  }
  const candidates = ITEM_DROP_TABLE.filter(i => i.rarity === chosenRarity);
  const picked = candidates[Math.floor(Math.random() * candidates.length)] || ITEM_DROP_TABLE[0];
  return {
    id: `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: picked.name,
    emoji: picked.emoji,
    rarity: picked.rarity,
    obtainedAt: new Date().toISOString()
  };
};

// ============================================================================
// SATIR-İÇİ ETİKET AYRIŞTIRMA — [p:]/[due:]/[time:]/[repeat:] ile AYNI desen
// (bkz. TasksView.tsx:227-266). Bu etiketler görev satırının içinde yaşar, ayrı
// bir depolama katmanı gerekmez.
// ============================================================================

export const DIFFICULTY_TAG_REGEX = /\[zorluk:(kolay|orta|zor)\]/i;
export const ESTIMATE_TAG_REGEX = /\[tahmini:(\d+)\]/i;
export const STARTED_TAG_REGEX = /\[baslangic:([^\]]+)\]/i;
export const COMPLETED_TAG_REGEX = /\[tamamlanma:([^\]]+)\]/i;
export const QUEST_OUTCOME_TAG_REGEX = /\[quest:(fast|ontime|failed)\]/i;
export const QUEST_TITLE_TAG_REGEX = /\[quest-title:([^\]]+)\]/i;
export const QUEST_DESC_TAG_REGEX = /\[quest-desc:([^\]]+)\]/i;

export const parseQuestTags = (rawText: string) => {
  const difficultyMatch = rawText.match(DIFFICULTY_TAG_REGEX);
  const estimateMatch = rawText.match(ESTIMATE_TAG_REGEX);
  const startedMatch = rawText.match(STARTED_TAG_REGEX);
  const completedMatch = rawText.match(COMPLETED_TAG_REGEX);
  const outcomeMatch = rawText.match(QUEST_OUTCOME_TAG_REGEX);
  const titleMatch = rawText.match(QUEST_TITLE_TAG_REGEX);
  const descMatch = rawText.match(QUEST_DESC_TAG_REGEX);

  return {
    difficulty: (difficultyMatch ? difficultyMatch[1].toLowerCase() : 'orta') as QuestDifficulty,
    estimatedMinutes: estimateMatch ? parseInt(estimateMatch[1], 10) : null,
    startedAt: startedMatch ? startedMatch[1] : null,
    completedAt: completedMatch ? completedMatch[1] : null,
    outcome: (outcomeMatch ? outcomeMatch[1].toLowerCase() : null) as QuestOutcome | null,
    questTitle: titleMatch ? titleMatch[1] : null,
    questDesc: descMatch ? descMatch[1] : null
  };
};

export const stripQuestTags = (text: string): string => text
  .replace(/\[zorluk:(?:kolay|orta|zor)\]/gi, '')
  .replace(/\[tahmini:\d+\]/gi, '')
  .replace(/\[baslangic:[^\]]+\]/gi, '')
  .replace(/\[tamamlanma:[^\]]+\]/gi, '')
  .replace(/\[quest:(?:fast|ontime|failed)\]/gi, '')
  .replace(/\[quest-title:[^\]]+\]/gi, '')
  .replace(/\[quest-desc:[^\]]+\]/gi, '');

export interface QuestOutcomeResult {
  outcome: QuestOutcome;
  goldDelta: number;
  itemDrop: InventoryItem | null;
  damagedItemId: string | null;
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Ödül hesaplama: [baslangic:] varsa gerçek geçen süre / tahmini süre oranına göre
// (kullanıcının açıkça istediği "gerçekten geçen süre" ölçütü); hiç başlatılmamışsa
// due tarihine göre bir düşüş (graceful fallback) yapılır. XP her durumda sabittir
// (hız fark etmez) — çağıran taraf bunu ayrıca ekler, bu fonksiyon sadece altın/eşya
// tarafını hesaplar.
export const computeQuestOutcome = (
  difficulty: QuestDifficulty,
  estimatedMinutes: number | null,
  startedAt: string | null,
  completedAt: string,
  dueDate: string | null,
  currentInventory: InventoryItem[]
): QuestOutcomeResult => {
  const baseGold = DIFFICULTY_BASE_GOLD[difficulty];
  let outcome: QuestOutcome;

  if (startedAt && estimatedMinutes && estimatedMinutes > 0) {
    const elapsedMinutes = (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 60000;
    const ratio = elapsedMinutes / estimatedMinutes;
    if (ratio < 0.85) outcome = 'fast';
    else if (ratio <= 1.15) outcome = 'ontime';
    else outcome = 'failed';
  } else if (dueDate) {
    const completedDay = completedAt.split('T')[0];
    outcome = completedDay <= dueDate ? 'ontime' : 'failed';
  } else {
    outcome = 'ontime';
  }

  if (outcome === 'fast') {
    return {
      outcome,
      goldDelta: Math.round(baseGold * FAST_SPEED_MULTIPLIER),
      itemDrop: rollRandomItem(),
      damagedItemId: null
    };
  }
  if (outcome === 'ontime') {
    return { outcome, goldDelta: baseGold, itemDrop: null, damagedItemId: null };
  }
  // failed: altın kaybı (taban kadar) + sahip olunan (henüz hasarsız) rastgele bir eşyanın hasar görmesi.
  const undamaged = currentInventory.filter(i => !i.damaged);
  const damagedItemId = undamaged.length > 0
    ? undamaged[Math.floor(Math.random() * undamaged.length)].id
    : null;
  return { outcome, goldDelta: -baseGold, itemDrop: null, damagedItemId };
};

export interface LineCompletionResult {
  newLine: string;
  outcome: QuestOutcome;
  goldDelta: number;
  itemDrop: InventoryItem | null;
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Checkbox işaretlenme anında (3 farklı yerden çağrılır: NotesView.tsx'in yerel
// editorContent state'i içinde VE App.tsx'in doğrudan dosya-yazma akışlarında) satırın
// kendisini mutasyona uğratan SAF fonksiyon — envanter bilgisine ihtiyaç duymaz (hangi
// eşyanın hasar göreceği, güncel envanteri elinde tutan App.tsx tarafında ayrıca seçilir),
// bu sayede NotesView.tsx gibi questRpg state'ine erişimi olmayan yerlerden de çağrılabilir.
// Satır zaten [quest:] etiketi taşıyorsa (idempotency guard) ya da bir checklist öğesi
// DEĞİLSE ya da işaretlenmemiş durumdaysa null döner (ödül uygulanmaz).
export const applyCompletionToLine = (line: string): LineCompletionResult | null => {
  const checklistMatch = line.match(/^(\s*[*\-]\s+\[)([ xX])(\]\s*.*)$/);
  if (!checklistMatch) return null;
  const isChecked = checklistMatch[2].toLowerCase() === 'x';
  if (!isChecked) return null;
  if (QUEST_OUTCOME_TAG_REGEX.test(line)) return null;

  const tags = parseQuestTags(line);
  const dueMatch = line.match(/\[due:(\d{4}-\d{2}-\d{2})/i);
  const completedAt = new Date().toISOString();

  const { outcome, goldDelta, itemDrop } = computeQuestOutcome(
    tags.difficulty,
    tags.estimatedMinutes,
    tags.startedAt,
    completedAt,
    dueMatch ? dueMatch[1] : null,
    []
  );

  let newLine = line;
  if (!tags.completedAt) {
    newLine = `${newLine} [tamamlanma:${completedAt}]`;
  }
  newLine = `${newLine} [quest:${outcome}]`;

  return { newLine, outcome, goldDelta, itemDrop };
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// "▶️ Başla" butonuna basıldığında çağrılır — satıra [baslangic:ISO] etiketini bir kere
// ekler (zaten varsa dokunmaz, tekrar basmak süreyi sıfırlamaz).
export const applyQuestStartToLine = (line: string): string | null => {
  const checklistMatch = line.match(/^(\s*[*\-]\s+\[)([ xX])(\]\s*.*)$/);
  if (!checklistMatch) return null;
  if (STARTED_TAG_REGEX.test(line)) return null;
  return `${line} [baslangic:${new Date().toISOString()}]`;
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Uygulama her açıldığında/veriler yüklendiğinde taranır: son tarihi geçmiş, hâlâ
// işaretlenmemiş ve henüz [quest:] etiketi olmayan görevleri "failed" olarak damgalar —
// "hiç bitirilmeden gün geçmesi" kuralını uygular. Tarama App.tsx'te yapılır (tüm notları
// gezmesi gerekir), bu sadece tek bir satır için karar veren saf fonksiyondur.
export const applyAutoFailToLine = (line: string, todayStr: string): LineCompletionResult | null => {
  const checklistMatch = line.match(/^(\s*[*\-]\s+\[)([ xX])(\]\s*.*)$/);
  if (!checklistMatch) return null;
  const isChecked = checklistMatch[2].toLowerCase() === 'x';
  if (isChecked) return null;
  if (QUEST_OUTCOME_TAG_REGEX.test(line)) return null;
  const dueMatch = line.match(/\[due:(\d{4}-\d{2}-\d{2})/i);
  if (!dueMatch || dueMatch[1] >= todayStr) return null;

  const tags = parseQuestTags(line);
  const baseGold = DIFFICULTY_BASE_GOLD[tags.difficulty];
  return { newLine: `${line} [quest:failed]`, outcome: 'failed', goldDelta: -baseGold, itemDrop: null };
};
