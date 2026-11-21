// Uygulama asistanı: isteği (a) bir soruya cevap, (b) ekran açma, (c) notu tasarlama, (d) hatırlatma, (e) otomasyon, (f) sayfadaki düğmelerle işlem
// eylemlerinden birine çevirir. Asistan KENDİLİĞİNDEN hiçbir şey yazmaz/silmez: her eylem kullanıcıya bir "onay kartı" olarak sunulur.
// Burada yalnızca saf mantık vardır (istem kurma, yanıtı doğrulama); ağ çağrısı callGemini zinciri üzerinden dışarıdan verilir (test edilebilir).
import { callGemini } from '../geminiMentor';
import { redactSensitive } from '../budget';
import { parseSched, validTime, type Sched, type Eylem } from './automation';
import { cleanPairs } from './assistantTools';
import { foldTr, matchStatus, sanitizeName, DEFAULT_STATUS_COLS, type StatusCol } from './projectOps';

export interface Screen { id: string; ad: string; ozet: string }
// Ekran kimlikleri uygulamanın menüsündeki kimliklerle birebir aynıdır (App.tsx titlebar). Ayrıntı yazılmayan ekranlar için yalnızca adına dayalı kısa tanım var:
// asistan, rehberde olmayan ayrıntıyı UYDURMAMALI (istemde böyle yazılı).
export const SCREENS: Screen[] = [
  { id: 'notes', ad: 'Notlar', ozet: 'Notları yazıp düzenlersiniz. Satıra "/" yazınca menü açılır: görev listesi, madde işareti, başlık, kutu (callout), tablo, 2-3 kolonlu bölüm vb. Başlık rengi: "# Başlık [color:blue]".' },
  { id: 'notfactory', ad: 'Hızlı Giriş', ozet: 'Hızlı not/görev girişi.' },
  { id: 'dashboard', ad: 'Gösterge Paneli', ozet: 'Genel durum özeti.' },
  { id: 'inbox', ad: 'Gelen Kutusu', ozet: 'Hızlıca atılan notlar ve görevler burada toplanır.' },
  { id: 'tasks', ad: 'Görev Havuzu', ozet: 'Notlardaki "- [ ]" görevleri toplar.' },
  { id: 'timeline', ad: 'Zaman Akışı', ozet: 'Olayların zaman çizelgesi.' },
  { id: 'calendar', ad: 'Takvim Planlayıcı', ozet: 'Görevleri takvimde planlarsınız.' },
  { id: 'projects', ad: 'Proje Yönetimi', ozet: 'Projeler ve panolar.' },
  { id: 'library', ad: 'Kütüphane', ozet: 'Kütüphane.' },
  { id: 'finance', ad: 'Finans', ozet: 'Gelir/gider kayıtları.' },
  { id: 'budget', ad: 'Bütçe Planı', ozet: 'Aylık bütçe: üstte kalan özeti, sekmeler (Genel, Kalemler, Harcamalar, Kartsız yaşam, Öneriler). "Finans uzmanı" düğmesi sohbeti açar; sohbette kart ekstresi PDF\'i ataçla eklenir. Kartsız yaşam sekmesinde yol haritası, taksitler, "alabilir miyim?", abonelikler ve karne vardır.' },
  { id: 'shopping', ad: 'Alışveriş', ozet: 'Canlı alışveriş listesi (telefon widget\'ıyla aynı not), ürün seçme ve en uygun fiyatla marketlere bölme, tercihler ve boykot listesi, hedef fiyat uyarısı.' },
  { id: 'efor', ad: 'Efor', ozet: 'Efor/süre takibi.' },
  { id: 'hunter', ad: 'Hunter Sistemi', ozet: 'Oyunlaştırma.' },
  { id: 'language', ad: 'Dil Atölyesi', ozet: 'Dil çalışması.' },
  { id: 'diary', ad: 'Günlük', ozet: 'Günlük yazısı.' },
  { id: 'assistant', ad: 'Asistan', ozet: 'Brifing, dışarı işler ve proje radarı gibi AI araçları.' },
  { id: 'develop', ad: 'Geliştir', ozet: 'Uygulamayı Claude Code ile uygulama içinden geliştirme; birleştirme ve yayın düğmeleri yalnızca kullanıcıya aittir.' },
  { id: 'db', ad: 'Depo', ozet: 'Veritabanı görünümü.' },
  { id: 'srs', ad: 'Ezber Kartları', ozet: 'Aralıklı tekrar kartları.' },
  { id: 'city', ad: 'Not Şehri', ozet: 'Notlardan şehir oyunu.' },
  { id: 'ambient', ad: 'Ortam Sesleri', ozet: 'Ortam sesleri.' },
  { id: 'forge', ad: 'Sentez Tezgahı', ozet: 'Notları birleştirip sentezleme.' },
  { id: 'mentor', ad: 'Not Mentörü', ozet: 'Notlar için AI mentörü.' },
  { id: 'aichat', ad: 'Notlarımla Sohbet', ozet: 'Notlarınızla yapay zekâ sohbeti.' },
  { id: 'adventure', ad: 'Dakiklik Pusulası', ozet: 'Dakiklik takibi.' },
  { id: 'analytics', ad: 'Verimlilik Analizi', ozet: 'Verimlilik grafikleri.' },
  { id: 'browser', ad: 'Web Araştırma', ozet: 'Uygulama içi tarayıcı.' },
  { id: 'music', ad: 'Müzik Kutusu', ozet: 'Müzik çalar.' }
];
export const screenById = (id: string): Screen | undefined => SCREENS.find(s => s.id === id);

