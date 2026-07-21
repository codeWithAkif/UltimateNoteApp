// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// "Gelişim Yolu" (rank) özelliğinin AI mentor katmanı (Faz 2). Google Gemini API'sini
// kullanıcının KENDİ API anahtarıyla doğrudan cihazdan çağırır — Anthropic/Claude API'si
// veya "Antigravity" DEĞİL (ikisi de bu kullanım için uygun değil, bkz. kullanıcıyla
// yapılan tartışma). Anahtar yalnızca localStorage'da tutulur, Supabase senkron
// bilgilerinin saklanma deseniyle birebir aynı yaklaşım.

import type { DevPathNoteMode } from '../devPaths';

const GEMINI_KEY_STORAGE = 'gemini_api_key';
const GEMINI_MODEL_STORAGE = 'gemini_model';

// Varsayılan model — kullanıcı Ayarlar > AI Mentor'dan kendi seçtiği bir modelle
// (localStorage) bunu her zaman geçersiz kılabilir. Sabit tutmak yerine ayarlanabilir
// yapılmasının sebebi: ücretsiz katmanda model başına GÜNLÜK istek kotası ayrı ayrı
// takip ediliyor (bkz. Google AI Studio "Rate Limit" paneli) — bir modelin günlük
// kotası dolunca kullanıcı kod değiştirmeden başka (henüz kotası dolmamış) bir flash
// modeline geçebilsin diye.
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const getGeminiApiKey = (): string | null => {
  return localStorage.getItem(GEMINI_KEY_STORAGE);
};

export const setGeminiApiKey = (key: string) => {
  if (key && key.trim()) {
    localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
  } else {
    localStorage.removeItem(GEMINI_KEY_STORAGE);
  }
};

export const getGeminiModel = (): string => {
  return localStorage.getItem(GEMINI_MODEL_STORAGE) || DEFAULT_GEMINI_MODEL;
};

export const setGeminiModel = (model: string) => {
  if (model && model.trim()) {
    localStorage.setItem(GEMINI_MODEL_STORAGE, model.trim());
  } else {
    localStorage.removeItem(GEMINI_MODEL_STORAGE);
  }
};

export const isGeminiConfigured = (): boolean => !!getGeminiApiKey();

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Gemini'nin "responseSchema" ile yapılandırılmış JSON çıktısı özelliğini kullanır —
// serbest metin ayrıştırmaya güvenmek yerine her zaman geçerli JSON döndürmesini garanti eder.
async function callGemini<T>(prompt: string, responseSchema: any): Promise<T> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API anahtarı ayarlanmamış. Ayarlar > AI Mentor bölümünden ekleyin.');
  }

  const res = await fetch(
    `${GEMINI_API_BASE}/${getGeminiModel()}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema
        }
      })
    }
  );

  if (!res.ok) {
    let errText = '';
    try { errText = await res.text(); } catch (e) { /* yoksay */ }
    throw new Error(`Gemini API hatası (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini yanıtı boş döndü.');
  }
  return JSON.parse(text) as T;
}

export interface ClarifyingQA {
  question: string;
  answer: string;
}

// Not: `DevPathNoteMode` tipi devPaths.ts'te tanımlıdır (paylaşılan veri modeli
// dosyası) — burada tekrar tanımlamak yerine oradan içe aktarılır, iki dosyanın
// zamanla birbirinden sapmasını önler.
export interface TopicSubNote {
  title: string;
  content: string;
}

