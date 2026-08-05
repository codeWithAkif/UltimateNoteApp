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
// BUG DÜZELTMESİ: Gemini bazen JSON çıktısı içinde satır sonlarını ÇİFT kaçışlı (\\n)
// üretiyor — JSON.parse bunu normalde gerçek bir satır sonuna çevirir, ama çift kaçış
// durumunda sonuç, gerçek bir satır sonu DEĞİL, literal "\n" (ters taksim + n) iki
// karakteri oluyor. Başlık/kolon/liste render mekanizmalarının tamamı GERÇEK satır
// sonuna dayandığı için (satır başı kontrolleri) bu durumda tüm biçimlendirme bozulup
// düz, yapışık metin olarak görünüyor. Bu, o literal kaçış dizilerini gerçek karakterlere
// çevirir — AI Öğretmen'in ürettiği HER metin bloğunda (soru cevabı, mini proje, test
// sonucu) ilk adım olarak uygulanır.
export const unescapeAIText = (text: string): string => {
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Kullanıcı geri bildirimi: AI "```sql" (boşluksuz) yazınca kod bloğu bizim tarafta
// görünmüyor. Dil etiketiyle ``` arasına her zaman bir boşluk koyarak garantiye alıyoruz.
export const normalizeCodeFenceSpacing = (text: string): string => {
  return text.replace(/```([a-zA-Z0-9_+-]+)/g, '``` $1');
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
  let normalized = text
    .replace(/\s*<<<row-end>>>\s*/g, '\n<<<row-end>>>\n')
    .replace(/\s*<<<row>>>\s*/g, '\n<<<row>>>\n')
    .replace(/\s*<<<col>>>\s*/g, '\n<<<col>>>\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // BUG DÜZELTMESİ: AI bazen <<<row>>> açıp <<<row-end>>> ile kapatmayı unutuyor. Notun
  // render mekanizması kapanmamış bir <<<row>>> gördüğünde notun GERİ KALAN TÜM içeriğini
  // o satır bloğunun içine yutuyordu (kullanıcı: "hiç bişey yazmadan ses konuşmaya
  // başladı" — aslında yazılıyordu ama bu yüzden hiç görünmüyordu). Açık kalan her
  // <<<row>>> için garanti bir <<<row-end>>> ekleyerek bunu kaynağında önlüyoruz.
  const rowOpens = (normalized.match(/<<<row>>>/g) || []).length;
  const rowEnds = (normalized.match(/<<<row-end>>>/g) || []).length;
  if (rowOpens > rowEnds) {
    normalized += '\n<<<row-end>>>\n'.repeat(rowOpens - rowEnds);
  }

  return normalized;
};

export const formatAITeacherAnswerBody = (answer: string): string => {
  const cleaned = normalizeCodeFenceSpacing(unescapeAIText(answer.trim()));
  return `${resolveYouTubeSearchTags(normalizeAITeacherGridTags(cleaned))}\n\n---\n`;
};

export const formatAITeacherQuizResult = (
  passed: boolean,
  feedback: string,
  streakAfter: number
): string => {
  const date = new Date().toLocaleString('tr-TR');
  const header = passed ? `✅ **Test (${date}): Geçti**` : `❌ **Test (${date}): Geçemedi**`;
  let block = `\n\n${header}\n\n${unescapeAIText(feedback.trim())}\n`;
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
  return `\n- [ ] 📚 **${noteTitle}** konusunu çalış [due:${dateStr}] [plannedtime:${startTime}-${endTime}]\n`;
};

export const formatMiniProjectBlock = (title: string, instructions: string): string => {
  const cleaned = normalizeCodeFenceSpacing(unescapeAIText(instructions.trim()));
  const resolvedInstructions = resolveYouTubeSearchTags(normalizeAITeacherGridTags(cleaned));
  return `\n\n### 🛠️ Mini Proje: ${title}\n\n${resolvedInstructions}\n\n- [ ] Mini projeyi tamamladım\n\n---\n`;
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Sesli soru-cevap: cevabı tarayıcının SpeechSynthesis'i ile okumadan önce Markdown
// işaretlerini temizler — aksi halde "kare kare Başlık", "yıldız yıldız kalın yıldız yıldız"
// gibi garip sesli çıktılar duyulur. Kod bloklarını ve otomatik SRS kart bloğunu (zaten
// sesli anlatıma uygun değil) tamamen atlar.
export const stripMarkdownForSpeech = (text: string): string => {
  return unescapeAIText(text)
    .replace(/<details>[\s\S]*?<\/details>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<<<row-end>>>|<<<row>>>|<<<col>>>/g, '. ')
    .replace(/\[color:[a-z]+\]/gi, '')
    .replace(/\[due:[^\]]*\]|\[(?:plannedtime|time|window):[^\]]*\]|\[(?:priority|p):[^\]]*\]/gi, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s*/gm, '')
    .replace(/^-\s*\[[ xX]\]\s*/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim();
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// BUG DÜZELTMESİ (kullanıcı geri bildirimi: "önce normal yazıyor bitince ikiye bölünmüş
// oluyor, ikiye bölünmüşken yazsa daha iyi olur"): Eski yazma animasyonu, TAM metni
// baştan sona TEK bir doğrusal karakter dizisi olarak açığa çıkarıyordu — bu yüzden bir
// <<<row>>>...<<<row-end>>> bloğunun içindeki metin, kapanış etiketi açığa çıkana kadar
// (yani neredeyse cevabın SONUNA kadar) düz/biçimlendirilmemiş görünüyor, sonra aniden
// kolonlara "zıplıyordu". Bu fonksiyon metni önceden segmentlere ayırır (düz metin /
// satır-kolon blokları) ve bir kolon bloğuna girildiği AN her iki kolonun etiketlerini
// (<<<row>>>/<<<col>>>/<<<row-end>>>) HEMEN açığa çıkarıp içeriklerini round-robin
// (bir sola bir sağa) dolduracak şekilde ilerletir — kutular en baştan görünür,
// karşılaştırma tarzı bir doldurma hissi verir.
interface AITeacherRevealSegment {
  type: 'text' | 'row';
  text: string;
  columns: string[];
}

const parseAITeacherRevealSegments = (fullText: string): AITeacherRevealSegment[] => {
  const segments: AITeacherRevealSegment[] = [];
  const rowRegex = /<<<row>>>\n([\s\S]*?)<<<row-end>>>\n?/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(fullText))) {
    if (m.index > lastIndex) {
      segments.push({ type: 'text', text: fullText.slice(lastIndex, m.index), columns: [] });
    }
    const inner = m[1];
    const rawColumns = inner.split(/<<<col>>>\n?/);
    const columns = rawColumns.filter((c, idx) => idx > 0 || c.trim().length > 0);
    segments.push({ type: 'row', text: '', columns: columns.length > 0 ? columns : [inner] });
    lastIndex = rowRegex.lastIndex;
  }
  if (lastIndex < fullText.length) {
    segments.push({ type: 'text', text: fullText.slice(lastIndex), columns: [] });
  }
  return segments;
};

const revealColumnsRoundRobin = (columns: string[], charBudget: number): string[] => {
  const revealedLens = columns.map(() => 0);
  let remaining = charBudget;
  let progressed = true;
  while (remaining > 0 && progressed) {
    progressed = false;
    for (let ci = 0; ci < columns.length && remaining > 0; ci++) {
      if (revealedLens[ci] < columns[ci].length) {
        revealedLens[ci]++;
        remaining--;
        progressed = true;
      }
    }
  }
  return columns.map((c, ci) => c.slice(0, revealedLens[ci]));
};

// `ratio` (0..1) ilerlemesine göre, YAPIYI (kolon iskeletini) korurcasına kısmi metni üretir.
export const buildAITeacherRevealText = (fullText: string, ratio: number): string => {
  const segments = parseAITeacherRevealSegments(fullText);
  const totalChars = segments.reduce((sum, s) => sum + (s.type === 'text' ? s.text.length : s.columns.join('').length), 0);
  let budget = Math.max(0, Math.floor(totalChars * Math.min(1, Math.max(0, ratio))));
  let out = '';

  for (const seg of segments) {
    if (budget <= 0) break;
    if (seg.type === 'text') {
      const take = Math.min(seg.text.length, budget);
      out += seg.text.slice(0, take);
      budget -= take;
    } else {
      const segLen = seg.columns.join('').length;
      if (segLen === 0) continue;
      const segBudget = Math.min(segLen, budget);
      const revealedCols = revealColumnsRoundRobin(seg.columns, segBudget);
      // Her kolon içeriği KESİNLİKLE kendi satırında bitmeli — aksi halde bir sonraki
      // <<<col>>>/<<<row-end>>> etiketi aynı satıra yapışıp render parser'ını (satır
      // başı kontrolüne dayanıyor) bozar; aynen normalizeAITeacherGridTags'in önlediği hata.
      out += '<<<row>>>\n';
      for (const rc of revealedCols) {
        out += '<<<col>>>\n' + rc;
        if (!rc.endsWith('\n')) out += '\n';
      }
      out += '<<<row-end>>>\n';
      budget -= segBudget;
    }
  }

  return out;
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Gemini TTS ham PCM (16-bit, mono, genelde 24kHz) ses döner — tarayıcı bunu doğrudan
// <audio>/Audio() ile ÇALAMAZ, önce bir WAV başlığı (RIFF header) eklenmesi gerekir.
// Bu fonksiyon base64 PCM'i geçerli bir WAV Blob URL'sine çevirir. mimeType içindeki
// "rate=NNNNN" kısmından örnekleme hızını okur, bulamazsa Gemini TTS'in varsayılanı olan
// 24000'i kullanır.
export const pcmBase64ToWavUrl = (base64: string, mimeType: string): string => {
  const rateMatch = mimeType.match(/rate=(\d+)/);
  const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;

  const binary = atob(base64);
  const pcmLength = binary.length;
  const buffer = new ArrayBuffer(44 + pcmLength);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM formatı
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (16-bit mono)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bit derinliği
  writeString(36, 'data');
  view.setUint32(40, pcmLength, true);

  for (let i = 0; i < pcmLength; i++) {
    view.setUint8(44 + i, binary.charCodeAt(i));
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
};