export type ActionKind = 'git' | 'notu_tasarla' | 'hatirlat' | 'otomasyon' | 'ui' | 'gorev' | 'proje_ac' | 'gorevler' | 'gorev_tasi' | 'gorev_gun' | 'alisveris' | 'finans' | 'butce' | 'gunluk' | 'not_sor' | 'kart_uret' | 'kart_ekle' | 'inbox_ayir' | 'kelime_ekle' | 'alisveris_al';
export interface AAction {
  tur: ActionKind;
  ekran?: string;                 // git / otomasyon(ac)
  talimat?: string;               // notu_tasarla / ui
  baslik?: string; mesaj?: string; // hatirlat / otomasyon(bildir)
  tarih?: string; saat?: string;   // hatirlat / gorev (saat = başlangıç)
  bitis?: string;                  // gorev: bitiş saati (saat varsa)
  proje?: string;                  // gorev: eşleşen proje notunun adı (varsa görev o notun sonuna yazılır)
  tekrar?: 'daily' | 'weekly' | 'monthly'; // gorev: [repeat:] etiketi
  soru?: string; kartlar?: { s: string; c: string }[]; // not_sor / kart_ekle
  tutar?: number; finTur?: string; kategori?: string; // finans / butce
  butceTur?: string; gun?: number; metin?: string; // butce kalemi / gunluk yazısı
  musteri?: string; musteriIstek?: string; // proje_ac: eşleşen müşteri adı / eşleşmeyen istenen ad
  basliklar?: string[];            // gorevler: eklenecek görev başlıkları
  hedef?: string; mevcut?: string; // gorev_tasi: hedef durum anahtarı / (varsa) şu anki durum
  projeIstek?: string;             // gorev: kullanıcının söylediği ama hiçbir projeyle eşleşmeyen ad (uyarı için)
  ad?: string; sched?: Sched; eylem?: Eylem; // otomasyon
}
export interface RouterResult { cevap: string; eylemler: AAction[] }
export interface AssistantCtx { tab: string; noteOpen: boolean; notePath?: string; now: Date; projeler?: string[]; musteriler?: string[]; durumlar?: StatusCol[]; finKategoriler?: string[]; butceOzet?: string; verimOzet?: string; gunOzet?: string }
export interface ChatTurn { role: 'user' | 'ai'; text: string }

export const ROUTER_SCHEMA = {
  type: 'object',
  properties: {
    cevap: { type: 'string' },
    eylemler: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tur: { type: 'string' }, ekran: { type: 'string' }, talimat: { type: 'string' }, baslik: { type: 'string' }, mesaj: { type: 'string' },
          tarih: { type: 'string' }, saat: { type: 'string' }, bitis: { type: 'string' }, proje: { type: 'string' }, musteri: { type: 'string' }, tekrar: { type: 'string' }, soru: { type: 'string' }, kartlar: { type: 'array', items: { type: 'object', properties: { s: { type: 'string' }, c: { type: 'string' } } } }, tutar: { type: 'number' }, finTur: { type: 'string' }, kategori: { type: 'string' }, butceTur: { type: 'string' }, gun: { type: 'number' }, metin: { type: 'string' }, hedef: { type: 'string' }, mevcut: { type: 'string' }, basliklar: { type: 'array', items: { type: 'string' } }, ad: { type: 'string' }, zamanlama: { type: 'string' }, eylemTuru: { type: 'string' }
        },
        required: ['tur']
      }
    }
  },
  required: ['cevap', 'eylemler']
};

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const GUN = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