export interface LevelAssessmentResult {
  needsClarification: boolean;
  clarifyingQuestion?: string;
  clarifyingOptions?: string[];
  levelTitle?: string;
  topics?: { title: string; description: string; introNote: string }[];
  priorLevels?: { title: string; topics: { title: string; description: string; introNote: string }[] }[];
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// `introNote`, konu klasörü oluşturulurken içine yazılan "Başlangıç Notu" için —
// kullanıcı boş bir klasörle karşılaşmasın, konuyu anlatan gerçek bir ders/özet notuyla
// başlasın diye. Bunu AYRI bir API çağrısıyla değil, zaten yapılan TEK çağrının
// (seviye+konu listesi üretimi) çıktısına ekleyerek üretiyoruz — maliyeti artırmadan.
// BUG DÜZELTMESİ (az konu üretimi): `subNotes` ESKİDEN bu şemanın bir parçasıydı ve
// 'advanced'/'complete' modda AYNI çağrıda hem konu listesi hem her konunun 3-5 alt-notu
// (100-150+ kelime/alt-not) üretiliyordu. Bu, konu sayısı arttıkça çıktı boyutunu
// katlanarak büyütüyordu — model de (fark etmeden) çıktıyı makul boyutta tutmak için
// KONU SAYISINI kısıyordu (kullanıcının şikayeti: "Complete modda Basic'ten bile az
// konu geliyor"). Çözüm: subNotes bu şemadan tamamen çıkarıldı; konu listesi HER ZAMAN
// (moddan bağımsız) sadece title+description+introNote üretir, böylece genişlik
// (konu sayısı) hiçbir zaman derinlik (alt-not içeriği) ile aynı çağrıda rekabet etmez.
// Alt-notlar artık AYRI bir çağrıyla (bkz. generateTopicSubNotes), konu klasörü
// oluşturulurken konu başına tek tek üretiliyor (App.tsx'teki createLevelFolders).
const TOPIC_LIST_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      introNote: { type: 'string' }
    },
    required: ['title', 'description', 'introNote']
  }
};

