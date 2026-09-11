import React, { useMemo, useState } from 'react';

// ============================================================================
// HUNTER SİSTEMİ — Solo Leveling temalı fitness/görev modülü
// ============================================================================
// İSTEK (kullanıcı): "arise" uygulaması gibi Solo Leveling temalı bir fitness modülü —
// Hunter/Rank(E-S)/Shadow teması, günlük görev XP'si, kaçırılan görev sonrası ertesi gün
// devreye giren, tamamlanmazsa büyüyen bir "Penalty Quest" (Penalty Zone mantığı), ve rank
// atlamanın günlük XP birikimiyle DEĞİL ayrı bir zorlu "Yükselme Zindanı" (Promotion Dungeon)
// tamamlanarak olması.
//
// GÖRSELLİK NOTU: Solo Leveling'in kendi karakter/illüstrasyon çizimleri telif hakkıyla
// korunuyor — internetten çekip gömemeyiz. Bunun yerine AYNI "Sistem HUD" hissini (hexagon
// rank rozeti, camgöbeği glow, kas grubu diyagramı) TAMAMEN ORİJİNAL, kod içinde çizilen
// SVG'lerle kuruyoruz — telifsiz, dosya boyutu yok, her temada/çözünürlükte net.
//
// VERİ: hiçbir yeni depolama mekanizması icat edilmiyor — uygulamanın geri kalanıyla AYNI
// şekilde, tek bir not dosyasında ([Sistem/Hunter.md]) köşeli-parantez etiketleriyle
// saklanıyor, bu yüzden telefon (Capacitor) ve masaüstü (Electron) arasında otomatik olarak
// aynı senkron/okuma-yazma altyapısını (onSaveNote/readNoteContent/fileContents) kullanıyor.

const HUNTER_NOTE_PATH = 'Sistem/Hunter.md';

type Rank = 'E' | 'D' | 'C' | 'B' | 'A' | 'S';
const RANK_ORDER: Rank[] = ['E', 'D', 'C', 'B', 'A', 'S'];
const RANK_COLOR: Record<Rank, string> = {
  E: '#9ca3af',
  D: '#22c55e',
  C: '#3b82f6',
  B: '#a855f7',
  A: '#f97316',
  S: '#facc15'
};
const RANK_TITLE: Record<Rank, string> = {
  E: 'E-Rank Hunter',
  D: 'D-Rank Hunter',
  C: 'C-Rank Hunter',
  B: 'B-Rank Hunter',
  A: 'A-Rank Hunter',
  S: 'S-Rank Hunter'
};

// Rank'e göre GÜNLÜK görev hedefleri (tekrar sayısı) — kullanıcı isterse sonradan
// ayarlanabilir hale getirilir, şimdilik makul bir ilerleme eğrisi.
const BASE_QUEST: Record<Rank, { pushups: number; situps: number; squats: number; dumbbell: number }> = {
  E: { pushups: 20, situps: 20, squats: 20, dumbbell: 15 },
  D: { pushups: 40, situps: 40, squats: 40, dumbbell: 25 },
  C: { pushups: 60, situps: 60, squats: 60, dumbbell: 35 },
  B: { pushups: 80, situps: 80, squats: 80, dumbbell: 45 },
  A: { pushups: 100, situps: 100, squats: 100, dumbbell: 60 },
  S: { pushups: 150, situps: 150, squats: 150, dumbbell: 80 }
};

const XP_REWARD = 50;
const XP_MISS_PENALTY = 30;
const XP_PENALTY_FAIL = 50;
// Penalty Zone çarpanı: ilk kaçırmadan sonra 1.5x, her başarısız Penalty Quest'te +0.5x,
// 3x'te tavan yapar (sonsuz zorlaşmasın diye) — bir tanesini bitirince 1x'e (normale) döner.
const PENALTY_MULTIPLIERS = [1, 1.5, 2, 2.5, 3];

interface DailyQuestItem { key: 'pushups' | 'situps' | 'squats' | 'dumbbell'; label: string; group: 'chest' | 'abs' | 'legs' | 'arms'; target: number; done: boolean; }
interface HunterState {
  rank: Rank;
  xp: number;
  penaltyLevel: number; // 0 = normal gün, 1+ = Penalty Zone kademesi
  streak: number;
  bestStreak: number;
  lastDate: string; // YYYY-MM-DD — günün son işlendiği tarih
  lastStatus: 'pending' | 'completed'; // o günün görevi bitirildi mi
  quest: DailyQuestItem[];
  history: { date: string; text: string; xpDelta: number }[];
  shadows: string[]; // 7 günlük seri kilometre taşlarında kazanılan "gölgeler"
}