export const buildRouterPrompt = (o: { ctx: AssistantCtx; history: ChatTurn[]; message: string }): string => {
  const cur = screenById(o.ctx.tab);
  const screens = SCREENS.map(s => `- ${s.id} = ${s.ad}: ${s.ozet}`).join('\n');
  const hist = o.history.slice(-6).map(m => `${m.role === 'user' ? 'Kullanıcı' : 'Asistan'}: ${redactSensitive(m.text).slice(0, 300)}`).join('\n');
  return `Sen "Ultimate NoteFactory" uygulamasının içindeki yardımcı asistansın. Kullanıcı uygulamayı kullanırken sana soru sorar ya da bir işi yaptırır. Kısa, sıcak, net Türkçe konuş (en çok 4 cümle).

BUGÜN: ${ymd(o.ctx.now)} (${GUN[o.ctx.now.getDay()]}), saat ${String(o.ctx.now.getHours()).padStart(2, '0')}:${String(o.ctx.now.getMinutes()).padStart(2, '0')}
ŞU AN AÇIK EKRAN: ${cur ? `${cur.id} (${cur.ad})` : o.ctx.tab}${o.ctx.noteOpen ? `; bir not açık${o.ctx.notePath ? ` (${o.ctx.notePath.split('/').pop()})` : ''}` : ''}

PROJELER (görev eklerken proje adı): ${(o.ctx.projeler || []).slice(0, 60).join(', ') || '(yok)'}
MUSTERILER: ${(o.ctx.musteriler || []).slice(0, 60).join(', ') || '(yok)'}
FINANS KATEGORILERI: ${(o.ctx.finKategoriler || []).join(', ') || '(yok)'}
BUTCE OZETI (bu ay): ${o.ctx.butceOzet || '(bütçe notu yok)'}
GUN OZETI (bugün): ${o.ctx.gunOzet || '(yok)'}
VERIMLILIK OZETI (son 14 gün): ${o.ctx.verimOzet || '(yok)'}
DURUMLAR (anahtar=ad): ${(o.ctx.durumlar || DEFAULT_STATUS_COLS).map(d => `${d.key}=${d.title}`).join(', ')}

EKRANLAR (kimlik = ad: ne işe yarar). Buradaki bilgi dışında ayrıntıyı UYDURMA; bilmiyorsan "bu ekranın ayrıntısını bilmiyorum, açayım mı?" de:
${screens}

YAPABİLECEĞİN EYLEMLER ("eylemler" dizisi; gerekmiyorsa boş bırak; en çok 3):
1. tur="git", ekran=<ekran kimliği>: kullanıcıyı o ekrana götürür. Nasıl yapılır sorularında cevabı yaz VE ilgili ekrana git eylemi ekle.
2. tur="notu_tasarla", talimat=<kullanıcının tasarım/biçim isteği, kendi cümleleriyle>: YALNIZCA bir not açıkken ve kullanıcı o notun görünümünü/düzenini/içeriğini değiştirmek istiyorsa ("başlığı mavi yap", "altını 3 sütuna böl", "şunu ekle", "tabloya çevir").
3. tur="hatirlat", baslik, tarih (YYYY-MM-DD, bugüne göre hesapla), saat (HH:MM 24 saat): tek seferlik hatırlatma/alarm. Tarih/saat belirsizse eylem ekleme, cevapta sor.
4. tur="otomasyon", ad, zamanlama ("her-gun 08:30" | "haftalik pzt 09:00" | "aylik 5 09:00" | "bir 2026-12-01 09:00"; gün adları pzt sal car per cum cmt paz), eylemTuru ("bildir" ya da "ac"), baslik (bildir için), ekran (ac için ekran kimliği), mesaj (isteğe bağlı): tekrarlayan kural. Kural yalnızca bildirim gösterir ya da bir ekranı açar.
6. tur="gorev", baslik, tarih (YYYY-MM-DD, bugüne göre hesapla), saat (HH:MM 24 saat, isteğe bağlı), bitis (HH:MM, isteğe bağlı), proje (isteğe bağlı): Takvime/Görev Havuzu'na yeni GÖREV ekler. "Takvime ekle", "görev ekle", "yapılacak olarak yaz", "toplantı/iş planla" gibi isteklerde bunu kullan; saat verilmediyse saat/bitis'i boş bırak. Kullanıcı saat aralığı söylediyse ("13 14 arası", "13-14", "13:00'dan 14:00'a kadar") MUTLAKA saat="13:00", bitis="14:00" gibi ikisini de doldur; yalnızca başlangıç verildiyse bitis'i boş bırak (1 saat sayılır). Alarm/bildirim istenirse ("hatırlat") 3'ü kullan, görev için 6'yı. Kullanıcı bir projeyi andıysa ("Datahub projesine ekle") proje alanına PROJELER listesindeki adı AYNEN yaz; listede yoksa kullanıcının söylediği adı yaz. Proje söylemediyse proje'yi boş bırak. Birden çok proje eşit derecede uyuyorsa eylem ekleme, cevapta hangisi olduğunu sor. Tarih belirsizse eylem ekleme, cevapta sor. Görev düzenli tekrar ediyorsa ("her pazartesi", "her gün", "her ay") tekrar="weekly"|"daily"|"monthly" yaz ve tarih'e İLK uygulanacak günü ver.
7. tur="proje_ac", musteri (MUSTERILER listesindeki ad AYNEN; yoksa kullanıcının söylediği ad), ad (yeni projenin adı): bir müşterinin altına yeni proje açar ("Zorlu müşterisinin altına Datahub projesi aç").
8. tur="gorevler", proje (PROJELER'deki ad AYNEN; proje söylenmediyse boş), basliklar (dizi: her görev AYRI ve kısa bir başlık), tarih (YYYY-MM-DD, yalnızca kullanıcı söylediyse): bir projeye (ya da proje yoksa Gelen Kutusu'na) BİRDEN ÇOK görev ya da tarih/saat gerekmeyen görevler ekler ("Datahub'a şunları ekle: baklava, sütlaç"). Tek ve tarihli/saatli iş için 6'yı kullan.
9. tur="gorev_tasi", baslik (taşınacak görevin başlığı, kullanıcının dediği gibi), proje (söylendiyse PROJELER'deki ad), mevcut (kullanıcı "şu durumdaki" dediyse DURUMLAR anahtarı), hedef (DURUMLAR anahtarı): var olan bir görevin durumunu değiştirir ("Devam Ediyor'daki sütlaç görevini Bitti'ye al"). Görevi sen bulma, yalnızca bu alanları doldur.
10. tur="alisveris", basliklar (dizi: ürünler, her biri AYRI ve kısa), kategori (isteğe bağlı: Market, Araç, Ev, Kişisel, Diğer): Alışveriş listesine YENİ ürün ekler ("listeye süt yumurta ekle"). Kullanıcı bir şeyi ALDIĞINI söylüyorsa ("aldım", "aldık", "bitti") bunu KULLANMA, 20'yi kullan.
11. tur="finans", tutar (sayı, TL), finTur ("gider" ya da "gelir"), kategori (FINANS KATEGORILERI'nden biri AYNEN; uymuyorsa en yakınını), baslik (kısa açıklama, isteğe bağlı), tarih (YYYY-MM-DD; söylenmediyse bugün): Finans ekranına tek bir harcama/gelir kaydı ekler ("markete 450 TL harcadım"). Tutar belirsizse eylem ekleme, sor.
12. tur="butce", baslik (kalem adı), tutar (sayı, TL), butceTur ("gelir", "sabit" ya da "degisken"), gun (ayın günü, isteğe bağlı): Bu ayın Bütçe Planı'na kalem ekler ("her ay 15'inde Netflix 230 TL sabit gider"). "Kalan bütçem ne?" gibi SORULARI eylemsiz, BUTCE OZETI'ne bakarak cevapta yanıtla; özet yoksa bütçe notu olmadığını söyle, sayı uydurma.
13. tur="gunluk", metin (günlüğe yazılacak cümle(ler), kullanıcının dediği gibi), tarih (YYYY-MM-DD; söylenmediyse bugün): Günlük ekranına o güne not düşer.
14. tur="gorev_gun", baslik (taşınacak görevin başlığı), proje (söylendiyse), tarih (YYYY-MM-DD, yeni gün): var olan bir görevi başka güne alır ("yarınki toplantıyı cumaya al"). Görevi sen bulma.
15. tur="not_sor", soru (kullanıcının sorusu, kendi cümleleriyle): kullanıcı KENDİ NOTLARINDAKİ bilgiyi soruyorsa ("Zorlu toplantısında ne konuşmuştuk?", "şu konuda notlarımda ne yazıyor?"). Uygulama notları arayıp cevabı kendisi yazar; sen cevap uydurma, cevapta sadece "Notlarına bakıyorum" de.
16. tur="kart_uret", talimat (isteğe bağlı): AÇIK NOTUN içeriğinden ezber kartı üretir ("bu nottaki kelimelerden kart üret"). Not açık değilse eylem ekleme, cevapta notu açmasını söyle.
17. tur="kart_ekle", kartlar (dizi: {s: soru, c: cevap}): kullanıcının kendi verdiği kartları ekler ("'ephemeral = geçici' kelimesini karta ekle").
18. tur="inbox_ayir": Gelen Kutusu'ndaki projesiz görevleri projelere dağıtmayı önerir ("gelen kutumu düzenle/projelere ayır"). Alan gerekmez.
19. tur="kelime_ekle", kartlar (dizi: {s: kelime, c: anlamı}): Dil Atölyesi kelime listesine kelime ekler ("'ephemeral' kelimesini dil atölyesine ekle").
"Bugün ne var?", "günümü özetle" gibi sorularda eylem ekleme; GUN OZETI'ne bakıp cevapta kısaca özetle, sayı/görev uydurma.
Verimlilik/üretkenlik soruları ("geçen haftaya göre nasıldım?") için eylem ekleme; VERIMLILIK OZETI'ne bakıp cevapta kısaca yorumla, özet yoksa söyle, sayı uydurma.
20. tur="alisveris_al", basliklar (dizi: alınan ürünler, kısa), kategori (söylendiyse nereden/hangi bölüm: "e-bebek", "market"; yoksa boş): Alışveriş listesinde ZATEN olan maddeyi alındı olarak işaretler ("e-bebekten bulaşık deterjanı aldım"). Yeni madde EKLEMEZ.
5. tur="ui", talimat: kullanıcı sayfadaki düğmelerle/alanlarla bir işlemi SENİN yapmanı istiyorsa ("Bütçe'ye şu kalemi ekle", "şu ayarı aç"). Not içeriği için 2'yi kullan, 5'i değil. Takvime/görev listesine görev eklemek için 5'i KULLANMA, 6'yı kullan.
KURALLAR: Silme, gönderme, yayınlama, ödeme gibi işlemleri yapma teklif etme (kullanıcıya nasıl yapacağını anlat). Kişisel/gizli bilgi isteme. Eylem eklediysen "cevap"ta ne yapacağını kısaca söyle; kullanıcı onay kartıyla onaylayacak.
${hist ? `\nSOHBET:\n${hist}\n` : ''}
KULLANICININ MESAJI:
${redactSensitive(o.message).slice(0, 1500)}

Sadece JSON döndür.`;
};

