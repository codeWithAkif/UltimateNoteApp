// Boykot listesi için web araması: ADAY markaları kaynaklarıyla getirir. Hiçbir şey kendiliğinden listeye girmez; kullanıcı her marka için "Ekle / Atla" der.
// Neden: tek yetkili bir liste yok, kaynaklar birbiriyle çelişiyor ve yapay zekâ hata yapabilir. Sayfada görülmeyen marka yazdırılmaz,
// çelişen bilgi notta belirtilir, bağlantılar yalnızca https kabul edilir ve düz metin olarak gösterilir.
import { callGeminiGroundedText } from './geminiMentor';
import { fold } from './shopPrefs';
import type { BoycottEntry } from './boycott';

export interface BoycottCandidate { marka: string; kategori?: string; kaynak?: string; not?: string }
export interface OwnerInfo { sahip: string; kaynak?: string; not?: string }

const safeUrl = (u: string): string | undefined => { try { const x = new URL(u.trim()); return x.protocol === 'https:' ? x.toString().slice(0, 300) : undefined; } catch { return undefined; } };
const cut = (s: string | undefined, n: number) => (s ? s.replace(/\s+/g, ' ').trim().slice(0, n) : undefined);

export const buildCandidatesPrompt = (existing: string[], extraSources: string[]): string => `Google Arama aracını kullanarak Türkiye'de tüketicilerin boykot ettiği markaların GÜNCEL listesini araştır. Birincil kaynak olarak BDS'nin (Boykot, Elden Çıkarma, Yaptırım hareketi) kendi yayınladığı güncel liste; ayrıca en az bir ikinci güvenilir kaynak. ${extraSources.length ? `Kullanıcının eklediği kaynaklar: ${extraSources.slice(0, 5).join(', ')}.` : ''}
Odak: market ürünleri (gıda, içecek, temizlik, kişisel bakım, bebek ürünleri).

Çıktı kuralları (başka HİÇBİR şey yazma: giriş cümlesi, markdown yok):
- En çok 40 satır; her satır TAM şu biçimde: MARKA | KATEGORİ | KAYNAK_URL | KISA NOT
- MARKA: markanın adı. Kaynak sayfada GÖRMEDİĞİN markayı yazma, tahmin etme.
- KATEGORİ: kaynaktaki sınıflandırma (örn. "boykot", "baskı", "organik boykot") ya da ürün grubu.
- KAYNAK_URL: markayı gördüğün gerçek sayfanın tam https adresi; yoksa "-".
- KISA NOT: en çok 12 kelime. Kaynaklar birbiriyle çelişiyorsa "kaynaklar çelişiyor" yaz.
- Zaten listede olan markaları yazma: ${existing.slice(0, 80).join(', ') || '(yok)'}`;

export const parseCandidates = (text: string, existing: BoycottEntry[]): BoycottCandidate[] => {
  const have = new Set(existing.map(e => fold(e.marka)));
  const out: BoycottCandidate[] = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const p = raw.trim().replace(/^[-*•]\s*/, '').split('|').map(s => s.trim());
    if (p.length < 3 || !p[0] || p[0].length > 50 || /^marka$/i.test(p[0])) continue;
    const key = fold(p[0]);
    if (have.has(key) || out.some(o => fold(o.marka) === key)) continue;
    out.push({ marka: p[0], kategori: cut(p[1], 40), kaynak: p[2] && p[2] !== '-' ? safeUrl(p[2]) : undefined, not: cut(p[3], 140) });
    if (out.length >= 40) break;
  }
  return out;
};

export const proposeBoycott = async (existing: BoycottEntry[], extraSources: string[] = [], call: (p: string) => Promise<string> = callGeminiGroundedText): Promise<BoycottCandidate[]> => {
  const list = parseCandidates(await call(buildCandidatesPrompt(existing.map(e => e.marka), extraSources)), existing);
  if (!list.length) throw new Error('Yeni aday bulunamadı (kaynaklarda yeni marka yok ya da arama sonuç vermedi). Birkaç dakika sonra tekrar deneyin.');
  return list;
};

export const buildOwnerPrompt = (brand: string): string => `Google Arama aracını kullanarak "${brand.slice(0, 60)}" markasının sahibi / bağlı olduğu ana şirket kimdir araştır.
Çıktı (başka HİÇBİR şey yazma): tek satır, TAM şu biçimde: SAHİP | KAYNAK_URL | KISA NOT
- Kaynakta görmediysen SAHİP olarak "bulunamadı" yaz; tahmin etme.
- KAYNAK_URL: gördüğün gerçek sayfanın https adresi; yoksa "-".
- KISA NOT: en çok 15 kelime (örn. satın alma tarihi, kaynaklar çelişiyorsa belirt).`;

export const parseOwner = (text: string): OwnerInfo | null => {
  for (const raw of String(text || '').split(/\r?\n/)) {
    const p = raw.trim().replace(/^[-*•]\s*/, '').split('|').map(s => s.trim());
    if (p.length >= 2 && p[0] && p[0].length <= 80) return { sahip: p[0], kaynak: p[1] && p[1] !== '-' ? safeUrl(p[1]) : undefined, not: cut(p[2], 160) };
  }
  return null;
};

export const askOwner = async (brand: string, call: (p: string) => Promise<string> = callGeminiGroundedText): Promise<OwnerInfo> => {
  const o = parseOwner(await call(buildOwnerPrompt(brand)));
  if (!o) throw new Error('Sahiplik bilgisi alınamadı; daha sonra tekrar deneyin.');
  return o;
};