const EXERCISE_META: { key: DailyQuestItem['key']; label: string; group: DailyQuestItem['group'] }[] = [
  { key: 'pushups', label: 'Şınav', group: 'chest' },
  { key: 'situps', label: 'Mekik', group: 'abs' },
  { key: 'squats', label: 'Squat', group: 'legs' },
  { key: 'dumbbell', label: 'Dambıl Hareketi (2x5kg)', group: 'arms' }
];

const SHADOW_NAMES = ['Igris', 'Iron', 'Tank', 'Beru', 'Greed', 'Tusk', 'Kaisel', 'Bellion'];

const pad2 = (n: number) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const dayOfYear = (d = new Date()) => {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
};

// İSTEK (kullanıcı: "çeşitlilik kattın mı") — her slot (şınav/mekik/squat/dambıl) için sabit
// TEK bir hareket yerine küçük bir HAVUZ tanımlanır; gün değiştikçe (dayOfYear'a göre,
// deterministik — aynı gün her zaman aynı seçimi verir) havuzdan sırayla bir tanesi seçilir.
// Böylece hafta boyunca aynı kas grubu çalışılır ama tekdüzelik olmaz.
const EXERCISE_POOL: Record<DailyQuestItem['key'], string[]> = {
  pushups: ['Şınav', 'Elmas Şınav', 'Geniş Şınav', 'Eğik Şınav'],
  situps: ['Mekik', 'Bisiklet Mekik', 'Plank (sn)', 'V-Up'],
  squats: ['Squat', 'Jump Squat', 'Lunge (bacak başına)', 'Bulgar Squat'],
  dumbbell: ['Dambıl Curl', 'Dambıl Shoulder Press', 'Dambıl Row', 'Dambıl Lateral Raise']
};

const questTargets = (rank: Rank, penaltyLevel: number, dateStr: string) => {
  const base = BASE_QUEST[rank];
  const mult = PENALTY_MULTIPLIERS[Math.min(penaltyLevel, PENALTY_MULTIPLIERS.length - 1)];
  const dIdx = dayOfYear(new Date(`${dateStr}T00:00:00`));
  return EXERCISE_META.map(m => {
    const pool = EXERCISE_POOL[m.key];
    const variant = pool[dIdx % pool.length];
    return {
      key: m.key, label: variant, group: m.group,
      target: Math.round((base as any)[m.key] * mult),
      done: false
    };
  });
};

