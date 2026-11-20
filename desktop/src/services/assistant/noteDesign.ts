// "Notu sözle tasarla": kullanıcının biçim/düzen isteğini (başlığı mavi yap, altını 3 sütuna böl, solda görev listesi...) editörün KENDİ sözdizimiyle
// yazılmış yeni nota çevirir. Sonuç hemen uygulanmaz: satır farkı (ne eklendi, ne silindi) önizleme olarak gösterilir, kullanıcı onaylar ve tek tıkla geri alınır.
import { callGemini } from '../geminiMentor';
import { redactSensitive } from '../budget';

// Editörün (NotesView) gerçekten çizdiği sözdizimleri; asistan YALNIZCA bunları kullanır
export const SYNTAX_GUIDE = `NOT EDİTÖRÜNÜN DESTEKLEDİĞİ SÖZDİZİMİ (başka biçim kullanma):
- Başlıklar: "# Başlık", "## Alt başlık", "### Küçük başlık".
- Başlık rengi: başlık satırının SONUNA [color:RENK] ekle. RENK: red, blue, green, purple, amber, pink, orange, cyan, indigo. Örn: "# Haftalık Plan [color:blue]". Renkli gradyan: [gradient:sunset|ocean|neon|forest|fiery|cosmic|purple-glow].
- SÜTUNLAR (yan yana kolonlar): satır satır şöyle yazılır; her <<<...>>> etiketi KENDİ SATIRINDA olmalı:
<<<row>>>
<<<col>>>
birinci sütunun içeriği (satırlar)
<<<col>>>
ikinci sütunun içeriği
<<<col>>>
üçüncü sütunun içeriği
<<<row-end>>>
  3 parçaya böl = 3 tane <<<col>>>. Sütun içinde başlık, görev listesi, madde işareti, metin, tablo olabilir. Sütunlar iç içe konmaz.
- Görev listesi: "- [ ] yapılacak" ve tamamlanmış "- [x] bitti". Madde işareti: "- madde". Numaralı: "1. madde".
- Kutu (callout): iki satır: "> [!NOTE]" sonra "> metin". Türler: NOTE, TIP, WARNING, IMPORTANT.
- Ayırıcı çizgi: "---" (yalnız tek satır). Alıntı: "> metin". Kod: üç ters tırnak.
- Vurgu: ==metin== sarı, ==mavi:metin==, ==kırmızı:metin==, ==yeşil:metin==, ==mor:metin==. Kalın **x**, italik *x*, bağlantı [[Not adı]] ya da [metin](adres), etiket #etiket.
- Tablo: "| a | b |" satırı ardından "|---|---|" satırı.`;

export const buildDesignPrompt = (o: { icerik: string; talimat: string }): string => `Bir not editöründe çalışan tasarım asistanısın. Kullanıcı açık notun görünümünü/düzenini değiştirmeni istiyor. Notun TAMAMININ yeni halini üret.

${SYNTAX_GUIDE}

KURALLAR:
- Kullanıcının mevcut içeriğini KORU: metinleri, görevleri, maddeleri silme, kısaltma, yeniden yazma. Yeni düzene TAŞI (örn. mevcut görevleri "solda görev listesi" sütununa koy). Kullanıcı açıkça "ekle/yaz/oluştur" demedikçe yeni bilgi/madde UYDURMA; "ortada madde işaretleri" gibi içerik tanımsızsa yer tutucu olarak kısa, genel bir başlık ve boş bir "- " maddesi bırak.
- Yalnızca yukarıdaki sözdizimini kullan. HTML, <style>, <script> yazma.
- Frontmatter (--- ile başlayan en üst blok) ve etiketler (#etiket), [due:...] gibi köşeli parantezli meta etiketler olduğu gibi kalsın.
- İstenmeyen yerlere dokunma.
- "icerik" alanına notun yeni tam metnini yaz, "ozet" alanına ne yaptığını 1-2 cümleyle yaz.

KULLANICININ İSTEĞİ:
${redactSensitive(o.talimat).slice(0, 800)}

MEVCUT NOT:
"""
${o.icerik.slice(0, 12000)}
"""

Sadece JSON döndür: {"icerik": "...", "ozet": "..."}`;

export const DESIGN_SCHEMA = { type: 'object', properties: { icerik: { type: 'string' }, ozet: { type: 'string' } }, required: ['icerik', 'ozet'] };

