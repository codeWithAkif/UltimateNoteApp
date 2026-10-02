import React, { useMemo, useRef, useState } from 'react';

// ============================================================================
// GÜNLÜK (Diary) — kağıt planner temalı haftalık günlük görünümü
// ============================================================================
// İSTEK (kullanıcı): gönderdiği ekran görüntüleri gibi (ahşap arka plan, spiral ciltli
// çizgili kağıt sayfalar, her gün ayrı bir kutu) bir "kağıt planner" görünümü istedi.
// Konuşma sonucu netleşen kararlar:
//   1) Her gün GERÇEK bir günlük notuna karşılık gelir (Günlükler/YYYY-MM-DD.md) — ayrı bir
//      veri deposu icat edilmiyor, uygulamanın geri kalanıyla AYNI not sistemi kullanılıyor.
//   2) Yeni, ayrı bir sekme (mevcut Takvim'e dokunulmuyor).
//   3) Görsel tarz SADE/uyarlanmış: fotoğrafik ahşap/kağıt dokusu yerine, uygulamanın kendi
//      koyu temasına uyarlanmış bir "kağıt hissi".
// DÜZELTME (kullanıcı: "istediğim bu değil direk olarak o sayfadan o günlere yazılar
// yazabilmem lazım... aynı anda haftanın her gününü görerek yazılar yazmak"): ilk versiyon
// güne tıklayınca AYRI not editörüne yönlendiriyordu — bunun yerine her gün kutusu artık
// KENDİ İÇİNDE düzenlenebilir bir alan, hepsi AYNI ANDA görünür ve yazılabilir durumda.
// "hatta iki hafta yapabiliyorsak" isteğiyle 1/2 hafta gösterme seçeneği de eklendi.

const DIARY_FOLDER = 'Günlükler';

const WEEKDAY_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const WEEKDAY_FULL = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const MONTH_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const MONTH_FULL = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const SAVE_DEBOUNCE_MS = 700;

