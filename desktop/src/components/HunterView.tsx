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

const XP_REWARD = 50;
const XP_MISS_PENALTY = 30;
const XP_PENALTY_FAIL = 50;
// Penalty Zone çarpanı: ilk kaçırmadan sonra 1.5x, her başarısız Penalty Quest'te +0.5x,
// 3x'te tavan yapar (sonsuz zorlaşmasın diye) — bir tanesini bitirince 1x'e (normale) döner.
const PENALTY_MULTIPLIERS = [1, 1.5, 2, 2.5, 3];

type ExerciseKey = 'pushups' | 'situps' | 'squats' | 'dumbbell' | 'back' | 'shoulders' | 'cardio';
type MuscleGroup = 'chest' | 'abs' | 'legs' | 'arms' | 'back' | 'shoulders' | 'cardio';

// İSTEK (kullanıcı: "gerçek spor eğitimi gibi çeşitlilik ve set/tekrar istiyorum, önce
// konuşalım"): konuşma sonucu netleşen 3 karar — (1) gün bazlı SPLIT (her gün aynı 4 grup
// değil, Push/Pull&Core/Leg/Full-Body dönüşümlü), (2) SET x TEKRAR modeli (tek toplam sayı
// değil, her hareket için ayrı ayrı işaretlenen set sayısı), (3) Sırt + Omuz + Kardiyo
// gruplarının eklenmesi. Her egzersiz artık `sets`/`reps`/`setsDone` taşıyor; tamamlanma
// setsDone >= sets olduğunda gerçekleşiyor (bkz. isQuestDone).
interface DailyQuestItem { key: ExerciseKey; label: string; group: MuscleGroup; sets: number; reps: number; setsDone: number; }
const isQuestDone = (q: DailyQuestItem) => q.setsDone >= q.sets;

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

const EXERCISE_META: { key: ExerciseKey; label: string; group: MuscleGroup }[] = [
  { key: 'pushups', label: 'Şınav', group: 'chest' },
  { key: 'situps', label: 'Mekik', group: 'abs' },
  { key: 'squats', label: 'Squat', group: 'legs' },
  { key: 'dumbbell', label: 'Dambıl Curl', group: 'arms' },
  { key: 'back', label: 'Süperman', group: 'back' },
  { key: 'shoulders', label: 'Dambıl Shoulder Press', group: 'shoulders' },
  { key: 'cardio', label: 'Jumping Jack', group: 'cardio' }
];

const SHADOW_NAMES = ['Igris', 'Iron', 'Tank', 'Beru', 'Greed', 'Tusk', 'Kaisel', 'Bellion'];

const pad2 = (n: number) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const dayOfYear = (d = new Date()) => {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
};

// Her slot için küçük bir HAVUZ — gün değiştikçe (dayOfYear'a göre, deterministik) havuzdan
// sırayla bir tanesi seçilir. Böylece aynı kas grubu çalışılır ama hareket tekdüze kalmaz.
const EXERCISE_POOL: Record<ExerciseKey, string[]> = {
  pushups: ['Şınav', 'Elmas Şınav', 'Geniş Şınav', 'Eğik Şınav'],
  situps: ['Mekik', 'Bisiklet Mekik', 'Plank (sn)', 'V-Up'],
  squats: ['Squat', 'Jump Squat', 'Lunge (bacak başına)', 'Bulgar Squat'],
  dumbbell: ['Dambıl Curl', 'Konsantrasyon Curl', 'Triceps Extension', 'Çekiç Curl'],
  back: ['Süperman', 'Dambıl Eğik Kürek (Row)', 'Ters Kelebek (Reverse Fly)', 'Kar Meleği (Snow Angel)'],
  shoulders: ['Dambıl Shoulder Press', 'Yana Açma (Lateral Raise)', 'Öne Açma (Front Raise)', 'Pike Push-up'],
  cardio: ['Jumping Jack', 'Mountain Climber', 'Burpee', 'Yüksek Diz (High Knees)']
};

// Rank'e göre set sayısı — gerçek antrenman mantığı: rank yükseldikçe hacim (set sayısı)
// da artıyor, sadece tekrar sayısı değil.
const SETS_BY_RANK: Record<Rank, number> = { E: 2, D: 3, C: 3, B: 4, A: 4, S: 5 };