const LEVEL_ASSESSMENT_SCHEMA = {
  type: 'object',
  properties: {
    needsClarification: { type: 'boolean' },
    clarifyingQuestion: { type: 'string' },
    clarifyingOptions: { type: 'array', items: { type: 'string' } },
    levelTitle: { type: 'string' },
    topics: TOPIC_LIST_SCHEMA,
    priorLevels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          topics: TOPIC_LIST_SCHEMA
        },
        required: ['title', 'topics']
      }
    }
  },
  required: ['needsClarification']
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Kullanıcı bir klasörü gelişim yolu olarak işaretlerken çağrılır. Açıklama yeterince
// netse doğrudan seviye+konu listesini döndürür; belirsizse TEK bir çoktan seçmeli
// netleştirme sorusu döner ve çağıran taraf (App.tsx) priorQA'ya ekleyip tekrar çağırır.
export const determineLevelAndTopics = async (
  domainLabel: string,
  selfDescription: string,
  priorQA: ClarifyingQA[],
  noteMode: DevPathNoteMode = 'basic'
): Promise<LevelAssessmentResult> => {
  const qaText = priorQA.length
    ? '\n\nDaha önce sorulan netleştirme soruları ve kullanıcının cevapları:\n' +
      priorQA.map(qa => `Soru: ${qa.question}\nCevap: ${qa.answer}`).join('\n\n')
    : '';

  const prompt = `Sen deneyimli bir kişisel gelişim mentorüsün. Kullanıcı bir klasörü "${domainLabel}" olarak adlandırmış ve şu şekilde kendini tanımlıyor: "${selfDescription}"${qaText}

ÖNEMLİ: "${domainLabel}" yalnızca kullanıcının klasöre verdiği KABA bir etikettir — kullanıcının GERÇEKTEN hangi alanda/rolde gelişmek istediğinin asıl ve tek güvenilir kaynağı kendi tanımı ("${selfDescription}"). Klasör adı belirli bir teknolojiyi/aracı içeriyor olabilir ama kullanıcının tanımı daha geniş veya farklı bir rolü işaret ediyorsa (ör. klasör adı bir framework'ün adını taşısa da kullanıcı kendini "mimar"/"lider"/"danışman" gibi daha üst düzey bir rol olarak tanımlıyorsa), kullanıcının kendi tanımını esas al ve üretilen unvan/konular buna göre şekillensin — asla sadece klasör adındaki teknoloji kelimesine bakıp kullanıcının tanımıyla çelişen, ondan daha dar/farklı bir role kaymayın. Özellikle: kullanıcı kendini "mimar" (architect) gibi bir rolle tanımlıyorsa, üretilecek konular gerçek MİMARİ konular olmalı (sistem tasarımı, ölçeklenebilirlik, mimari kalıplar/pattern'ler, trade-off analizi, güvenlik mimarisi, dağıtık sistemler vb.) — bir framework'ün iç API detaylarını (ör. bir DI konteynerinin yaşam döngüsü seçenekleri gibi) ÖĞRENEN bir "junior geliştirici" müfredatına indirgemeyin; bu ikisi FARKLI şeylerdir ve kullanıcının tanımladığı role uygun olanı seçmek senin sorumluluğun.

Görevin:
1. Bu ALANA ÖZGÜ, gerçekçi bir seviye/unvan sistemi düşün (genel "acemi/uzman" gibi değil, o alanın kendi terminolojisiyle — örneğin bir zanaat için çırak-kalfa-usta sistemi, bir yazılım mesleği için junior-mid-senior gibi, o alana ne uyuyorsa). Bu sistemin BAŞLANGIÇTAN kullanıcının şu anki seviyesine kadar TÜM basamaklarını da zihninde net olarak sırala (ör. Çırak -> Kalfa -> Usta), çünkü aşağıda bunları da dolduracaksın.
2. Kullanıcının açıklaması hangi seviyede olduğunu belirlemek için yeterliyse: needsClarification=false yap, kullanıcının ŞU ANKİ seviyesinin unvanını levelTitle alanına yaz, ve bir sonraki seviyeye geçmek için GERÇEKTEN bilinmesi/yapılması gereken TÜM somut, doğru ve alana özgü konuları topics dizisine yaz. KONU SAYISINI YAPAY OLARAK SINIRLAMA VEYA ŞİŞİRME — bazı alanlarda/seviyelerde bu gerçekten 5 konu olabilir, bazılarında 25 konu olabilir; sen bu alanın gerçek uzmanı gibi düşünüp GERÇEKTE kaç konu gerekiyorsa o kadarını yaz, "yuvarlak" bir sayıya (ör. 10) uydurmaya çalışma — GENİŞLİK (kapsamlı bir konu listesi) her zaman önceliklidir, konu sayısını asla küçük tutmak için kısma. Her konu için: kısa bir başlık (title), 1-2 cümlelik açıklama (description), VE o konuyu gerçekten ÖĞRETEN, iyi yapılandırılmış bir Markdown ders notu (introNote — başlıklar, madde işaretleri, somut örnekler içeren en az 150-250 kelimelik gerçek bir eğitim içeriği; kullanıcı bu konuda SIFIRDAN başlıyormuş gibi düşün, boş bir klasörle değil GERÇEK bir başlangıç notuyla karşılaşsın). Bu konular ve içerikleri uydurma dolgu olmamalı — gerçekten o alanda bir üst seviyeye geçmek için gereken, doğru bilgiler olmalı.
3. Kullanıcının şu anki seviyesi bu alanın EN BAŞLANGIÇ seviyesi DEĞİLSE (yani kullanıcı bazı önceki seviyeleri atlayıp doğrudan daha ileri bir seviyeden başlıyorsa): priorLevels alanına, en başlangıç seviyesinden başlayıp şu anki seviyenin BİR ÖNCESİNE kadar (şu anki seviye HARİÇ) sıradaki TÜM önceki seviyeleri, her biri kendi GERÇEK ve alana özgü konu listesiyle (title+description+introNote, yukarıdaki gibi — konu sayısı burada da yapay olarak sınırlanmaz/şişirilmez, o seviye için gerçekte kaç konu gerekiyorsa o kadar) birlikte yaz (bu konular, kullanıcının o seviyeye gelirken zaten bilmesi/yapmış olması gereken şeylerdir — kullanıcı bunları muhtemelen biliyor ama gözden geçirip eksik olanları işaretleyebilecek). Kullanıcı zaten EN BAŞLANGIÇ seviyesindeyse priorLevels alanını boş dizi [] yap.
4. Açıklama çok belirsizse (ör. sadece "yazılım mühendisiyim" gibi, hangi seviyede olduğu belli değilse): needsClarification=true yap, clarifyingQuestion alanına TEK bir netleştirici soru yaz, clarifyingOptions alanına bu alan için anlamlı 3-5 seçenek (seviye adı gibi) yaz. Bu durumda topics, levelTitle ve priorLevels alanlarını boş bırak.
5. ÖZ-KONTROL (son adım, JSON'u döndürmeden HEMEN önce yap): topics/levelTitle'ı yazdıktan sonra, ürettiğin listeyi kullanıcının kendi tanımıyla ("${selfDescription}") karşılaştır. Kendine sor: "Bu konular kullanıcının GERÇEKTEN hedeflediği role mi uyuyor, yoksa ben farkında olmadan daha dar/farklı bir role (ör. bir framework'ün implementasyon detaylarına) mı kaydım?" Kaymışsan, JSON'u döndürmeden önce topics/levelTitle alanlarını GERÇEKTEN düzelt — bu kontrolü sessizce yap, cevaba "öz-kontrol yaptım" gibi bir açıklama EKLEME, sadece düzeltilmiş sonucu döndür.

Sadece JSON döndür, başka hiçbir metin ekleme. Türkçe yaz.`;

  return callGemini<LevelAssessmentResult>(prompt, LEVEL_ASSESSMENT_SCHEMA);
};

