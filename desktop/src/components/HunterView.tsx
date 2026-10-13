import React, { useEffect, useMemo, useRef, useState } from 'react';

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
const MUSCLE_GROUP_LABEL: Record<MuscleGroup, string> = {
  chest: 'Göğüs', abs: 'Karın', legs: 'Bacak', arms: 'Kol', back: 'Sırt', shoulders: 'Omuz', cardio: 'Kardiyo'
};
const ALL_MUSCLE_GROUPS: MuscleGroup[] = ['chest', 'abs', 'legs', 'arms', 'back', 'shoulders', 'cardio'];

// İSTEK (kullanıcı: "gerçek spor eğitimi gibi çeşitlilik ve set/tekrar istiyorum, önce
// konuşalım"): konuşma sonucu netleşen 3 karar — (1) gün bazlı SPLIT (her gün aynı 4 grup
// değil, Push/Pull&Core/Leg/Full-Body dönüşümlü), (2) SET x TEKRAR modeli (tek toplam sayı
// değil, her hareket için ayrı ayrı işaretlenen set sayısı), (3) Sırt + Omuz + Kardiyo
// gruplarının eklenmesi. Her egzersiz artık `sets`/`reps`/`setsDone` taşıyor; tamamlanma
// setsDone >= sets olduğunda gerçekleşiyor (bkz. isQuestDone).
// İSTEK (kullanıcı: "bir günde sadece iki antreman mı var az mı çok mu... gerçek spor
// salonlarında bir seansta nasıl olur" — konuşma sonrası karar: kas grubu başına 1 yerine 2
// hareket, gerçek bir salon seansına daha yakın hacim için): aynı `key` (kas grubu slotu)
// için havuzdan İKİ farklı varyant seçiliyor, `slot` (0/1) bu ikisini birbirinden ayırt ediyor
// (aksi halde ikisi de aynı `key`'i paylaştığı için set kaydetme/geri alma birbirine karışırdı).
// İSTEK (kullanıcı: "hunterda kendi kişisel programımı yapabilmek istiyorum. hareket isimleri
// kaydetme... hangi kas gruplarına etki ettiğini belirtme... sonra program oluşturma"): `key`
// artık sadece sabit ExerciseKey değil, kullanıcının kendi egzersizinin id'si de olabilir
// (string) — ve bir hareket birden fazla kas grubunu birden etkileyebildiği için `group` tekil
// yerine `groups` (dizi) oldu.
interface DailyQuestItem { key: string; slot: number; label: string; groups: MuscleGroup[]; sets: number; reps: number; setsDone: number; }
const isQuestDone = (q: DailyQuestItem) => q.setsDone >= q.sets;
const questItemId = (q: DailyQuestItem) => `${q.key}-${q.slot}`;

// Kullanıcının kendi kaydettiği egzersiz — isim + hangi kas gruplarını hedeflediği.
interface CustomExercise { id: string; name: string; groups: MuscleGroup[]; }
// Haftalık programdaki tek bir satır: hangi egzersiz, kaç set, kaç tekrar.
interface WeeklyProgramEntry { exerciseId: string; sets: number; reps: number; }
const WEEKDAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'] as const;
type Weekday = typeof WEEKDAYS[number];
type WeeklyProgram = Record<Weekday, WeeklyProgramEntry[]>;
const emptyWeeklyProgram = (): WeeklyProgram => ({
  Pazartesi: [], Salı: [], Çarşamba: [], Perşembe: [], Cuma: [], Cumartesi: [], Pazar: []
});
const weekdayForDate = (dateStr: string): Weekday => {
  const jsDay = new Date(`${dateStr}T00:00:00`).getDay(); // 0=Pazar..6=Cumartesi
  return WEEKDAYS[(jsDay + 6) % 7]; // Pazartesi=0 olacak şekilde kaydır
};

// 'auto' = rank sistemi otomatik üretir, 'custom' = haftanın günlerine göre kendi programın,
// 'sessions' = antrenör tarzı "8 antrenmanlık liste": gün bağımsız, sırayla ilerler
// (kullanıcı: "bana 8 antrenman şu listeyi uygulayacaksın sonra değişecek dediler").
type ProgramMode = 'auto' | 'custom' | 'sessions';

// Antrenman programı: sıralı antrenmanlar + sıradaki antrenmanın indeksi (0 tabanlı).
// Aktif plan, "Programlarım"daki bir programın KOPYASIDIR (başlatınca kopyalanır); başlangıç tarihi
// ve hangi haftanın günlerinde antrenman yapılacağı da burada tutulur (boş `weekdays` = her gün).
// `weekdays`: 0=Pazartesi … 6=Pazar.
interface SessionPlan {
  workouts: WeeklyProgramEntry[][]; cursor: number;
  programId?: string; name?: string; startDate?: string; weekdays?: number[];
  doneDates?: string[]; // tamamlanan günlerin tarihleri (sırayla) — "kaç gün yaptım / kaç gün kaldı" ve gidişat için
  repeats?: number[]; // her listenin kaç GÜN uygulanacağı (varsayılan 1) — "8 gün şu listeyi uygula, sonra değişecek"
}
const emptySessionPlan = (): SessionPlan => ({ workouts: [], cursor: 0 });
// İSTEK (kullanıcı: "ikinci gün tekrar baştan giriyorum, 'programlarım' diye bir yer olsa orada
// kaydetsem ve çalışacağım zamana planlasam"): adlandırılmış, kalıcı program kitaplığı.
interface SavedProgram { id: string; name: string; workouts: WeeklyProgramEntry[][]; repeats?: number[]; }

// Hareket başına ağırlık (kg) ve tarih bazlı geçmişi (gidişat için). Anahtar: hareket adı.
interface WeightEntry { kg: number; log: { date: string; kg: number }[]; }

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
  programMode: ProgramMode; // 'auto' = rank sistemi otomatik üretir, 'custom' = kullanıcının kendi programı
  customExercises: CustomExercise[];
  weeklyProgram: WeeklyProgram;
  sessionPlan: SessionPlan;
  programs: SavedProgram[];
  weights: Record<string, WeightEntry>;
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

// İSTEK (kullanıcı: Huawei Watch GT6'da "Güç / Fonksiyonel Antrenman / CrossFit" modları var,
// "her antremanın yanına yazar mısın ve bir antrenman planı çıkartırsan daha etkili olur...
// bir program gibi olsa"): her egzersiz hangi saat moduyla takip edilmeli, buna göre etiketleniyor
// VE günün görev listesi bu moda göre GRUPLANIP art arda bir "program" haline getiriliyor —
// böylece kullanıcı saatte modu BİR KERE seçip o bloğu bitirene kadar mod değiştirmeden devam
// edebiliyor (Güç → Fonksiyonel → CrossFit sırasıyla: ağır/bileşik hareketler tazeyken, kardiyo
// finişer en sona).
type WatchMode = 'Güç' | 'Fonksiyonel' | 'CrossFit';
const WATCH_MODE: Record<ExerciseKey, WatchMode> = {
  pushups: 'Güç', dumbbell: 'Güç', shoulders: 'Güç', squats: 'Güç',
  back: 'Fonksiyonel', situps: 'Fonksiyonel',
  cardio: 'CrossFit'
};
const WATCH_MODE_ICON: Record<WatchMode, string> = { 'Güç': '⚡', 'Fonksiyonel': '🧩', 'CrossFit': '🔥' };
const WATCH_MODE_ORDER: WatchMode[] = ['Güç', 'Fonksiyonel', 'CrossFit'];

const questTargets = (rank: Rank, penaltyLevel: number, dateStr: string): DailyQuestItem[] => {
  const mult = PENALTY_MULTIPLIERS[Math.min(penaltyLevel, PENALTY_MULTIPLIERS.length - 1)];
  const dIdx = dayOfYear(new Date(`${dateStr}T00:00:00`));
  const sets = SETS_BY_RANK[rank];
  const split = splitDayForDate(dateStr);
  const items: DailyQuestItem[] = [];
  split.keys.forEach(key => {
    const meta = EXERCISE_META.find(m => m.key === key)!;
    const pool = EXERCISE_POOL[key];
    const repCount = Math.max(1, Math.round(REPS_BASE[key][rank] * mult));
    // Kas grubu başına HAVUZDAN 2 FARKLI varyant (slot 0 ve 1) — pool 4 elemanlı olduğundan
    // 2 kaydırma her zaman farklı bir varyant garanti eder, tek harekete sıkışmaz.
    [0, 1].forEach(slot => {
      const variant = pool[(dIdx + slot * 2) % pool.length];
      items.push({ key, slot, label: variant, groups: [meta.group], sets, reps: repCount, setsDone: 0 });
    });
  });
  return items;
};

// İSTEK (kullanıcı: "kendi kişisel programımı yapabilmek istiyorum"): `programMode==='custom'`
// olduğunda günlük görev artık rank sisteminden DEĞİL, kullanıcının o gün (haftanın günü) için
// kurduğu kendi programından üretiliyor — hiçbir hareket girilmemiş bir gün otomatik "dinlenme
// günü" sayılır (boş quest listesi).
// İSTEK (kullanıcı: "8 antrenman şu listeyi uygulayacaksın, sonra değişecek" — yani TEK liste 8 gün
// boyunca tekrar edilir, 8 farklı liste değil): her liste `repeats[i]` gün uygulanır; toplam gün sayısı
// listelerin tekrarlarının toplamıdır ve ilerleme (kaç gün yaptım / kaç gün kaldı) bu gün sayısı üzerinden izlenir.
const repeatOf = (repeats: number[] | undefined, i: number): number => Math.max(1, Math.floor(repeats?.[i] ?? 1));
const totalSessions = (workouts: WeeklyProgramEntry[][], repeats?: number[]): number =>
  workouts.reduce((n, _w, i) => n + repeatOf(repeats, i), 0);
// `session` (0 tabanlı gün sırası) hangi listeye denk geliyor? Program bittiyse -1.
const workoutIndexAt = (workouts: WeeklyProgramEntry[][], repeats: number[] | undefined, session: number): number => {
  let acc = 0;
  for (let i = 0; i < workouts.length; i++) {
    acc += repeatOf(repeats, i);
    if (session < acc) return i;
  }
  return -1;
};
const normalizeRepeats = (pg: SavedProgram): number[] => pg.workouts.map((_w, i) => repeatOf(pg.repeats, i));
// Aktif plan, kayıtlı programı CANLI izler: programdaki liste/gün sayısı değişince plana hemen yansır
// (kullanıcı her seferinde yeniden başlatmak zorunda kalmaz). Program silindiyse başlatma anındaki kopya kullanılır.
const effectivePlan = (st: { sessionPlan: SessionPlan; programs: SavedProgram[] }): SessionPlan => {
  const pg = st.sessionPlan.programId ? st.programs.find(x => x.id === st.sessionPlan.programId) : undefined;
  return pg ? { ...st.sessionPlan, workouts: pg.workouts, repeats: normalizeRepeats(pg) } : st.sessionPlan;
};

