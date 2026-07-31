// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// AI Öğretmen özelliğinin not-içi durum takibi. Ayrı bir veritabanı/tablo yerine, projenin
// genelindeki desenle (punctuality.ts, [due:]/[time:] vb.) tutarlı şekilde tek bir satır-içi
// etiket ([ai-teacher-mastery: ...]) notun kendi içinde taşınır — senkron, yedekleme, sürüm
// geçmişi gibi her şey ekstra kod yazmadan otomatik gelir.

export const AI_TEACHER_MASTERY_TARGET = 3;

const MASTERY_TAG_REGEX = /\[ai-teacher-mastery:\s*streak=(\d+)\/(\d+)\]/i;

export const getMasteryStreak = (content: string): number => {
  const m = content.match(MASTERY_TAG_REGEX);
  return m ? parseInt(m[1], 10) : 0;
};

export const isMastered = (content: string): boolean =>
  getMasteryStreak(content) >= AI_TEACHER_MASTERY_TARGET;

export const setMasteryStreak = (content: string, streak: number): string => {
  const clamped = Math.max(0, Math.min(streak, AI_TEACHER_MASTERY_TARGET));
  const tag = `[ai-teacher-mastery: streak=${clamped}/${AI_TEACHER_MASTERY_TARGET}]`;
  if (MASTERY_TAG_REGEX.test(content)) {
    return content.replace(MASTERY_TAG_REGEX, tag);
  }
  return content.trimEnd() + `\n\n${tag}\n`;
};