const NEXT_LEVEL_SCHEMA = {
  type: 'object',
  properties: {
    levelTitle: { type: 'string' },
    topics: TOPIC_LIST_SCHEMA
  },
  required: ['levelTitle', 'topics']
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Bir seviyedeki tüm konular geçildiğinde bir sonraki seviyeyi (unvan + yeni konu listesi)
// üretmek için çağrılır — netleştirme sorusu YOK, çünkü seviye zaten "bir öncekinin devamı"
// olarak sabit. `noteMode` parametresi geriye dönük uyumluluk için tutuluyor ama artık
// kullanılmıyor — alt-notlar artık ayrı bir çağrıyla (generateTopicSubNotes) üretiliyor.
export const generateNextLevel = async (
  domainLabel: string,
  priorLevelTitles: string[],
  noteMode: DevPathNoteMode = 'basic'
): Promise<{ levelTitle: string; topics: { title: string; description: string; introNote: string }[] }> => {
  const prompt = `Sen deneyimli bir kişisel gelişim mentorüsün. Kullanıcı "${domainLabel}" alanında gelişiyor.

Şimdiye kadar geçtiği seviyeler (eskiden yeniye): ${priorLevelTitles.join(' -> ')}

Görev: Bir sonraki seviyenin unvanını (bu alana özgü, gerçekçi terminoloji ile, önceki seviyelerin mantıklı bir devamı olacak şekilde) belirle. Ardından, bu yeni seviyeYE ULAŞTIKTAN SONRA bir SONRAKİ seviyeye geçmek için gereken TÜM somut, doğru, alana özgü konuları belirle (uydurma dolgu değil, gerçekten gerekli şeyler). KONU SAYISINI YAPAY OLARAK SINIRLAMA VEYA ŞİŞİRME — bu seviye için gerçekte kaç konu gerekiyorsa (5 de olabilir, 25 de olabilir) o kadarını yaz, "yuvarlak" bir sayıya uydurmaya çalışma; GENİŞLİK her zaman önceliklidir. Her konu için title (kısa başlık), description (1-2 cümle) VE introNote (o konuyu gerçekten öğreten, başlıklar/madde işaretleri/somut örnekler içeren en az 150-250 kelimelik gerçek bir Markdown ders notu — kullanıcı bu konu klasörünü ilk açtığında boş değil, dolu bir başlangıç notuyla karşılaşacak) üret.

Sadece JSON döndür. Türkçe yaz.`;

  return callGemini(prompt, NEXT_LEVEL_SCHEMA);
};

const SUB_NOTES_SCHEMA = {
  type: 'object',
  properties: {
    subNotes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['title', 'content']
      }
    }
  },
  required: ['subNotes']
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// 'advanced'/'complete' modda her konu için AYRI bir çağrı — eskiden bu, konu listesi
// üretimiyle AYNI çağrıda isteniyordu, bu da konu sayısı arttıkça çıktının katlanarak
// büyümesine ve modelin (fark ettirmeden) konu sayısını kısmasına yol açıyordu (bkz.
// TOPIC_LIST_SCHEMA üstündeki yorum). Artık App.tsx'teki createLevelFolders, konu
// klasörünü oluştururken bu fonksiyonu HER konu için tek tek çağırıyor — genişlik
// (konu sayısı) ve derinlik (alt-not içeriği) birbirinden tamamen bağımsız.
export const generateTopicSubNotes = async (
  topicTitle: string,
  topicDescription: string,
  introNote: string
): Promise<{ subNotes: TopicSubNote[] }> => {
  const prompt = `Sen "${topicTitle}" (${topicDescription}) konusunda ders hazırlayan bir mentorsün.

Bu konu için zaten yazılmış bir başlangıç notu var:
"""
${introNote.slice(0, 3000)}
"""

Görev: Bu konuyu 3-5 alt-başlığa/alt-yöne böl ve her biri için ayrı bir not üret (subNotes dizisine yaz — her biri kendi title'ı ve en az 100-150 kelimelik gerçek, doğru bir Markdown içeriğiyle, konunun farklı bir alt-yönünü derinlemesine ele alsın). Yukarıdaki başlangıç notunun TEKRARI olmasın, onu TAMAMLASIN — farklı açılardan derinleştirsin (ör. pratik örnekler, yaygın hatalar, ileri seviye detaylar, karşılaştırmalar gibi).

Sadece JSON döndür. Türkçe yaz.`;

  return callGemini(prompt, SUB_NOTES_SCHEMA);
};

