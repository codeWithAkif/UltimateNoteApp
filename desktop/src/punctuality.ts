// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// "Dakiklik Pusulası" — eski "Görev Macerası" (altın/XP/envanter/mağaza) sisteminin yerine
// geçer. Eski sistem SONUÇ-odaklıydı (görev bitince ödül hesaplanırdı) ama kullanıcının asıl
// istediği CANLI takip: bir göreve başladığında geç kalıp kalmadığını anlık görmek, gerekirse
// bildirim almak. Bu yüzden ekonomi tamamen kaldırıldı; yerine tek, sürekli bir "dakiklik
// skoru" (0-100, 50=nötr) geldi — sağa (yüksek) dakik/hızlı, sola (düşük) yavaş/erteleyen.
// Aynı önceki felsefe korunuyor: per-task veri (başlangıç/tamamlanma/sonuç) hâlâ notun kendi
// satırında satır-içi etiket olarak yaşar, ayrı bir depolama katmanı YOK. Sadece toplu skor
// (App.tsx'teki PunctualityState) kendi küçük localStorage anahtarı + Supabase tablosunda durur.

export type PunctualityOutcome = 'fast' | 'ontime' | 'late';

export interface PunctualityState {
  score: number; // 0-100, başlangıç 50 (nötr)
  updatedAt: string;
}

export const createDefaultPunctualityState = (): PunctualityState => ({
  score: 50,
  updatedAt: new Date().toISOString()
});

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Hareketli ortalama (EMA) katsayısı: tek bir görev ibreyi ne kadar sallayabilir. Düşük tutulur
// (0.12) ki bir kötü gün skoru dibe vurdurmasın — kullanıcının GENEL eğilimini yansıtsın,
// anlık bir tek olayı değil.
export const SCORE_EMA_ALPHA = 0.12;

export const nudgeScore = (oldScore: number, outcomeScore: number): number => {
  const next = oldScore * (1 - SCORE_EMA_ALPHA) + outcomeScore * SCORE_EMA_ALPHA;
  return Math.max(0, Math.min(100, Math.round(next * 10) / 10));
};

// ============================================================================
// SATIR-İÇİ ETİKET AYRIŞTIRMA — [p:]/[due:]/[time:]/[repeat:] ile AYNI desen
// (bkz. TasksView.tsx:227-266).
// ============================================================================

export const STARTED_TAG_REGEX = /\[baslangic:([^\]]+)\]/i;
export const COMPLETED_TAG_REGEX = /\[tamamlanma:([^\]]+)\]/i;
export const PUNCTUALITY_OUTCOME_TAG_REGEX = /\[dakiklik:(fast|ontime|late)\]/i;

export const parseQuestTags = (rawText: string) => {
  const startedMatch = rawText.match(STARTED_TAG_REGEX);
  const completedMatch = rawText.match(COMPLETED_TAG_REGEX);
  const outcomeMatch = rawText.match(PUNCTUALITY_OUTCOME_TAG_REGEX);

  return {
    startedAt: startedMatch ? startedMatch[1] : null,
    completedAt: completedMatch ? completedMatch[1] : null,
    outcome: (outcomeMatch ? outcomeMatch[1].toLowerCase() : null) as PunctualityOutcome | null
  };
};

export const stripQuestTags = (text: string): string => text
  .replace(/\[baslangic:[^\]]+\]/gi, '')
  .replace(/\[tamamlanma:[^\]]+\]/gi, '')
  .replace(/\[dakiklik:(?:fast|ontime|late)\]/gi, '');

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Bir satırın Takvim'de planlanmış bitiş anını (varsa) hesaplar — [due:YYYY-MM-DD]
// [time:HH:mm-HH:mm] deseninden bitiş saatini, yoksa yalnızca [due:] varsa o günün sonunu
// (23:59) kullanır. Hiç [due:] yoksa null döner (deadline'a göre hesaplanacak bir şey yok).
export const getDeadlineFromLine = (line: string): Date | null => {
  const dueMatch = line.match(/\[due:(\d{4}-\d{2}-\d{2})(?:\s\d{2}:\d{2})?\]/i);
  if (!dueMatch) return null;
  const [y, m, d] = dueMatch[1].split('-').map(Number);

  const timeMatch = line.match(/\[time:\d{2}:\d{2}-(\d{2}):(\d{2})\]/i);
  if (timeMatch) {
    return new Date(y, m - 1, d, parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10), 0);
  }
  return new Date(y, m - 1, d, 23, 59, 59);
};

