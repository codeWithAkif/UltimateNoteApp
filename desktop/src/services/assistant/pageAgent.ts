// Sayfa ajanı: ekrandaki düğme/alan/seçicileri okur (adlarıyla), yapay zekânın planladığı adımları (tıkla, yaz, seç, işaretle) gerçek DOM olaylarıyla uygular.
// Güvenlik: (1) yalnızca o an ekranda görünen öğelere dokunulur (ref'ler her okumada yeniden üretilir, uydurma ref reddedilir), (2) yıkıcı adımlar (sil, gönder,
// sıfırla...) kullanıcı onayı ister, (3) birleştir/yayınla gibi düğmelere HİÇ dokunulmaz, (4) şifre benzeri alanlar okunmaz/yazılmaz, (5) asistanın kendi paneli
// ([data-agent-ignore]) hariç tutulur, (6) not metni gibi içerik yapay zekâya gitmez: yalnızca kontrol adları ve kısa değerleri gider.
import { callGemini } from '../geminiMentor';
import { screenById } from './assistantAI';

export type Rol = 'dugme' | 'alan' | 'secici' | 'onay' | 'sekme' | 'baglanti';
export type Risk = 'normal' | 'onay' | 'yasak';
export interface PageEl { ref: string; rol: Rol; ad: string; deger?: string; secenekler?: string[]; secili?: boolean; kapali?: boolean; risk: Risk }
export type StepKind = 'tikla' | 'yaz' | 'sec' | 'isaretle' | 'git' | 'bitti' | 'sor' | 'basarisiz';
export interface Step { tur: StepKind; ref?: string; deger?: string; ekran?: string; aciklama: string }

const SENSITIVE = /şifre|sifre|parola|password|token|anahtar|api key|iban|kart no|cvv|tc kimlik/i;
const YASAK = /birleştir|yayınla|sürümü yayın|release|push|ana dala|merge|kalıcı olarak sil|hesabı sil|tüm verileri sil/i;
const ONAY = /\b(sil|kaldır|temizle|boşalt|gönder|geri yükle|üzerine yaz|çıkış|sıfırla|iptal et|çöpe|arşivle|ödeme|satın al|onayla ve)\b|sil$|kaldır$|^sil\b/i;

export const classifyRisk = (ad: string): Risk => (YASAK.test(ad) ? 'yasak' : ONAY.test(ad) ? 'onay' : 'normal');

const nameOf = (el: HTMLElement): string => {
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return aria.trim();
  const lb = el.getAttribute('aria-labelledby');
  if (lb) { const t = lb.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim(); if (t) return t; }
  if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l?.textContent?.trim()) return l.textContent.trim(); }
  const wrap = el.closest('label'); if (wrap && wrap !== el && wrap.textContent?.trim()) return wrap.textContent.replace(/\s+/g, ' ').trim();
  const title = el.getAttribute('title'); const ph = el.getAttribute('placeholder');
  const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
  return (txt || title || ph || '').slice(0, 70);
};

const visible = (el: HTMLElement): boolean => {
  if (el.closest('[data-agent-ignore],[aria-hidden="true"],[hidden]')) return false;
  const r = el.getClientRects();
  if (!r.length) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
};

export const snapshotPage = (root: ParentNode = document, max = 140): { els: PageEl[]; map: Map<string, HTMLElement> } => {
  document.querySelectorAll('[data-agent-ref]').forEach(e => e.removeAttribute('data-agent-ref'));
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="tab"], [role="button"], [role="checkbox"]'));
  const inView: HTMLElement[] = [], below: HTMLElement[] = [];
  for (const el of nodes) {
    if (!visible(el)) continue;
    if (el instanceof HTMLInputElement && (el.type === 'hidden' || el.type === 'password' || el.type === 'file')) continue;
    (el.getBoundingClientRect().top < innerHeight ? inView : below).push(el);
  }
  const els: PageEl[] = [];
  const map = new Map<string, HTMLElement>();
  let n = 0;
  for (const el of [...inView, ...below]) {
    if (els.length >= max) break;
    const ad = nameOf(el);
    if (!ad && !(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) continue;
    const ref = `e${++n}`;
    let rol: Rol = 'dugme';
    const pe: PageEl = { ref, rol, ad: ad || '(adsız alan)', risk: classifyRisk(ad) };
    if (el instanceof HTMLSelectElement) { pe.rol = 'secici'; pe.deger = el.selectedOptions[0]?.text; pe.secenekler = Array.from(el.options).map(o => o.text).slice(0, 25); }
    else if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(el.type))) {
      pe.rol = 'alan'; pe.deger = SENSITIVE.test(ad) ? '(gizli)' : el.value.slice(0, 40);
    }
    else if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) { pe.rol = 'onay'; pe.secili = el.checked; }
    else if (el.getAttribute('role') === 'tab') { pe.rol = 'sekme'; pe.secili = el.getAttribute('aria-selected') === 'true'; }
    else if (el instanceof HTMLAnchorElement) pe.rol = 'baglanti';
    pe.kapali = (el as HTMLButtonElement).disabled === true;
    if (pe.rol === 'alan' && SENSITIVE.test(ad)) continue; // hassas alanlar hiç listelenmez
    el.setAttribute('data-agent-ref', ref);
    map.set(ref, el); els.push(pe);
  }
  return { els, map };
};