const SUGGEST_TOPIC_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    introNote: { type: 'string' }
  },
  required: ['title', 'description', 'introNote']
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Gelişim Yolu Detayı panelinde, mevcut seviyeye kullanıcının "eksik bir konu var"
// deyip TEK bir yeni konu eklemesi için — App.tsx'teki handleConfirmAddTopic bunu
// çağırıp dönen tek konuyu createLevelFolders ile (mevcut seviyenin klasörüne)
// materyalize eder.
export const suggestAdditionalTopic = async (
  domainLabel: string,
  levelTitle: string,
  existingTopicTitles: string[],
  hint: string
): Promise<{ title: string; description: string; introNote: string }> => {
  const hintText = hint.trim()
    ? `\n\nKullanıcının eksik olduğunu düşündüğü nokta: "${hint.trim()}"`
    : '';
  const prompt = `Sen "${domainLabel}" alanında "${levelTitle}" seviyesi için müfredat hazırlayan bir mentorsün.

Bu seviyede zaten var olan konular: ${existingTopicTitles.join(', ') || '(henüz yok)'}${hintText}

Görev: Bu seviyeye eklenmesi gereken, mevcut konularla ÇAKIŞMAYAN, gerçekten önemli BİR yeni konu öner (kullanıcı bir ipucu verdiyse ona uygun; vermediyse müfredatta gerçekten eksik olan en önemli konuyu sen seç). title (kısa başlık), description (1-2 cümle), introNote (o konuyu gerçekten öğreten, başlıklar/madde işaretleri/somut örnekler içeren en az 150-250 kelimelik gerçek bir Markdown ders notu) üret.

Sadece JSON döndür. Türkçe yaz.`;

  return callGemini(prompt, SUGGEST_TOPIC_SCHEMA);
};

const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    questions: { type: 'array', items: { type: 'string' } }
  },
  required: ['questions']
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Kullanıcının o konu altına yazdığı gerçek notları da prompta dahil eder — böylece
// sorular hem konunun genel bilgisini hem de kullanıcının GERÇEKTEN ne yazdığını
// kapsar (jenerik, alakasız sorular değil).
export const generateQuiz = async (
  topicTitle: string,
  topicDescription: string,
  notesContent: string
): Promise<{ questions: string[] }> => {
  const prompt = `Sen bir sınav hazırlayan deneyimli bir mentorsün. Konu: "${topicTitle}" (${topicDescription}).

Kullanıcının bu konu altında aldığı notlar:
"""
${notesContent.slice(0, 6000)}
"""

Görev: Bu notları ve konuyu temel alarak, kullanıcının bu konuyu GERÇEKTEN anlayıp anlamadığını ölçecek 3-5 kısa cevaplı, düşündürücü soru hazırla. Sorular hem notlarda yazılanları hem de konunun genel bilgisini kapsamalı — sadece notu ezbere okuyup cevaplanamayacak, gerçek anlayış gerektiren sorular olsun.

Sadece JSON döndür. Türkçe yaz.`;

  return callGemini(prompt, QUIZ_SCHEMA);
};