// Aktif planda bu tarih bir antrenman günü mü? (başlangıç tarihinden önce değil ve seçili günlerden biri)
const isTrainingDay = (plan: SessionPlan, dateStr: string): boolean => {
  if (plan.startDate && dateStr < plan.startDate) return false;
  if (plan.weekdays && plan.weekdays.length > 0 && !plan.weekdays.includes(WEEKDAYS.indexOf(weekdayForDate(dateStr)))) return false;
  return true;
};
// `fromDate` DAHİL, sıradaki antrenman gününün tarihi (60 gün içinde bulamazsa null).
const nextTrainingDate = (plan: SessionPlan, fromDate: string): string | null => {
  const d = new Date(`${fromDate}T00:00:00`);
  for (let i = 0; i < 60; i++) {
    const ds = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    if (isTrainingDay(plan, ds)) return ds;
    d.setDate(d.getDate() + 1);
  }
  return null;
};
const dateStrOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
// Başlangıçtan DÜNE kadar planlı antrenman günü sayısı eksi o tarihe kadar yapılan antrenman sayısı
// (İSTEK: "bir gün gidemedim diyelim ne olacak"). Antrenmanlar sıralı olduğundan kaçırılan gün
// programı bir gün öteler; bu sayı kullanıcıya açıkça gösterilir.
const missedPlannedDays = (plan: SessionPlan, today: string): number => {
  if (!plan.startDate || plan.workouts.length === 0) return 0;
  let planned = 0;
  const d = new Date(`${plan.startDate}T00:00:00`);
  for (let i = 0; i < 400; i++) {
    const ds = dateStrOf(d);
    if (ds >= today) break;
    if (isTrainingDay(plan, ds)) planned++;
    d.setDate(d.getDate() + 1);
  }
  const done = (plan.doneDates || []).filter(x => x < today).length;
  return Math.max(0, planned - done);
};
// Kalan antrenmanların, planlı günlere sırayla yerleştirilmesiyle tahmini bitiş tarihi.
// `todayPending`: bugünün antrenmanı henüz yapılmadıysa bugün de sayılır.
const projectedFinish = (plan: SessionPlan, today: string, todayPending: boolean): string | null => {
  let remaining = totalSessions(plan.workouts, plan.repeats) - plan.cursor;
  if (remaining <= 0) return null;
  const d = new Date(`${today}T00:00:00`);
  for (let i = 0; i < 400; i++) {
    const ds = dateStrOf(d);
    if (isTrainingDay(plan, ds) && (ds !== today || todayPending)) {
      remaining--;
      if (remaining === 0) return ds;
    }
    d.setDate(d.getDate() + 1);
  }
  return null;
};
const formatTrDate = (ds: string) => {
  const d = new Date(`${ds}T00:00:00`);
  return `${d.getDate()} ${['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'][d.getMonth()]} ${weekdayForDate(ds)}`;
};

const buildDailyQuest = (opts: {
  programMode: ProgramMode; rank: Rank; penaltyLevel: number; dateStr: string;
  customExercises: CustomExercise[]; weeklyProgram: WeeklyProgram; sessionPlan: SessionPlan; ignoreSchedule?: boolean;
}): DailyQuestItem[] => {
  const fromEntries = (entries: WeeklyProgramEntry[]): DailyQuestItem[] => {
    const items: DailyQuestItem[] = [];
    entries.forEach((entry, i) => {
      const ex = opts.customExercises.find(e => e.id === entry.exerciseId);
      if (!ex) return; // silinmiş bir egzersize referans kalmışsa sessizce atla
      items.push({ key: entry.exerciseId, slot: i, label: ex.name, groups: ex.groups, sets: entry.sets, reps: entry.reps, setsDone: 0 });
    });
    return items;
  };
  if (opts.programMode === 'custom') return fromEntries(opts.weeklyProgram[weekdayForDate(opts.dateStr)] || []);
  // Antrenman programı: tarih fark etmez, sıradaki antrenman (cursor). Program bittiyse/boşsa boş liste.
  if (opts.programMode === 'sessions') {
    if (!opts.ignoreSchedule && !isTrainingDay(opts.sessionPlan, opts.dateStr)) return []; // antrenman günü değil
    const wi = workoutIndexAt(opts.sessionPlan.workouts, opts.sessionPlan.repeats, opts.sessionPlan.cursor);
    return wi < 0 ? [] : fromEntries(opts.sessionPlan.workouts[wi]);
  }
  return questTargets(opts.rank, opts.penaltyLevel, opts.dateStr);
};

