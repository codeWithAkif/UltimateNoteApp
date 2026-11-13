// Teams "Aramalar > Geçmiş" listesinden kopyalanan metni görüşme kayıtlarına çevirir. Teams arama listesi uygulamadan okunamaz
// (şirket yöneticisi izni ister); kullanıcı listeyi yapıştırır, burada kişi/gün/süre ayrıştırılır. Saf işlevler, ağ yok.
//
// Biçim (örnek): "Betül Ünlü Giden Dün 1sa 48dk" ya da satır satır. Süre yazımı: "1sa 48dk" = 1 saat 48 dk, "9dk 42sa" = 9 dk 42 sn
// (Teams Türkçe'de saniyeye de "sa" yazıyor; sıraya bakılır: dk'dan sonra gelen sa = saniye).

export interface ParsedCall {
  person: string;
  direction: string;
  ymd: string;
  seconds: number;
  key: string; // yinelenen yapıştırmaları ayırmak için: gün|kişi|saniye
}

const DIRECTIONS = 'Giden|Gelen|Cevapsız|Sesli mesaj|Outgoing|Incoming|Missed|Voicemail';
const WEEKDAYS: Record<string, number> = { pazar: 0, pazartesi: 1, salı: 2, çarşamba: 3, perşembe: 4, cuma: 5, cumartesi: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const NOISE = new Set(['tümü', 'cevapsız', 'gelen', 'giden', 'sesli', 'mesaj', 'geçmiş', 'hızlı', 'arama', 'ara', 'aramalar', 'all', 'missed', 'incoming', 'outgoing', 'voicemail', 'history', 'calls']);

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseDuration = (raw: string): number => {
  const parts = [...raw.matchAll(/(\d+)\s*(sa|dk|sn|saat|h|min|m|s)\b/gi)].map(m => ({ n: parseInt(m[1], 10), u: m[2].toLowerCase() }));
  if (parts.length === 0) return 0;
  let sec = 0;
  parts.forEach((p, i) => {
    if (p.u === 'dk' || p.u === 'min' || p.u === 'm') sec += p.n * 60;
    else if (p.u === 'sn' || p.u === 's') sec += p.n;
    else if (p.u === 'saat' || p.u === 'h') sec += p.n * 3600;
    else if (p.u === 'sa') {
      const prev = parts[i - 1];
      // "9dk 42sa": dakikadan sonra gelen "sa" saniyedir. Tek başına "sa" saat sayılır (12'ye kadar), aksi halde saniye.
      if (prev && (prev.u === 'dk' || prev.u === 'min' || prev.u === 'm')) sec += p.n;
      else sec += p.n <= 12 ? p.n * 3600 : p.n;
    }
  });
  return sec;
};

export const resolveDate = (token: string, today: Date): string | null => {
  const t = token.trim().toLocaleLowerCase('tr');
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (t === 'bugün' || t === 'today') return ymd(base);
  if (t === 'dün' || t === 'yesterday') { base.setDate(base.getDate() - 1); return ymd(base); }
  if (t in WEEKDAYS) {
    // Teams hafta içi günlerini yalnızca son 7 gün için gösterir: bugünden önceki en yakın o gün.
    for (let back = 1; back <= 7; back++) {
      const d = new Date(base); d.setDate(d.getDate() - back);
      if (d.getDay() === WEEKDAYS[t]) return ymd(d);
    }
  }
  let m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  return null;
};

export const parseTeamsCalls = (text: string, today: Date = new Date()): ParsedCall[] => {
  const flat = text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
  const dateAlt = 'Bugün|Dün|Today|Yesterday|Pazartesi|Salı|Çarşamba|Perşembe|Cuma|Cumartesi|Pazar|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\\d{1,2}\\.\\d{1,2}\\.\\d{4}|\\d{4}-\\d{2}-\\d{2}';
  const re = new RegExp(`(.+?)\\s+(${DIRECTIONS})\\s+(${dateAlt})\\s+((?:\\d+\\s*(?:saat|sa|dk|sn|min|h|m|s)\\b\\s*)+)`, 'giu');
  const out: ParsedCall[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) {
    // Ad: başlık sözcüklerini ("Tümü Cevapsız Gelen…") ayıkla, en çok son 4 sözcüğü al.
    const words = m[1].trim().split(' ').filter(w => !NOISE.has(w.toLocaleLowerCase('tr')));
    const person = words.slice(-4).join(' ').trim();
    const date = resolveDate(m[3], today);
    const seconds = parseDuration(m[4]);
    if (!person || !date || seconds <= 0) continue;
    out.push({ person, direction: m[2], ymd: date, seconds, key: `${date}|${person.toLocaleLowerCase('tr')}|${seconds}` });
  }
  return out;
};

export const formatDuration = (sec: number): string => {
  const h = Math.floor(sec / 3600), mi = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h} sa ${mi} dk` : `${mi} dk`;
};