const FLASHCARDS_SCHEMA = {
  type: 'object',
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' }
        },
        required: ['question', 'answer']
      }
    }
  },
  required: ['cards']
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Quiz'ten farklı olarak burada KISA, atomik soru-cevap çiftleri istenir (aralıklı
// tekrar/spaced-repetition kartı olarak kullanılacak — uygulamanın var olan
// [card: soru || cevap] [srs: ...] söz dizimine yazılıp mevcut Ezber Kartları
// (SRS) sistemine (bkz. FlashcardView.tsx) otomatik dahil olur, ayrı bir depolama
// gerekmez).
export const generateFlashcards = async (
  topicTitle: string,
  topicDescription: string,
  notesContent: string
): Promise<{ cards: { question: string; answer: string }[] }> => {
  const prompt = `Sen aralıklı tekrar (spaced repetition) kartları hazırlayan bir mentorsün. Konu: "${topicTitle}" (${topicDescription}).

Kullanıcının bu konu altında aldığı notlar:
"""
${notesContent.slice(0, 6000)}
"""

Görev: Bu notlardan, ezber/hatırlama amaçlı 5-8 KISA soru-cevap kartı üret. Her kart TEK bir atomik bilgiyi test etmeli (uzun deneme sorusu DEĞİL) — soru kısa ve net, cevap birkaç kelime ile 1-2 cümle arasında olmalı. Notlarda geçen gerçek terim/tanım/örnekleri kullan, uydurma bilgi ekleme.

Sadece JSON döndür. Türkçe yaz.`;

  return callGemini(prompt, FLASHCARDS_SCHEMA);
};

const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    feedback: { type: 'string' },
    weakAreas: { type: 'array', items: { type: 'string' } }
  },
  required: ['passed', 'feedback']
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// feedback her zaman yapıcı ve teşvik edici olacak şekilde iste — geçilirse tebrik,
// geçilmezse nazik yönlendirme (kullanıcının motivasyonunu kırmadan gerçek bir mentor gibi).
// weakAreas: genel feedback metninden AYRI olarak, hangi ALT-KONU/KAVRAMLARIN eksik/yanlış
// anlaşıldığını kısa madde başlıkları halinde döndürür (ör. "Closure kavramı", "async/await
// hata yönetimi") — böylece kullanıcı SADECE "eksiklerin var" değil, TAM OLARAK neyi tekrar
// çalışması gerektiğini görür. Her şey doğruysa veya belirtilecek somut bir eksik yoksa boş
// dizi döner.
export const gradeQuiz = async (
  topicTitle: string,
  qa: { question: string; answer: string }[]
): Promise<{ passed: boolean; feedback: string; weakAreas?: string[] }> => {
  const qaText = qa.map((x, i) => `Soru ${i + 1}: ${x.question}\nCevap: ${x.answer}`).join('\n\n');
  const prompt = `Sen "${topicTitle}" konusunda bir sınav değerlendiricisisin.

${qaText}

Görev: Cevapları değerlendir. Kullanıcı konuyu genel olarak yeterince anlamışsa passed=true yap. Anlayışta ciddi eksik/yanlış varsa passed=false yap. feedback alanına kısa (2-4 cümle), yapıcı ve TEŞVİK EDİCİ bir geri bildirim yaz — geçtiyse tebrik et, geçmediyse nazikçe hangi noktaların eksik olduğunu söyle ve cesaretlendir, asla küçümseyici olma. Ayrıca weakAreas alanına, cevaplardan anlaşılan eksik/yanlış anlaşılmış SPESİFİK alt-konu veya kavramları kısa madde başlıkları (2-5 kelime) halinde listele (ör. "Closure kavramı", "Event loop sıralaması") — genel/belirsiz ifadeler değil, kullanıcının doğrudan "şunu tekrar çalış" diyebileceği somut başlıklar olsun. Her şey zaten iyiyse weakAreas'ı boş dizi yap.

Sadece JSON döndür. Türkçe yaz.`;

  return callGemini(prompt, GRADE_SCHEMA);
};

const CATEGORY_OPTIONS = ['Market', 'Fatura', 'Ulaşım', 'Eğlence', 'Sağlık', 'Giyim', 'Eğitim', 'Kira', 'Abonelik', 'Diğer'];