const str = (v: unknown, n: number) => String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// "13", "13.30", "13:00:00" → "13:00"; geçersizse ''.
const normTime = (v: string): string => {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(?:[:.]\d{2})?$/.exec(v.trim());
  if (!m) return '';
  const t = `${m[1].padStart(2, '0')}:${m[2] ?? '00'}`;
  return validTime(t) ? t : '';
};
// saat alanında aralık ("13:00-14:00") gelmişse bölünür; bitis ayrıca verilmişse o kullanılır.
const parseTimeRange = (saat: string, bitis: string): [string, string] => {
  const range = /^(.+?)\s*(?:-|–|—|\/| ile )\s*(.+)$/.exec(saat);
  if (range && !bitis) return [normTime(range[1]), normTime(range[2])];
  return [normTime(saat), normTime(bitis)];
};

// Kullanıcının söylediği proje adını listedeki bir projeyle eşler: önce birebir, sonra "içerir" (tek aday varsa). Belirsizse '' döner.
export const matchProject = (istek: string, projeler: string[]): string => {
  const q = foldTr(istek).replace(/\s*proje(si|ye|de|yi|nin)?$/, '').trim();
  if (!q) return '';
  const exact = projeler.filter(p => foldTr(p) === q);
  if (exact.length === 1) return exact[0];
  const part = projeler.filter(p => { const f = foldTr(p); return f.includes(q) || (f.length >= 4 && q.includes(f)); });
  return part.length === 1 ? part[0] : '';
};