// Rank'e göre SET BAŞINA tekrar hedefi (kaçırma/Penalty çarpanı buna uygulanır).
const REPS_BASE: Record<ExerciseKey, Record<Rank, number>> = {
  pushups: { E: 8, D: 10, C: 12, B: 14, A: 16, S: 20 },
  situps: { E: 10, D: 12, C: 15, B: 18, A: 20, S: 25 },
  squats: { E: 12, D: 15, C: 18, B: 20, A: 25, S: 30 },
  dumbbell: { E: 8, D: 10, C: 12, B: 14, A: 16, S: 20 },
  back: { E: 8, D: 10, C: 12, B: 14, A: 16, S: 20 },
  shoulders: { E: 8, D: 10, C: 12, B: 14, A: 16, S: 18 },
  cardio: { E: 15, D: 20, C: 25, B: 30, A: 35, S: 45 }
};

// İSTEK (kullanıcı: "sadece düz şınav mekik hep aynı gruba hitap etmez mi" — konuşma sonrası
// karar: gün bazlı split): her gün AYNI 4 grup yerine, 4 günlük dönüşümlü bir program —
// kas toparlanma süresine (48 saat) saygılı, gerçek spor salonu mantığına yakın.
const SPLIT_DAYS: { name: string; keys: ExerciseKey[] }[] = [
  { name: 'Push Günü — Göğüs · Omuz · Kol', keys: ['pushups', 'shoulders', 'dumbbell'] },
  { name: 'Pull & Core Günü — Sırt · Karın', keys: ['back', 'situps'] },
  { name: 'Bacak Günü — Bacak · Kondisyon', keys: ['squats', 'cardio'] },
  { name: 'Full-Body & Kondisyon Günü', keys: ['pushups', 'squats', 'situps', 'cardio'] }
];
const splitDayForDate = (dateStr: string) => SPLIT_DAYS[dayOfYear(new Date(`${dateStr}T00:00:00`)) % SPLIT_DAYS.length];