// Bir görev maddesinin saatte hangi modla takip edilmesi gerektiğini belirler — sabit
// egzersizler için WATCH_MODE tablosundan, kullanıcının kendi egzersizleri için ise hedeflediği
// kas gruplarından (kardiyo varsa CrossFit, sırt/karın varsa Fonksiyonel, aksi halde Güç).
const watchModeFor = (q: DailyQuestItem): WatchMode => {
  if (q.key in WATCH_MODE) return WATCH_MODE[q.key as ExerciseKey];
  if (q.groups.includes('cardio')) return 'CrossFit';
  if (q.groups.some(g => g === 'back' || g === 'abs')) return 'Fonksiyonel';
  return 'Güç';
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
  const programModeMatch = content.match(/\[programMode:(auto|custom|sessions)\]/i);

  const rank = (rankMatch ? rankMatch[1].toUpperCase() : 'E') as Rank;
  const xp = xpMatch ? parseInt(xpMatch[1], 10) : 0;
  const penaltyLevel = penaltyMatch ? parseInt(penaltyMatch[1], 10) : 0;
  const streak = streakMatch ? parseInt(streakMatch[1], 10) : 0;
  const bestStreak = bestStreakMatch ? parseInt(bestStreakMatch[1], 10) : 0;
  const lastDate = lastDateMatch ? lastDateMatch[1] : '';
  const lastStatus = (lastStatusMatch ? lastStatusMatch[1] : 'pending') as 'pending' | 'completed';
  const programMode = (programModeMatch ? programModeMatch[1].toLowerCase() : 'auto') as ProgramMode;

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
      // İSTEK (kullanıcı: "bir günde sadece iki antreman mı var" — kas grubu başına 2 hareket):
      // aynı `key` artık İKİ satırda tekrarlanabildiği için `slot` (0/1) eklendi, ikisini
      // ayırt etmek için — yoksa set kaydetme ikisini birden etkilerdi.
      // İSTEK (kullanıcı: "hangi kas gruplarına etki ettiğini belirtme" — özel egzersizler birden
      // fazla grubu birden hedefleyebiliyor): `[group:X]` tekil etiketi `[groups:X,Y,Z]` (virgülle
      // ayrılmış liste) oldu; `key` artık sabit ExerciseKey union'ına kısıtlı değil (özel
      // egzersiz id'si de olabilir), bu yüzden `\w+` yerine `[^\]]+` (köşeli parantez içinde her şey).
      const m = line.match(/\[key:([^\]]+)\]\s*\[slot:(\d+)\]\s*\[sets:(\d+)\]\s*\[reps:(\d+)\]\s*\[setsDone:(\d+)\]\s*\[groups:([^\]]*)\]\s*\[variant:([^\]]*)\]/);
      const checkedMatch = line.match(/^\s*[*\-]\s+\[([ xX])\]/);
      if (m && checkedMatch) {
        const meta = EXERCISE_META.find(e => e.key === m[1]);
        const sets = parseInt(m[3], 10);
        quest.push({
          label: m[7].trim() || (meta ? meta.label : m[1]),
          key: m[1],
          slot: parseInt(m[2], 10),
          sets,
          reps: parseInt(m[4], 10),
          setsDone: Math.min(parseInt(m[5], 10), sets),
          groups: m[6].split(',').map(g => g.trim()).filter(Boolean) as MuscleGroup[]
        });
      }
    });
  }

  // Egzersiz Kütüphanem — kullanıcının kendi kaydettiği hareketler (isim + hedeflediği kas
  // grupları), haftalık programda bunlara referans verilir.
  const customExercises: CustomExercise[] = [];
  const libSectionMatch = content.match(/## Egzersiz Kütüphanem\n([\s\S]*?)(?=\n##|\n?$)/);
  if (libSectionMatch) {
    libSectionMatch[1].split('\n').forEach(line => {
      const m = line.match(/^\s*-\s+(.+?)\s*\[groups:([^\]]*)\]\s*\[exid:([^\]]+)\]/);
      if (m) customExercises.push({ id: m[3].trim(), name: m[1].trim(), groups: m[2].split(',').map(g => g.trim()).filter(Boolean) as MuscleGroup[] });
    });
  }

  // Haftalık Program — her gün başlığı altında (## Haftalık Program > ### <Gün>) o günün
  // hareket/set/tekrar listesi; başlık altında hiç satır yoksa o gün dinlenme günüdür.
  const weeklyProgram: WeeklyProgram = emptyWeeklyProgram();
  const programSectionMatch = content.match(/## Haftalık Program\n([\s\S]*?)(?=\n## [^#]|\n?$)/);
  if (programSectionMatch) {
    const dayBlocks = programSectionMatch[1].split(/\n(?=### )/);
    dayBlocks.forEach(block => {
      const dayMatch = block.match(/^### (.+)$/m);
      if (!dayMatch) return;
      const dayName = dayMatch[1].trim() as Weekday;
      if (!WEEKDAYS.includes(dayName)) return;
      const entries: WeeklyProgramEntry[] = [];
      block.split('\n').forEach(line => {
        const m = line.match(/\[exid:([^\]]+)\]\s*\[sets:(\d+)\]\s*\[reps:(\d+)\]/);
        if (m) entries.push({ exerciseId: m[1].trim(), sets: parseInt(m[2], 10), reps: parseInt(m[3], 10) });
      });
      weeklyProgram[dayName] = entries;
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

  // Antrenman Programı — `## Antrenman Programı` altında `[cursor:N]` (sıradaki antrenman) ve
  // her antrenman için `### Antrenman K` blokları; blok içindeki satırlar haftalık programdakiyle aynı etiketler.
  const sessionPlan: SessionPlan = emptySessionPlan();
  const sessionSectionMatch = content.match(/## Antrenman Programı\n([\s\S]*?)(?=\n## [^#]|\n?$)/);
  if (sessionSectionMatch) {
    const body = sessionSectionMatch[1];
    const cur = body.match(/\[cursor:(\d+)\]/);
    sessionPlan.cursor = cur ? parseInt(cur[1], 10) : 0;
    const st = body.match(/\[start:(\d{4}-\d{2}-\d{2})\]/);
    if (st) sessionPlan.startDate = st[1];
    const dy = body.match(/\[days:([\d,]*)\]/);
    if (dy) sessionPlan.weekdays = dy[1].split(',').filter(Boolean).map(n => parseInt(n, 10)).filter(n => n >= 0 && n <= 6);
    const dn = body.match(/\[done:([\d,-]*)\]/);
    if (dn) sessionPlan.doneDates = dn[1].split(',').filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
    const pid = body.match(/\[pid:([^\]]+)\]/);
    if (pid) sessionPlan.programId = pid[1];
    const pn = body.match(/\[pname:([^\]]*)\]/);
    if (pn) { try { sessionPlan.name = decodeURIComponent(pn[1]); } catch { sessionPlan.name = pn[1]; } }
    body.split(/\n(?=### )/).forEach(block => {
      if (!/^### Antrenman \d+/m.test(block)) return;
      const rp = block.match(/^### Antrenman \d+[^\n]*\[repeat:(\d+)\]/m);
      (sessionPlan.repeats = sessionPlan.repeats || []).push(rp ? Math.max(1, parseInt(rp[1], 10)) : 1);
      const entries: WeeklyProgramEntry[] = [];
      block.split('\n').forEach(line => {
        const m = line.match(/\[exid:([^\]]+)\]\s*\[sets:(\d+)\]\s*\[reps:(\d+)\]/);
        if (m) entries.push({ exerciseId: m[1].trim(), sets: parseInt(m[2], 10), reps: parseInt(m[3], 10) });
      });
      sessionPlan.workouts.push(entries);
    });
  }

  // Ağırlıklar — hareket adı `[ex:...]` etiketinde (URL-kodlu, serbest metin geri okunmaz),
  // güncel kg `[kg:..]`, geçmiş `[log:tarih=kg,...]`.
  const weights: Record<string, WeightEntry> = {};
  const weightSectionMatch = content.match(/## Ağırlıklar\n([\s\S]*?)(?=\n## [^#]|\n?$)/);
  if (weightSectionMatch) {
    weightSectionMatch[1].split('\n').forEach(line => {
      const m = line.match(/\[ex:([^\]]+)\]\s*\[kg:([\d.]+)\]\s*\[log:([^\]]*)\]/);
      if (!m) return;
      let name = m[1];
      try { name = decodeURIComponent(m[1]); } catch { /* olduğu gibi */ }
      const log = m[3].split(',').map(x => x.split('=')).filter(a => a.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(a[0]) && !isNaN(parseFloat(a[1])))
        .map(a => ({ date: a[0], kg: parseFloat(a[1]) }));
      weights[name] = { kg: parseFloat(m[2]), log };
    });
  }

  // Programlarım — adlandırılmış programlar; her biri `### Program: ad [pid:..]` bloğu, altında
  // `#### Antrenman K` blokları (satır etiketleri haftalık programdakiyle aynı).
  const programs: SavedProgram[] = [];
  const programsSectionMatch = content.match(/## Programlarım\n([\s\S]*?)(?=\n## [^#]|\n?$)/);
  if (programsSectionMatch) {
    programsSectionMatch[1].split(/\n(?=### Program:)/).forEach(block => {
      const head = block.match(/^### Program: (.*?) \[pid:([^\]]+)\]/m);
      if (!head) return;
      const workouts: WeeklyProgramEntry[][] = [];
      const repeats: number[] = [];
      block.split(/\n(?=#### )/).forEach(wb => {
        if (!/^#### Antrenman \d+/m.test(wb)) return;
        const wrp = wb.match(/^#### Antrenman \d+[^\n]*\[repeat:(\d+)\]/m);
        repeats.push(wrp ? Math.max(1, parseInt(wrp[1], 10)) : 1);
        const entries: WeeklyProgramEntry[] = [];
        wb.split('\n').forEach(line => {
          const m = line.match(/\[exid:([^\]]+)\]\s*\[sets:(\d+)\]\s*\[reps:(\d+)\]/);
          if (m) entries.push({ exerciseId: m[1].trim(), sets: parseInt(m[2], 10), reps: parseInt(m[3], 10) });
        });
        workouts.push(entries);
      });
      programs.push({ id: head[2], name: head[1].trim(), workouts, repeats });
    });
  }

  return { rank, xp, penaltyLevel, streak, bestStreak, lastDate, lastStatus, quest, history, shadows, programMode, customExercises, weeklyProgram, sessionPlan, programs, weights };
}

function serializeHunterState(s: HunterState): string {
  const header = `# Hunter Sistemi\n\n[rank:${s.rank}] [xp:${s.xp}] [penaltyLevel:${s.penaltyLevel}] [streak:${s.streak}] [bestStreak:${s.bestStreak}] [lastDate:${s.lastDate}] [lastStatus:${s.lastStatus}] [programMode:${s.programMode}]\n`;
  // Satırın görünen metni SADECE bilgi amaçlı (kullanıcı notu ham olarak açarsa okunabilir
  // olsun diye) — geri okunurken KULLANILMIYOR (bkz. parseHunterState'teki uyarı), bu yüzden
  // burada güvenle sabit/temiz kalabilir, her kaydette büyümez.
  const questLines = s.quest.map(q => `- [${isQuestDone(q) ? 'x' : ' '}] ${q.label} — ${q.sets}x${q.reps} (${q.setsDone}/${q.sets} set) [key:${q.key}] [slot:${q.slot}] [sets:${q.sets}] [reps:${q.reps}] [setsDone:${q.setsDone}] [groups:${q.groups.join(',')}] [variant:${q.label}]`).join('\n');
  const dayLabel = s.lastDate
    ? (s.programMode === 'custom' ? weekdayForDate(s.lastDate) : splitDayForDate(s.lastDate).name)
    : '';
  const restDay = s.programMode === 'custom' && s.quest.length === 0;
  const questSection = `\n## Günlük Görev — ${s.lastDate} — ${dayLabel}${restDay ? ' 🛌 Dinlenme Günü' : ''}${s.penaltyLevel > 0 ? ' ⚠️ PENALTY QUEST' : ''}\n${questLines}\n`;
  const historyLines = s.history.slice(0, 60).map(h => `- ${h.date}: ${h.text} [xpDelta:${h.xpDelta}]`).join('\n');
  const historySection = `\n## Geçmiş\n${historyLines}\n`;
  const shadowLines = s.shadows.map(sh => `- ${sh}`).join('\n');
  const shadowSection = `\n## Gölge Ordusu\n${shadowLines}\n`;
  const libLines = s.customExercises.map(e => `- ${e.name} [groups:${e.groups.join(',')}] [exid:${e.id}]`).join('\n');
  const libSection = `\n## Egzersiz Kütüphanem\n${libLines}\n`;
  const programBlocks = WEEKDAYS.map(day => {
    const entries = s.weeklyProgram[day] || [];
    const lines = entries.length > 0
      ? entries.map(e => {
          const ex = s.customExercises.find(x => x.id === e.exerciseId);
          return `- ${ex ? ex.name : '(silinmiş egzersiz)'} — ${e.sets}x${e.reps} [exid:${e.exerciseId}] [sets:${e.sets}] [reps:${e.reps}]`;
        }).join('\n')
      : '(dinlenme günü)';
    return `### ${day}\n${lines}`;
  }).join('\n');
  const programSection = `\n## Haftalık Program\n${programBlocks}\n`;
  const sessionBlocks = s.sessionPlan.workouts.map((entries, i) => {
    const lines = entries.length > 0
      ? entries.map(e => {
          const ex = s.customExercises.find(x => x.id === e.exerciseId);
          return `- ${ex ? ex.name : '(silinmiş egzersiz)'} — ${e.sets}x${e.reps} [exid:${e.exerciseId}] [sets:${e.sets}] [reps:${e.reps}]`;
        }).join('\n')
      : '(boş)';
    return `### Antrenman ${i + 1} [repeat:${repeatOf(s.sessionPlan.repeats, i)}]\n${lines}`;
  }).join('\n');
  const sp = s.sessionPlan;
  const sessionMeta = `[cursor:${sp.cursor}]${sp.startDate ? ` [start:${sp.startDate}]` : ''} [days:${(sp.weekdays || []).join(',')}] [done:${(sp.doneDates || []).join(',')}]${sp.programId ? ` [pid:${sp.programId}]` : ''}${sp.name ? ` [pname:${encodeURIComponent(sp.name)}]` : ''}`;
  const sessionSection = `\n## Antrenman Programı\n${sessionMeta}\n${sessionBlocks}\n`;
  const programBlocksSaved = s.programs.map(pg => {
    const wbs = pg.workouts.map((entries, i) => {
      const lines = entries.length > 0
        ? entries.map(e => {
            const ex = s.customExercises.find(x => x.id === e.exerciseId);
            return `- ${ex ? ex.name : '(silinmiş egzersiz)'} — ${e.sets}x${e.reps} [exid:${e.exerciseId}] [sets:${e.sets}] [reps:${e.reps}]`;
          }).join('\n')
        : '(boş)';
      return `#### Antrenman ${i + 1} [repeat:${repeatOf(pg.repeats, i)}]\n${lines}`;
    }).join('\n');
    return `### Program: ${pg.name.replace(/[\[\]\n]/g, ' ')} [pid:${pg.id}]\n${wbs}`;
  }).join('\n');
  const programsSection = `\n## Programlarım\n${programBlocksSaved}\n`;
  const weightLines = Object.entries(s.weights).map(([name, w]) =>
    `- ${name}: ${w.kg} kg [ex:${encodeURIComponent(name)}] [kg:${w.kg}] [log:${w.log.map(l => `${l.date}=${l.kg}`).join(',')}]`).join('\n');
  const weightSection = `\n## Ağırlıklar\n${weightLines}\n`;
  return header + questSection + historySection + shadowSection + libSection + programSection + sessionSection + programsSection + weightSection;
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
const MuscleBodyDiagramImpl: React.FC<{ status: Record<MuscleGroup, boolean>; rankColor: string; rank: Rank }> = ({ status, rankColor, rank }) => {
  const fillFor = (group: MuscleGroup) => status[group] ? rankColor : 'rgba(148,163,184,0.12)';
  const strokeFor = (group: MuscleGroup) => status[group] ? rankColor : 'rgba(148,163,184,0.4)';
  const glow = (group: MuscleGroup) => status[group] ? { filter: 'url(#bodyGlow)' } : {};

  const rankIdx = RANK_ORDER.indexOf(rank); // 0 (E) .. 5 (S)
  const t = rankIdx / (RANK_ORDER.length - 1); // 0..1 evrim oranı

  // BUG DÜZELTMESİ (kullanıcı geri bildirimi: gönderdiği anatomik referansla karşılaştırınca
  // "şu benzerliğe bakar mısınız" — önceki versiyon birbirine BAĞLI OLMAYAN, boşluklu/havada
  // asılı parçalardan (ayrı omuz noktaları, gövdeye değmeyen kollar, bacaklarla birleşmeyen
  // karın) oluşuyordu, bu yüzden "robot parçaları" gibi görünüyordu. KÖK SEBEP: hiçbir zaman
  // tek parça, SÜREKLİ bir vücut siluetinin ÇİZİLMEMİŞ olmasıydı. Çözüm: önce nötr renkte,
  // TEK PARÇA süreklilik sağlayan bir "temel siluet" (gövde + 2 kol + 2 bacak, kollar/
  // bacaklar gövdeye birkaç piksel binerek) çiziliyor — bu her zaman TAM bir insan şekli
  // garanti eder. Kas grubu renkleri bu temel siluetin ÜZERİNE, onun sınırları içinde kalan
  // daha küçük bölgeler olarak ekleniyor (referans görseldeki gibi: nötr ten + üzerinde
  // renkli kas bölgeleri) — artık hiçbir parça boşlukta asılı durmuyor.
  const shoulderW = 26 + 14 * t;      // omuz genişliği (gövde temel siluet)
  const torsoWaistW = 13 + 2 * t;     // bel genişliği (gövde temel siluet, dar kısım)
  const hipW = 16 + 3 * t;            // kalça genişliği (gövde temel siluet, alt taban)
  const armR = 7 + 3.5 * t;           // kol temel siluet kalınlığı (omuzda)
  const wristR = 3.5 + 1 * t;
  const legR = 8 + 2 * t;             // bacak temel siluet kalınlığı (kalçada)
  const ankleR = 4.5 + 1 * t;
  const neckW = 6 + 1.2 * t;
  const absRows = 3 + Math.round(2 * t); // 3..5 satır six-pack
  const showDefinitionLines = t >= 0.55;
  const showAura = rankIdx === RANK_ORDER.length - 1; // sadece S-Rank

  const shoulderY = 44, waistY = 94, hipY = 136, wristY = 126, ankleY = 222;
  const armCx = { l: 75 - shoulderW - armR + 6, r: 75 + shoulderW + armR - 6 }; // 6px gövdeye biniyor
  const legCx = { l: 75 - hipW * 0.5, r: 75 + hipW * 0.5 };
  const legTopY = hipY - 4; // 4px gövdeye biniyor

  const absTop = 90, absBottom = 128;
  const rowH = (absBottom - absTop) / absRows;
  const pecOffset = 8 + 2 * t, pecRx = 11 + 3 * t, pecRy = 13 + 3 * t, pecCy = 58;

  const neutralFill = 'rgba(148,163,184,0.07)', neutralStroke = 'rgba(148,163,184,0.3)';
  const torsoPath = `M${75 - shoulderW} ${shoulderY} Q75 36 ${75 + shoulderW} ${shoulderY} L${75 + torsoWaistW} ${waistY} L${75 + hipW} ${hipY} Q75 144 ${75 - hipW} ${hipY} L${75 - torsoWaistW} ${waistY} Z`;
  const armPath = (cx: number) => `M${cx - armR} ${shoulderY - 2} Q${cx - armR - 2} ${(shoulderY + wristY) / 2} ${cx - wristR} ${wristY} L${cx + wristR} ${wristY} Q${cx + armR + 2} ${(shoulderY + wristY) / 2} ${cx + armR} ${shoulderY - 2} Z`;
  const legPath = (cx: number) => `M${cx - legR} ${legTopY} Q${cx - legR - 1} ${(legTopY + ankleY) / 2} ${cx - ankleR} ${ankleY} L${cx + ankleR} ${ankleY} Q${cx + legR + 1} ${(legTopY + ankleY) / 2} ${cx + legR} ${legTopY} Z`;

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

      {/* ADIM 1 — TEMEL SİLUET: her zaman tam, tek parça gibi görünen bir insan şekli (gövde +
          2 kol + 2 bacak, birkaç piksel binerek birleşiyor). Duruma göre DEĞİL, her zaman aynı
          nötr tonda — böylece hiçbir egzersiz tamamlanmasa bile vücut asla "eksik/parçalı"
          görünmez, referans görseldeki ten rengi tabanına karşılık gelir. */}
      <path d={armPath(armCx.l)} fill={neutralFill} stroke={neutralStroke} strokeWidth="1.3" />
      <path d={armPath(armCx.r)} fill={neutralFill} stroke={neutralStroke} strokeWidth="1.3" />
      <path d={legPath(legCx.l)} fill={neutralFill} stroke={neutralStroke} strokeWidth="1.3" />
      <path d={legPath(legCx.r)} fill={neutralFill} stroke={neutralStroke} strokeWidth="1.3" />
      <path d={torsoPath} fill={neutralFill} stroke={neutralStroke} strokeWidth="1.3" />
      <circle cx="75" cy="20" r="13" fill={neutralFill} stroke={neutralStroke} strokeWidth="1.3" />
      <rect x={75 - neckW} y="31" width={neckW * 2} height="10" fill={neutralFill} stroke={neutralStroke} strokeWidth="1" />

      {/* ADIM 2 — KAS GRUBU BÖLGELERİ: temel siluetin İÇİNDE kalan, o günkü egzersiz
          tamamlanınca dolup parlayan renkli bölgeler (referans görseldeki gibi nötr taban
          üzerine binen renkli kas haritası). */}

      {/* Trapez (sırt) — boyun/omuz kavşağında, her zaman görünür, rank ile büyür */}
      <path
        d={`M${75 - neckW - 3} 38 L${75 - shoulderW + 6} ${shoulderY + 3} L${75 - neckW} ${shoulderY - 3} Z M${75 + neckW + 3} 38 L${75 + shoulderW - 6} ${shoulderY + 3} L${75 + neckW} ${shoulderY - 3} Z`}
        fill={fillFor('back')} stroke={strokeFor('back')} strokeWidth="0.8" opacity="0.9" style={glow('back')}
      />

      {/* Deltoid (omuz) — gövde ile kolun tam kavşağında, her iki temel siluete de biniyor */}
      <ellipse cx={75 - shoulderW + 3} cy={shoulderY + 3} rx={5 + 2.5 * t} ry={7 + 2.5 * t} fill={fillFor('shoulders')} stroke={strokeFor('shoulders')} strokeWidth="1" style={glow('shoulders')} />
      <ellipse cx={75 + shoulderW - 3} cy={shoulderY + 3} rx={5 + 2.5 * t} ry={7 + 2.5 * t} fill={fillFor('shoulders')} stroke={strokeFor('shoulders')} strokeWidth="1" style={glow('shoulders')} />

      {/* Göğüs (chest) — iki pektoral lob, gövde siluetinin içinde */}
      <ellipse cx={75 - pecOffset} cy={pecCy} rx={pecRx} ry={pecRy} fill={fillFor('chest')} stroke={strokeFor('chest')} strokeWidth="1.3" style={glow('chest')} transform={`rotate(-12 ${75 - pecOffset} ${pecCy})`} />
      <ellipse cx={75 + pecOffset} cy={pecCy} rx={pecRx} ry={pecRy} fill={fillFor('chest')} stroke={strokeFor('chest')} strokeWidth="1.3" style={glow('chest')} transform={`rotate(12 ${75 + pecOffset} ${pecCy})`} />
      {showDefinitionLines && <line x1="75" y1="48" x2="75" y2="84" stroke="rgba(2,6,23,0.4)" strokeWidth="1.6" />}

      {/* Karın (abs) — six-pack grid + yan oblikler, gövde siluetinin içinde */}
      <rect x={75 - torsoWaistW + 1} y={absTop + 2} width="5" height={absBottom - absTop - 6} rx="2.5" fill={fillFor('abs')} opacity="0.5" stroke={strokeFor('abs')} strokeWidth="0.8" />
      <rect x={75 + torsoWaistW - 6} y={absTop + 2} width="5" height={absBottom - absTop - 6} rx="2.5" fill={fillFor('abs')} opacity="0.5" stroke={strokeFor('abs')} strokeWidth="0.8" />
      <rect x={75 - torsoWaistW + 4} y={absTop} width={(torsoWaistW - 4) * 2} height={absBottom - absTop} rx="5" fill={fillFor('abs')} stroke={strokeFor('abs')} strokeWidth="1.3" style={glow('abs')} />
      {showDefinitionLines && Array.from({ length: absRows - 1 }).map((_, i) => (
        <line key={i} x1={75 - torsoWaistW + 7} y1={absTop + rowH * (i + 1)} x2={75 + torsoWaistW - 7} y2={absTop + rowH * (i + 1)} stroke="rgba(2,6,23,0.35)" strokeWidth="1.1" />
      ))}
      {showDefinitionLines && <line x1="75" y1={absTop + 2} x2="75" y2={absBottom - 2} stroke="rgba(2,6,23,0.35)" strokeWidth="1.1" />}

      {/* Kollar (arms) — pazı (bicep) üstte, ön kol (forearm) altta, ikisi de kol siluetinin içinde */}
      <ellipse cx={armCx.l} cy={shoulderY + 17} rx={armR - 1} ry={13 + 2.5 * t} fill={fillFor('arms')} stroke={strokeFor('arms')} strokeWidth="1.3" style={glow('arms')} />
      <ellipse cx={armCx.r} cy={shoulderY + 17} rx={armR - 1} ry={13 + 2.5 * t} fill={fillFor('arms')} stroke={strokeFor('arms')} strokeWidth="1.3" style={glow('arms')} />
      <path d={`M${armCx.l - armR + 2} ${shoulderY + 34} L${armCx.l - wristR - 1} ${wristY - 4} L${armCx.l + wristR + 1} ${wristY - 4} L${armCx.l + armR - 2} ${shoulderY + 34} Z`} fill={fillFor('arms')} stroke={strokeFor('arms')} strokeWidth="1.1" opacity="0.8" />
      <path d={`M${armCx.r - armR + 2} ${shoulderY + 34} L${armCx.r - wristR - 1} ${wristY - 4} L${armCx.r + wristR + 1} ${wristY - 4} L${armCx.r + armR - 2} ${shoulderY + 34} Z`} fill={fillFor('arms')} stroke={strokeFor('arms')} strokeWidth="1.1" opacity="0.8" />

      {/* Bacaklar (legs) — quad (üst) + baldır (alt), ikisi de bacak siluetinin içinde */}
      <path d={`M${legCx.l - legR + 1} ${legTopY + 3} L${legCx.l - legR * 0.55} 178 L${legCx.l + legR * 0.55} 178 L${legCx.l + legR - 1} ${legTopY + 3} Z`} fill={fillFor('legs')} stroke={strokeFor('legs')} strokeWidth="1.3" style={glow('legs')} />
      <path d={`M${legCx.r - legR + 1} ${legTopY + 3} L${legCx.r - legR * 0.55} 178 L${legCx.r + legR * 0.55} 178 L${legCx.r + legR - 1} ${legTopY + 3} Z`} fill={fillFor('legs')} stroke={strokeFor('legs')} strokeWidth="1.3" style={glow('legs')} />
      <path d={`M${legCx.l - legR * 0.5} 182 L${legCx.l - ankleR - 1} 218 L${legCx.l + ankleR + 1} 218 L${legCx.l + legR * 0.5} 182 Z`} fill={fillFor('legs')} stroke={strokeFor('legs')} strokeWidth="1.1" opacity="0.8" />
      <path d={`M${legCx.r - legR * 0.5} 182 L${legCx.r - ankleR - 1} 218 L${legCx.r + ankleR + 1} 218 L${legCx.r + legR * 0.5} 182 Z`} fill={fillFor('legs')} stroke={strokeFor('legs')} strokeWidth="1.1" opacity="0.8" />

      {/* Kardiyo/kondisyon rozeti — kardiyo için anatomik bir bölge olmadığından, vücudun
          dışında sağ üst köşede ayrı bir HUD ikonu (göğse binmiyor) */}
      <g transform="translate(128, 14)">
        <circle r="11" fill={status.cardio ? `${rankColor}22` : 'rgba(148,163,184,0.06)'} stroke={strokeFor('cardio')} strokeWidth="1.1" style={glow('cardio')} />
        <path d="M2 -6 L-3.5 1 L0 1 L-1.5 7 L4.5 -1 L1 -1 Z" fill={fillFor('cardio')} />
      </g>

      {/* S-Rank rozeti */}
      {showAura && (
        <text x="75" y="46" textAnchor="middle" fontSize="8" fontWeight="800" fill={rankColor} fontFamily="monospace" opacity="0.9">S</text>
      )}
    </svg>
  );
};

// PERFORMANS: diyagram çok sayıda SVG bulanıklık (glow) filtresi içerir; her set dokunuşunda
// değil, YALNIZCA kas grubu durumu/rank/renk değişince yeniden çizilir (scroll akıcılığı için).
const MuscleBodyDiagram = React.memo(MuscleBodyDiagramImpl, (a, b) =>
  a.rank === b.rank && a.rankColor === b.rankColor &&
  (Object.keys(a.status) as MuscleGroup[]).every(k => a.status[k] === b.status[k]));

interface HunterViewProps {
  fileContents: Record<string, string>;
  readNoteContent: (path: string) => Promise<string>;
  onSaveNote: (path: string, content: string, opts?: { lightweight?: boolean }) => Promise<void>;
}

export default function HunterView({ fileContents, readNoteContent, onSaveNote }: HunterViewProps) {
  const [dungeonMode, setDungeonMode] = useState(false);
  const [dungeonDone, setDungeonDone] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  // İSTEK (kullanıcı: "kendi kişisel programımı yapabilmek istiyorum") — programı düzenleme
  // paneli için UI-only state (kaydedilen veri değil, sadece hangi ekranın açık olduğu).
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<'exercises' | 'schedule' | 'sessions'>('exercises');
  const [newExName, setNewExName] = useState('');
  const [newExGroups, setNewExGroups] = useState<MuscleGroup[]>([]);
  const [editingProgramId, setEditingProgramId] = useState<string | null>(null);
  const [planProgramId, setPlanProgramId] = useState<string | null>(null);
  const [newProgramName, setNewProgramName] = useState('');
  const [planForm, setPlanForm] = useState<{ startDate: string; weekdays: number[] }>({ startDate: todayStr(), weekdays: [] });
  const [dayAddForm, setDayAddForm] = useState<Record<string, { exerciseId: string; sets: number; reps: number }>>({});

  const rawContent = fileContents[HUNTER_NOTE_PATH];

  // İlk kez açılıyorsa (not hiç yoksa) taze bir E-Rank başlangıç state'i.
  const baseState: HunterState = useMemo(() => {
    if (!rawContent) {
      return {
        rank: 'E', xp: 0, penaltyLevel: 0, streak: 0, bestStreak: 0,
        lastDate: todayStr(), lastStatus: 'pending',
        quest: questTargets('E', 0, todayStr()), history: [], shadows: [],
        programMode: 'auto', customExercises: [], weeklyProgram: emptyWeeklyProgram(), sessionPlan: emptySessionPlan(), programs: [], weights: {}
      };
    }
    const parsed = parseHunterState(rawContent);
    return parsed;
  }, [rawContent]);

  // PERFORMANS (kullanıcı: spor salonunda "çok ağır çalışıyor, bir şey eklerken çok bekliyor,
  // scroll kasıyor"): eskiden her dokunuş diske yazılıp dosya içeriği geri gelene kadar arayüz
  // kilitleniyordu. Artık değişiklik EKRANA ANINDA yansır (`override`), kayıt arka planda sıraya
  // alınır — peş peşe dokunuşlarda yalnızca en son durum yazılır (önceki ara durumlar atlanır).
  // Kayıt `lightweight` modda yapılır (sürüm geçmişi ve tam kasa taraması yok, bkz. App.tsx).
  const [override, setOverride] = useState<HunterState | null>(null);
  const state: HunterState = override ?? baseState;
  const pendingSave = useRef<HunterState | null>(null);
  const saving = useRef(false);
  const lastSavedText = useRef('');
  const rawRef = useRef(rawContent);
  rawRef.current = rawContent;
  const persist = (next: HunterState) => {
    setOverride(next);
    pendingSave.current = next;
    if (saving.current) return;
    saving.current = true;
    (async () => {
      try {
        while (pendingSave.current) {
          const s = pendingSave.current;
          pendingSave.current = null;
          const text = serializeHunterState(s);
          lastSavedText.current = text;
          try { await onSaveNote(HUNTER_NOTE_PATH, text, { lightweight: true }); }
          catch (e) { console.error('Hunter kaydı başarısız:', e); }
        }
      } finally {
        saving.current = false;
        if (rawRef.current === lastSavedText.current) setOverride(null);
      }
    })();
  };
  // Dosya içeriği bizim son yazdığımızla eşleşince geçici durumu bırakır (dosya doğruluk
  // kaynağı olur). Eşleşmezse override KORUNUR: bu durumda başka bir cihazdan gelen bir
  // değişiklik, bu cihazdaki sonraki ilk kayıt gelene kadar ekrana yansımaz (bilinen sınır).
  useEffect(() => {
    if (saving.current || !override) return;
    if (rawContent === lastSavedText.current) setOverride(null);
  }, [rawContent]);

  // Kullanıcının kendi programında bir gün için hiç hareket eklenmemişse (dinlenme günü) o gün
  // otomatik "completed" sayılır — aksi halde ertesi gün rollover onu "kaçırılmış görev" olarak
  // cezalandırırdı, ama dinlenme günü kaçırılmış bir görev değildir.
  // Antrenman programında (sessions) program bittiyse/boşsa da aynı şekilde "tamam" sayılır.
  const dayStatusFor = (quest: DailyQuestItem[], programMode: ProgramMode): 'pending' | 'completed' =>
    (programMode !== 'auto' && quest.length === 0) ? 'completed' : 'pending';

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
      // Antrenman programı (sessions) günden bağımsızdır: salona gitmediğin gün CEZA/seri sıfırlama yok;
      // tamamlanmamış antrenman aynen ertesi güne taşınır, tamamlandıysa sıradaki antrenman gelir.
      if (state.programMode === 'sessions') {
        // Bugün planlı bir antrenman günü değilse: görev yok, ceza yok (antrenman cursor'da bekler).
        if (!isTrainingDay(state.sessionPlan, todayStr())) {
          persist({ ...state, lastDate: todayStr(), quest: [], lastStatus: 'completed' });
          return;
        }
        const carry = state.lastStatus !== 'completed' && state.quest.length > 0;
        const nq = carry ? state.quest : buildDailyQuest({
          programMode: 'sessions', rank: state.rank, penaltyLevel: state.penaltyLevel, dateStr: todayStr(),
          customExercises: state.customExercises, weeklyProgram: state.weeklyProgram, sessionPlan: effectivePlan(state)
        });
        persist({ ...state, lastDate: todayStr(), quest: nq, lastStatus: carry ? 'pending' : dayStatusFor(nq, 'sessions') });
        return;
      }
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

      const newQuest = buildDailyQuest({
        programMode: state.programMode, rank: state.rank, penaltyLevel: newPenaltyLevel, dateStr: todayStr(),
        customExercises: state.customExercises, weeklyProgram: state.weeklyProgram, sessionPlan: effectivePlan(state)
      });
      const newState: HunterState = {
        ...state,
        xp: newXp,
        penaltyLevel: newPenaltyLevel,
        streak: newStreak,
        lastDate: todayStr(),
        lastStatus: dayStatusFor(newQuest, state.programMode),
        quest: newQuest,
        history: missed ? [historyEntry, ...state.history] : state.history
      };
      persist(newState);
    } finally {
      setBusy(false);
    }
  };

  // İSTEK (kullanıcı: "set×tekrar" modeli — konuşma sonrası karar): tek bir checkbox yerine
  // her SET ayrı ayrı kaydediliyor. `logSet` bir set daha işler (setsDone+1, sets'i aşmaz);
  // `undoSet` yanlışlıkla ileri gidilirse geri alır (sadece gün henüz kapanmadıysa — kapandıktan
  // sonra XP/streak zaten işlendiği için geri almak karmaşık bir tersine işlem gerektirir).
  const logSet = async (id: string) => {
    if (busy || needsRollover) return;
    setBusy(true);
    try {
      const updatedQuest = state.quest.map(q => questItemId(q) === id && q.setsDone < q.sets ? { ...q, setsDone: q.setsDone + 1 } : q);
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

      // Antrenman programı: antrenman bitince sıra bir sonrakine geçer (bugünün listesi ekranda kalır).
      const newSessionPlan = (justCompleted && state.programMode === 'sessions')
        ? { ...state.sessionPlan, cursor: state.sessionPlan.cursor + 1, doneDates: [...(state.sessionPlan.doneDates || []), state.lastDate] }
        : state.sessionPlan;
      // Ağırlık gidişatı: o gün bu hareketle bir set yapıldıysa ve kg girilmişse günlüğe o günün kg'ı yazılır.
      let newWeights = state.weights;
      const doneItem = state.quest.find(q => questItemId(q) === id);
      const w = doneItem ? state.weights[doneItem.label] : undefined;
      if (doneItem && w && w.kg > 0 && !w.log.some(l => l.date === state.lastDate)) {
        newWeights = { ...state.weights, [doneItem.label]: { ...w, log: [...w.log, { date: state.lastDate, kg: w.kg }].slice(-60) } };
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
        shadows: newShadows,
        sessionPlan: newSessionPlan,
        weights: newWeights
      };
      persist(newState);
    } finally {
      setBusy(false);
    }
  };

  const undoSet = async (id: string) => {
    if (busy || needsRollover || state.lastStatus === 'completed') return;
    setBusy(true);
    try {
      const updatedQuest = state.quest.map(q => questItemId(q) === id && q.setsDone > 0 ? { ...q, setsDone: q.setsDone - 1 } : q);
      persist({ ...state, quest: updatedQuest });
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
      const newQuest = buildDailyQuest({
        programMode: state.programMode, rank: nextRank, penaltyLevel: 0, dateStr: todayStr(),
        customExercises: state.customExercises, weeklyProgram: state.weeklyProgram, sessionPlan: effectivePlan(state)
      });
      const newState: HunterState = {
        ...state,
        rank: nextRank,
        xp: 0,
        penaltyLevel: 0,
        quest: newQuest,
        lastStatus: dayStatusFor(newQuest, state.programMode),
        history: [{ date: todayStr(), text: rankedUp ? `🌀 Yükselme Zindanı tamamlandı — ${nextRank}-Rank'e terfi!` : '🏆 Zaten en üst rank\'tesin', xpDelta: 0 }, ...state.history]
      };
      persist(newState);
      setDungeonMode(false);
    } finally {
      setBusy(false);
    }
  };

  // ============================================================================
  // KENDİ PROGRAMIM — egzersiz kütüphanesi + haftalık program düzenleme
  // ============================================================================

  // Otomatik/Kendi Programım modu arasında geçiş — geçiş anında BUGÜNÜN görevi yeni moda göre
  // yeniden üretilir (deliberate bir aksiyon olduğu için ilerlemenin sıfırlanması kabul edilir).
  const switchProgramMode = async (mode: ProgramMode) => {
    if (busy) return;
    setBusy(true);
    try {
      const dateStr = state.lastDate || todayStr();
      const newQuest = buildDailyQuest({
        programMode: mode, rank: state.rank, penaltyLevel: state.penaltyLevel, dateStr,
        customExercises: state.customExercises, weeklyProgram: state.weeklyProgram, sessionPlan: effectivePlan(state)
      });
      const newState: HunterState = {
        ...state, programMode: mode, lastDate: dateStr, quest: newQuest,
        lastStatus: dayStatusFor(newQuest, mode)
      };
      persist(newState);
    } finally {
      setBusy(false);
    }
  };

  // Programdan (kütüphane/haftalık program) BUGÜNÜN görevini elle yeniden üretir — kütüphane/
  // program düzenlemeleri otomatik olarak bugünün görevini bozmasın diye, kullanıcı bu butona
  // basana kadar mevcut ilerleme korunur.
  const refreshTodayFromProgram = async () => {
    if (busy || state.programMode === 'auto') return;
    setBusy(true);
    try {
      const dateStr = state.lastDate || todayStr();
      const newQuest = buildDailyQuest({
        programMode: state.programMode, rank: state.rank, penaltyLevel: state.penaltyLevel, dateStr,
        customExercises: state.customExercises, weeklyProgram: state.weeklyProgram, sessionPlan: effectivePlan(state)
      });
      persist({ ...state, quest: newQuest, lastStatus: dayStatusFor(newQuest, state.programMode) });
    } finally {
      setBusy(false);
    }
  };

  const addCustomExercise = async () => {
    const name = newExName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const newExercise: CustomExercise = { id: `ex${Date.now()}`, name, groups: newExGroups };
      persist({ ...state, customExercises: [...state.customExercises, newExercise] });
      setNewExName('');
      setNewExGroups([]);
    } finally {
      setBusy(false);
    }
  };

  const deleteCustomExercise = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const newExercises = state.customExercises.filter(e => e.id !== id);
      const newProgram: WeeklyProgram = { ...state.weeklyProgram };
      WEEKDAYS.forEach(day => { newProgram[day] = (newProgram[day] || []).filter(e => e.exerciseId !== id); });
      const newPlan: SessionPlan = { ...state.sessionPlan, workouts: state.sessionPlan.workouts.map(w => w.filter(e => e.exerciseId !== id)) };
      const newPrograms = state.programs.map(pg => ({ ...pg, workouts: pg.workouts.map(w => w.filter(e => e.exerciseId !== id)) }));
      persist({ ...state, customExercises: newExercises, weeklyProgram: newProgram, sessionPlan: newPlan, programs: newPrograms });
    } finally {
      setBusy(false);
    }
  };

  const addEntryToDay = async (day: Weekday) => {
    if (busy) return;
    // BUG DÜZELTMESİ: form sadece kullanıcı bir alanı DEĞİŞTİRDİYSE dayAddForm'a yazılıyordu —
    // varsayılan değerlerle (ilk egzersiz, 2 set, 10 tekrar) hiç dokunmadan "+ Ekle"ye basılırsa
    // dayAddForm[day] undefined kalıyor ve fonksiyon sessizce hiçbir şey yapmadan çıkıyordu.
    // Render'daki AYNI varsayılanı burada da kullanmak gerekiyor.
    const form = dayAddForm[day] || { exerciseId: state.customExercises[0]?.id || '', sets: 2, reps: 10 };
    if (!form.exerciseId) return;
    setBusy(true);
    try {
      const newProgram: WeeklyProgram = { ...state.weeklyProgram, [day]: [...(state.weeklyProgram[day] || []), { exerciseId: form.exerciseId, sets: form.sets, reps: form.reps }] };
      persist({ ...state, weeklyProgram: newProgram });
    } finally {
      setBusy(false);
    }
  };

  const removeEntryFromDay = async (day: Weekday, index: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const newProgram: WeeklyProgram = { ...state.weeklyProgram, [day]: (state.weeklyProgram[day] || []).filter((_, i) => i !== index) };
      persist({ ...state, weeklyProgram: newProgram });
    } finally {
      setBusy(false);
    }
  };

  const groupStatus: Record<MuscleGroup, boolean> = { chest: false, abs: false, legs: false, arms: false, back: false, shoulders: false, cardio: false };
  state.quest.forEach(q => { if (isQuestDone(q)) q.groups.forEach(g => { groupStatus[g] = true; }); });
  const rankColor = RANK_COLOR[state.rank];
  const completedCount = state.quest.filter(isQuestDone).length;
  const progressPercent = state.quest.length > 0 ? Math.round((completedCount / state.quest.length) * 100) : 0;
  const isRestDay = state.programMode === 'custom' && state.quest.length === 0;
  const effPlan = effectivePlan(state);
  const sessionTotal = totalSessions(effPlan.workouts, effPlan.repeats);
  const sessionFinished = state.programMode === 'sessions' && state.quest.length === 0;
  // Gösterilen antrenmanın numarası: tamamlandıysa cursor zaten bir ilerlemiştir.
  const sessionNo = state.lastStatus === 'completed' && state.quest.length > 0 ? state.sessionPlan.cursor : state.sessionPlan.cursor + 1;
  const planName = state.sessionPlan.name || 'Antrenman Planı';
  const notTrainingDay = state.programMode === 'sessions' && sessionTotal > 0 && state.sessionPlan.cursor < sessionTotal && !isTrainingDay(state.sessionPlan, state.lastDate || todayStr());
  const nextTrainDate = notTrainingDay ? nextTrainingDate(state.sessionPlan, state.lastDate || todayStr()) : null;
  const todayDayLabel = state.programMode === 'sessions'
    ? (sessionFinished ? planName : `${planName} · Gün ${Math.min(sessionNo, sessionTotal)} / ${sessionTotal}`)
    : state.programMode === 'custom'
      ? `${state.lastDate ? weekdayForDate(state.lastDate) : ''} Programı`
      : (state.lastDate ? splitDayForDate(state.lastDate).name : SPLIT_DAYS[0].name);

  // ---- Hareket başına ağırlık (kg) ----
  // ± ile değiştirilir (2,5 kg adım); değişim o günün tarihiyle günlüğe yazılır (gidişat grafiği).
  const changeWeight = (label: string, delta: number) => {
    const w = state.weights[label] ?? { kg: 0, log: [] };
    const kg = Math.max(0, Math.round((w.kg + delta) * 10) / 10);
    const date = state.lastDate || todayStr();
    const log = [...w.log.filter(l => l.date !== date), { date, kg }].sort((a, b) => a.date.localeCompare(b.date)).slice(-60);
    persist({ ...state, weights: { ...state.weights, [label]: { kg, log } } });
  };

  // ---- Antrenman programı ----
  // Tamamlanmış antrenmanın ardından, ertesi günü beklemeden sıradakine geç.
  const startNextWorkout = () => {
    const nq = buildDailyQuest({
      ignoreSchedule: true,
      programMode: 'sessions', rank: state.rank, penaltyLevel: state.penaltyLevel, dateStr: todayStr(),
      customExercises: state.customExercises, weeklyProgram: state.weeklyProgram, sessionPlan: effectivePlan(state)
    });
    persist({ ...state, lastDate: todayStr(), quest: nq, lastStatus: dayStatusFor(nq, 'sessions') });
  };
  const updateSessionPlan = (next: SessionPlan) => persist({ ...state, sessionPlan: next });
  const rewindSessionPlan = () => updateSessionPlan({ ...state.sessionPlan, cursor: 0, doneDates: [] });

  // ---- Programlarım (kalıcı program kitaplığı) ----
  const updateProgram = (id: string, fn: (pg: SavedProgram) => SavedProgram) =>
    persist({ ...state, programs: state.programs.map(pg => pg.id === id ? fn(pg) : pg) });
  const createProgram = () => {
    const name = newProgramName.trim().replace(/[\[\]\n]/g, ' ');
    if (!name) return;
    const id = `pg${Date.now()}`;
    persist({ ...state, programs: [...state.programs, { id, name, workouts: [[]], repeats: [1] }] });
    setNewProgramName('');
    setEditingProgramId(id);
  };
  const deleteProgram = (id: string) => {
    if (editingProgramId === id) setEditingProgramId(null);
    if (planProgramId === id) setPlanProgramId(null);
    persist({ ...state, programs: state.programs.filter(pg => pg.id !== id) });
  };
  const addWorkoutTo = (pid: string) => updateProgram(pid, pg => ({ ...pg, workouts: [...pg.workouts, []], repeats: [...normalizeRepeats(pg), 1] }));
  const removeWorkoutFrom = (pid: string, i: number) => updateProgram(pid, pg => ({ ...pg, workouts: pg.workouts.filter((_, k) => k !== i), repeats: normalizeRepeats(pg).filter((_, k) => k !== i) }));
  // Bir listenin kaç gün uygulanacağı ("8 gün şu listeyi uygula").
  const setRepeatOf = (pid: string, i: number, n: number) => updateProgram(pid, pg => ({ ...pg, repeats: normalizeRepeats(pg).map((r, k) => k === i ? Math.max(1, Math.min(99, n || 1)) : r) }));
  const addEntryToProgram = (pid: string, i: number) => {
    const form = dayAddForm[`p${pid}-${i}`] || { exerciseId: state.customExercises[0]?.id || '', sets: 3, reps: 10 };
    if (!form.exerciseId) return;
    updateProgram(pid, pg => ({ ...pg, workouts: pg.workouts.map((w, k) => k === i ? [...w, { exerciseId: form.exerciseId, sets: form.sets, reps: form.reps }] : w) }));
  };
  const removeEntryFromProgram = (pid: string, i: number, j: number) =>
    updateProgram(pid, pg => ({ ...pg, workouts: pg.workouts.map((w, k) => k === i ? w.filter((_, m) => m !== j) : w) }));
  // Programı başlat: aktif plana KOPYALANIR (başlangıç tarihi + antrenman günleri ile), mod "Antrenman Planı" olur.
  const startProgram = (pid: string) => {
    const pg = state.programs.find(x => x.id === pid);
    if (!pg || planForm.startDate === '') return;
    const plan: SessionPlan = { workouts: pg.workouts.map(w => w.map(e => ({ ...e }))), cursor: 0, programId: pg.id, name: pg.name, startDate: planForm.startDate, weekdays: [...planForm.weekdays].sort(), doneDates: [], repeats: normalizeRepeats(pg) };
    const date = todayStr();
    const quest = buildDailyQuest({
      programMode: 'sessions', rank: state.rank, penaltyLevel: state.penaltyLevel, dateStr: date,
      customExercises: state.customExercises, weeklyProgram: state.weeklyProgram, sessionPlan: plan
    });
    persist({ ...state, programMode: 'sessions', sessionPlan: plan, lastDate: date, quest, lastStatus: dayStatusFor(quest, 'sessions') });
    setPlanProgramId(null);
  };
  // Aktif planı bırak: otomatik moda dön.
  const stopPlan = () => {
    const date = todayStr();
    const quest = buildDailyQuest({
      programMode: 'auto', rank: state.rank, penaltyLevel: state.penaltyLevel, dateStr: date,
      customExercises: state.customExercises, weeklyProgram: state.weeklyProgram, sessionPlan: emptySessionPlan()
    });
    persist({ ...state, programMode: 'auto', sessionPlan: emptySessionPlan(), lastDate: date, quest, lastStatus: 'pending' });
  };

  // Günün görevini saat moduna göre GRUPLAYIP sıralı bir "program" haline getiriyor (Güç →
  // Fonksiyonel → CrossFit) — her blok başında hangi saat modunun seçileceği yazıyor, blok
  // içindeki adımlar numaralandırılıyor.
  const programRows = useMemo(() => {
    const rows: ({ type: 'header'; mode: WatchMode } | { type: 'item'; q: DailyQuestItem; step: number })[] = [];
    let step = 0;
    WATCH_MODE_ORDER.forEach(mode => {
      const items = state.quest.filter(q => watchModeFor(q) === mode);
      if (items.length === 0) return;
      rows.push({ type: 'header', mode });
      items.forEach(q => { step++; rows.push({ type: 'item', q, step }); });
    });
    return rows;
  }, [state.quest]);

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>⚔️</span>
            <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 800, letterSpacing: '0.5px', fontFamily: 'monospace', color: '#e2e8f0' }}>HUNTER SİSTEMİ</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.12)' }}>
              <button
                type="button" disabled={busy} onClick={() => switchProgramMode('auto')}
                style={{
                  padding: '6px 10px', fontSize: '10.5px', fontFamily: 'monospace', fontWeight: 700, border: 'none', cursor: busy ? 'wait' : 'pointer',
                  background: state.programMode === 'auto' ? rankColor : 'rgba(255,255,255,0.04)',
                  color: state.programMode === 'auto' ? '#0a0a0a' : '#94a3b8'
                }}
              >🤖 Otomatik</button>
              <button
                type="button" disabled={busy} onClick={() => switchProgramMode('custom')}
                style={{
                  padding: '6px 10px', fontSize: '10.5px', fontFamily: 'monospace', fontWeight: 700, border: 'none', cursor: busy ? 'wait' : 'pointer',
                  background: state.programMode === 'custom' ? rankColor : 'rgba(255,255,255,0.04)',
                  color: state.programMode === 'custom' ? '#0a0a0a' : '#94a3b8'
                }}
              >📝 Kendi Programım</button>
              <button
                type="button" disabled={busy} onClick={() => switchProgramMode('sessions')}
                style={{
                  padding: '6px 10px', fontSize: '10.5px', fontFamily: 'monospace', fontWeight: 700, border: 'none', cursor: busy ? 'wait' : 'pointer',
                  background: state.programMode === 'sessions' ? rankColor : 'rgba(255,255,255,0.04)',
                  color: state.programMode === 'sessions' ? '#0a0a0a' : '#94a3b8'
                }}
              >🗂 Antrenman Planı</button>
            </div>
            <button
              type="button" onClick={() => setEditorOpen(o => !o)}
              style={{
                padding: '7px 10px', fontSize: '10.5px', fontFamily: 'monospace', fontWeight: 700, cursor: 'pointer', borderRadius: '8px',
                border: `1px solid ${editorOpen ? rankColor : 'rgba(255,255,255,0.12)'}`,
                background: editorOpen ? `${rankColor}1a` : 'rgba(255,255,255,0.04)', color: editorOpen ? rankColor : '#94a3b8'
              }}
            >🛠 Programımı Düzenle</button>
          </div>
        </div>

        {editorOpen && (
          // ============ KENDİ PROGRAMIM DÜZENLEYİCİ ============
          <div style={{ padding: '18px', borderRadius: '14px', background: 'rgba(15,23,42,0.75)', border: `1px solid ${rankColor}55` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button" onClick={() => setEditorTab('exercises')}
                  style={{
                    padding: '7px 12px', fontSize: '11.5px', fontWeight: 800, fontFamily: 'monospace', borderRadius: '8px', cursor: 'pointer',
                    border: `1px solid ${editorTab === 'exercises' ? rankColor : 'rgba(255,255,255,0.12)'}`,
                    background: editorTab === 'exercises' ? `${rankColor}1a` : 'transparent', color: editorTab === 'exercises' ? rankColor : '#94a3b8'
                  }}
                >📚 Egzersiz Kütüphanem</button>
                <button
                  type="button" onClick={() => setEditorTab('schedule')}
                  style={{
                    padding: '7px 12px', fontSize: '11.5px', fontWeight: 800, fontFamily: 'monospace', borderRadius: '8px', cursor: 'pointer',
                    border: `1px solid ${editorTab === 'schedule' ? rankColor : 'rgba(255,255,255,0.12)'}`,
                    background: editorTab === 'schedule' ? `${rankColor}1a` : 'transparent', color: editorTab === 'schedule' ? rankColor : '#94a3b8'
                  }}
                >📅 Haftalık Program</button>
                <button
                  type="button" onClick={() => setEditorTab('sessions')}
                  style={{
                    padding: '7px 12px', fontSize: '11.5px', fontWeight: 800, fontFamily: 'monospace', borderRadius: '8px', cursor: 'pointer',
                    border: `1px solid ${editorTab === 'sessions' ? rankColor : 'rgba(255,255,255,0.12)'}`,
                    background: editorTab === 'sessions' ? `${rankColor}1a` : 'transparent', color: editorTab === 'sessions' ? rankColor : '#94a3b8'
                  }}
                >🗂 Programlarım</button>
              </div>
              <button type="button" onClick={() => setEditorOpen(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}>✕ Kapat</button>
            </div>

            {editorTab === 'exercises' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {state.customExercises.length === 0 && (
                  <div style={{ fontSize: '11.5px', color: '#64748b', padding: '10px' }}>Henüz kayıtlı egzersizin yok — aşağıdan ekle.</div>
                )}
                {state.customExercises.map(ex => (
                  <div key={ex.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <span style={{ flex: 1, fontSize: '12.5px', color: '#e2e8f0' }}>{ex.name}</span>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxWidth: '260px' }}>
                      {ex.groups.map(g => (
                        <span key={g} style={{ fontSize: '9.5px', padding: '2px 7px', borderRadius: '10px', background: `${rankColor}1a`, color: rankColor, fontFamily: 'monospace' }}>{MUSCLE_GROUP_LABEL[g]}</span>
                      ))}
                      {ex.groups.length === 0 && <span style={{ fontSize: '9.5px', color: '#64748b' }}>grup seçilmedi</span>}
                    </div>
                    <button type="button" disabled={busy} onClick={() => deleteCustomExercise(ex.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: busy ? 'wait' : 'pointer', fontSize: '14px' }}>🗑</button>
                  </div>
                ))}
                <div style={{ marginTop: '6px', padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.15)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 800, color: '#94a3b8', fontFamily: 'monospace' }}>+ YENİ EGZERSİZ EKLE</div>
                  <input
                    type="text" value={newExName} onChange={e => setNewExName(e.target.value)} placeholder="Hareket adı (örn. Dambıl ile Kol Geliştirme)"
                    style={{ padding: '9px 11px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', fontSize: '12px', outline: 'none' }}
                  />
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {ALL_MUSCLE_GROUPS.map(g => {
                      const active = newExGroups.includes(g);
                      return (
                        <button
                          key={g} type="button"
                          onClick={() => setNewExGroups(list => active ? list.filter(x => x !== g) : [...list, g])}
                          style={{
                            padding: '6px 10px', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace', cursor: 'pointer',
                            border: `1px solid ${active ? rankColor : 'rgba(255,255,255,0.15)'}`,
                            background: active ? `${rankColor}22` : 'transparent', color: active ? rankColor : '#94a3b8'
                          }}
                        >{MUSCLE_GROUP_LABEL[g]}</button>
                      );
                    })}
                  </div>
                  <button
                    type="button" disabled={busy || !newExName.trim()} onClick={addCustomExercise}
                    style={{
                      alignSelf: 'flex-start', padding: '8px 16px', borderRadius: '8px', border: 'none', fontWeight: 800, fontSize: '12px', fontFamily: 'monospace',
                      background: newExName.trim() ? rankColor : 'rgba(255,255,255,0.08)', color: newExName.trim() ? '#0a0a0a' : '#64748b',
                      cursor: busy || !newExName.trim() ? 'not-allowed' : 'pointer'
                    }}
                  >Ekle</button>
                </div>
              </div>
            ) : editorTab === 'schedule' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {state.customExercises.length === 0 && (
                  <div style={{ fontSize: '11.5px', color: '#64748b' }}>Önce "📚 Egzersiz Kütüphanem" sekmesinden en az bir hareket ekle.</div>
                )}
                {WEEKDAYS.map(day => {
                  const entries = state.weeklyProgram[day] || [];
                  const form = dayAddForm[day] || { exerciseId: state.customExercises[0]?.id || '', sets: 2, reps: 10 };
                  return (
                    <div key={day} style={{ padding: '10px 12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 800, color: '#e2e8f0', fontFamily: 'monospace' }}>{day}</span>
                        {entries.length === 0 && <span style={{ fontSize: '10px', color: '#64748b' }}>🛌 Dinlenme Günü</span>}
                      </div>
                      {entries.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                          {entries.map((entry, i) => {
                            const ex = state.customExercises.find(e => e.id === entry.exerciseId);
                            return (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px' }}>
                                <span style={{ flex: 1, color: '#cbd5e1' }}>{ex ? ex.name : '(silinmiş egzersiz)'}</span>
                                <span style={{ fontFamily: 'monospace', color: rankColor, fontWeight: 700 }}>{entry.sets}×{entry.reps}</span>
                                <button type="button" disabled={busy} onClick={() => removeEntryFromDay(day, i)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: busy ? 'wait' : 'pointer', fontSize: '12px' }}>✕</button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {state.customExercises.length > 0 && (
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <select
                            value={form.exerciseId}
                            onChange={e => setDayAddForm(f => ({ ...f, [day]: { ...form, exerciseId: e.target.value } }))}
                            style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', fontSize: '11px', flex: 1, minWidth: '140px' }}
                          >
                            {state.customExercises.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
                          </select>
                          <input
                            type="number" min={1} value={form.sets}
                            onChange={e => setDayAddForm(f => ({ ...f, [day]: { ...form, sets: Math.max(1, parseInt(e.target.value, 10) || 1) } }))}
                            style={{ width: '48px', padding: '6px 6px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', fontSize: '11px' }}
                          />
                          <span style={{ fontSize: '10px', color: '#64748b' }}>set ×</span>
                          <input
                            type="number" min={1} value={form.reps}
                            onChange={e => setDayAddForm(f => ({ ...f, [day]: { ...form, reps: Math.max(1, parseInt(e.target.value, 10) || 1) } }))}
                            style={{ width: '48px', padding: '6px 6px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', fontSize: '11px' }}
                          />
                          <span style={{ fontSize: '10px', color: '#64748b' }}>tekrar</span>
                          <button
                            type="button" disabled={busy} onClick={() => addEntryToDay(day)}
                            style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: rankColor, color: '#0a0a0a', fontWeight: 800, fontSize: '10.5px', fontFamily: 'monospace', cursor: busy ? 'wait' : 'pointer' }}
                          >+ Ekle</button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button" disabled={busy} onClick={refreshTodayFromProgram}
                  style={{
                    alignSelf: 'flex-start', padding: '9px 16px', borderRadius: '8px', border: `1px solid ${rankColor}`,
                    background: `${rankColor}1a`, color: rankColor, fontWeight: 800, fontSize: '11.5px', fontFamily: 'monospace', cursor: busy ? 'wait' : 'pointer'
                  }}
                >🔄 Bugünün Görevini Programdan Yenile</button>
              </div>
            ) : (
              // ---- PROGRAMLARIM: kalıcı program kitaplığı + planlama ----
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {state.customExercises.length === 0 && (
                  <div style={{ fontSize: '11.5px', color: '#64748b' }}>Önce "📚 Egzersiz Kütüphanem" sekmesinden hareketlerini ekle, sonra program kurabilirsin.</div>
                )}
                <div style={{ fontSize: '11.5px', color: '#94a3b8', lineHeight: 1.5 }}>
                  Antrenörün verdiği programı BİR KEZ kaydet: bir liste oluştur, "gün uygula" kutusuna kaç gün yapacağını yaz (örn. 8). Sonra değişecekse yeni bir liste ekle. İstediğin zaman başlangıç tarihi ve günlerini seçip planla; aktif plan programı canlı izler, programı düzeltince plana hemen yansır.
                </div>

                {effPlan.workouts.length > 0 && (
                  <div style={{ padding: '10px 12px', borderRadius: '10px', background: `${rankColor}12`, border: `1px solid ${rankColor}` }}>
                    <div style={{ fontSize: '12px', fontWeight: 800, color: rankColor, fontFamily: 'monospace' }}>
                      ▶ Aktif: {state.sessionPlan.name || 'Antrenman Planı'}
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#cbd5e1', margin: '4px 0 8px' }}>
                      {state.sessionPlan.cursor < sessionTotal ? `Sıradaki: Gün ${state.sessionPlan.cursor + 1} / ${sessionTotal}` : `Program bitti (${sessionTotal}/${sessionTotal})`}
                      {' · '}
                      {(state.sessionPlan.weekdays && state.sessionPlan.weekdays.length > 0) ? state.sessionPlan.weekdays.map(d => WEEKDAYS[d].slice(0, 3)).join(' ') : 'her gün'}
                      {state.sessionPlan.startDate ? ` · başlangıç ${formatTrDate(state.sessionPlan.startDate)}` : ''}
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#e2e8f0', marginBottom: '8px' }}>
                      {Math.min(state.sessionPlan.cursor, sessionTotal)} / {sessionTotal} gün yapıldı · {Math.max(0, sessionTotal - state.sessionPlan.cursor)} gün kaldı
                      {missedPlannedDays(effPlan, todayStr()) > 0 && <span style={{ color: '#f59e0b' }}> · {missedPlannedDays(effPlan, todayStr())} planlı gün kaçırıldı</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button type="button" onClick={rewindSessionPlan} style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#94a3b8', fontSize: '11px', cursor: 'pointer' }}>↺ Başa sar</button>
                      <button type="button" onClick={stopPlan} style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.4)', background: 'transparent', color: '#ef4444', fontSize: '11px', cursor: 'pointer' }}>⏹ Planı bırak</button>
                      <button type="button" disabled={busy} onClick={refreshTodayFromProgram} style={{ padding: '6px 10px', borderRadius: '8px', border: `1px solid ${rankColor}`, background: 'transparent', color: rankColor, fontSize: '11px', cursor: busy ? 'wait' : 'pointer' }}>🔄 Bugünü yenile</button>
                    </div>
                  </div>
                )}

                {state.programs.length === 0 && (
                  <div style={{ fontSize: '11.5px', color: '#64748b', padding: '6px' }}>Henüz kayıtlı programın yok — aşağıdan bir ad verip oluştur.</div>
                )}
                {state.programs.map(pg => {
                  const editing = editingProgramId === pg.id;
                  const planning = planProgramId === pg.id;
                  const isActive = state.sessionPlan.programId === pg.id && effPlan.workouts.length > 0;
                  return (
                    <div key={pg.id} style={{ padding: '10px 12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${editing || planning ? rankColor : 'rgba(255,255,255,0.08)'}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ flex: 1, minWidth: '120px', fontSize: '13px', fontWeight: 700, color: '#e2e8f0' }}>{pg.name}{isActive && <span style={{ marginLeft: '6px', fontSize: '10px', color: rankColor }}>▶ aktif</span>}</span>
                        <span style={{ fontSize: '10.5px', color: '#64748b', fontFamily: 'monospace' }}>{totalSessions(pg.workouts, pg.repeats)} gün</span>
                        <button type="button" onClick={() => { setEditingProgramId(editing ? null : pg.id); setPlanProgramId(null); }} style={{ padding: '5px 9px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.15)', background: editing ? `${rankColor}1a` : 'transparent', color: editing ? rankColor : '#94a3b8', fontSize: '11px', cursor: 'pointer' }}>✏️ Düzenle</button>
                        <button type="button" onClick={() => { setPlanProgramId(planning ? null : pg.id); setEditingProgramId(null); setPlanForm({ startDate: todayStr(), weekdays: [] }); }} style={{ padding: '5px 9px', borderRadius: '7px', border: `1px solid ${rankColor}`, background: planning ? `${rankColor}1a` : 'transparent', color: rankColor, fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>📅 Planla</button>
                        <button type="button" onClick={() => deleteProgram(pg.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>🗑</button>
                      </div>

                      {planning && (
                        <div style={{ marginTop: '10px', padding: '10px', borderRadius: '8px', background: 'rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <label style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            Başlangıç tarihi
                            <input type="date" value={planForm.startDate} onChange={e => setPlanForm(f => ({ ...f, startDate: e.target.value }))}
                              style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', fontSize: '11px' }} />
                          </label>
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>Hangi günler antrenman yapacaksın? <span style={{ color: '#64748b' }}>(hiçbiri seçili değilse her gün)</span></div>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {WEEKDAYS.map((d, i) => {
                              const on = planForm.weekdays.includes(i);
                              return (
                                <button key={d} type="button" onClick={() => setPlanForm(f => ({ ...f, weekdays: on ? f.weekdays.filter(x => x !== i) : [...f.weekdays, i] }))}
                                  style={{ padding: '6px 10px', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace', cursor: 'pointer', border: `1px solid ${on ? rankColor : 'rgba(255,255,255,0.15)'}`, background: on ? `${rankColor}22` : 'transparent', color: on ? rankColor : '#94a3b8' }}>{d.slice(0, 3)}</button>
                              );
                            })}
                          </div>
                          <button type="button" disabled={pg.workouts.length === 0 || pg.workouts.every(w => w.length === 0)} onClick={() => startProgram(pg.id)}
                            style={{ alignSelf: 'flex-start', padding: '8px 16px', borderRadius: '8px', border: 'none', fontWeight: 800, fontSize: '12px', fontFamily: 'monospace', background: rankColor, color: '#0a0a0a', cursor: 'pointer', opacity: pg.workouts.every(w => w.length === 0) ? 0.4 : 1 }}>▶ Başlat</button>
                          {effPlan.workouts.length > 0 && <div style={{ fontSize: '10.5px', color: '#64748b' }}>Not: başlatırsan şu an aktif olan plan ve ilerlemesi bu programla değişir.</div>}
                        </div>
                      )}

                      {editing && (
                        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {pg.workouts.map((entries, i) => {
                            const fk = `p${pg.id}-${i}`;
                            const form = dayAddForm[fk] || { exerciseId: state.customExercises[0]?.id || '', sets: 3, reps: 10 };
                            return (
                              <div key={i} style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(0,0,0,0.2)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', fontWeight: 800, color: '#e2e8f0', fontFamily: 'monospace', flexWrap: 'wrap' }}>
                                    Liste {i + 1}
                                    <input type="number" min={1} max={99} value={repeatOf(pg.repeats, i)} onChange={e => setRepeatOf(pg.id, i, parseInt(e.target.value, 10) || 1)}
                                      style={{ width: '48px', padding: '4px 6px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', fontSize: '11px' }} />
                                    <span style={{ fontWeight: 500, color: '#94a3b8' }}>gün uygula</span>
                                  </span>
                                  <button type="button" onClick={() => removeWorkoutFrom(pg.id, i)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '11px' }}>🗑 Sil</button>
                                </div>
                                {entries.length > 0 && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '6px' }}>
                                    {entries.map((entry, j) => {
                                      const ex = state.customExercises.find(e => e.id === entry.exerciseId);
                                      return (
                                        <div key={j} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px' }}>
                                          <span style={{ flex: 1, color: '#cbd5e1' }}>{ex ? ex.name : '(silinmiş egzersiz)'}</span>
                                          <span style={{ fontFamily: 'monospace', color: rankColor, fontWeight: 700 }}>{entry.sets}×{entry.reps}</span>
                                          <button type="button" onClick={() => removeEntryFromProgram(pg.id, i, j)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                {state.customExercises.length > 0 && (
                                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <select value={form.exerciseId} onChange={e => setDayAddForm(f => ({ ...f, [fk]: { ...form, exerciseId: e.target.value } }))}
                                      style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', fontSize: '11px', flex: 1, minWidth: '130px' }}>
                                      {state.customExercises.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
                                    </select>
                                    <input type="number" min={1} value={form.sets} onChange={e => setDayAddForm(f => ({ ...f, [fk]: { ...form, sets: Math.max(1, parseInt(e.target.value, 10) || 1) } }))}
                                      style={{ width: '46px', padding: '6px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', fontSize: '11px' }} />
                                    <span style={{ fontSize: '10px', color: '#64748b' }}>set ×</span>
                                    <input type="number" min={1} value={form.reps} onChange={e => setDayAddForm(f => ({ ...f, [fk]: { ...form, reps: Math.max(1, parseInt(e.target.value, 10) || 1) } }))}
                                      style={{ width: '46px', padding: '6px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', fontSize: '11px' }} />
                                    <span style={{ fontSize: '10px', color: '#64748b' }}>tekrar</span>
                                    <button type="button" onClick={() => addEntryToProgram(pg.id, i)} style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', background: rankColor, color: '#0a0a0a', fontWeight: 800, fontSize: '10.5px', fontFamily: 'monospace', cursor: 'pointer' }}>+ Ekle</button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          <button type="button" onClick={() => addWorkoutTo(pg.id)} style={{ alignSelf: 'flex-start', padding: '7px 14px', borderRadius: '8px', border: `1px dashed ${rankColor}`, background: 'transparent', color: rankColor, fontWeight: 800, fontSize: '11px', fontFamily: 'monospace', cursor: 'pointer' }}>+ Yeni liste ekle (sonra değişecek)</button>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <input type="text" value={newProgramName} onChange={e => setNewProgramName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') createProgram(); }} placeholder="Yeni program adı (örn. Antrenör 8 Gün)"
                    style={{ flex: 1, minWidth: '160px', padding: '9px 11px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', fontSize: '12px', outline: 'none' }} />
                  <button type="button" disabled={!newProgramName.trim()} onClick={createProgram}
                    style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', fontWeight: 800, fontSize: '12px', fontFamily: 'monospace', background: newProgramName.trim() ? rankColor : 'rgba(255,255,255,0.08)', color: newProgramName.trim() ? '#0a0a0a' : '#64748b', cursor: newProgramName.trim() ? 'pointer' : 'not-allowed' }}>+ Yeni program</button>
                </div>
              </div>
            )}
          </div>
        )}

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
                <div style={{ fontSize: '10.5px', color: rankColor, fontFamily: 'monospace', fontWeight: 700 }}>📅 {todayDayLabel}</div>
                {state.programMode === 'sessions' && sessionTotal > 0 && (() => {
                  const doneCount = Math.min(state.sessionPlan.cursor, sessionTotal);
                  const remaining = sessionTotal - doneCount;
                  const today = todayStr();
                  const missed = missedPlannedDays(effPlan, today);
                  const finish = projectedFinish(effPlan, today, state.lastStatus !== 'completed' || state.quest.length === 0);
                  return (
                    <div style={{ padding: '10px 12px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12.5px', fontWeight: 800, color: '#e2e8f0' }}>{doneCount} / {sessionTotal} gün yapıldı</span>
                        <span style={{ fontSize: '11.5px', color: remaining === 0 ? '#22c55e' : '#94a3b8', fontFamily: 'monospace' }}>{remaining === 0 ? '🎉 program bitti' : `${remaining} gün kaldı`}</span>
                      </div>
                      <div style={{ height: '5px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.round((doneCount / sessionTotal) * 100)}%`, height: '100%', background: '#22c55e', transition: 'width 0.4s ease' }} />
                      </div>
                      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                        {Array.from({ length: sessionTotal }).map((_, i) => {
                          const isDone = i < doneCount, isNext = i === doneCount;
                          const when = state.sessionPlan.doneDates?.[i];
                          return (
                            <span key={i} title={isDone ? `Gün ${i + 1} ✓${when ? ' ' + formatTrDate(when) : ''}` : `Gün ${i + 1}`}
                              style={{ width: '26px', height: '26px', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontFamily: 'monospace', fontWeight: 800,
                                background: isDone ? 'rgba(34,197,94,0.18)' : 'transparent', color: isDone ? '#22c55e' : isNext ? rankColor : '#64748b',
                                border: `1px solid ${isDone ? 'rgba(34,197,94,0.5)' : isNext ? rankColor : 'rgba(255,255,255,0.12)'}` }}>{isDone ? '✓' : i + 1}</span>
                          );
                        })}
                      </div>
                      {(missed > 0 || finish) && (
                        <div style={{ fontSize: '10.5px', color: '#94a3b8', lineHeight: 1.5 }}>
                          {missed > 0 && <div style={{ color: '#f59e0b' }}>⚠️ {missed} planlı gün kaçırıldı — sıra korunur, program {missed} gün öteye kayar.</div>}
                          {finish && <div>Tahmini bitiş: {formatTrDate(finish)}</div>}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div style={{ width: '100%', height: '5px', borderRadius: '3px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <div style={{ width: `${progressPercent}%`, height: '100%', background: rankColor, transition: 'width 0.4s ease' }} />
                </div>
                {sessionFinished && (
                  <div style={{ padding: '20px', textAlign: 'center', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.12)', color: '#94a3b8', fontSize: '12.5px', lineHeight: 1.5 }}>
                    {sessionTotal === 0
                      ? 'Aktif bir plan yok. 🛠 Programımı Düzenle → 🗂 Programlarım bölümünden bir program kaydedip planla.'
                      : notTrainingDay
                        ? `Bugün planlı bir antrenman günü değil. Sıradaki: Gün ${state.sessionPlan.cursor + 1}${nextTrainDate ? ` — ${formatTrDate(nextTrainDate)}` : ''}.`
                        : '🎉 Program tamamlandı! 🛠 Programımı Düzenle → 🗂 Programlarım bölümünden başa sarabilir ya da yeni bir program başlatabilirsin.'}
                  </div>
                )}
                {state.programMode === 'sessions' && state.lastStatus === 'completed' && state.quest.length > 0 && state.sessionPlan.cursor < sessionTotal && (
                  <button type="button" onClick={startNextWorkout} style={{ padding: '10px', borderRadius: '8px', border: `1px solid ${rankColor}`, background: `${rankColor}1a`, color: rankColor, fontWeight: 800, fontSize: '12px', fontFamily: 'monospace', cursor: 'pointer' }}>
                    ▶ Sıradaki güne geç (Gün {state.sessionPlan.cursor + 1})
                  </button>
                )}
                {isRestDay && (
                  <div style={{ padding: '20px', textAlign: 'center', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.12)', color: '#94a3b8', fontSize: '12.5px' }}>
                    🛌 Bugün dinlenme günü — programında bu güne hareket eklenmemiş. Kas grupları toparlanıyor.
                  </div>
                )}
                {programRows.map((row, idx) => {
                  if (row.type === 'header') {
                    return (
                      <div key={`h-${row.mode}`} style={{
                        display: 'flex', alignItems: 'center', gap: '6px', marginTop: idx > 0 ? '4px' : 0,
                        padding: '6px 10px', borderRadius: '6px', background: 'rgba(255,255,255,0.04)',
                        border: '1px dashed rgba(255,255,255,0.15)'
                      }}>
                        <span style={{ fontSize: '12px' }}>{WATCH_MODE_ICON[row.mode]}</span>
                        <span style={{ fontSize: '10.5px', fontWeight: 800, color: '#94a3b8', fontFamily: 'monospace', letterSpacing: '0.3px' }}>
                          SAATTE "{row.mode.toUpperCase()}" MODUNU SEÇ
                        </span>
                      </div>
                    );
                  }
                  const q = row.q;
                  const done = isQuestDone(q);
                  return (
                    <div
                      key={questItemId(q)}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', borderRadius: '8px',
                        background: done ? `${rankColor}1a` : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${done ? rankColor : 'rgba(255,255,255,0.08)'}`,
                        opacity: busy ? 0.7 : 1
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{
                          width: '18px', height: '18px', borderRadius: '50%', background: 'rgba(255,255,255,0.06)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 800,
                          color: '#64748b', fontFamily: 'monospace', flexShrink: 0
                        }}>{row.step}</span>
                        <span style={{ flex: 1, fontSize: '12.5px', fontWeight: done ? 700 : 500, textDecoration: done ? 'line-through' : 'none', color: done ? '#94a3b8' : '#e2e8f0' }}>{q.label}</span>
                        <span style={{ fontSize: '11.5px', fontFamily: 'monospace', color: rankColor, fontWeight: 700 }}>{q.sets}×{q.reps}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }} title="Bu hareketin ağırlığı (kg) — her değişiklik gidişata yazılır">
                          <button type="button" onClick={() => changeWeight(q.label, -2.5)} style={{ width: '22px', height: '22px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#94a3b8', fontSize: '13px', lineHeight: 1, cursor: 'pointer', padding: 0 }}>−</button>
                          <span style={{ fontSize: '11px', fontFamily: 'monospace', minWidth: '42px', textAlign: 'center', color: (state.weights[q.label]?.kg ?? 0) > 0 ? '#e2e8f0' : '#64748b' }}>{(state.weights[q.label]?.kg ?? 0) > 0 ? `${state.weights[q.label].kg} kg` : 'kg'}</span>
                          <button type="button" onClick={() => changeWeight(q.label, 2.5)} style={{ width: '22px', height: '22px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#94a3b8', fontSize: '13px', lineHeight: 1, cursor: 'pointer', padding: 0 }}>+</button>
                        </span>
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
                            type="button" disabled={busy} onClick={() => undoSet(questItemId(q))} title="Son seti geri al"
                            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: '#94a3b8', fontSize: '11px', padding: '5px 7px', cursor: busy ? 'wait' : 'pointer' }}
                          >↺</button>
                        )}
                        <button
                          type="button" disabled={busy || done} onClick={() => logSet(questItemId(q))}
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

        {/* Ağırlık gidişatı — hareket başına kg geçmişi (İSTEK: "leg ext 20 kg ile çalışıyorum, bir süre sonra
            kg arttırıcam, bu tutulmuyor") */}
        {Object.values(state.weights).some(w => w.log.length > 0) && (
          <div style={{ padding: '16px', borderRadius: '14px', background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#64748b', fontFamily: 'monospace', marginBottom: '10px', letterSpacing: '0.5px' }}>🏋️ AĞIRLIK GİDİŞATI</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {Object.entries(state.weights).filter(([, w]) => w.log.length > 0)
                .sort((a, b) => b[1].log[b[1].log.length - 1].date.localeCompare(a[1].log[a[1].log.length - 1].date))
                .map(([name, w]) => {
                  const pts = w.log.slice(-10).map(l => l.kg);
                  const min = Math.min(...pts), max = Math.max(...pts), span = Math.max(1, max - min);
                  const X = (i: number) => pts.length === 1 ? 40 : 4 + (i * 72) / (pts.length - 1);
                  const Y = (v: number) => 20 - ((v - min) / span) * 16;
                  const first = w.log[0].kg, last = w.log[w.log.length - 1].kg, delta = Math.round((last - first) * 10) / 10;
                  return (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px' }}>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#cbd5e1' }}>{name}</span>
                      <svg width="80" height="24" viewBox="0 0 80 24" style={{ flexShrink: 0 }}>
                        {pts.length > 1 && <polyline points={pts.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} fill="none" stroke={rankColor} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />}
                        <circle cx={X(pts.length - 1)} cy={Y(pts[pts.length - 1])} r="2.6" fill={rankColor} />
                      </svg>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#e2e8f0', minWidth: '52px', textAlign: 'right' }}>{last} kg</span>
                      <span style={{ fontFamily: 'monospace', fontSize: '10.5px', minWidth: '46px', textAlign: 'right', color: delta > 0 ? '#22c55e' : delta < 0 ? '#ef4444' : '#64748b' }}>{delta > 0 ? '+' : ''}{delta} kg</span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

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
