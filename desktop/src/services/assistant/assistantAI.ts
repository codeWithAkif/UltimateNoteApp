// Uygulama asistanı: isteği (a) bir soruya cevap, (b) ekran açma, (c) notu tasarlama, (d) hatırlatma, (e) otomasyon, (f) sayfadaki düğmelerle işlem
// eylemlerinden birine çevirir. Asistan KENDİLİĞİNDEN hiçbir şey yazmaz/silmez: her eylem kullanıcıya bir "onay kartı" olarak sunulur.
// Burada yalnızca saf mantık vardır (istem kurma, yanıtı doğrulama); ağ çağrısı callGemini zinciri üzerinden dışarıdan verilir (test edilebilir).
import { callGemini } from '../geminiMentor';
import { redactSensitive } from '../budget';
import { parseSched, validTime, type Sched, type Eylem } from './automation';

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

export type ActionKind = 'git' | 'notu_tasarla' | 'hatirlat' | 'otomasyon' | 'ui';
export interface AAction {
  tur: ActionKind;
  ekran?: string;                 // git / otomasyon(ac)
  talimat?: string;               // notu_tasarla / ui
  baslik?: string; mesaj?: string; // hatirlat / otomasyon(bildir)
  tarih?: string; saat?: string;   // hatirlat
  ad?: string; sched?: Sched; eylem?: Eylem; // otomasyon
}
export interface RouterResult { cevap: string; eylemler: AAction[] }
export interface AssistantCtx { tab: string; noteOpen: boolean; notePath?: string; now: Date }
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
          tarih: { type: 'string' }, saat: { type: 'string' }, ad: { type: 'string' }, zamanlama: { type: 'string' }, eylemTuru: { type: 'string' }
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

EKRANLAR (kimlik = ad: ne işe yarar). Buradaki bilgi dışında ayrıntıyı UYDURMA; bilmiyorsan "bu ekranın ayrıntısını bilmiyorum, açayım mı?" de:
${screens}

YAPABİLECEĞİN EYLEMLER ("eylemler" dizisi; gerekmiyorsa boş bırak; en çok 3):
1. tur="git", ekran=<ekran kimliği>: kullanıcıyı o ekrana götürür. Nasıl yapılır sorularında cevabı yaz VE ilgili ekrana git eylemi ekle.
2. tur="notu_tasarla", talimat=<kullanıcının tasarım/biçim isteği, kendi cümleleriyle>: YALNIZCA bir not açıkken ve kullanıcı o notun görünümünü/düzenini/içeriğini değiştirmek istiyorsa ("başlığı mavi yap", "altını 3 sütuna böl", "şunu ekle", "tabloya çevir").
3. tur="hatirlat", baslik, tarih (YYYY-MM-DD, bugüne göre hesapla), saat (HH:MM 24 saat): tek seferlik hatırlatma/alarm. Tarih/saat belirsizse eylem ekleme, cevapta sor.
4. tur="otomasyon", ad, zamanlama ("her-gun 08:30" | "haftalik pzt 09:00" | "aylik 5 09:00" | "bir 2026-12-01 09:00"; gün adları pzt sal car per cum cmt paz), eylemTuru ("bildir" ya da "ac"), baslik (bildir için), ekran (ac için ekran kimliği), mesaj (isteğe bağlı): tekrarlayan kural. Kural yalnızca bildirim gösterir ya da bir ekranı açar.
5. tur="ui", talimat: kullanıcı sayfadaki düğmelerle/alanlarla bir işlemi SENİN yapmanı istiyorsa ("Bütçe'ye şu kalemi ekle", "şu ayarı aç"). Not içeriği için 2'yi kullan, 5'i değil.
KURALLAR: Silme, gönderme, yayınlama, ödeme gibi işlemleri yapma teklif etme (kullanıcıya nasıl yapacağını anlat). Kişisel/gizli bilgi isteme. Eylem eklediysen "cevap"ta ne yapacağını kısaca söyle; kullanıcı onay kartıyla onaylayacak.
${hist ? `\nSOHBET:\n${hist}\n` : ''}
KULLANICININ MESAJI:
${redactSensitive(o.message).slice(0, 1500)}

Sadece JSON döndür.`;
};

const str = (v: unknown, n: number) => String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

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
    } else if (tur === 'ui') {
      if (str(a.talimat, 600)) out.push({ tur, talimat: str(a.talimat, 600) });
    }
    if (out.length >= 3) break;
  }
  return { cevap: str(raw?.cevap, 900) || 'Anladım.', eylemler: out };
};

export const askRouter = async (o: { ctx: AssistantCtx; history: ChatTurn[]; message: string }, call: <T>(p: string, s: any) => Promise<T> = callGemini): Promise<RouterResult> =>
  normalizeRouter(await call<any>(buildRouterPrompt(o), ROUTER_SCHEMA), o.ctx);

// Hatırlatma: mevcut alarm sistemi (notta "alarm HH:MM" geçen satır) kullanılır; gün, dosya adındaki tarihten gelir.
export const reminderPath = (tarih: string): string => `Hatırlatmalar/${tarih}.md`;
export const reminderLine = (baslik: string, saat: string, mesaj?: string): string => `- [ ] ${str(baslik, 80)}${mesaj ? ` (${str(mesaj, 160)})` : ''} alarm ${saat}`;
export const appendReminder = (existing: string | undefined, tarih: string, baslik: string, saat: string, mesaj?: string): string => {
  const line = reminderLine(baslik, saat, mesaj);
  const base = existing && existing.trim() ? existing.replace(/\s*$/, '\n') : `# Hatırlatmalar ${tarih}\n\n`;
  return base.includes(line) ? base : base + line + '\n';
};