export const normalizeRouter = (raw: any, ctx: AssistantCtx): RouterResult => {
  const out: AAction[] = [];
  for (const a of Array.isArray(raw?.eylemler) ? raw.eylemler : []) {
    const tur = str(a?.tur, 20) as ActionKind;
    if (tur === 'git') {
      if (screenById(str(a.ekran, 20))) out.push({ tur, ekran: str(a.ekran, 20) });
    } else if (tur === 'notu_tasarla') {
      if (ctx.noteOpen && str(a.talimat, 600)) out.push({ tur, talimat: str(a.talimat, 600) });
    } else if (tur === 'hatirlat') {
      const tarih = str(a.tarih, 12), saat = str(a.saat, 6), baslik = str(a.baslik, 80);
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(tarih) && validTime(saat) && baslik;
      if (ok) {
        const [y, m, d] = tarih.split('-').map(Number), [h, mi] = saat.split(':').map(Number);
        if (new Date(y, m - 1, d, h, mi).getTime() > ctx.now.getTime() - 60_000) out.push({ tur, baslik, tarih, saat, mesaj: str(a.mesaj, 160) || undefined });
      }
    } else if (tur === 'otomasyon') {
      const sched = parseSched(str(a.zamanlama, 40));
      const ad = str(a.ad, 60);
      const et = str(a.eylemTuru, 10).toLowerCase();
      if (sched && ad) {
        if (et === 'ac' && screenById(str(a.ekran, 20))) out.push({ tur, ad, sched, eylem: { tur: 'ac', ekran: str(a.ekran, 20), mesaj: str(a.mesaj, 160) || undefined } });
        else if (et === 'bildir' && str(a.baslik, 80)) out.push({ tur, ad, sched, eylem: { tur: 'bildir', baslik: str(a.baslik, 80), mesaj: str(a.mesaj, 160) || undefined } });
      }
    } else if (tur === 'gorev') {
      const tarih = str(a.tarih, 12), baslik = str(a.baslik, 120);
      // Model saati "13", "13.00", "13:00:00" ya da "13:00-14:00" gibi değişik biçimlerde döndürebiliyor; geçerli HH:MM'e çevrilir.
      // Aksi halde görev saatsiz ("tüm gün") eklenip takvimde doğru saate düşmüyordu.
      let [saat, bitis] = parseTimeRange(str(a.saat, 20), str(a.bitis, 20));
      if (saat && !validTime(bitis)) { const [h, mi] = saat.split(':').map(Number); bitis = `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(mi).padStart(2, '0')}`; }
      if (saat && bitis <= saat) bitis = '23:59';
      // Geçmiş güne görev eklenmez: model tarihi yanlış hesapladıysa kullanıcı kartı görüp düzeltsin diye eylem düşer, cevapta sorulur.
      const istek = str(a.proje, 60);
      const proje = istek ? matchProject(istek, ctx.projeler || []) : '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(tarih) && baslik && tarih >= ymd(ctx.now)) out.push({ tur, baslik, tarih, saat: saat || undefined, bitis: bitis || undefined, tekrar: (['daily', 'weekly', 'monthly'] as const).find(x => x === str(a.tekrar, 10)), proje: proje || undefined, projeIstek: istek && !proje ? istek : undefined });
    } else if (tur === 'proje_ac') {
      const ad = sanitizeName(str(a.ad, 60)), istek = str(a.musteri, 60);
      const musteri = istek ? matchProject(istek, ctx.musteriler || []) : '';
      if (ad && istek) out.push({ tur, ad, musteri: musteri || undefined, musteriIstek: musteri ? undefined : sanitizeName(istek) });
    } else if (tur === 'gorevler') {
      const basliklar = (Array.isArray(a.basliklar) ? a.basliklar : []).map((b: unknown) => str(b, 120)).filter(Boolean).slice(0, 15);
      const tarih = str(a.tarih, 12), istek = str(a.proje, 60);
      const proje = istek ? matchProject(istek, ctx.projeler || []) : '';
      if (basliklar.length) out.push({ tur, basliklar, tarih: /^\d{4}-\d{2}-\d{2}$/.test(tarih) ? tarih : undefined, proje: proje || undefined, projeIstek: istek && !proje ? istek : undefined });
    } else if (tur === 'gorev_tasi') {
      const cols = ctx.durumlar || DEFAULT_STATUS_COLS;
      const hedef = matchStatus(str(a.hedef, 30), cols), baslik = str(a.baslik, 120), istek = str(a.proje, 60);
      const proje = istek ? matchProject(istek, ctx.projeler || []) : '';
      if (hedef && baslik) out.push({ tur, baslik, hedef, mevcut: matchStatus(str(a.mevcut, 30), cols) || undefined, proje: proje || undefined, projeIstek: istek && !proje ? istek : undefined });
    } else if (tur === 'alisveris') {
      const basliklar = (Array.isArray(a.basliklar) ? a.basliklar : []).map((b: unknown) => str(b, 60)).filter(Boolean).slice(0, 20);
      if (basliklar.length) out.push({ tur, basliklar, kategori: str(a.kategori, 30) || undefined });
    } else if (tur === 'alisveris_al') {
      const basliklar = (Array.isArray(a.basliklar) ? a.basliklar : []).map((b: unknown) => str(b, 60)).filter(Boolean).slice(0, 15);
      if (basliklar.length) out.push({ tur, basliklar, kategori: str(a.kategori, 30) || undefined });
    } else if (tur === 'finans') {
      const tutar = Number(a.tutar), finTur = str(a.finTur, 10) === 'gelir' ? 'gelir' : 'gider', tarih = str(a.tarih, 12);
      const kats = ctx.finKategoriler || [];
      const istek = str(a.kategori, 40), kategori = istek ? matchProject(istek, kats) || istek : '';
      if (Number.isFinite(tutar) && tutar > 0 && tutar < 1e9 && kategori) out.push({ tur, tutar: Math.round(tutar * 100) / 100, finTur, kategori, baslik: str(a.baslik, 80) || undefined, tarih: /^\d{4}-\d{2}-\d{2}$/.test(tarih) ? tarih : ymd(ctx.now) });
    } else if (tur === 'butce') {
      const tutar = Number(a.tutar), baslik = str(a.baslik, 60), g = Math.round(Number(a.gun));
      const bt = str(a.butceTur, 12).replace(/ı/g, 'i');
      const butceTur = bt === 'gelir' ? 'gelir' : bt === 'sabit' ? 'sabit' : bt === 'degisken' ? 'degisken' : '';
      if (Number.isFinite(tutar) && tutar > 0 && tutar < 1e9 && baslik && butceTur) out.push({ tur, baslik, tutar: Math.round(tutar * 100) / 100, butceTur, gun: g >= 1 && g <= 31 ? g : undefined });
    } else if (tur === 'gunluk') {
      const metin = str(a.metin, 600), tarih = str(a.tarih, 12);
      if (metin) out.push({ tur, metin, tarih: /^\d{4}-\d{2}-\d{2}$/.test(tarih) ? tarih : ymd(ctx.now) });
    } else if (tur === 'gorev_gun') {
      const baslik = str(a.baslik, 120), tarih = str(a.tarih, 12), istek = str(a.proje, 60);
      const proje = istek ? matchProject(istek, ctx.projeler || []) : '';
      if (baslik && /^\d{4}-\d{2}-\d{2}$/.test(tarih) && tarih >= ymd(ctx.now)) out.push({ tur, baslik, tarih, proje: proje || undefined, projeIstek: istek && !proje ? istek : undefined });
    } else if (tur === 'not_sor') {
      const soru = str(a.soru, 300);
      if (soru) out.push({ tur, soru });
    } else if (tur === 'kart_uret') {
      if (ctx.noteOpen) out.push({ tur, talimat: str(a.talimat, 200) || undefined });
    } else if (tur === 'kelime_ekle') {
      const kartlar = cleanPairs(a.kartlar);
      if (kartlar.length) out.push({ tur, kartlar });
    } else if (tur === 'kart_ekle') {
      const kartlar = cleanPairs(a.kartlar);
      if (kartlar.length) out.push({ tur, kartlar });
    } else if (tur === 'inbox_ayir') {
      out.push({ tur });
    } else if (tur === 'ui') {
      if (str(a.talimat, 600)) out.push({ tur, talimat: str(a.talimat, 600) });
    }
    if (out.length >= 6) break;
  }
  return { cevap: str(raw?.cevap, 900) || 'Anladım.', eylemler: out };
};