export const formatAITeacherQA = (question: string, answer: string): string => {
  return `\n\n> 🤓 **Soru:** ${question}\n\n${answer.trim()}\n\n---\n`;
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Daktilo efekti için soru ve cevap iki ayrı adımda nota yazılır: önce soru bloğu (kullanıcı
// nereye kaydığını hemen görsün), sonra cevap harf harf eklenir. formatAITeacherQA'nın
// tek-parça hâli artık kullanılmıyor ama geriye dönük uyumluluk için duruyor.
export const formatAITeacherQuestionBlock = (question: string): string => {
  return `\n\n> 🤓 **Soru:** ${question}\n\n`;
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// AI'ye "gerçek bir YouTube video URL'si üret" dedirtmek halüsinasyon riski taşır — var
// olmayan/yanlış bir video ID'si uydurup notlara yanlışlıkla otomatik gömülebilir (bkz.
// NotesView.tsx'in her YouTube linkini iframe'e çeviren davranışı). Bunun yerine AI'den
// yalnızca "[youtube-search: terim]" ETİKETİ istenir; gerçek, hiç uydurma içermeyen arama
// linkini (encodeURIComponent ile) BURADA, kod tarafında, deterministik olarak üretiriz.
// Sonuç bir arama SONUÇ sayfası linkidir (spesifik bir video değil) — bu yüzden otomatik
// gömülmez, kullanıcı tıklayıp gerçek videoyu kendi seçer.
const YOUTUBE_SEARCH_TAG_REGEX = /\[youtube-search:\s*([^\]]+)\]/gi;

export const resolveYouTubeSearchTags = (text: string): string => {
  return text.replace(YOUTUBE_SEARCH_TAG_REGEX, (_match, query: string) => {
    const trimmedQuery = query.trim();
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(trimmedQuery)}`;
    return `[▶️ YouTube'da ara: "${trimmedQuery}"](${url})`;
  });
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// NotesView.tsx'teki <<<row>>>/<<<col>>>/<<<row-end>>> kolon render mekanizması bu
// etiketlerin HER BİRİNİN kendi satırında (satır başında) olmasını şart koşar (bkz.
// renderLinesWithColumns, lineText.startsWith kontrolleri). Prompt'ta bunu açıkça istesek
// de LLM çıktısı bazen etiketleri bir paragrafın içine gömüp aynı satıra yazabiliyor —
// bu durumda etiketler render edilmeyip düz metin olarak görünüyor. AI'nin talimata tam
// uymasına güvenmek yerine, kod tarafında etiketleri garantili şekilde kendi satırlarına
// ayırıyoruz; bu yüzden prompt uyumu ne olursa olsun kolon görünümü her zaman çalışır.
export const normalizeAITeacherGridTags = (text: string): string => {
  return text
    .replace(/\s*<<<row-end>>>\s*/g, '\n<<<row-end>>>\n')
    .replace(/\s*<<<row>>>\s*/g, '\n<<<row>>>\n')
    .replace(/\s*<<<col>>>\s*/g, '\n<<<col>>>\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const formatAITeacherAnswerBody = (answer: string): string => {
  return `${resolveYouTubeSearchTags(normalizeAITeacherGridTags(answer.trim()))}\n\n---\n`;
};

export const formatAITeacherQuizResult = (
  passed: boolean,
  feedback: string,
  streakAfter: number
): string => {
  const date = new Date().toLocaleString('tr-TR');
  const header = passed ? `✅ **Test (${date}): Geçti**` : `❌ **Test (${date}): Geçemedi**`;
  let block = `\n\n${header}\n\n${feedback.trim()}\n`;
  if (passed && streakAfter >= AI_TEACHER_MASTERY_TARGET) {
    block += `\n🎓 **Bu konuya %100 hakimsin!** (Art arda ${AI_TEACHER_MASTERY_TARGET} testte başarılı oldun)\n`;
  }
  return block;
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// FlashcardView.tsx'in ayrıştırdığı BİREBİR AYNI format: [card: soru || cevap] [srs: box1, tarih].
// Böylece AI Öğretmen'in ürettiği kartlar ekstra kod yazılmadan Soru-Cevap Kartları (SRS)
// ekranına otomatik dahil olur.
const getTodayDateStr = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export const formatAITeacherFlashcards = (cards: { question: string; answer: string }[]): string => {
  if (cards.length === 0) return '';
  const todayStr = getTodayDateStr();
  const lines = cards.map(c => `[card: ${c.question.trim()} || ${c.answer.trim()}] [srs: box1, ${todayStr}]`);
  return `\n\n<details><summary>🗂️ Otomatik oluşturulan hatırlatma kartları (${cards.length})</summary>\n\n${lines.join('\n')}\n\n</details>\n`;
};

// Notta zaten var olan kart SORULARIYLA (soru metni) birebir aynı olan yeni kartları eler —
// her sohbet turunda generateFlashcards çağrılırsa aynı kartların tekrar tekrar eklenmesini önler.
export const dedupeNewFlashcards = (
  existingContent: string,
  newCards: { question: string; answer: string }[]
): { question: string; answer: string }[] => {
  const existingQuestions = new Set(
    Array.from(existingContent.matchAll(/\[card:\s*([^\]]+?)\s*\|\|/g)).map(m => m[1].trim().toLowerCase())
  );
  return newCards.filter(c => !existingQuestions.has(c.question.trim().toLowerCase()));
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Takvim/Görevler, [due:]/[time:] etiketli herhangi bir checklist satırını (hangi notta
// olursa olsun, bkz. CalendarView.tsx fileContents taraması) otomatik olarak görev sayar —
// bu yüzden "çalışma zamanı planla" için ayrı bir entegrasyon yazmaya gerek yok, sadece
// doğru formatta TEK bir satır eklemek yeterli. Görev tamamlanınca/başlayınca dakiklik
// takibi, geri sayım, bildirimler zaten mevcut Takvim altyapısından otomatik gelir.
export const buildAITeacherScheduleTaskLine = (
  noteTitle: string,
  dateStr: string,
  startTime: string,
  endTime: string
): string => {
  return `\n- [ ] 📚 **${noteTitle}** konusunu çalış [due:${dateStr}] [time:${startTime}-${endTime}]\n`;
};

export const formatMiniProjectBlock = (title: string, instructions: string): string => {
  const resolvedInstructions = resolveYouTubeSearchTags(normalizeAITeacherGridTags(instructions.trim()));
  return `\n\n### 🛠️ Mini Proje: ${title}\n\n${resolvedInstructions}\n\n- [ ] Mini projeyi tamamladım\n\n---\n`;
};