export const elsToText = (els: PageEl[]): string =>
  els.map(e => `${e.ref} | ${e.rol} | ${e.ad}${e.deger !== undefined ? ` | değer: "${e.deger}"` : ''}${e.secenekler ? ` | seçenekler: ${e.secenekler.join(' / ')}` : ''}${e.secili !== undefined ? ` | ${e.secili ? 'seçili' : 'seçili değil'}` : ''}${e.kapali ? ' | KAPALI' : ''}${e.risk !== 'normal' ? ` | RİSK:${e.risk}` : ''}`).join('\n');

// React kontrollü alanlar için: doğal değer yazıcısı + olay
const setNative = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, v: string) => {
  const proto = Object.getPrototypeOf(el);
  const d = Object.getOwnPropertyDescriptor(proto, 'value');
  if (d?.set) d.set.call(el, v); else (el as any).value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

export const performStep = (map: Map<string, HTMLElement>, s: Step): { ok: boolean; mesaj: string } => {
  const el = s.ref ? map.get(s.ref) : undefined;
  if (!el || !document.contains(el)) return { ok: false, mesaj: 'Öğe artık sayfada yok.' };
  if ((el as HTMLButtonElement).disabled) return { ok: false, mesaj: 'Öğe şu an kapalı.' };
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* yoksay */ }
  if (s.tur === 'tikla' || s.tur === 'isaretle') { el.click(); return { ok: true, mesaj: 'Tıklandı.' }; }
  if (s.tur === 'yaz') {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return { ok: false, mesaj: 'Bu öğeye yazılamaz.' };
    if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'password', 'file'].includes(el.type)) return { ok: false, mesaj: 'Bu alana yazılamaz.' };
    setNative(el, String(s.deger ?? '').slice(0, 2000)); return { ok: true, mesaj: 'Yazıldı.' };
  }
  if (s.tur === 'sec') {
    if (!(el instanceof HTMLSelectElement)) return { ok: false, mesaj: 'Bu bir seçici değil.' };
    const want = String(s.deger ?? '').trim().toLocaleLowerCase('tr');
    const opt = Array.from(el.options).find(o => o.text.trim().toLocaleLowerCase('tr') === want || o.value.toLocaleLowerCase('tr') === want) || Array.from(el.options).find(o => o.text.toLocaleLowerCase('tr').includes(want));
    if (!opt) return { ok: false, mesaj: `Seçenek bulunamadı: ${s.deger}` };
    setNative(el, opt.value); return { ok: true, mesaj: 'Seçildi.' };
  }
  return { ok: false, mesaj: 'Bilinmeyen adım.' };
};