// Güvenlik ağı: model "13 14 arası" gibi bir aralığı görev alanlarına yazmayı unutursa, saat kullanıcının cümlesinden çıkarılır.
export const timeRangeFromText = (msg: string): [string, string] | null => {
  const m = /(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|ile|ve|'?(?:dan|den|tan|ten))?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:arası|arasi|arasında|arasinda|kadar)/i.exec(msg);
  if (!m) return null;
  const a = normTime(`${m[1]}${m[2] ? ':' + m[2] : ''}`), b = normTime(`${m[3]}${m[4] ? ':' + m[4] : ''}`);
  return a && b && b > a ? [a, b] : null;
};

export const askRouter = async (o: { ctx: AssistantCtx; history: ChatTurn[]; message: string }, call: <T>(p: string, s: any) => Promise<T> = callGemini): Promise<RouterResult> => {
  const res = normalizeRouter(await call<any>(buildRouterPrompt(o), ROUTER_SCHEMA), o.ctx);
  const fromText = timeRangeFromText(o.message);
  if (fromText) res.eylemler = res.eylemler.map(a => (a.tur === 'gorev' && !a.saat ? { ...a, saat: fromText[0], bitis: fromText[1] } : a));
  return res;
};

// Hatırlatma: mevcut alarm sistemi (notta "alarm HH:MM" geçen satır) kullanılır; gün, dosya adındaki tarihten gelir.
export const reminderPath = (tarih: string): string => `Hatırlatmalar/${tarih}.md`;
export const reminderLine = (baslik: string, saat: string, mesaj?: string): string => `- [ ] ${str(baslik, 80)}${mesaj ? ` (${str(mesaj, 160)})` : ''} alarm ${saat}`;
export const appendReminder = (existing: string | undefined, tarih: string, baslik: string, saat: string, mesaj?: string): string => {
  const line = reminderLine(baslik, saat, mesaj);
  const base = existing && existing.trim() ? existing.replace(/\s*$/, '\n') : `# Hatırlatmalar ${tarih}\n\n`;
  return base.includes(line) ? base : base + line + '\n';
};

// Görev: Görev Havuzu'nun "yeni görev" ekleme deseniyle aynı — kök inbox.md'ye etiketli checklist satırı. Takvim ve Görev Havuzu tüm notları taradığı için görev anında görünür.
export const TASK_PATH = 'inbox.md';
export const taskLine = (baslik: string, tarih: string | undefined, saat?: string, bitis?: string, projeSlug?: string, tekrar?: string): string =>
  `- [ ] ${str(baslik, 120)}${tarih ? ` [due:${tarih}]` : ''}${saat && bitis ? ` [plannedtime:${saat}-${bitis}]` : ''}${projeSlug ? ` [project:${projeSlug}]` : ''}${tekrar && tarih ? ` [repeat:${tekrar}]` : ''}`;
// Proje notunda görev Proje Yönetimi ile aynı kuralla "[project:slug]" etiketi alır (ProjectsView.addTaskToProject).
export const projectSlug = (name: string): string => name.replace(/\.md$/i, '').toLocaleLowerCase('tr').replace(/\s+/g, '-');
export const appendTask = (existing: string | undefined, baslik: string, tarih: string | undefined, saat?: string, bitis?: string, projeSlug?: string, tekrar?: string): string => {
  const line = taskLine(baslik, tarih, saat, bitis, projeSlug, tekrar);
  const base = existing && existing.trim() ? existing.replace(/\s*$/, '\n') : '';
  return base.includes(line) ? base : base + line + '\n';
};

// Alarm listesi: Hatırlatmalar/<tarih>.md içindeki "- [ ] başlık alarm HH:MM" satırları (reminderLine biçimi). Yalnızca tamamlanmamış olanlar.
export interface ReminderItem { path: string; lineIdx: number; tarih: string; saat: string; baslik: string }
export const parseReminders = (files: Record<string, string>): ReminderItem[] => {
  const out: ReminderItem[] = [];
  for (const path of Object.keys(files)) {
    const pm = /^Hatırlatmalar\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path);
    if (!pm) continue;
    String(files[path] || '').split(/\r?\n/).forEach((line, lineIdx) => {
      const m = /^-\s*\[ \]\s+(.+?)\s+alarm\s+(\d{2}:\d{2})\s*$/.exec(line.trim());
      if (m) out.push({ path, lineIdx, tarih: pm[1], saat: m[2], baslik: m[1] });
    });
  }
  return out.sort((a, b) => (a.tarih + a.saat).localeCompare(b.tarih + b.saat));
};
export const removeLine = (content: string, lineIdx: number): string => content.split(/\r?\n/).filter((_, i) => i !== lineIdx).join('\n');