const questTargets = (rank: Rank, penaltyLevel: number, dateStr: string): DailyQuestItem[] => {
  const mult = PENALTY_MULTIPLIERS[Math.min(penaltyLevel, PENALTY_MULTIPLIERS.length - 1)];
  const dIdx = dayOfYear(new Date(`${dateStr}T00:00:00`));
  const sets = SETS_BY_RANK[rank];
  const split = splitDayForDate(dateStr);
  return split.keys.map(key => {
    const meta = EXERCISE_META.find(m => m.key === key)!;
    const pool = EXERCISE_POOL[key];
    const variant = pool[dIdx % pool.length];
    const reps = Math.max(1, Math.round(REPS_BASE[key][rank] * mult));
    return { key, label: variant, group: meta.group, sets, reps, setsDone: 0 };
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
      // İSTEK (kullanıcı: "set ve tekrar de artırırsan" — set×tekrar modeline geçiş):
      // `target` tek toplam sayı yerine `sets`/`reps`/`setsDone` üçlüsüne ayrıldı.
      const m = line.match(/\[key:(\w+)\]\s*\[sets:(\d+)\]\s*\[reps:(\d+)\]\s*\[setsDone:(\d+)\]\s*\[group:(\w+)\]\s*\[variant:([^\]]*)\]/);
      const checkedMatch = line.match(/^\s*[*\-]\s+\[([ xX])\]/);
      if (m && checkedMatch) {
        const meta = EXERCISE_META.find(e => e.key === m[1]);
        const sets = parseInt(m[2], 10);
        quest.push({
          label: m[6].trim() || (meta ? meta.label : m[1]),
          key: m[1] as ExerciseKey,
          sets,
          reps: parseInt(m[3], 10),
          setsDone: Math.min(parseInt(m[4], 10), sets),
          group: m[5] as MuscleGroup
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
  const questLines = s.quest.map(q => `- [${isQuestDone(q) ? 'x' : ' '}] ${q.label} — ${q.sets}x${q.reps} (${q.setsDone}/${q.sets} set) [key:${q.key}] [sets:${q.sets}] [reps:${q.reps}] [setsDone:${q.setsDone}] [group:${q.group}] [variant:${q.label}]`).join('\n');
  const splitName = s.lastDate ? splitDayForDate(s.lastDate).name : '';
  const questSection = `\n## Günlük Görev — ${s.lastDate} — ${splitName}${s.penaltyLevel > 0 ? ' ⚠️ PENALTY QUEST' : ''}\n${questLines}\n`;
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

// Önden hunter silüeti — kas grupları ayrı path'ler, tamamlanan egzersize göre
// parlıyor (done=true → dolu+glow, pending → sadece ince kontur). Rank yükseldikçe
// (E→S) vücut kademeli olarak daha kaslı/karmaşık bir siluete evriliyor: omuzlar
// genişliyor, bel daralıyor (V-taper), abs satırları artıyor, biceps/trap/damar
// detay çizgileri ekleniyor, S-Rank'te aura + omuz zırhı beliriyor.
const MuscleBodyDiagram: React.FC<{ status: Record<MuscleGroup, boolean>; rankColor: string; rank: Rank }> = ({ status, rankColor, rank }) => {
  const fillFor = (group: MuscleGroup) => status[group] ? rankColor : 'rgba(148,163,184,0.12)';
  const strokeFor = (group: MuscleGroup) => status[group] ? rankColor : 'rgba(148,163,184,0.4)';
  const glow = (group: MuscleGroup) => status[group] ? { filter: 'url(#bodyGlow)' } : {};

  const rankIdx = RANK_ORDER.indexOf(rank); // 0 (E) .. 5 (S)
  const t = rankIdx / (RANK_ORDER.length - 1); // 0..1 evrim oranı

  // İSTEK (kullanıcı: gerçek bir anatomik kas haritası referansı paylaşıp "daha çok böyle
  // olsun" dedi) — soyut/blok kapsüller yerine kas gruplarının kendi anatomik biçimine
  // yakın, AYRI ayrı şekiller: iki loblu pektoral, ayrı deltoid kapak, pazı+ön kol ayrımı,
  // yan oblik şeritli six-pack, ayrı quad+baldır. Renk mantığı AYNI kalıyor: her bölge o
  // günkü egzersiz tamamlanınca dolup parlıyor (rank rengi), tamamlanmamışsa soluk gri.
  const shoulderW = 32 + 16 * t;      // omuz genişliği
  const waistW = 16 - 3 * t;          // karın yarı genişliği (V-taper)
  const armRx = 8 + 4.5 * t;          // pazı kalınlığı
  const neckW = 7 + 1.5 * t;
  const absRows = 3 + Math.round(2 * t); // 3..5 satır six-pack
  const showTraps = t >= 0.35;
  const showDeltCaps = t >= 0.35;
  const showDefinitionLines = t >= 0.55;
  const showAura = rankIdx === RANK_ORDER.length - 1; // sadece S-Rank

  const absTop = 96, absBottom = 136;
  const rowH = (absBottom - absTop) / absRows;
  const pecOffset = 9 + 3 * t;   // sternum'dan pektoral merkezine mesafe
  const pecRx = 13 + 4.5 * t;
  const pecRy = 16 + 3.5 * t;
  const pecCy = 62;
  const armCx = { l: 75 - shoulderW - armRx + 5, r: 75 + shoulderW + armRx - 5 };
  const legOuter = 75 - waistW - 2, legInner = 75 - 2, legW = 16 + 2 * t;

  return (
    <svg width="150" height="260" viewBox="0 0 150 260">
      <defs>
        <filter id="bodyGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="auraGlow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="6" result="b2" />
          <feMerge><feMergeNode in="b2" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {showAura && (
        <ellipse cx="75" cy="130" rx="68" ry="122" fill="none" stroke={rankColor} strokeWidth="1.2" opacity="0.35" filter="url(#auraGlow)" />
      )}

      {/* Trapez (üst sırt kası) — Sırt günü tamamlandığında dolup parlıyor */}
      {showTraps && (
        <path
          d={`M${75 - neckW - 5} 40 L${75 - shoulderW + 7} 48 L${75 - neckW} 45 Z M${75 + neckW + 5} 40 L${75 + shoulderW - 7} 48 L${75 + neckW} 45 Z`}
          fill={fillFor('back')} stroke={strokeFor('back')} strokeWidth="0.8" opacity="0.9" style={glow('back')}
        />
      )}

      {/* Baş + boyun */}
      <circle cx="75" cy="20" r="13" fill="rgba(148,163,184,0.1)" stroke="rgba(148,163,184,0.4)" strokeWidth="1.5" />
      <rect x={75 - neckW} y="31" width={neckW * 2} height="10" fill="rgba(148,163,184,0.1)" stroke="rgba(148,163,184,0.3)" strokeWidth="1" />

      {/* Omuz kapağı (deltoid) — Omuz günü tamamlandığında dolup parlıyor, ayrı yuvarlak bir kütle */}
      {showDeltCaps && (
        <>
          <ellipse cx={75 - shoulderW + 4} cy="46" rx={7 + 3 * t} ry={9 + 3.5 * t} fill={fillFor('shoulders')} stroke={strokeFor('shoulders')} strokeWidth="1" style={glow('shoulders')} />
          <ellipse cx={75 + shoulderW - 4} cy="46" rx={7 + 3 * t} ry={9 + 3.5 * t} fill={fillFor('shoulders')} stroke={strokeFor('shoulders')} strokeWidth="1" style={glow('shoulders')} />
        </>
      )}

      {/* Göğüs (chest) — İKİ AYRI pektoral lob (anatomik referansa uygun), tek blok değil */}
      <ellipse cx={75 - pecOffset} cy={pecCy} rx={pecRx} ry={pecRy} fill={fillFor('chest')} stroke={strokeFor('chest')} strokeWidth="1.5" style={glow('chest')} transform={`rotate(-14 ${75 - pecOffset} ${pecCy})`} />
      <ellipse cx={75 + pecOffset} cy={pecCy} rx={pecRx} ry={pecRy} fill={fillFor('chest')} stroke={strokeFor('chest')} strokeWidth="1.5" style={glow('chest')} transform={`rotate(14 ${75 + pecOffset} ${pecCy})`} />
      {showDefinitionLines && (
        <line x1="75" y1="48" x2="75" y2="90" stroke="rgba(2,6,23,0.45)" strokeWidth="2" />
      )}

      {/* Karın (abs) — orta six-pack grid + yan oblikler (aynı grup rengi, daha soluk) */}
      <rect x={75 - waistW - 6} y={absTop + 2} width="6" height={absBottom - absTop - 6} rx="3" fill={fillFor('abs')} opacity="0.55" stroke={strokeFor('abs')} strokeWidth="1" />
      <rect x={75 + waistW} y={absTop + 2} width="6" height={absBottom - absTop - 6} rx="3" fill={fillFor('abs')} opacity="0.55" stroke={strokeFor('abs')} strokeWidth="1" />
      <rect x={75 - waistW} y={absTop} width={waistW * 2} height={absBottom - absTop} rx="6" fill={fillFor('abs')} stroke={strokeFor('abs')} strokeWidth="1.5" style={glow('abs')} />
      {showDefinitionLines && Array.from({ length: absRows - 1 }).map((_, i) => (
        <line key={i} x1={75 - waistW + 3} y1={absTop + rowH * (i + 1)} x2={75 + waistW - 3} y2={absTop + rowH * (i + 1)} stroke="rgba(2,6,23,0.4)" strokeWidth="1.3" />
      ))}
      {showDefinitionLines && (
        <line x1="75" y1={absTop + 2} x2="75" y2={absBottom - 2} stroke="rgba(2,6,23,0.4)" strokeWidth="1.3" />
      )}

      {/* Kollar (arms) — pazı (bicep) ayrı, ön kol (forearm) ayrı ve daha ince/soluk devam ediyor */}
      <ellipse cx={armCx.l} cy="62" rx={armRx} ry={18 + 3.5 * t} fill={fillFor('arms')} stroke={strokeFor('arms')} strokeWidth="1.5" style={glow('arms')} />
      <ellipse cx={armCx.r} cy="62" rx={armRx} ry={18 + 3.5 * t} fill={fillFor('arms')} stroke={strokeFor('arms')} strokeWidth="1.5" style={glow('arms')} />
      {showDefinitionLines && (
        <>
          <path d={`M${armCx.l - 3} 52 Q${armCx.l} 45 ${armCx.l + 3} 52`} fill="none" stroke="rgba(2,6,23,0.4)" strokeWidth="1.2" />
          <path d={`M${armCx.r - 3} 52 Q${armCx.r} 45 ${armCx.r + 3} 52`} fill="none" stroke="rgba(2,6,23,0.4)" strokeWidth="1.2" />
        </>
      )}
      <path d={`M${armCx.l - armRx + 1} 78 L${armCx.l - armRx * 0.6} 122 Q${armCx.l} 128 ${armCx.l + armRx * 0.6} 122 L${armCx.l + armRx - 1} 78 Z`} fill={fillFor('arms')} stroke={strokeFor('arms')} strokeWidth="1.2" opacity="0.75" />
      <path d={`M${armCx.r - armRx + 1} 78 L${armCx.r - armRx * 0.6} 122 Q${armCx.r} 128 ${armCx.r + armRx * 0.6} 122 L${armCx.r + armRx - 1} 78 Z`} fill={fillFor('arms')} stroke={strokeFor('arms')} strokeWidth="1.2" opacity="0.75" />

      {/* Bacaklar (legs) — quad (üst, geniş teardrop) + baldır (alt, daha dar) ayrı şekiller */}
      <path d={`M${legOuter - legW + 2} 138 Q${legOuter - legW} 168 ${legOuter - legW / 2} 186 L${legOuter} 186 Q${legOuter + 3} 158 ${legOuter} 138 Z`} fill={fillFor('legs')} stroke={strokeFor('legs')} strokeWidth="1.5" style={glow('legs')} />
      <path d={`M${legInner} 138 Q${legInner - 3} 158 ${legInner} 186 L${legInner + legW / 2} 186 Q${legInner + legW} 168 ${legInner + legW - 2} 138 Z`} fill={fillFor('legs')} stroke={strokeFor('legs')} strokeWidth="1.5" style={glow('legs')} />
      <path d={`M${legOuter - legW + 4} 188 Q${legOuter - legW + 2} 210 ${legOuter - legW / 2 + 1} 222 L${legOuter - 1} 222 Q${legOuter + 1} 205 ${legOuter - 2} 188 Z`} fill={fillFor('legs')} stroke={strokeFor('legs')} strokeWidth="1.3" opacity="0.8" />
      <path d={`M${legInner + 2} 188 Q${legInner} 205 ${legInner + 3} 222 L${legInner + legW / 2 - 1} 222 Q${legInner + legW - 2} 210 ${legInner + legW - 4} 188 Z`} fill={fillFor('legs')} stroke={strokeFor('legs')} strokeWidth="1.3" opacity="0.8" />
      {showDefinitionLines && (
        <>
          <line x1={legOuter - legW / 2} y1="148" x2={legOuter - legW / 2} y2="180" stroke="rgba(2,6,23,0.3)" strokeWidth="1" />
          <line x1={legInner + legW / 2} y1="148" x2={legInner + legW / 2} y2="180" stroke="rgba(2,6,23,0.3)" strokeWidth="1" />
        </>
      )}

      {/* Kardiyo/kondisyon rozeti — vücudun ÜSTÜNE binmeyen, sağ üst köşede ayrı bir yıldırım
          rozeti (kardiyo için anatomik bir bölge olmadığından, HUD-tarzı bir ikon tercih edildi) */}
      <g transform="translate(126, 14)">
        <circle r="12" fill={status.cardio ? `${rankColor}22` : 'rgba(148,163,184,0.06)'} stroke={strokeFor('cardio')} strokeWidth="1.2" style={glow('cardio')} />
        <path d="M2 -7 L-4 1 L0 1 L-2 8 L5 -1 L1 -1 Z" fill={fillFor('cardio')} />
      </g>

      {/* S-Rank omuz zırhı rozeti */}
      {showAura && (
        <text x="75" y="50" textAnchor="middle" fontSize="9" fontWeight="800" fill={rankColor} fontFamily="monospace" opacity="0.9">S</text>
      )}
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

  // İSTEK (kullanıcı: "set×tekrar" modeli — konuşma sonrası karar): tek bir checkbox yerine
  // her SET ayrı ayrı kaydediliyor. `logSet` bir set daha işler (setsDone+1, sets'i aşmaz);
  // `undoSet` yanlışlıkla ileri gidilirse geri alır (sadece gün henüz kapanmadıysa — kapandıktan
  // sonra XP/streak zaten işlendiği için geri almak karmaşık bir tersine işlem gerektirir).
  const logSet = async (key: ExerciseKey) => {
    if (busy || needsRollover) return;
    setBusy(true);
    try {
      const updatedQuest = state.quest.map(q => q.key === key && q.setsDone < q.sets ? { ...q, setsDone: q.setsDone + 1 } : q);
      const allDone = updatedQuest.length > 0 && updatedQuest.every(isQuestDone);
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

  const undoSet = async (key: ExerciseKey) => {
    if (busy || needsRollover || state.lastStatus === 'completed') return;
    setBusy(true);
    try {
      const updatedQuest = state.quest.map(q => q.key === key && q.setsDone > 0 ? { ...q, setsDone: q.setsDone - 1 } : q);
      await onSaveNote(HUNTER_NOTE_PATH, serializeHunterState({ ...state, quest: updatedQuest }));
    } finally {
      setBusy(false);
    }
  };

  const enterDungeon = () => {
    setDungeonDone({});
    setDungeonMode(true);
  };

  // Yükselme Zindanı: tüm 7 egzersizden oluşan tek oturuşluk bir gauntlet — günlük split'ten
  // BAĞIMSIZ (o gün hangi split olursa olsun tüm gruplar test edilir), normal set×tekrar
  // hacminin ~3 katı toplam tekrar hedefiyle.
  const dungeonTargets = useMemo(() => {
    const sets = SETS_BY_RANK[state.rank];
    return EXERCISE_META.map(m => ({ ...m, target: Math.round(REPS_BASE[m.key][state.rank] * sets * 3) }));
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

  const groupStatus: Record<MuscleGroup, boolean> = { chest: false, abs: false, legs: false, arms: false, back: false, shoulders: false, cardio: false };
  state.quest.forEach(q => { if (isQuestDone(q)) groupStatus[q.group] = true; });
  const rankColor = RANK_COLOR[state.rank];
  const completedCount = state.quest.filter(isQuestDone).length;
  const progressPercent = state.quest.length > 0 ? Math.round((completedCount / state.quest.length) * 100) : 0;
  const todaySplit = state.lastDate ? splitDayForDate(state.lastDate) : SPLIT_DAYS[0];

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
                <MuscleBodyDiagram status={groupStatus} rankColor={rankColor} rank={state.rank} />
                <div style={{ fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>{completedCount}/{state.quest.length} TAMAMLANDI</div>
              </div>

              <div style={{ flex: 1, minWidth: '260px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: '#94a3b8', fontFamily: 'monospace', letterSpacing: '0.5px' }}>
                    GÜNLÜK GÖREV {state.penaltyLevel > 0 && <span style={{ color: '#ef4444' }}> ⚠️ PENALTY</span>}
                  </span>
                  {state.lastStatus === 'completed' && <span style={{ fontSize: '10.5px', color: '#22c55e', fontWeight: 700 }}>✅ Bugün bitti</span>}
                </div>
                <div style={{ fontSize: '10.5px', color: rankColor, fontFamily: 'monospace', fontWeight: 700 }}>📅 {todaySplit.name}</div>
                <div style={{ width: '100%', height: '5px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <div style={{ width: `${progressPercent}%`, height: '100%', background: rankColor, transition: 'width 0.4s ease' }} />
                </div>
                {state.quest.map(q => {
                  const done = isQuestDone(q);
                  return (
                    <div
                      key={q.key}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', borderRadius: '8px',
                        background: done ? `${rankColor}1a` : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${done ? rankColor : 'rgba(255,255,255,0.08)'}`,
                        opacity: busy ? 0.7 : 1
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ flex: 1, fontSize: '12.5px', fontWeight: done ? 700 : 500, textDecoration: done ? 'line-through' : 'none', color: done ? '#94a3b8' : '#e2e8f0' }}>{q.label}</span>
                        <span style={{ fontSize: '11.5px', fontFamily: 'monospace', color: rankColor, fontWeight: 700 }}>{q.sets}×{q.reps}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {Array.from({ length: q.sets }).map((_, i) => (
                            <div key={i} style={{
                              width: '11px', height: '11px', borderRadius: '50%',
                              background: i < q.setsDone ? rankColor : 'transparent',
                              border: `1.5px solid ${i < q.setsDone ? rankColor : 'rgba(255,255,255,0.25)'}`
                            }} />
                          ))}
                        </div>
                        <span style={{ fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>{q.setsDone}/{q.sets} set</span>
                        <div style={{ flex: 1 }} />
                        {q.setsDone > 0 && state.lastStatus !== 'completed' && (
                          <button
                            type="button" disabled={busy} onClick={() => undoSet(q.key)} title="Son seti geri al"
                            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#94a3b8', fontSize: '11px', padding: '5px 7px', cursor: busy ? 'wait' : 'pointer' }}
                          >↺</button>
                        )}
                        <button
                          type="button" disabled={busy || done} onClick={() => logSet(q.key)}
                          style={{
                            background: done ? 'rgba(34,197,94,0.15)' : rankColor, border: 'none', borderRadius: '6px',
                            color: done ? '#22c55e' : '#0a0a0a', fontSize: '11px', fontWeight: 800, padding: '5px 10px',
                            cursor: busy || done ? 'default' : 'pointer', fontFamily: 'monospace'
                          }}
                        >
                          {done ? '✓ Bitti' : `Set Tamamla (${q.reps})`}
                        </button>
                      </div>
                    </div>
                  );
                })}
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
