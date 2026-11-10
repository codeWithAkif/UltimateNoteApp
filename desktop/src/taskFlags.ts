// Görev etiketleri (öncelikten bağımsız): Söz verildi, Sonra, Derin odak, Hafif. Görev satırında "[flag:...]" olarak durur
// (aynı [p:], [due:] gibi). Başında "Sonra:" yazan görevler etiketsiz de "Sonra" sayılır (kullanıcının kendi yazım alışkanlığı).

export type TaskFlag = 'promise' | 'later' | 'deep' | 'light';

export const TASK_FLAGS: { key: TaskFlag; emoji: string; label: string; title: string }[] = [
  { key: 'promise', emoji: '🤝', label: 'Söz verildi', title: 'Birine verdiğiniz taahhüt; geciktirmek güven kaybettirir (puanı artar)' },
  { key: 'later', emoji: '⏳', label: 'Sonra', title: 'Şimdi değil: günlük listelerde gizlenir; proje ve Kanban\'da görünür' },
  { key: 'deep', emoji: '🧠', label: 'Derin odak', title: 'Kesintisiz dikkat gerektiren iş' },
  { key: 'light', emoji: '🪫', label: 'Hafif', title: 'Düşük enerjiyle yapılabilen iş' }
];

const FLAG_RE = /\[flag:(promise|later|deep|light)\]/gi;
// "Sonra: ..." ya da "Sonra - ..." (yalnızca ayraçla yazılmışsa; "Sonra bakarız ..." gibi cümleler etiket sayılmaz).
const LATER_PREFIX = /^\s*sonra\s*[:\-–—]\s*/i;

// text: onay kutusundan SONRAKİ görev metni (ya da tüm satır; baştaki onay kutusu otomatik atlanır).
export const parseFlags = (text: string): TaskFlag[] => {
  const body = text.replace(/^\s*[*\-]\s+\[[ xX/]\]\s*/, '');
  const out = new Set<TaskFlag>();
  for (const m of body.matchAll(FLAG_RE)) out.add(m[1].toLowerCase() as TaskFlag);
  if (LATER_PREFIX.test(body)) out.add('later');
  return Array.from(out);
};

export const stripFlagTags = (text: string): string => text.replace(/\s*\[flag:(?:promise|later|deep|light)\]/gi, '');

// Puan katkısı: söz verilen iş daha öne çıkar.
export const flagScoreBonus = (flags: TaskFlag[]): number => (flags.includes('promise') ? 4 : 0);

// Bir satırda etiketi açar/kapatır. Derin odak ile Hafif birbirini dışlar. "Sonra:" yazısıyla otomatik sayılan bir görevde
// "Sonra" kapatılırsa baştaki "Sonra:" ifadesi kaldırılır (aksi hâlde yine Sonra sayılırdı).
export const toggleFlagInLine = (line: string, flag: TaskFlag): string => {
  const m = line.match(/^(\s*[*\-]\s+\[[ xX/]\]\s*)(.*)$/);
  if (!m) return line;
  let body = m[2];
  const drop = (b: string, f: TaskFlag) => b.replace(new RegExp(`\\s*\\[flag:${f}\\]`, 'gi'), '');
  if (parseFlags(body).includes(flag)) {
    body = drop(body, flag);
    if (flag === 'later') body = body.replace(LATER_PREFIX, '');
  } else {
    if (flag === 'deep') body = drop(body, 'light');
    if (flag === 'light') body = drop(body, 'deep');
    body = `${body.trimEnd()} [flag:${flag}]`;
  }
  return m[1] + body;
};