const pad2 = (n: number) => String(n).padStart(2, '0');
const toDateStr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Haftanın Pazartesi'sini bulur (uygulamadaki diğer haftalık hesaplarla — İş Planla, Hunter
// Sistemi split günleri — AYNI Pazartesi-başlangıçlı kural).
const mondayOf = (d: Date): Date => {
  const copy = new Date(d);
  const jsDay = copy.getDay(); // 0=Pazar..6=Cumartesi
  const diff = (jsDay + 6) % 7;
  copy.setDate(copy.getDate() - diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const headerFor = (weekdayFull: string, dayNum: number, monthFull: string) => `# ${weekdayFull}, ${dayNum} ${monthFull}`;

// Not içeriğinden, otomatik üretilen "# Salı, 29 Eylül" başlık satırını (varsa) ayıklar —
// kutunun ÜSTÜNDE zaten gün/tarih yazdığından, düzenleme alanında bunu tekrar göstermeye
// gerek yok; kullanıcı sadece gövde metnini görür/yazar.
const bodyOf = (content: string | undefined, header: string): string => {
  if (!content) return '';
  if (content.startsWith(header)) {
    return content.slice(header.length).replace(/^\n+/, '');
  }
  return content;
};

// Günlük notlarına uygulamanın başka yerlerinden (Hızlı Giriş, görev tamamlama) yazılan
// "- [x] Başlık [due:..] [plannedtime:..] [project:..] [completed:..] [outcome:..]" satırları
// ham etiketleriyle okunması zor — bunlar düzenlenebilir metin alanından AYRILIP temiz satırlar
// olarak gösterilir (Not editöründeki rozet etiketleriyle aynı dakiklik metinleri). Satırların
// kendisi dosyada AYNEN korunur, kaydederken olduğu gibi geri yazılır.
// SADECE uygulamanın yazdığı (etiketli) görev satırları ayrılır; kullanıcının kutuya kendi
// yazdığı düz "- [ ] bir şey" satırı kutuda kalır — aksi halde yazarken satır kutudan kopup
// yukarı taşınıyor ve kullanıcı "yazamıyorum" hissediyordu.
const isTaskLine = (l: string) =>
  /^\s*[-*]\s+\[[ xX]\]\s*/.test(l) && /\[(due|plannedtime|project|completed|outcome|started|priority):[^\]]*\]/i.test(l);

const OUTCOME_LABEL: Record<string, string> = {
  fast: '⚡ Erken', ontime: '✅ Zamanında', late: '⏰ Geç', incomplete: '❌ Bitirilmedi'
};

const splitBody = (body: string): { taskLines: string[]; freeText: string } => {
  const taskLines: string[] = [];
  const free: string[] = [];
  body.split('\n').forEach(l => (isTaskLine(l) ? taskLines.push(l) : free.push(l)));
  return { taskLines, freeText: free.join('\n').replace(/^\n+/, '').replace(/\s+$/, '') };
};

const parseTask = (line: string) => {
  const done = /^\s*[-*]\s+\[[xX]\]/.test(line);
  const rest = line.replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '');
  const tags: Record<string, string> = {};
  rest.replace(/\[(\w+):([^\]]*)\]/g, (_m, k: string, v: string) => { tags[k.toLowerCase()] = v; return ''; });
  const title = rest.replace(/\[\w+:[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  let completedAt = '';
  if (tags.completed) {
    const d = new Date(tags.completed);
    if (!isNaN(d.getTime())) completedAt = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  return { done, title: title || '(başlıksız görev)', project: tags.project || '', planned: tags.plannedtime || '', completedAt, outcome: OUTCOME_LABEL[(tags.outcome || '').toLowerCase()] || '' };
};

// ----------------------------------------------------------------------------
// Satır-bazlı canlı editör — Markdown'ın küçük bir alt kümesi (görev kutusu, madde işareti,
// başlık). İSTEK (kullanıcı: "dönüşmüyor taska falan, md dönüştürme yok"): düz bir <textarea>
// "- [ ] x" yazınca hiçbir şeye dönüştürmüyordu. Not editöründeki gibi: odaktaki satır ham
// metin (input), diğer satırlar işlenmiş görünür (☐/☑ tıklanabilir, • madde, başlık).
// ----------------------------------------------------------------------------
const TASK_RE = /^(\s*)([-*])\s+\[([ xX]?)\]\s?(.*)$/;
const BULLET_RE = /^(\s*)([-*])\s+(.*)$/;
const HEADING_RE = /^(#{1,3})\s+(.*)$/;

const listPrefixOf = (line: string): string => {
  const t = line.match(TASK_RE);
  if (t) return `${t[1]}${t[2]} [ ] `;
  const b = line.match(BULLET_RE);
  if (b) return `${b[1]}${b[2]} `;
  return '';
};
// Satır sadece boş bir liste maddesi mi ("- [ ] " ya da "- ")?
const isEmptyItem = (line: string): boolean => {
  const t = line.match(TASK_RE);
  if (t) return t[4].trim() === '';
  const b = line.match(BULLET_RE);
  return !!b && b[3].trim() === '';
};

const LiveLines: React.FC<{ value: string; onChange: (v: string) => void; onFlush: () => void; placeholder: string }> = ({ value, onChange, onFlush, placeholder }) => {
  const lines = value === '' ? [''] : value.split('\n');
  const [focusIdx, setFocusIdx] = useState(-1);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const pending = useRef<{ idx: number; pos: number } | null>(null);

  React.useEffect(() => {
    const p = pending.current;
    if (p && refs.current[p.idx]) {
      const el = refs.current[p.idx]!;
      el.focus();
      el.setSelectionRange(p.pos, p.pos);
      pending.current = null;
    }
  });

  const emit = (next: string[]) => onChange(next.join('\n'));
  const focusLine = (idx: number, pos: number) => { pending.current = { idx, pos }; setFocusIdx(idx); };
  const toggle = (i: number) => {
    const next = [...lines];
    next[i] = next[i].replace(/\[([ xX]?)\]/, /\[[xX]\]/.test(next[i]) ? '[ ]' : '[x]');
    emit(next);
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const pos = el.selectionStart ?? 0;
    const line = lines[i];
    const collapsed = el.selectionStart === el.selectionEnd;
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = [...lines];
      if (isEmptyItem(line) && pos >= line.length) { // boş maddede Enter = listeden çık
        next[i] = '';
        emit(next); focusLine(i, 0);
        return;
      }
      const before = line.slice(0, pos), after = line.slice(pos);
      const prefix = listPrefixOf(line);
      next.splice(i, 1, before, prefix + after);
      emit(next); focusLine(i + 1, prefix.length);
    } else if (e.key === 'Backspace' && collapsed) {
      if (isEmptyItem(line) && pos >= line.length && line.length > 0) { // boş maddede Backspace = işareti sil
        e.preventDefault();
        const next = [...lines]; next[i] = '';
        emit(next); focusLine(i, 0);
      } else if (pos === 0 && i > 0) { // satır başında Backspace = üst satırla birleştir
        e.preventDefault();
        const next = [...lines];
        next.splice(i - 1, 2, lines[i - 1] + line);
        emit(next); focusLine(i - 1, lines[i - 1].length);
      }
    } else if (e.key === 'ArrowUp' && i > 0) {
      e.preventDefault(); focusLine(i - 1, Math.min(pos, lines[i - 1].length));
    } else if (e.key === 'ArrowDown' && i < lines.length - 1) {
      e.preventDefault(); focusLine(i + 1, Math.min(pos, lines[i + 1].length));
    }
  };

  const rowBase: React.CSSProperties = { minHeight: '22px', lineHeight: '22px', fontSize: '12px', color: '#e8ddc8', display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '0 4px' };

  return (
    <div
      style={{ flex: 1, minHeight: '64px', margin: '0 10px 10px', padding: '4px 0', borderRadius: '6px', cursor: 'text',
        backgroundImage: 'repeating-linear-gradient(to bottom, transparent, transparent 21px, rgba(240,230,210,0.1) 22px)',
        backgroundPositionY: '4px', backgroundColor: 'rgba(0,0,0,0.14)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) { e.preventDefault(); focusLine(lines.length - 1, lines[lines.length - 1].length); } }}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setFocusIdx(-1); onFlush(); } }}
    >
      {lines.map((line, i) => {
        if (i === focusIdx) {
          return (
            <div key={i} style={rowBase}>
              <input
                ref={el => { refs.current[i] = el; }}
                value={line}
                onChange={e => { const next = [...lines]; next[i] = e.target.value; emit(next); }}
                onKeyDown={e => onKeyDown(i, e)}
                placeholder={lines.length === 1 && line === '' ? placeholder : ''}
                style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: '#e8ddc8', fontSize: '12px', lineHeight: '22px', height: '22px', padding: 0, fontFamily: 'inherit' }}
              />
            </div>
          );
        }
        const t = line.match(TASK_RE);
        const b = !t && line.match(BULLET_RE);
        const h = !t && !b && line.match(HEADING_RE);
        let content: React.ReactNode;
        if (t) {
          const done = /[xX]/.test(t[3]);
          content = (
            <>
              <span
                onMouseDown={e => { e.preventDefault(); e.stopPropagation(); toggle(i); }}
                style={{ cursor: 'pointer', color: done ? '#6aa86a' : '#a89a86', fontSize: '13px', paddingLeft: `${t[1].length * 6}px` }}
              >{done ? '☑' : '☐'}</span>
              <span style={{ flex: 1, textDecoration: done ? 'line-through' : 'none', color: done ? '#a89a86' : '#e8ddc8' }}>{t[4]}</span>
            </>
          );
        } else if (b) {
          content = (<><span style={{ color: '#a89a86', paddingLeft: `${b[1].length * 6}px` }}>•</span><span style={{ flex: 1 }}>{b[3]}</span></>);
        } else if (h) {
          content = <span style={{ flex: 1, fontWeight: 800, fontSize: h[1].length === 1 ? '14px' : '13px', color: '#f4c98a' }}>{h[2]}</span>;
        } else {
          content = <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: line ? '#e8ddc8' : 'rgba(201,189,168,0.35)' }}>{line || (lines.length === 1 ? placeholder : '')}</span>;
        }
        return (
          <div key={i} style={rowBase} onMouseDown={e => { e.preventDefault(); focusLine(i, line.length); }}>{content}</div>
        );
      })}
    </div>
  );
};

interface DiaryViewProps {
  fileContents: Record<string, string>;
  onSaveNote: (path: string, content: string) => Promise<void>;
  onOpenNote: (path: string) => void;
}

export default function DiaryView({ fileContents, onSaveNote, onOpenNote }: DiaryViewProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [numWeeks, setNumWeeks] = useState<1 | 2>(1);
  // Kullanıcı yazarken `fileContents` henüz güncellenmemiş olabilir (kaydetme async/debounce'lu)
  // — o yüzden aktif düzenlenen metin, kaydedilene kadar YEREL state'te (draft) tutulur, prop'tan
  // asla geri okunup üzerine yazılmaz (aksi halde yazarken imleç/metin sıçrardı).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Kaydetme anında EN GÜNCEL dosya içeriğinden görev satırlarını okumak için (debounce
  // sırasında başka bir yerden eklenen görev satırı ezilmesin).
  const contentsRef = useRef(fileContents);
  contentsRef.current = fileContents;

  const todayStr = toDateStr(new Date());

  const weekDays = useMemo(() => {
    const base = mondayOf(new Date());
    base.setDate(base.getDate() + weekOffset * 7);
    return Array.from({ length: numWeeks * 7 }).map((_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const dateStr = toDateStr(d);
      const weekdayIdx = i % 7;
      return {
        dateStr,
        dayNum: d.getDate(),
        monthShort: MONTH_SHORT[d.getMonth()],
        weekdayShort: WEEKDAY_SHORT[weekdayIdx],
        weekdayFull: WEEKDAY_FULL[weekdayIdx],
        monthFull: MONTH_FULL[d.getMonth()],
        isToday: dateStr === todayStr,
        path: `${DIARY_FOLDER}/${dateStr}.md`
      };
    });
  }, [weekOffset, numWeeks, todayStr]);

  const rangeLabel = useMemo(() => {
    const first = weekDays[0], last = weekDays[weekDays.length - 1];
    if (!first || !last) return '';
    return first.monthShort === last.monthShort
      ? `${first.dayNum} – ${last.dayNum} ${last.monthShort}`
      : `${first.dayNum} ${first.monthShort} – ${last.dayNum} ${last.monthShort}`;
  }, [weekDays]);

  // Yazarken debounce'lu kaydetme — her tuş vuruşunda değil, kullanıcı durakladığında kaydeder.
  // Dosyaya yazılacak içerik: başlık + (korunan) görev satırları + kullanıcının serbest metni.
  const buildContent = (day: (typeof weekDays)[number], freeText: string) => {
    const header = headerFor(day.weekdayFull, day.dayNum, day.monthFull);
    const fileTasks = splitBody(bodyOf(contentsRef.current[day.path], header)).taskLines;
    // Kullanıcı serbest metin alanına bir görev satırı yazdıysa/yapıştırdıysa o da görev
    // satırı sayılır — tekilleştirerek (aynı satır iki kez yazılmasın) birleştirilir.
    const typed = splitBody(freeText);
    const taskLines = Array.from(new Set([...fileTasks, ...typed.taskLines]));
    return `${header}\n\n${taskLines.length ? taskLines.join('\n') + '\n\n' : ''}${typed.freeText}`;
  };

  const handleChange = (day: (typeof weekDays)[number], value: string) => {
    setDrafts(prev => ({ ...prev, [day.path]: value }));
    if (saveTimers.current[day.path]) clearTimeout(saveTimers.current[day.path]);
    saveTimers.current[day.path] = setTimeout(() => commit(day, value), SAVE_DEBOUNCE_MS);
  };

  // Kaydeder ve düzenleme alanını (draft) görev satırlarından arındırır — görev satırları
  // kaydedildikten sonra temiz satır olarak gösterildiğinden alanda ham halde kalmamalı.
  const commit = (day: (typeof weekDays)[number], value: string) => {
    onSaveNote(day.path, buildContent(day, value));
    // Metne SADECE içinde etiketli görev satırı varsa dokun, o da yalnızca o satırları
    // çıkararak (baştaki/sondaki boşlukları KIRPMADAN) — aksi halde kayıttan sonra metnin
    // sonundaki Enter ile açılan boş satır siliniyor ve imleç yukarı sıçrıyordu.
    if (value.split('\n').some(isTaskLine)) {
      setDrafts(prev => ({ ...prev, [day.path]: value.split('\n').filter(l => !isTaskLine(l)).join('\n') }));
    }
  };

  // Sayfadan ayrılmadan/sekme kapanmadan önce bekleyen (henüz debounce süresi dolmamış)
  // kaydetmeleri hemen uygular — aksi halde son birkaç saniyelik yazı kaybolabilirdi.
  const flushPending = () => {
    Object.entries(saveTimers.current).forEach(([path, timer]) => clearTimeout(timer));
    saveTimers.current = {};
  };
  React.useEffect(() => () => flushPending(), []);

  const openInFullEditor = async (day: (typeof weekDays)[number]) => {
    if (fileContents[day.path] === undefined && drafts[day.path] === undefined) {
      const header = headerFor(day.weekdayFull, day.dayNum, day.monthFull);
      await onSaveNote(day.path, `${header}\n\n`);
    }
    onOpenNote(day.path);
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px', background: '#1c1712' }} className="custom-scroll">
      <div style={{ maxWidth: numWeeks === 2 ? '1180px' : '820px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* Başlık + hafta gezinme */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>📔</span>
            <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: '#f0e6d2' }}>GÜNLÜK</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button" onClick={() => setNumWeeks(w => (w === 1 ? 2 : 1))}
              style={{ padding: '7px 12px', borderRadius: '8px', border: '1px solid rgba(240,230,210,0.2)', background: numWeeks === 2 ? 'rgba(224,164,88,0.18)' : 'rgba(240,230,210,0.06)', color: '#f0e6d2', cursor: 'pointer', fontSize: '11.5px', fontWeight: 700 }}
            >{numWeeks === 2 ? '📅 2 Hafta' : '📅 1 Hafta'}</button>
            <button
              type="button" onClick={() => setWeekOffset(o => o - 1)}
              style={{ padding: '7px 12px', borderRadius: '8px', border: '1px solid rgba(240,230,210,0.2)', background: 'rgba(240,230,210,0.06)', color: '#f0e6d2', cursor: 'pointer', fontSize: '13px' }}
            >‹</button>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '110px' }}>
              <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#f0e6d2' }}>{rangeLabel}</span>
              {weekOffset !== 0 && (
                <button type="button" onClick={() => setWeekOffset(0)} style={{ background: 'none', border: 'none', color: '#e0a458', fontSize: '10.5px', cursor: 'pointer', padding: 0 }}>Bugüne dön</button>
              )}
            </div>
            <button
              type="button" onClick={() => setWeekOffset(o => o + 1)}
              style={{ padding: '7px 12px', borderRadius: '8px', border: '1px solid rgba(240,230,210,0.2)', background: 'rgba(240,230,210,0.06)', color: '#f0e6d2', cursor: 'pointer', fontSize: '13px' }}
            >›</button>
          </div>
        </div>

        {/* Haftalık sayfa — her gün AYRI, doğrudan yazılabilir, çizgili bir kutu; bugünün
            kutusu çerçeveyle ayırt ediliyor. Hepsi AYNI ANDA görünür ve düzenlenebilir. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          {weekDays.map(day => {
            const header = headerFor(day.weekdayFull, day.dayNum, day.monthFull);
            const { taskLines, freeText } = splitBody(bodyOf(fileContents[day.path], header));
            const value = drafts[day.path] !== undefined ? drafts[day.path] : freeText;
            const tasks = taskLines.map(parseTask);
            return (
              <div
                key={day.dateStr}
                style={{
                  borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: '190px',
                  background: day.isToday ? 'linear-gradient(180deg, #3a2416, #2a1c10)' : 'linear-gradient(180deg, #2b2620, #211d18)',
                  boxShadow: day.isToday ? '0 0 0 1.5px #e0a458, 0 4px 14px rgba(224,164,88,0.15)' : '0 1px 0 rgba(255,255,255,0.04) inset, 0 4px 10px rgba(0,0,0,0.25)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '10px 12px 6px' }}>
                  <span style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.5px', color: day.isToday ? '#f4c98a' : '#a89a86', textTransform: 'uppercase' }}>{day.weekdayShort}</span>
                  <span style={{ fontSize: '18px', fontWeight: 800, color: day.isToday ? '#f4c98a' : '#f0e6d2', fontFamily: 'monospace' }}>{day.dayNum}</span>
                  <button
                    type="button" onClick={() => openInFullEditor(day)} title="Tam editörde aç"
                    style={{ background: 'none', border: 'none', color: 'rgba(240,230,210,0.4)', cursor: 'pointer', fontSize: '12px', padding: '2px' }}
                  >↗</button>
                </div>
                {tasks.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', padding: '0 10px 8px' }}>
                    {tasks.map((t, i) => (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '6px 8px', borderRadius: '7px', background: 'rgba(0,0,0,0.22)', borderLeft: `3px solid ${t.done ? '#6aa86a' : '#a89a86'}` }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                          <span style={{ fontSize: '11px', color: t.done ? '#6aa86a' : '#a89a86', lineHeight: '16px' }}>{t.done ? '✓' : '○'}</span>
                          <span style={{ fontSize: '11.5px', lineHeight: '16px', color: t.done ? '#bfb29c' : '#e8ddc8', textDecoration: t.done ? 'line-through' : 'none', textDecorationColor: 'rgba(191,178,156,0.5)' }}>{t.title}</span>
                        </div>
                        {(t.project || t.planned || t.completedAt || t.outcome) && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', paddingLeft: '17px' }}>
                            {t.project && <span style={{ fontSize: '9.5px', padding: '1px 6px', borderRadius: '8px', background: 'rgba(224,164,88,0.16)', color: '#e0a458' }}>📁 {t.project}</span>}
                            {t.planned && <span style={{ fontSize: '9.5px', padding: '1px 6px', borderRadius: '8px', background: 'rgba(240,230,210,0.08)', color: '#a89a86' }}>🕘 {t.planned}</span>}
                            {t.completedAt && <span style={{ fontSize: '9.5px', padding: '1px 6px', borderRadius: '8px', background: 'rgba(106,168,106,0.14)', color: '#8fc48f' }}>✔ {t.completedAt}</span>}
                            {t.outcome && <span style={{ fontSize: '9.5px', padding: '1px 6px', borderRadius: '8px', background: 'rgba(240,230,210,0.08)', color: '#c9bda8' }}>{t.outcome}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <LiveLines
                  value={value}
                  onChange={v => handleChange(day, v)}
                  onFlush={() => {
                    // Odak kutudan tamamen çıkınca bekleyen kaydı hemen uygula — kullanıcı başka
                    // bir güne geçtiğinde son yazdığı satırın debounce süresini beklememesi için.
                    if (saveTimers.current[day.path]) {
                      clearTimeout(saveTimers.current[day.path]);
                      delete saveTimers.current[day.path];
                      commit(day, value);
                    }
                  }}
                  placeholder="Buraya yaz…"
                />

              </div>
            );
          })}
        </div>

        <div style={{ fontSize: '10.5px', color: 'rgba(240,230,210,0.35)', textAlign: 'center' }}>
          Her gün, "{DIARY_FOLDER}" klasöründe gerçek bir not olarak kaydedilir — yazarken otomatik kaydedilir, ↗ ile tam editörde açabilirsin.
        </div>
      </div>
    </div>
  );
}