export interface QuestOutcomeResult {
  outcome: PunctualityOutcome;
  outcomeScore: number; // yeni skor İÇİN girdi (0-100 aralığında bir "bu görev nasıl geçti" puanı)
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// [baslangic:] varsa gerçek geçen süre / planlanan süre oranına göre (kullanıcının açıkça
// istediği "gerçekten geçen süre" ölçütü); hiç başlatılmamışsa sadece due anına göre bir
// ikili (erken/geç) karşılaştırma yapılır. Dönen outcomeScore, EMA'ya (nudgeScore) girdi olarak
// kullanılan 0-100 aralığında bir puandır — ratio=0.5 (yarı sürede bitirmiş) → 100,
// ratio=1 (tam zamanında) → 50, ratio>=2 (iki katı sürede) → 0.
export const computeQuestOutcome = (
  startedAt: string | null,
  completedAt: string,
  deadline: Date | null
): QuestOutcomeResult => {
  if (startedAt && deadline) {
    const startMs = new Date(startedAt).getTime();
    const allocatedMs = deadline.getTime() - startMs;
    if (allocatedMs > 0) {
      const elapsedMs = new Date(completedAt).getTime() - startMs;
      const ratio = elapsedMs / allocatedMs;
      const outcome: PunctualityOutcome = ratio < 0.9 ? 'fast' : ratio <= 1.1 ? 'ontime' : 'late';
      const outcomeScore = ratio <= 1
        ? 50 + 50 * (1 - ratio)
        : 50 - 50 * Math.min(ratio - 1, 1);
      return { outcome, outcomeScore: Math.max(0, Math.min(100, outcomeScore)) };
    }
  }
  if (deadline) {
    const isLate = new Date(completedAt).getTime() > deadline.getTime();
    return isLate ? { outcome: 'late', outcomeScore: 15 } : { outcome: 'ontime', outcomeScore: 65 };
  }
  // Ne başlangıç ne deadline var — nötr say, ibreyi oynatma.
  return { outcome: 'ontime', outcomeScore: 50 };
};

export interface LineCompletionResult {
  newLine: string;
  outcome: PunctualityOutcome;
  outcomeScore: number;
  completedAt: string;
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // "Boşluğu doldur" önerisi (bkz. App.tsx applyQuestRewardToState) için: erken bitirilen,
  // saatli-planlanmış bir görevde kaç dakikalık boşluk açıldığı + hangi gün + planlanan
  // bitişin gece yarısından itibaren kaçıncı dakika olduğu. Bu bilgi TAMAMLAMA ANINDA, satırın
  // kendisinden (saf fonksiyon içinde) hesaplanır — App.tsx bunu tekrar hesaplamaz, doğrudan
  // kullanır. gapMinutes<=0 ise (saatsiz görev, geç kalma, boşluk yok) öneri tetiklenmez.
  gapMinutes: number;
  dueDate: string | null;
  plannedEndAbsMin: number | null;
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Checkbox işaretlenme anında (3 farklı yerden çağrılır: NotesView.tsx'in yerel editorContent
// state'i içinde VE App.tsx/CalendarView.tsx/TasksView.tsx'in dosya-yazma akışlarında) satırın
// kendisini mutasyona uğratan SAF fonksiyon. Satır zaten [dakiklik:] etiketi taşıyorsa
// (idempotency guard) ya da bir checklist öğesi DEĞİLSE ya da işaretlenmemiş durumdaysa null
// döner (ödül uygulanmaz).
export const applyCompletionToLine = (line: string): LineCompletionResult | null => {
  const checklistMatch = line.match(/^(\s*[*\-]\s+\[)([ xX])(\]\s*.*)$/);
  if (!checklistMatch) return null;
  const isChecked = checklistMatch[2].toLowerCase() === 'x';
  if (!isChecked) return null;
  if (PUNCTUALITY_OUTCOME_TAG_REGEX.test(line)) return null;

  const tags = parseQuestTags(line);
  const completedAt = new Date().toISOString();
  const deadline = getDeadlineFromLine(line);

  const { outcome, outcomeScore } = computeQuestOutcome(tags.startedAt, completedAt, deadline);

  let newLine = line;
  if (!tags.completedAt) {
    newLine = `${newLine} [tamamlanma:${completedAt}]`;
  }
  newLine = `${newLine} [dakiklik:${outcome}]`;

  let gapMinutes = 0;
  let dueDate: string | null = null;
  let plannedEndAbsMin: number | null = null;
  const timeMatch = line.match(/\[time:\d{2}:\d{2}-(\d{2}):(\d{2})\]/i);
  if (outcome === 'fast' && deadline && timeMatch) {
    const dueMatch = line.match(/\[due:(\d{4}-\d{2}-\d{2})\]/i);
    dueDate = dueMatch ? dueMatch[1] : null;
    plannedEndAbsMin = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
    const diff = (deadline.getTime() - new Date(completedAt).getTime()) / 60000;
    if (diff > 0) gapMinutes = diff;
  }

  return { newLine, outcome, outcomeScore, completedAt, gapMinutes, dueDate, plannedEndAbsMin };
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// "▶️ Başla" butonuna basıldığında çağrılır — satıra [baslangic:ISO] etiketini bir kere ekler
// (zaten varsa dokunmaz, tekrar basmak süreyi sıfırlamaz).
export const applyQuestStartToLine = (line: string): string | null => {
  const checklistMatch = line.match(/^(\s*[*\-]\s+\[)([ xX])(\]\s*.*)$/);
  if (!checklistMatch) return null;
  if (STARTED_TAG_REGEX.test(line)) return null;
  return `${line} [baslangic:${new Date().toISOString()}]`;
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Uygulama her açıldığında/veriler yüklendiğinde taranır: son tarihi geçmiş, hâlâ
// işaretlenmemiş ve henüz [dakiklik:] etiketi olmayan görevleri "late" olarak damgalar —
// "hiç bitirilmeden gün geçmesi" kuralını uygular. Tarama App.tsx'te yapılır, bu sadece tek
// bir satır için karar veren saf fonksiyondur.
export const applyAutoFailToLine = (line: string, todayStr: string): LineCompletionResult | null => {
  const checklistMatch = line.match(/^(\s*[*\-]\s+\[)([ xX])(\]\s*.*)$/);
  if (!checklistMatch) return null;
  const isChecked = checklistMatch[2].toLowerCase() === 'x';
  if (isChecked) return null;
  if (PUNCTUALITY_OUTCOME_TAG_REGEX.test(line)) return null;
  const dueMatch = line.match(/\[due:(\d{4}-\d{2}-\d{2})/i);
  if (!dueMatch || dueMatch[1] >= todayStr) return null;

  return {
    newLine: `${line} [dakiklik:late]`,
    outcome: 'late',
    outcomeScore: 5,
    completedAt: new Date().toISOString(),
    gapMinutes: 0,
    dueDate: null,
    plannedEndAbsMin: null
  };
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Dakiklik rütbe merdiveni — devPaths.ts'teki RANK_LADDER (Er→General) ile AYNI desen: sadece
// "tembel/deha" iki ucu değil, TIRMANILASI ara kademeler. 4 negatif + 1 nötr + 4 pozitif = 9
// kademe. Kullanıcı bir üst rütbeye ne kadar kaldığını (bkz. getPunctualityRank'in
// nextMinScore'u) görüp oraya çıkmak istesin diye.
export const PUNCTUALITY_RANK_LADDER: { name: string; emoji: string; minScore: number; color: string }[] = [
  { name: 'Ertelemeci', emoji: '🐌', minScore: 0, color: '#ef4444' },
  { name: 'Sürüncemede', emoji: '😴', minScore: 13, color: '#f97316' },
  { name: 'Gecikmeli', emoji: '⏳', minScore: 26, color: '#f59e0b' },
  { name: 'Dağınık', emoji: '🌥️', minScore: 38, color: '#facc15' },
  { name: 'Dengeli', emoji: '⚖️', minScore: 46, color: '#94a3b8' },
  { name: 'Derli Toplu', emoji: '🙂', minScore: 55, color: '#a3e635' },
  { name: 'Dakik', emoji: '⏱️', minScore: 64, color: '#4ade80' },
  { name: 'Usta Planlayıcı', emoji: '🎯', minScore: 76, color: '#22c55e' },
  { name: 'Zaman Ustası', emoji: '⚡', minScore: 88, color: '#16a34a' }
];

export interface PunctualityRankInfo {
  index: number;
  name: string;
  emoji: string;
  color: string;
  minScore: number;
  nextMinScore: number | null;
}

export const getPunctualityRank = (score: number): PunctualityRankInfo => {
  const clamped = Math.max(0, Math.min(100, score));
  let idx = 0;
  for (let i = 0; i < PUNCTUALITY_RANK_LADDER.length; i++) {
    if (clamped >= PUNCTUALITY_RANK_LADDER[i].minScore) idx = i;
  }
  const cur = PUNCTUALITY_RANK_LADDER[idx];
  const next = PUNCTUALITY_RANK_LADDER[idx + 1];
  return { index: idx, name: cur.name, emoji: cur.emoji, color: cur.color, minScore: cur.minScore, nextMinScore: next ? next.minScore : null };
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Geriye dönük uyumluluk için kısa {label,color} biçimini rütbe merdiveninden türetir —
// PunctualityGauge.tsx ve Sidebar widget'ı bu basit biçimi kullanmaya devam edebilir.
export const getPunctualityLabel = (score: number): { label: string; color: string } => {
  const rank = getPunctualityRank(score);
  return { label: `${rank.emoji} ${rank.name}`, color: rank.color };
};

export interface SavedTimeStats {
  today: number;
  week: number;
  month: number;
  allTime: number;
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Kazanılan (erken bitirmeyle tasarruf edilen) süre AYRI bir yerde saklanmaz — her zaman
// notlardaki [dakiklik:fast]+[tamamlanma:]+[due:]+[time:] etiketlerinden anlık hesaplanır.
// Sidebar (bugün) ve AdventureView (bugün/hafta/ay/tüm zamanlar) bu TEK fonksiyonu paylaşır.
export const computeSavedTimeStats = (fileContents: Record<string, string>): SavedTimeStats => {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const monthStr = todayStr.slice(0, 7);
  const weekAgoMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  const stats: SavedTimeStats = { today: 0, week: 0, month: 0, allTime: 0 };

  Object.values(fileContents).forEach(content => {
    if (!content) return;
    content.split('\n').forEach(line => {
      if (!PUNCTUALITY_OUTCOME_TAG_REGEX.test(line) || !/\[dakiklik:fast\]/i.test(line)) return;
      const completedMatch = line.match(COMPLETED_TAG_REGEX);
      if (!completedMatch) return;
      if (!line.includes('[time:')) return;
      const deadline = getDeadlineFromLine(line);
      if (!deadline) return;
      const completedMs = new Date(completedMatch[1]).getTime();
      if (isNaN(completedMs)) return;
      const diffMin = (deadline.getTime() - completedMs) / 60000;
      if (diffMin <= 0) return;

      stats.allTime += diffMin;
      if (completedMs >= weekAgoMs) stats.week += diffMin;
      if (completedMatch[1].slice(0, 10) === todayStr) stats.today += diffMin;
      if (completedMatch[1].slice(0, 7) === monthStr) stats.month += diffMin;
    });
  });

  return stats;
};