// Hedef öğeyi kısa süre vurgular (asistan paneli hariç, kullanıcı ne olduğunu görsün)
export const highlight = (el: HTMLElement, ms = 1400): void => {
  // Asistanın hedefini gösteren HUD: dört kilit köşesi, tarama çizgisi ve "JARVIS" etiketi (görsel geri bildirim; ekranı değiştirmez)
  if (!document.getElementById('agent-hud-css')) {
    const st = document.createElement('style'); st.id = 'agent-hud-css';
    st.textContent = '@keyframes agent-scan{0%{top:0}100%{top:calc(100% - 2px)}}@keyframes agent-lock{0%{transform:scale(1.6);opacity:0}100%{transform:scale(1);opacity:1}}'
      + '.agent-hud{position:fixed;z-index:2147482600;pointer-events:none;transition:opacity .3s;animation:agent-lock .28s ease-out}'
      + '.agent-hud i{position:absolute;width:14px;height:14px;border:2px solid #22d3ee;filter:drop-shadow(0 0 5px #22d3ee)}'
      + '.agent-hud i:nth-child(1){left:0;top:0;border-right:0;border-bottom:0}.agent-hud i:nth-child(2){right:0;top:0;border-left:0;border-bottom:0}'
      + '.agent-hud i:nth-child(3){left:0;bottom:0;border-right:0;border-top:0}.agent-hud i:nth-child(4){right:0;bottom:0;border-left:0;border-top:0}'
      + '.agent-hud b{position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#22d3ee,transparent);box-shadow:0 0 10px #22d3ee;animation:agent-scan .8s ease-in-out infinite alternate}'
      + '.agent-hud em{position:absolute;left:0;top:-18px;font:500 10px Inter,system-ui,sans-serif;letter-spacing:.16em;color:#22d3ee;font-style:normal;text-shadow:0 0 6px #22d3ee}';
    document.head.appendChild(st);
  }
  const r = el.getBoundingClientRect();
  const box = document.createElement('div');
  box.className = 'agent-hud';
  box.setAttribute('data-agent-ignore', '1');
  Object.assign(box.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
  box.innerHTML = '<i></i><i></i><i></i><i></i><b></b><em>JARVIS</em>';
  document.body.appendChild(box);
  setTimeout(() => { box.style.opacity = '0'; setTimeout(() => box.remove(), 320); }, ms);
};

// ---- planlayıcı: tek adım (her adımdan sonra sayfa yeniden okunur)
export const STEP_SCHEMA = {
  type: 'object',
  properties: { tur: { type: 'string' }, ref: { type: 'string' }, deger: { type: 'string' }, ekran: { type: 'string' }, aciklama: { type: 'string' } },
  required: ['tur', 'aciklama']
};

export const buildStepPrompt = (o: { talimat: string; els: PageEl[]; gecmis: string[]; ekranAd: string; adim: number }): string => `Uygulama içindeki bir sayfa ajanısın. Kullanıcının isteğini, ekrandaki kontrolleri kullanarak ADIM ADIM yerine getir. Her çağrıda yalnızca SIRADAKİ TEK adımı ver.

KULLANICININ İSTEĞİ: ${o.talimat}
AÇIK EKRAN: ${o.ekranAd}
ŞU ANA KADAR YAPILANLAR (${o.adim - 1}. adıma kadar):
${o.gecmis.length ? o.gecmis.map((g, i) => `${i + 1}. ${g}`).join('\n') : '(henüz bir şey yapılmadı)'}

EKRANDAKİ KONTROLLER (ref | tür | ad | değer ...):
${elsToText(o.els)}

ADIM TÜRLERİ:
- tur="tikla", ref: düğme/sekme/bağlantıya bas.
- tur="yaz", ref (alan), deger: alana yaz (alan boşsa ya da değiştirilecekse).
- tur="sec", ref (seçici), deger: seçeneğin metni.
- tur="isaretle", ref: kutuyu işaretle/kaldır.
- tur="git", ekran: başka bir ekrana geç (ekran kimliği).
- tur="bitti": istek tamamlandı (aciklama'da ne yapıldığını söyle).
- tur="sor": bir bilgi eksik ve kullanıcıya sormalısın (aciklama = soru).
- tur="basarisiz": yapılamıyor (aciklama = nedeni).
KURALLAR: Yalnızca yukarıdaki listede olan ref'leri kullan; uydurma. RİSK işaretli öğeler için dikkatli ol (kullanıcı onay verecek). KAPALI öğelere basma. Aynı adımı tekrarlama; istek tamamsa "bitti" de. Metin alanlarına YALNIZCA kullanıcının istediği değeri yaz; bilmediğin değer için "sor" kullan. aciklama: ne yaptığını/yapacağını kısa Türkçe cümleyle yaz.
Sadece JSON döndür.`;

export const normalizeStep = (raw: any, map: Map<string, HTMLElement>): Step => {
  const tur = String(raw?.tur ?? '') as StepKind;
  const aciklama = String(raw?.aciklama ?? '').slice(0, 240) || '…';
  if (tur === 'bitti' || tur === 'sor' || tur === 'basarisiz') return { tur, aciklama };
  if (tur === 'git') return screenById(String(raw?.ekran ?? '')) ? { tur, ekran: String(raw.ekran), aciklama } : { tur: 'basarisiz', aciklama: 'Geçersiz ekran.' };
  if (['tikla', 'yaz', 'sec', 'isaretle'].includes(tur)) {
    const ref = String(raw?.ref ?? '');
    if (!map.has(ref)) return { tur: 'basarisiz', aciklama: 'Planlanan öğe ekranda bulunamadı.' };
    if ((tur === 'yaz' || tur === 'sec') && typeof raw?.deger !== 'string') return { tur: 'basarisiz', aciklama: 'Yazılacak değer eksik.' };
    return { tur, ref, deger: typeof raw?.deger === 'string' ? raw.deger.slice(0, 2000) : undefined, aciklama };
  }
  return { tur: 'basarisiz', aciklama: 'Anlaşılmayan adım.' };
};

export const planStep = async (o: { talimat: string; els: PageEl[]; map: Map<string, HTMLElement>; gecmis: string[]; ekranAd: string; adim: number }, call: <T>(p: string, s: any) => Promise<T> = callGemini): Promise<Step> =>
  normalizeStep(await call<any>(buildStepPrompt(o), STEP_SCHEMA), o.map);