// ============================================================================
// Not dosyasından state okuma / yazma — uygulamanın geri kalanıyla AYNI köşeli-parantez
// etiket konvansiyonu. Header satırı state'i taşır, "## Günlük Görev" altındaki checklist
// bugünün egzersizlerini, "## Geçmiş" altındaki liste ise tamamlanma/kaçırma kaydını tutar.
// ============================================================================
function parseHunterState(content: string): HunterState {
  const rankMatch = content.match(/\[rank:(E|D|C|B|A|S)\]/i);
  const xpMatch = content.match(/\[xp:(-?\d+)\]/i);
  const penaltyMatch = content.match(/\[penaltyLevel:(\d+)\]/i);
  const streakMatch = content.match(/\[streak:(\d+)\]/i);
  const bestStreakMatch = content.match(/\[bestStreak:(\d+)\]/i);
  const lastDateMatch = content.match(/\[lastDate:(\d{4}-\d{2}-\d{2})\]/i);
  const lastStatusMatch = content.match(/\[lastStatus:(pending|completed)\]/i);

  const rank = (rankMatch ? rankMatch[1].toUpperCase() : 'E') as Rank;
  const xp = xpMatch ? parseInt(xpMatch[1], 10) : 0;
  const penaltyLevel = penaltyMatch ? parseInt(penaltyMatch[1], 10) : 0;
  const streak = streakMatch ? parseInt(streakMatch[1], 10) : 0;
  const bestStreak = bestStreakMatch ? parseInt(bestStreakMatch[1], 10) : 0;
  const lastDate = lastDateMatch ? lastDateMatch[1] : '';
  const lastStatus = (lastStatusMatch ? lastStatusMatch[1] : 'pending') as 'pending' | 'completed';

  // Günlük görev checklist'i
  const quest: DailyQuestItem[] = [];
  const questSectionMatch = content.match(/## Günlük Görev[^\n]*\n([\s\S]*?)(?=\n##|\n?$)/);
  if (questSectionMatch) {
    const lines = questSectionMatch[1].split('\n');
    lines.forEach(line => {
      // BUG DÜZELTMESİ (kullanıcı geri bildirimi: "neden sürekli 20 tekrar yazmış" — etiket
      // her kaydetmede bir tane daha "— 20 tekrar" ekleyip büyüyordu): SERBEST METNİ (satırın
      // görünen kısmını) ASLA "label" olarak GERİ OKUMUYORUZ artık — aynı satırda hem
      // görüntülenen metni hem de o metni üreten veriyi tutmak, her kaydette birbirinin
      // üstüne binen bir döngü yaratıyordu (İş Planla'daki isim ikilenmesi hatasıyla AYNI kök
      // sebep). `key` zaten hangi sabit egzersiz olduğunu tek başına belirlediği için, etiket
      // METNİ HER ZAMAN EXERCISE_META'dan türetilir — dosyadaki serbest metin tamamen
      // yok sayılır (varsa bile).
      // İSTEK (kullanıcı: "çeşitlilik kattın mı"): her slot artık SABİT tek hareket değil,
      // günlük dönen bir havuzdan seçiliyor — bu yüzden etiket metni artık EXERCISE_META'dan
      // DEĞİL, ayrı ve TEK amaçlı bir [variant:...] etiketinden okunur (yukarıdaki "serbest
      // metni asla geri okuma" kuralı hâlâ geçerli — variant SADECE bu tag'den gelir, satırın
      // görünen kısmından değil).
      const m = line.match(/\[key:(\w+)\]\s*\[target:(\d+)\]\s*\[group:(\w+)\]\s*\[variant:([^\]]*)\]/);
      const checkedMatch = line.match(/^\s*[*\-]\s+\[([ xX])\]/);
      if (m && checkedMatch) {
        const meta = EXERCISE_META.find(e => e.key === m[1]);
        quest.push({
          done: checkedMatch[1].toLowerCase() === 'x',
          label: m[4].trim() || (meta ? meta.label : m[1]),
          key: m[1] as DailyQuestItem['key'],
          target: parseInt(m[2], 10),
          group: m[3] as DailyQuestItem['group']
        });
      }
    });
  }

  // Geçmiş
  const history: HunterState['history'] = [];
  const historySectionMatch = content.match(/## Geçmiş\n([\s\S]*?)(?=\n##|\n?$)/);
  if (historySectionMatch) {
    historySectionMatch[1].split('\n').forEach(line => {
      const m = line.match(/^\s*-\s+(\d{4}-\d{2}-\d{2}):\s*(.*?)\s*\[xpDelta:(-?\d+)\]/);
      if (m) history.push({ date: m[1], text: m[2].trim(), xpDelta: parseInt(m[3], 10) });
    });
  }

  const shadows: string[] = [];
  const shadowSectionMatch = content.match(/## Gölge Ordusu\n([\s\S]*?)(?=\n##|\n?$)/);
  if (shadowSectionMatch) {
    shadowSectionMatch[1].split('\n').forEach(line => {
      const m = line.match(/^\s*-\s+(.+)$/);
      if (m) shadows.push(m[1].trim());
    });
  }

  return { rank, xp, penaltyLevel, streak, bestStreak, lastDate, lastStatus, quest, history, shadows };
}

function serializeHunterState(s: HunterState): string {
  const header = `# Hunter Sistemi\n\n[rank:${s.rank}] [xp:${s.xp}] [penaltyLevel:${s.penaltyLevel}] [streak:${s.streak}] [bestStreak:${s.bestStreak}] [lastDate:${s.lastDate}] [lastStatus:${s.lastStatus}]\n`;
  // Satırın görünen metni SADECE bilgi amaçlı (kullanıcı notu ham olarak açarsa okunabilir
  // olsun diye) — geri okunurken KULLANILMIYOR (bkz. parseHunterState'teki uyarı), bu yüzden
  // burada güvenle sabit/temiz kalabilir, her kaydette büyümez.
  const questLines = s.quest.map(q => `- [${q.done ? 'x' : ' '}] ${q.label} [key:${q.key}] [target:${q.target}] [group:${q.group}] [variant:${q.label}]`).join('\n');
  const questSection = `\n## Günlük Görev — ${s.lastDate}${s.penaltyLevel > 0 ? ' ⚠️ PENALTY QUEST' : ''}\n${questLines}\n`;
  const historyLines = s.history.slice(0, 60).map(h => `- ${h.date}: ${h.text} [xpDelta:${h.xpDelta}]`).join('\n');
  const historySection = `\n## Geçmiş\n${historyLines}\n`;
  const shadowLines = s.shadows.map(sh => `- ${sh}`).join('\n');
  const shadowSection = `\n## Gölge Ordusu\n${shadowLines}\n`;
  return header + questSection + historySection + shadowSection;
}

// ============================================================================
// Orijinal SVG bileşenleri — telifsiz, "Sistem HUD" estetiği
// ============================================================================

const RankHexagon: React.FC<{ rank: Rank; size?: number }> = ({ rank, size = 96 }) => {
  const color = RANK_COLOR[rank];
  const points = '50,3 93,26 93,74 50,97 7,74 7,26';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <defs>
        <filter id={`glow-${rank}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <polygon points={points} fill="rgba(15,23,42,0.9)" stroke={color} strokeWidth="2.5" filter={`url(#glow-${rank})`} />
      <polygon points={points} fill="none" stroke={color} strokeWidth="0.8" opacity="0.5" transform="scale(0.88)" transform-origin="50 50" />
      <text x="50" y="62" textAnchor="middle" fontSize="34" fontWeight="800" fill={color} fontFamily="monospace">{rank}</text>
    </svg>
  );
};

// Önden basit hunter silüeti — kas grupları ayrı path'ler, tamamlanan egzersize göre
// parlıyor (done=true → dolu+glow, pending → sadece ince kontur).
const MuscleBodyDiagram: React.FC<{ status: Record<DailyQuestItem['group'], boolean>; rankColor: string }> = ({ status, rankColor }) => {
  const fillFor = (group: DailyQuestItem['group']) => status[group] ? rankColor : 'rgba(148,163,184,0.12)';
  const strokeFor = (group: DailyQuestItem['group']) => status[group] ? rankColor : 'rgba(148,163,184,0.4)';
  const glow = (group: DailyQuestItem['group']) => status[group] ? { filter: 'url(#bodyGlow)' } : {};
  return (
    <svg width="150" height="260" viewBox="0 0 150 260">
      <defs>
        <filter id="bodyGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Baş */}
      <circle cx="75" cy="22" r="16" fill="rgba(148,163,184,0.1)" stroke="rgba(148,163,184,0.4)" strokeWidth="1.5" />
      {/* Boyun */}
      <rect x="68" y="36" width="14" height="10" fill="rgba(148,163,184,0.1)" />
      {/* Göğüs (chest) */}
      <path d="M45 48 Q75 38 105 48 L100 88 Q75 96 50 88 Z" fill={fillFor('chest')} stroke={strokeFor('chest')} strokeWidth="1.5" style={glow('chest')} />
      {/* Karın (abs) */}
      <rect x="58" y="90" width="34" height="46" rx="6" fill={fillFor('abs')} stroke={strokeFor('abs')} strokeWidth="1.5" style={glow('abs')} />
      {/* Kollar (arms) — iki taraf */}
      <ellipse cx="35" cy="70" rx="10" ry="28" fill={fillFor('arms')} stroke={strokeFor('arms')} strokeWidth="1.5" style={glow('arms')} />
      <ellipse cx="115" cy="70" rx="10" ry="28" fill={fillFor('arms')} stroke={strokeFor('arms')} strokeWidth="1.5" style={glow('arms')} />
      <rect x="27" y="96" width="16" height="24" rx="6" fill={fillFor('arms')} stroke={strokeFor('arms')} strokeWidth="1.2" opacity="0.85" />
      <rect x="107" y="96" width="16" height="24" rx="6" fill={fillFor('arms')} stroke={strokeFor('arms')} strokeWidth="1.2" opacity="0.85" />
      {/* Bacaklar (legs) */}
      <rect x="56" y="138" width="17" height="80" rx="7" fill={fillFor('legs')} stroke={strokeFor('legs')} strokeWidth="1.5" style={glow('legs')} />
      <rect x="77" y="138" width="17" height="80" rx="7" fill={fillFor('legs')} stroke={strokeFor('legs')} strokeWidth="1.5" style={glow('legs')} />
    </svg>
  );
};

interface HunterViewProps {
  fileContents: Record<string, string>;
  readNoteContent: (path: string) => Promise<string>;
  onSaveNote: (path: string, content: string) => Promise<void>;
}

export default function HunterView({ fileContents, readNoteContent, onSaveNote }: HunterViewProps) {
  const [dungeonMode, setDungeonMode] = useState(false);
  const [dungeonDone, setDungeonDone] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const rawContent = fileContents[HUNTER_NOTE_PATH];

  // İlk kez açılıyorsa (not hiç yoksa) taze bir E-Rank başlangıç state'i.
  const state: HunterState = useMemo(() => {
    if (!rawContent) {
      return {
        rank: 'E', xp: 0, penaltyLevel: 0, streak: 0, bestStreak: 0,
        lastDate: todayStr(), lastStatus: 'pending',
        quest: questTargets('E', 0, todayStr()), history: [], shadows: []
      };
    }
    const parsed = parseHunterState(rawContent);
    return parsed;
  }, [rawContent]);

  // Gün geçişi kontrolü: not dosyasındaki lastDate bugünden eskiyse, dünün görevi
  // tamamlanmamışsa (lastStatus hâlâ 'pending') CEZA uygulanır + Penalty Zone kademesi
  // artar; tamamlanmışsa ceza yok. Ardından BUGÜN için taze görev üretilir. Bu efekt
  // SADECE bir kez, gün değiştiğinde bir sonraki save ile tetiklenir (React state değil,
  // doğrudan not içeriği okunup yazılır — sayfa her açıldığında/render'da kontrol edilir).
  const needsRollover = state.lastDate !== '' && state.lastDate !== todayStr();

  const applyRollover = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const missed = state.lastStatus !== 'completed';
      let newXp = state.xp;
      let newPenaltyLevel = state.penaltyLevel;
      let newStreak = state.streak;
      const historyEntry: HunterState['history'][number] = { date: state.lastDate, text: '', xpDelta: 0 };

      if (missed) {
        const wasAlreadyPenalty = state.penaltyLevel > 0;
        newXp -= wasAlreadyPenalty ? XP_PENALTY_FAIL : XP_MISS_PENALTY;
        newPenaltyLevel = Math.min(state.penaltyLevel + 1, PENALTY_MULTIPLIERS.length - 1);
        newStreak = 0;
        historyEntry.text = wasAlreadyPenalty ? '⚠️ Penalty Quest de kaçırıldı — ceza büyüdü' : '❌ Görev kaçırıldı';
        historyEntry.xpDelta = wasAlreadyPenalty ? -XP_PENALTY_FAIL : -XP_MISS_PENALTY;
      }
      // (completed durumu zaten checkbox handler'ında işlendi, burada tekrar XP verilmez —
      // sadece hiç dokunulmadıysa/miss ise işlenir.)

      const newState: HunterState = {
        ...state,
        xp: newXp,
        penaltyLevel: newPenaltyLevel,
        streak: newStreak,
        lastDate: todayStr(),
        lastStatus: 'pending',
        quest: questTargets(state.rank, newPenaltyLevel, todayStr()),
        history: missed ? [historyEntry, ...state.history] : state.history
      };
      await onSaveNote(HUNTER_NOTE_PATH, serializeHunterState(newState));
    } finally {
      setBusy(false);
    }
  };

  const toggleExercise = async (key: DailyQuestItem['key']) => {
    if (busy || needsRollover) return;
    setBusy(true);
    try {
      const updatedQuest = state.quest.map(q => q.key === key ? { ...q, done: !q.done } : q);
      const allDone = updatedQuest.length > 0 && updatedQuest.every(q => q.done);
      const justCompleted = allDone && state.lastStatus !== 'completed';

      let newXp = state.xp;
      let newPenaltyLevel = state.penaltyLevel;
      let newStreak = state.streak;
      let newBestStreak = state.bestStreak;
      let newShadows = state.shadows;
      let newHistory = state.history;

      if (justCompleted) {
        newXp += XP_REWARD;
        newPenaltyLevel = 0; // Penalty Quest'i bitirdiyse döngü biter, normale döner.
        newStreak = state.streak + 1;
        newBestStreak = Math.max(state.bestStreak, newStreak);
        const label = state.penaltyLevel > 0 ? '🔥 Penalty Quest tamamlandı — döngü kırıldı!' : '✅ Görev tamamlandı';
        newHistory = [{ date: state.lastDate, text: label, xpDelta: XP_REWARD }, ...state.history];
        if (newStreak > 0 && newStreak % 7 === 0) {
          const nextShadow = SHADOW_NAMES[state.shadows.length % SHADOW_NAMES.length];
          newShadows = [...state.shadows, `${nextShadow} (${newStreak} gün seri)`];
        }
      }

      const newState: HunterState = {
        ...state,
        xp: newXp,
        penaltyLevel: newPenaltyLevel,
        streak: newStreak,
        bestStreak: newBestStreak,
        lastStatus: justCompleted ? 'completed' : state.lastStatus,
        quest: updatedQuest,
        history: newHistory,
        shadows: newShadows
      };
      await onSaveNote(HUNTER_NOTE_PATH, serializeHunterState(newState));
    } finally {
      setBusy(false);
    }
  };

  const enterDungeon = () => {
    setDungeonDone({});
    setDungeonMode(true);
  };

  const dungeonTargets = useMemo(() => {
    const base = BASE_QUEST[state.rank];
    return EXERCISE_META.map(m => ({ ...m, target: Math.round((base as any)[m.key] * 3) }));
  }, [state.rank]);

  const finishDungeon = async () => {
    if (busy) return;
    const allDone = dungeonTargets.every(t => dungeonDone[t.key]);
    if (!allDone) return;
    setBusy(true);
    try {
      const currentIdx = RANK_ORDER.indexOf(state.rank);
      const nextRank = RANK_ORDER[Math.min(currentIdx + 1, RANK_ORDER.length - 1)];
      const rankedUp = currentIdx < RANK_ORDER.length - 1;
      const newState: HunterState = {
        ...state,
        rank: nextRank,
        xp: 0,
        penaltyLevel: 0,
        quest: questTargets(nextRank, 0, todayStr()),
        history: [{ date: todayStr(), text: rankedUp ? `🌀 Yükselme Zindanı tamamlandı — ${nextRank}-Rank'e terfi!` : '🏆 Zaten en üst rank\'tesin', xpDelta: 0 }, ...state.history]
      };
      await onSaveNote(HUNTER_NOTE_PATH, serializeHunterState(newState));
      setDungeonMode(false);
    } finally {
      setBusy(false);
    }
  };

  const groupStatus: Record<DailyQuestItem['group'], boolean> = { chest: false, abs: false, legs: false, arms: false };
  state.quest.forEach(q => { if (q.done) groupStatus[q.group] = true; });
  const rankColor = RANK_COLOR[state.rank];
  const completedCount = state.quest.filter(q => q.done).length;
  const progressPercent = state.quest.length > 0 ? Math.round((completedCount / state.quest.length) * 100) : 0;

  // İSTEK (kullanıcı: "günlük haftalık tutuyor musun, grafikler olacak mı gidişatı takip
  // için"): geçmiş kaydından (zaten var olan `history`) GÜNE göre XP toplamı ve başarı/
  // kaçırma durumu çıkarılır — ayrı bir istatistik deposu icat edilmiyor, her şey aynı
  // Sistem/Hunter.md'den türetiliyor (uygulamanın geri kalanının felsefesiyle tutarlı).
  const dailyAgg = useMemo(() => {
    const map = new Map<string, { xp: number; success: boolean; fail: boolean }>();
    state.history.forEach(h => {
      const cur = map.get(h.date) || { xp: 0, success: false, fail: false };
      cur.xp += h.xpDelta;
      if (h.text.includes('✅') || h.text.includes('🔥')) cur.success = true;
      if (h.text.includes('❌') || h.text.includes('⚠️')) cur.fail = true;
      map.set(h.date, cur);
    });
    return map;
  }, [state.history]);

  const last7Days = useMemo(() => {
    const days: { date: string; label: string; xp: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      days.push({ date: ds, label: 'PSÇPCCP'[d.getDay() === 0 ? 6 : d.getDay() - 1], xp: dailyAgg.get(ds)?.xp ?? 0 });
    }
    return days;
  }, [dailyAgg]);
  const maxWeekXp = Math.max(50, ...last7Days.map(d => Math.abs(d.xp)));

  const last30Days = useMemo(() => {
    const days: { date: string; status: 'success' | 'fail' | 'none' }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const agg = dailyAgg.get(ds);
      days.push({ date: ds, status: agg?.success ? 'success' : agg?.fail ? 'fail' : 'none' });
    }
    return days;
  }, [dailyAgg]);

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '20px', background: 'radial-gradient(circle at 50% 0%, #0f1b2e 0%, #05070d 60%)', color: '#e2e8f0' }} className="custom-scroll">
      <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>

        {/* Başlık */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>⚔️</span>
          <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 800, letterSpacing: '0.5px', fontFamily: 'monospace', color: '#e2e8f0' }}>HUNTER SİSTEMİ</h2>
        </div>

        {/* Üst kart: rank hexagon + XP + streak */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '20px', padding: '20px',
          borderRadius: '14px', background: 'rgba(15,23,42,0.65)', border: `1px solid ${rankColor}55`,
          boxShadow: `0 0 24px ${rankColor}22`
        }}>
          <RankHexagon rank={state.rank} size={90} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '15px', fontWeight: 700, color: rankColor, fontFamily: 'monospace' }}>{RANK_TITLE[state.rank]}</div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>
              <span>XP: <strong style={{ color: '#e2e8f0' }}>{state.xp}</strong></span>
              <span>🔥 Seri: <strong style={{ color: '#e2e8f0' }}>{state.streak}</strong> gün</span>
              <span>🏆 En iyi: <strong style={{ color: '#e2e8f0' }}>{state.bestStreak}</strong> gün</span>
            </div>
            {state.penaltyLevel > 0 && (
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px' }}>
                ⚠️ PENALTY ZONE — kademe {state.penaltyLevel} ({PENALTY_MULTIPLIERS[Math.min(state.penaltyLevel, PENALTY_MULTIPLIERS.length - 1)]}x zorluk)
              </div>
            )}
          </div>
        </div>

        {needsRollover ? (
          <div style={{ padding: '24px', borderRadius: '14px', background: 'rgba(15,23,42,0.65)', border: '1px solid #ef444455', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
            <div style={{ fontSize: '13px', color: '#94a3b8' }}>Yeni bir gün başladı — dünün görevi kapatılıp bugünün görevi hazırlanacak.</div>
            <button
              type="button"
              disabled={busy}
              onClick={applyRollover}
              style={{ background: rankColor, border: 'none', borderRadius: '8px', color: '#0a0a0a', padding: '10px 20px', fontSize: '13px', fontWeight: 800, cursor: busy ? 'wait' : 'pointer', fontFamily: 'monospace' }}
            >
              {busy ? 'İşleniyor...' : 'BUGÜNÜ BAŞLAT →'}
            </button>
          </div>
        ) : dungeonMode ? (
          // ============ YÜKSELME ZİNDANI (Promotion Dungeon) ============
          <div style={{ padding: '20px', borderRadius: '14px', background: 'rgba(15,23,42,0.75)', border: '1px solid #facc1555', boxShadow: '0 0 30px rgba(250,204,21,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '15px', fontWeight: 800, color: '#facc15', fontFamily: 'monospace' }}>🌀 YÜKSELME ZİNDANI</div>
              <button type="button" onClick={() => setDungeonMode(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}>✕ Çık</button>
            </div>
            <div style={{ fontSize: '11.5px', color: '#94a3b8', marginBottom: '14px' }}>
              Tek oturuşta tamamla — başarırsan <strong style={{ color: '#facc15' }}>{RANK_ORDER[Math.min(RANK_ORDER.indexOf(state.rank) + 1, RANK_ORDER.length - 1)]}-Rank</strong>'e terfi edersin.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {dungeonTargets.map(t => (
                <label key={t.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', background: dungeonDone[t.key] ? 'rgba(250,204,21,0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${dungeonDone[t.key] ? '#facc15' : 'rgba(255,255,255,0.08)'}`, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!dungeonDone[t.key]} onChange={() => setDungeonDone(d => ({ ...d, [t.key]: !d[t.key] }))} style={{ width: '16px', height: '16px', accentColor: '#facc15' }} />
                  <span style={{ flex: 1, fontSize: '13px', fontWeight: dungeonDone[t.key] ? 700 : 500 }}>{t.label}</span>
                  <span style={{ fontSize: '13px', fontFamily: 'monospace', color: '#facc15', fontWeight: 700 }}>{t.target}</span>
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={busy || !dungeonTargets.every(t => dungeonDone[t.key])}
              onClick={finishDungeon}
              style={{
                marginTop: '16px', width: '100%', padding: '12px', borderRadius: '8px', border: 'none',
                background: dungeonTargets.every(t => dungeonDone[t.key]) ? '#facc15' : 'rgba(255,255,255,0.08)',
                color: dungeonTargets.every(t => dungeonDone[t.key]) ? '#0a0a0a' : '#64748b',
                fontWeight: 800, fontSize: '13px', fontFamily: 'monospace',
                cursor: dungeonTargets.every(t => dungeonDone[t.key]) ? 'pointer' : 'not-allowed'
              }}
            >
              TERFİ ET
            </button>
          </div>
        ) : (
          <>
            {/* Kas grubu diyagramı + günlük görev listesi yan yana */}
            <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '16px', borderRadius: '14px', background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <MuscleBodyDiagram status={groupStatus} rankColor={rankColor} />
                <div style={{ fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>{completedCount}/{state.quest.length} TAMAMLANDI</div>
              </div>

              <div style={{ flex: 1, minWidth: '260px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: '#94a3b8', fontFamily: 'monospace', letterSpacing: '0.5px' }}>
                    GÜNLÜK GÖREV {state.penaltyLevel > 0 && <span style={{ color: '#ef4444' }}> ⚠️ PENALTY</span>}
                  </span>
                  {state.lastStatus === 'completed' && <span style={{ fontSize: '10.5px', color: '#22c55e', fontWeight: 700 }}>✅ Bugün bitti</span>}
                </div>
                <div style={{ width: '100%', height: '5px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <div style={{ width: `${progressPercent}%`, height: '100%', background: rankColor, transition: 'width 0.4s ease' }} />
                </div>
                {state.quest.map(q => (
                  <label
                    key={q.key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', cursor: busy ? 'wait' : 'pointer',
                      background: q.done ? `${rankColor}1a` : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${q.done ? rankColor : 'rgba(255,255,255,0.08)'}`,
                      opacity: busy ? 0.6 : 1
                    }}
                  >
                    <input type="checkbox" checked={q.done} disabled={busy} onChange={() => toggleExercise(q.key)} style={{ width: '16px', height: '16px', accentColor: rankColor }} />
                    <span style={{ flex: 1, fontSize: '12.5px', fontWeight: q.done ? 700 : 500, textDecoration: q.done ? 'line-through' : 'none', color: q.done ? '#94a3b8' : '#e2e8f0' }}>{q.label}</span>
                    <span style={{ fontSize: '12.5px', fontFamily: 'monospace', color: rankColor, fontWeight: 700 }}>{q.target}</span>
                  </label>
                ))}
                <div style={{ fontSize: '10px', color: '#64748b', textAlign: 'right', fontFamily: 'monospace' }}>Tamamlarsan +{XP_REWARD} XP</div>
              </div>
            </div>

            {/* Yükselme Zindanı giriş butonu */}
            {RANK_ORDER.indexOf(state.rank) < RANK_ORDER.length - 1 && (
              <button
                type="button"
                onClick={enterDungeon}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  padding: '12px', borderRadius: '10px', border: '1px solid #facc1555',
                  background: 'linear-gradient(90deg, rgba(250,204,21,0.1), rgba(250,204,21,0.02))',
                  color: '#facc15', fontWeight: 800, fontSize: '12.5px', fontFamily: 'monospace', cursor: 'pointer'
                }}
              >
                🌀 YÜKSELME ZİNDANINA GİR ({RANK_ORDER[RANK_ORDER.indexOf(state.rank) + 1]}-Rank için)
              </button>
            )}
          </>
        )}

        {/* İSTEK ("günlük haftalık tutuyor musun, grafikler olacak mı gidişatı takip için"):
            haftalık XP grafiği + 30 günlük tutarlılık haritası (GitHub katkı grafiği stili) —
            ikisi de mevcut `history` kaydından türetilir, ekstra bir depolama yok. */}
        <div style={{ padding: '16px', borderRadius: '14px', background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#64748b', fontFamily: 'monospace', marginBottom: '10px', letterSpacing: '0.5px' }}>📊 HAFTALIK XP</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '70px' }}>
              {last7Days.map(d => {
                const heightPct = Math.max(4, Math.round((Math.abs(d.xp) / maxWeekXp) * 100));
                const barColor = d.xp > 0 ? '#22c55e' : d.xp < 0 ? '#ef4444' : 'rgba(255,255,255,0.12)';
                return (
                  <div key={d.date} title={`${d.date}: ${d.xp >= 0 ? '+' : ''}${d.xp} XP`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: '9px', color: '#64748b', fontFamily: 'monospace' }}>{d.xp !== 0 ? (d.xp > 0 ? `+${d.xp}` : d.xp) : ''}</span>
                    <div style={{ width: '100%', height: `${heightPct}%`, minHeight: '3px', borderRadius: '3px', background: barColor, transition: 'height 0.3s ease' }} />
                    <span style={{ fontSize: '9.5px', color: '#94a3b8', fontFamily: 'monospace' }}>{d.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#64748b', fontFamily: 'monospace', marginBottom: '10px', letterSpacing: '0.5px' }}>🗓️ SON 30 GÜN</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {last30Days.map(d => (
                <div
                  key={d.date}
                  title={`${d.date}: ${d.status === 'success' ? 'Tamamlandı' : d.status === 'fail' ? 'Kaçırıldı' : 'Kayıt yok'}`}
                  style={{
                    width: '16px', height: '16px', borderRadius: '4px',
                    background: d.status === 'success' ? '#22c55e' : d.status === 'fail' ? '#ef4444' : 'rgba(255,255,255,0.06)',
                    border: d.status === 'none' ? '1px solid rgba(255,255,255,0.08)' : 'none'
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Gölge Ordusu */}
        {state.shadows.length > 0 && (
          <div style={{ padding: '16px', borderRadius: '14px', background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(139,92,246,0.3)' }}>
            <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#a78bfa', fontFamily: 'monospace', marginBottom: '10px', letterSpacing: '0.5px' }}>👥 GÖLGE ORDUSU</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {state.shadows.map((sh, i) => (
                <span key={i} style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '8px', background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.4)', color: '#c4b5fd' }}>
                  🗡️ {sh}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Geçmiş */}
        {state.history.length > 0 && (
          <div>
            <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#64748b', fontFamily: 'monospace', marginBottom: '8px', letterSpacing: '0.5px' }}>GEÇMİŞ</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {state.history.slice(0, 15).map((h, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', borderRadius: '7px', background: 'rgba(255,255,255,0.02)', fontSize: '11px' }}>
                  <span style={{ color: '#64748b', fontFamily: 'monospace', flexShrink: 0 }}>{h.date}</span>
                  <span style={{ flex: 1, color: '#cbd5e1' }}>{h.text}</span>
                  {h.xpDelta !== 0 && (
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: h.xpDelta > 0 ? '#22c55e' : '#ef4444', flexShrink: 0 }}>
                      {h.xpDelta > 0 ? '+' : ''}{h.xpDelta} XP
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