const EXPENSE_CATEGORY_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: CATEGORY_OPTIONS }
  },
  required: ['category']
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Harcama girişini (FinanceView.tsx) sabit bir kategori listesinden birine sınıflandırır —
// serbest metin yerine ENUM kullanılıyor ki sonuçlar tutarlı olsun ve "Kategoriye Göre
// Dağılım" grafiğinde gruplanabilsin. Tek, küçük, ucuz bir sınıflandırma çağrısıdır.
export const categorizeExpense = async (
  description: string,
  location: string
): Promise<{ category: string }> => {
  const prompt = `Bir harcama kaydını şu sabit kategorilerden BİRİNE sınıflandır: ${CATEGORY_OPTIONS.join(', ')}.

Harcama açıklaması: "${description}"
Yer/market bilgisi: "${location || 'belirtilmedi'}"

Sadece JSON döndür (category alanına yukarıdaki listeden BİREBİR bir değer yaz).`;

  return callGemini(prompt, EXPENSE_CATEGORY_SCHEMA);
};

const DATE_EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    date: { type: 'string' },
    time: { type: 'string' }
  },
  required: ['found']
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Hızlı Not Fabrikası'na yazılan serbest metinden ("yarın öğlen doktor randevusu" gibi)
// [due:YYYY-MM-DD] / [time:HH:MM-HH:MM] etiketlerini otomatik çıkarır. `todayISO` referans
// olarak verilir ki "yarın"/"gelecek hafta" gibi göreli ifadeler doğru tarihe çevrilsin.
// `time` alanı yalnızca metinde açık bir saat/saat aralığı geçiyorsa doldurulur; sadece
// tarih varsa boş bırakılır.
export const extractDateFromText = async (
  text: string,
  todayISO: string
): Promise<{ found: boolean; date?: string; time?: string }> => {
  const prompt = `Bugünün tarihi: ${todayISO} (YYYY-MM-DD).

Şu serbest metinde bir tarih veya zaman ifadesi (ör. "yarın", "gelecek hafta salı", "öğlen", "14:00'te") var mı tespit et: "${text}"

Görev: Metinde net bir tarih/zaman ifadesi varsa found=true yap, date alanına YYYY-MM-DD formatında kesin tarihi (göreli ifadeleri bugünün tarihine göre hesaplayarak) yaz. Metinde ayrıca belirgin bir saat/saat aralığı da varsa time alanına HH:MM-HH:MM formatında yaz (ör. "öğlen" için 12:00-13:00, sadece "14:00" için 14:00-15:00); saat belirtilmemişse time alanını boş bırak. Metinde HİÇBİR tarih/zaman ipucu yoksa found=false yap ve diğer alanları boş bırak.

Sadece JSON döndür.`;

  return callGemini(prompt, DATE_EXTRACT_SCHEMA);
};

const NOTE_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } }
  },
  required: ['summary', 'tags']
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Not editöründeki "Özetle" butonu için: notun içeriğinden kısa bir özet VE mevcut
// etiketlerle tutarlı 2-4 etiket önerisi üretir. `existingTags`, uygulamada zaten
// kullanılan etiketleri gösterir ki AI mümkün olduğunca YENİ, alakasız etiketler
// uydurmak yerine var olanlarla eşleşen/tutarlı öneriler yapsın.
export const summarizeNoteAndSuggestTags = async (
  content: string,
  existingTags: string[]
): Promise<{ summary: string; tags: string[] }> => {
  const existingTagsText = existingTags.length
    ? `\n\nUygulamada zaten kullanılan etiketler (mümkünse bunlarla tutarlı/eşleşen öneriler yap, ama konuya uymuyorsa yeni bir etiket önermekten çekinme): ${existingTags.join(', ')}`
    : '';

  const prompt = `Aşağıdaki notu oku:
"""
${content.slice(0, 8000)}
"""${existingTagsText}

Görev: 1) summary alanına notun 2-4 cümlelik, öz ve bilgilendirici bir özetini yaz (notu tekrar etmek yerine gerçekten sıkıştırılmış bir özet olsun). 2) tags alanına bu notun konusunu iyi yansıtan 2-4 kısa etiket öner (# işareti OLMADAN, küçük harf, tek kelime veya kısa tire'li ifade, ör. "yazilim", "toplanti-notlari").

Sadece JSON döndür. Türkçe yaz.`;

  return callGemini(prompt, NOTE_SUMMARY_SCHEMA);
};