export interface DesignResult { icerik: string; ozet: string; uyarilar: string[] }

// Güvenlik süzgeci: betik/iframe/javascript bağlantısı olan çıktı reddedilir; aşırı küçülme uyarısı verilir
export const validateDesign = (eski: string, yeni: string): { ok: boolean; uyarilar: string[]; hata?: string } => {
  const uyarilar: string[] = [];
  if (!yeni.trim()) return { ok: false, uyarilar, hata: 'Boş sonuç döndü.' };
  if (/<\s*(script|iframe|object|embed|style)\b|javascript:|on\w+\s*=\s*["']/i.test(yeni)) return { ok: false, uyarilar, hata: 'Sonuç güvenli olmayan içerik içeriyordu; uygulanmadı.' };
  const rows = (yeni.match(/<<<row>>>/g) || []).length, ends = (yeni.match(/<<<row-end>>>/g) || []).length;
  if (rows !== ends) uyarilar.push('Sütun blokları eşleşmiyor (<<<row>>> ve <<<row-end>>> sayısı farklı).');
  const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean);
  const eskiSatir = lines(eski).filter(l => !/^<<<|^#{1,6}\s*$/.test(l));
  const yeniSet = new Set(lines(yeni).map(l => l.replace(/\s*\[color:[a-z]+\]|\s*\[gradient:[a-z-]+\]/gi, '')));
  const kayip = eskiSatir.filter(l => !yeniSet.has(l.replace(/\s*\[color:[a-z]+\]|\s*\[gradient:[a-z-]+\]/gi, '')));
  if (eskiSatir.length >= 4 && kayip.length / eskiSatir.length > 0.4) uyarilar.push(`Mevcut satırların %${Math.round(kayip.length / eskiSatir.length * 100)}'i yeni halde görünmüyor; önizlemede silinen satırları kontrol edin.`);
  return { ok: true, uyarilar };
};

export const designNote = async (o: { icerik: string; talimat: string }, call: <T>(p: string, s: any) => Promise<T> = callGemini): Promise<DesignResult> => {
  const raw = await call<any>(buildDesignPrompt(o), DESIGN_SCHEMA);
  const yeni = String(raw?.icerik ?? '').replace(/\r\n/g, '\n');
  const v = validateDesign(o.icerik, yeni);
  if (!v.ok) throw new Error(v.hata || 'Tasarım uygulanamadı.');
  return { icerik: yeni, ozet: String(raw?.ozet ?? '').slice(0, 300) || 'Not yeniden düzenlendi.', uyarilar: v.uyarilar };
};

// ---- önizleme için satır farkı (ortak baş/son atılır, orta kısımda LCS; çok büyükse blok olarak gösterilir)
export interface DiffOp { t: 'ayni' | 'ekle' | 'sil'; s: string }
export const lineDiff = (a: string, b: string): DiffOp[] => {
  const x = a.split('\n'), y = b.split('\n');
  let p = 0; while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let q = 0; while (q < x.length - p && q < y.length - p && x[x.length - 1 - q] === y[y.length - 1 - q]) q++;
  const mx = x.slice(p, x.length - q), my = y.slice(p, y.length - q);
  const out: DiffOp[] = x.slice(0, p).map(s => ({ t: 'ayni' as const, s }));
  if (mx.length * my.length > 360_000) { mx.forEach(s => out.push({ t: 'sil', s })); my.forEach(s => out.push({ t: 'ekle', s })); }
  else {
    const L: number[][] = Array.from({ length: mx.length + 1 }, () => new Array(my.length + 1).fill(0));
    for (let i = mx.length - 1; i >= 0; i--) for (let j = my.length - 1; j >= 0; j--) L[i][j] = mx[i] === my[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < mx.length && j < my.length) {
      if (mx[i] === my[j]) { out.push({ t: 'ayni', s: mx[i] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ t: 'sil', s: mx[i++] }); }
      else out.push({ t: 'ekle', s: my[j++] });
    }
    while (i < mx.length) out.push({ t: 'sil', s: mx[i++] });
    while (j < my.length) out.push({ t: 'ekle', s: my[j++] });
  }
  x.slice(x.length - q).forEach(s => out.push({ t: 'ayni', s }));
  return out;
};