const WEEKLY_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' }
  },
  required: ['summary']
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Dashboard'daki haftalık özet kartı için: ham istatistikleri (not başlıkları, görev
// sayıları) tek bir doğal dil paragrafına çevirir. Maliyeti düşük tutmak için bu haftada
// yalnızca BİR KEZ çağrılır ve sonucu App.tsx tarafında haftaya göre önbelleğe alınır
// (bkz. DashboardView.tsx weekly_summary_cache).
export const generateWeeklySummary = async (
  activityDigest: string
): Promise<{ summary: string }> => {
  const prompt = `Kullanıcının bu haftaki not alma/görev aktivitesinin ham özeti:
"""
${activityDigest.slice(0, 4000)}
"""

Görev: Bu ham veriyi, kullanıcıya "bu hafta ne yaptın" diye anlatan, samimi ve motive edici TEK bir paragraf (3-5 cümle) doğal dil özetine çevir. Hangi konularda ilerlediğini, ne kadar üretken olduğunu vurgula. Ham veriyi madde madde tekrar etme, gerçek bir özet/anlatı ol. Kullanıcıya doğrudan hitap et ("bu hafta ... yaptın" gibi).

Sadece JSON döndür. Türkçe yaz.`;

  return callGemini(prompt, WEEKLY_SUMMARY_SCHEMA);
};

const SUMMARY_EVAL_SCHEMA = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    feedback: { type: 'string' }
  },
  required: ['approved', 'feedback']
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// "Test Et" ÖNCESİ bir ön koşul: kullanıcı konu notunun sonuna kendi cümleleriyle bir
// özet yazar, bu özet konuyu (ve kullanıcının kendi notlarını) gerçekten doğru ve
// yeterince kapsayıcı şekilde özetliyorsa onaylanır — bu, kullanıcının o konuya
// GERÇEKTEN çalıştığının ilk kanıtıdır. Onaylanmadan quiz açılmaz (bkz. App.tsx
// handleSubmitTopicSummary / summaryApproved alanı).
export const evaluateSummary = async (
  topicTitle: string,
  topicDescription: string,
  notesContent: string,
  summaryText: string
): Promise<{ approved: boolean; feedback: string }> => {
  const prompt = `Sen "${topicTitle}" (${topicDescription}) konusunda bir mentorsün.

Kullanıcının bu konu altında aldığı notlar:
"""
${notesContent.slice(0, 6000)}
"""

Kullanıcının kendi cümleleriyle yazdığı ÖZET:
"""
${summaryText.slice(0, 3000)}
"""

Görev: Bu özetin, konuyu (ve kendi notlarını) GERÇEKTEN doğru ve yeterince kapsayıcı şekilde özetleyip özetlemediğini değerlendir — kelimesi kelimesine kopyalama değil, gerçek anlayışı yansıtan bir özet olmalı. Yeterince iyiyse approved=true yap. Çok yüzeysel, eksik veya yanlışsa approved=false yap. feedback alanına kısa (2-3 cümle), yapıcı ve TEŞVİK EDİCİ bir geri bildirim yaz — onaylandıysa kısaca neyi iyi yakaladığını söyle, onaylanmadıysa nazikçe neyin eksik olduğunu söyle ve cesaretlendir, asla küçümseyici olma.

Sadece JSON döndür. Türkçe yaz.`;

  return callGemini(prompt, SUMMARY_EVAL_SCHEMA);
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Seviye atlama kutlaması ŞABLONLA (API çağrısı olmadan) üretilir — ücretsiz, güvenilir,
// ve Faz 1'deki rankUpCelebration mekanizmasıyla aynı desende.
export const buildLevelUpMessage = (domainLabel: string, newLevelTitle: string): string => {
  return `${domainLabel} yolunda yeni seviye: ${newLevelTitle}. Buraya kadar gösterdiğin emek gerçek — devam et!`;
};
