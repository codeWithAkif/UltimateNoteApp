import React, { useState, useMemo } from 'react';
import type { TimelineItem } from '../App';
import KanbanBoard from './KanbanBoard';
import { Briefcase, Folder, BarChart, LayoutDashboard, Target, Users, User, Plus, Gauge, Trash2 } from 'lucide-react';

interface NoteItem {
  name: string;
  path: string;
  updatedAt: number;
}

interface ProjectsViewProps {
  timelineItems: TimelineItem[];
  notes: NoteItem[];
  scannedContents: Record<string, string>;
  onChangeTaskStatus: (id: string, newStatus: 'backlog' | 'inprogress' | 'review' | 'blocked' | 'done') => void;
  onOpenNote?: (item: TimelineItem) => void;
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Müşteriye renk/icon atarken müşteri notunun içeriğine [renk:]/[icon:] etiketi yazmak
  // için gerekli — Finans kategorileri gibi ayrı bir tablo yerine, müşteri zaten bir NOT
  // olduğundan (bkz. #müşteri etiketi) veriyi doğrudan o notun içinde tutmak, mevcut
  // not-senkron mekanizmasını (satır-bazlı, kanıtlanmış) bedavaya kullanır.
  onSaveNote?: (path: string, content: string) => Promise<void>;
  // İSTEK: Yeni müşteri/proje oluşturma iskelet klasör yapısı Ayarlar > Clients'ta
  // belirlenen kök klasörün altına kurulur: {clientsFolder}/{MüşteriAdı}/{MüşteriAdı}.md
  // (#müşteri etiketli) ve {clientsFolder}/{MüşteriAdı}/Projeler/{ProjeAdı}.md (#proje +
  // müşteri-slug etiketli). Ayarlar'daki varsayılan "Müşteriler" ile eşleşir.
  clientsFolder?: string;
}

// Bir müşteri/proje notunun içeriğinden [renk:hex] ve [icon:emoji] etiketlerini okur.
// Not içinde yoksa varsayılan (nötr gri + 👤) döner.
//
// BUG DÜZELTMESİ (kullanıcı geri bildirimi: "renk olmadı, notda renki başında # olacak
// şekilde belirtirsen onu etiket olarak alır"): [renk:#22c55e] yazıldığında, notun GENEL
// etiket tarayıcısı (App.tsx'teki tagRegexGlobal, sidebar "Etiketler" listesi vb. — TÜM not
// içeriğini tarar, köşeli parantez içi/dışı ayırt etmez) buradaki "#22c55e" kısmını da
// gerçek bir hashtag ("22c55e") sanıp yakalıyordu — bu hem gereksiz bir etiket kirliliği
// yaratıyor hem de rengin okunmasını güvenilmez kılıyordu. Çözüm: renk değeri parantez
// içinde "#" OLMADAN saklanır ([renk:22c55e]) — hashtag deseniyle hiç eşleşmez. "#" yalnızca
// kullanım anında (CSS rengi olarak) eklenir.
const CLIENT_COLOR_REGEX = /\[renk:#?([0-9a-fA-F]{3,8})\]/;
const CLIENT_ICON_REGEX = /\[icon:([^\]]+)\]/;
const DEFAULT_CLIENT_COLOR = '#6366f1';
const DEFAULT_CLIENT_ICON = '👤';
const CLIENT_PALETTE = ['#6366f1', '#22c55e', '#f97316', '#3b82f6', '#a855f7', '#eab308', '#ef4444', '#ec4899', '#06b6d4', '#84cc16'];
const CLIENT_ICON_CHOICES = ['👤', '🏢', '🏭', '🏦', '🛒', '🎯', '💼', '⚙️', '🚀', '🎨', '📦', '🔧'];

// BUG DÜZELTMESİ (kullanıcı geri bildirimi: "rengi mavi yaptım hâlâ yeşil görünüyor"):
// Not içinde (önceki test/deneme kayıtlarından kalma) BİRDEN FAZLA [renk:]/[icon:] etiketi
// varsa, `.match()` (global olmayan) HER ZAMAN İLK eşleşmeyi döndürüyordu — kullanıcı yeni
// bir renk seçtiğinde bu YENİ etiket dosyanın SONUNA ekleniyordu ama okuma hep en eski (ilk)
// etiketi görüyordu, yani seçim hiçbir zaman "görünürde" etkili olmuyordu. Artık SON
// (en son yazılan) eşleşme alınır — hem bu geçmiş kirliliğe karşı dayanıklı olur hem de
// upsertClientTag artık yazarken TÜM eski kopyaları temizleyip TEK bir taze etiket bırakır.
const lastMatch = (content: string, regexSource: string): RegExpMatchArray | null => {
  const matches = Array.from(content.matchAll(new RegExp(regexSource, 'g')));
  return matches.length > 0 ? matches[matches.length - 1] : null;
};
const parseClientColor = (content: string): string => {
  const m = lastMatch(content, CLIENT_COLOR_REGEX.source);
  return m ? `#${m[1]}` : DEFAULT_CLIENT_COLOR;
};
const parseClientIcon = (content: string): string => {
  const m = lastMatch(content, CLIENT_ICON_REGEX.source);
  return m ? m[1].trim() : DEFAULT_CLIENT_ICON;
};
// Var olan TÜM [renk:]/[icon:] etiketi kopyalarını kaldırıp notun sonuna TEK, taze bir
// etiket ekler (yukarıdaki yorumdaki mükerrer-etiket sorununu kökten temizler).
const upsertClientTag = (content: string, tagRegex: RegExp, newTag: string): string => {
  const globalRegex = new RegExp(tagRegex.source, 'g');
  const stripped = content
    .replace(globalRegex, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
  return `${stripped}\n${newTag}`;
};

export default function ProjectsView({ timelineItems, notes, scannedContents, onChangeTaskStatus, onOpenNote, onSaveNote, clientsFolder = 'Müşteriler' }: ProjectsViewProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'kanban' | 'clients'>('dashboard');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [colorPickerOpenFor, setColorPickerOpenFor] = useState<string | null>(null);

  // 1. Identify all projects (Notes containing #proje)
  const projectNotes = notes.filter(note => {
    const content = scannedContents[note.path] || '';
    return content.toLowerCase().includes('#proje');
  });

  // 2. Identify all clients (Notes containing #müşteri)
  const clientNotes = notes.filter(note => {
    const content = scannedContents[note.path] || '';
    return content.toLowerCase().includes('#müşteri');
  });

  const projectNames = new Set(
    projectNotes.map(n => n.name.replace('.md', '').toLowerCase())
  );

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // BUG DÜZELTMESİ (kullanıcı geri bildirimi: "müşterinin altına direkt görev eklemek saçma,
  // müşterinin altında projeler var, o projelerin görevleri var"): Görev bir müşteriye değil
  // PROJEYE bağlanmalı — hiyerarşi Müşteri → Proje → Görev. Bir görev artık ya (a) doğrudan
  // proje notunun İÇİNDE bir satır olabilir (t.note === projectName, eski davranış) YA DA
  // (b) günlük nota yazılmış ama #proje-slug etiketiyle o projeye bağlanmış olabilir (bkz.
  // CalendarView.tsx'teki "Yeni Görev Ekle" modalındaki PROJE seçici). İkisi de aynı ilerleme
  // yüzdesine/Kanban listesine sayılır — TEK gerçek kopya (günlük nottaki satır), iki görünüm.
  const isProjectTask = (t: TimelineItem, cleanProjectName: string) => {
    const slug = cleanProjectName.toLocaleLowerCase('tr').replace(/\s+/g, '-');
    // BUG DÜZELTMESİ: `tags` (not-geneli birleştirilmiş) yerine `ownTags` (SADECE bu
    // görevin kendi satırı) kullanılır — aksi halde aynı günlük nottaki BAŞKA bir görevin
    // proje etiketi, alakasız görevleri de o projeye sayarmış gibi gösterirdi.
    return (t.note && t.note.toLowerCase() === cleanProjectName.toLowerCase()) || (t.ownTags || t.tags).includes(slug);
  };

  const getProjectProgress = (noteName: string) => {
    const cleanName = noteName.replace('.md', '');
    const projectTasks = timelineItems.filter(t => t.isTodo && isProjectTask(t, cleanName));
    if (projectTasks.length === 0) return { total: 0, done: 0, percent: 0, blocked: 0 };

    const doneTasks = projectTasks.filter(t => t.status === 'done' || (!t.status && t.isCompleted));
    const blockedTasks = projectTasks.filter(t => t.kanbanStatus === 'blocked');
    return {
      total: projectTasks.length,
      done: doneTasks.length,
      percent: Math.round((doneTasks.length / projectTasks.length) * 100),
      blocked: blockedTasks.length
    };
  };

  // İSTEK: proje kartında "Son Hareketler" — o projenin klasöründeki Changelog.md dosyasının
  // en tepesindeki birkaç "### " başlıklı girişi küçük bir özet olarak gösterir. Dosya yoksa
  // hiçbir şey render edilmez (eski/küçük projelerde Changelog.md henüz kurulmamış olabilir).
  const getProjectChangelogPreview = (projectPath: string): string[] => {
    const folderPath = projectPath.replace(/\.md$/i, '');
    const changelogPath = `${folderPath}/Changelog.md`;
    const changelogNote = notes.find(n => n.path.toLowerCase() === changelogPath.toLowerCase());
    if (!changelogNote) return [];
    const content = scannedContents[changelogNote.path] || '';
    const entries = content.split(/\n---\n/).map(block => {
      const headerMatch = block.match(/###\s*.*?([0-9]{1,2}\s+\S+\s+[0-9]{4}[^\n\[]*)/);
      return headerMatch ? headerMatch[1].trim() : null;
    }).filter((x): x is string => !!x);
    return entries.slice(0, 3);
  };

  const getClientProjects = (clientName: string, clientPath: string) => {
    const cleanClientName = clientName.replace('.md', '').toLowerCase();
    const clientContent = scannedContents[clientPath] || '';

    return projectNotes.filter(proj => {
      const projCleanName = proj.name.replace('.md', '').toLowerCase();
      
      // Check if project note references client (e.g. #borusan, #borusan-proje or "Borusan")
      const projContent = scannedContents[proj.path] || '';
      const projRefClient = projContent.toLowerCase().includes(`#${cleanClientName}`) ||
                            projContent.toLowerCase().includes(`#${cleanClientName.replace(/\s+/g, '-')}`) ||
                            projContent.toLowerCase().includes(cleanClientName);
                            
      // Check if client note references project (e.g. [[Borusan Tasarım]] or just "Borusan Tasarım")
      const clientRefProj = clientContent.toLowerCase().includes(`[[${projCleanName}]]`) ||
                            clientContent.toLowerCase().includes(projCleanName);

      return projRefClient || clientRefProj;
    });
  };

  const currentProjectTasks = selectedProject
    ? timelineItems.filter(t => t.isTodo && !t.isSubtask && isProjectTask(t, selectedProject))
    : timelineItems.filter(t => t.isTodo && !t.isSubtask && projectNotes.some(p => isProjectTask(t, p.name.replace('.md', ''))));

  // Renk/icon seçimi, müşteri notunun İÇİNE [renk:hex]/[icon:emoji] etiketi olarak yazılır
  // (bkz. App.tsx'teki projectColors haritası — CalendarView bu etiketleri görev kartlarında
  // proje→müşteri bağlantısı üzerinden kullanır). "#" burada BİLEREK atılır (bkz. yukarıdaki
  // CLIENT_COLOR_REGEX yorumu) — genel etiket tarayıcısının bunu hashtag sanmaması için.
  const handleSetClientColor = async (clientPath: string, currentContent: string, color: string) => {
    if (!onSaveNote) return;
    const updated = upsertClientTag(currentContent, CLIENT_COLOR_REGEX, `[renk:${color.replace(/^#/, '')}]`);
    await onSaveNote(clientPath, updated);
  };
  const handleSetClientIcon = async (clientPath: string, currentContent: string, icon: string) => {
    if (!onSaveNote) return;
    const updated = upsertClientTag(currentContent, CLIENT_ICON_REGEX, `[icon:${icon}]`);
    await onSaveNote(clientPath, updated);
  };

  // BUG DÜZELTMESİ: Electron'da window.prompt() DESTEKLENMİYOR — alert()/confirm()'ün aksine
  // Electron'un varsayılan BrowserWindow'unda hiçbir yerel karşılığı yok, çağrıldığında
  // sessizce hiçbir şey yapmıyor ("tıklayınca bir şey olmadı"). Native prompt() yerine
  // uygulama içi küçük bir modal (aşağıda, createModal state'i) kullanıyoruz.
  const [createModal, setCreateModal] = useState<
    { type: 'client' } | { type: 'project'; clientName: string } | null
  >(null);
  const [createModalInput, setCreateModalInput] = useState('');

  // ============ İŞ PLANLA (esnek, tekrar-hesaplanabilir Gantt planlayıcı) ============
  // İSTEK (kullanıcı): "bir işin subtask'ları var, X iş günü içinde bitmesi lazım, işe
  // %Y dedike çalışacağım — takvime otomatik dağıtılsın, önizleme göster, Uygula deyince
  // yazsın, sonra istediğim an tarih/oranı değiştirip yeniden Uygula diyebileyim."
  interface PlannerSubtask { id: string; name: string; hours: number; }
  const [plannerProject, setPlannerProject] = useState<{ path: string; name: string } | null>(null);
  const [plannerTaskName, setPlannerTaskName] = useState('');
  const [plannerSubtasks, setPlannerSubtasks] = useState<PlannerSubtask[]>([]);
  const [plannerNewSubtaskName, setPlannerNewSubtaskName] = useState('');
  const [plannerNewSubtaskHours, setPlannerNewSubtaskHours] = useState('4');
  // İSTEK (kullanıcı geri bildirimi: "neden son tarihi ben seçiyorum, otomatik belirlemesi
  // lazım, bana kaç gün diye sormalı"): kullanıcı bir TARİH değil, "kaç iş günü içinde"
  // sorusuna cevap verir — bitiş tarihi bundan HESAPLANIR ve kendisine gösterilir.
  const [plannerDeadlineDays, setPlannerDeadlineDays] = useState('10');
  const [plannerDedication, setPlannerDedication] = useState(80);
  // İSTEK (kullanıcı geri bildirimi: "bana sorularak belirlensin, birden fazla seçenek
  // olsun"): dedike oranının nasıl uygulanacağı HER SEFERİNDE bu seçiciyle sorulur —
  // sabit bir mantığa kilitlenmiyoruz.
  const [plannerMode, setPlannerMode] = useState<'skip-days' | 'shorten-hours'>('skip-days');

  const DAY_START_HOUR = 9;
  const DAY_END_HOUR = 18;
  const FULL_DAY_HOURS = DAY_END_HOUR - DAY_START_HOUR;

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const formatDateStr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

  // "Kaç iş günü içinde?" sorusundan bitiş tarihini hesaplar (bugünden itibaren, sadece
  // hafta içi günleri sayarak).
  const addBusinessDays = (days: number): Date => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) added++;
    }
    return d;
  };

  const plannerDeadlineDaysNum = Math.max(1, parseInt(plannerDeadlineDays, 10) || 1);
  const plannerDeadline = useMemo(
    () => formatDateStr(addBusinessDays(plannerDeadlineDaysNum)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plannerDeadlineDaysNum, plannerProject?.path]
  );

  // Bugünden (dahil) verilen bitiş tarihine (dahil) kadar SADECE hafta içi (Pzt-Cum) günler.
  const getWeekdaysUntil = (deadlineStr: string): Date[] => {
    if (!deadlineStr) return [];
    const days: Date[] = [];
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(`${deadlineStr}T00:00:00`);
    if (isNaN(end.getTime()) || end < cursor) return [];
    while (cursor <= end) {
      const dow = cursor.getDay(); // 0=Paz, 6=Cmt
      if (dow !== 0 && dow !== 6) days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  };

  interface PlannerPlacement { subtaskId: string; label: string; dateStr: string; startTime: string; endTime: string; }
  interface PlannerSchedule {
    placements: PlannerPlacement[];
    usedDays: string[];
    totalRequiredHours: number;
    totalAvailableHours: number;
    fits: boolean;
    shortfallHours: number;
  }

  // Çekirdek dağıtım algoritması — hem önizleme hem "Uygula" AYNI fonksiyonu kullanır ki
  // ikisi arasında hiçbir tutarsızlık olmasın (gördüğün önizleme birebir yazılan şeydir).
  const computePlannerSchedule = (): PlannerSchedule => {
    const weekdays = getWeekdaysUntil(plannerDeadline);
    const totalRequiredHours = plannerSubtasks.reduce((sum, s) => sum + (s.hours || 0), 0);

    let usedDays: Date[];
    let dailyCapacity: number;
    if (plannerMode === 'skip-days') {
      // %80 → ~5 günden 4'ü kullanılır (1 gün tamamen boş) — kullanılan günler eşit
      // aralıklarla seçilir (hep en sona/en başa yığılmasın diye).
      const useCount = Math.max(0, Math.round(weekdays.length * (plannerDedication / 100)));
      usedDays = [];
      if (useCount > 0 && weekdays.length > 0) {
        for (let i = 0; i < useCount; i++) {
          const idx = Math.min(weekdays.length - 1, Math.floor((i * weekdays.length) / useCount));
          usedDays.push(weekdays[idx]);
        }
        usedDays = Array.from(new Set(usedDays.map(d => d.getTime()))).map(t => new Date(t)).sort((a, b) => a.getTime() - b.getTime());
      }
      dailyCapacity = FULL_DAY_HOURS;
    } else {
      usedDays = weekdays;
      dailyCapacity = FULL_DAY_HOURS * (plannerDedication / 100);
    }

    const totalAvailableHours = usedDays.length * dailyCapacity;

    const pad = (n: number) => String(n).padStart(2, '0');
    const hourToTime = (h: number) => {
      const hh = Math.floor(h);
      const mm = Math.round((h - hh) * 60 / 15) * 15;
      return mm === 60 ? `${pad(hh + 1)}:00` : `${pad(hh)}:${pad(mm)}`;
    };

    // İSTEK (kullanıcı geri bildirimi: "neden 9-17 ve 17-18 gibi ikiye ayırmış anlamadım"):
    // ÖNCEDEN bir görevin gün içindeki kalan (küçük) boşluğuna bir SONRAKİ görev sığdırılmaya
    // çalışılıyordu — bu da her görevi 1sa/7sa gibi anlamsız parçalara bölüp bir sonraki güne
    // taşırıyordu. Artık her alt görev KENDİ gününde, günün BAŞINDAN (09:00) başlar; bir
    // görev günün tamamını doldurmasa bile kalan boşluk bir SONRAKİ görev tarafından
    // kullanılmaz — sıradaki görev her zaman yeni bir günde başlar. Daha basit, okunması
    // kolay bir plan; karşılığında bazı günlerde kapasite tam kullanılmayabilir.
    const placements: PlannerPlacement[] = [];
    let dayIdx = 0;

    for (const sub of plannerSubtasks) {
      let remainingHours = sub.hours || 0;
      let part = 1;
      const totalParts = Math.max(1, Math.ceil(remainingHours / dailyCapacity) || 1);
      while (remainingHours > 0 && dayIdx < usedDays.length) {
        const chunk = Math.min(remainingHours, dailyCapacity);
        const endH = DAY_START_HOUR + chunk;
        placements.push({
          subtaskId: sub.id,
          label: totalParts > 1 ? `${sub.name} (${part}/${totalParts})` : sub.name,
          dateStr: format(usedDays[dayIdx]),
          startTime: hourToTime(DAY_START_HOUR),
          endTime: hourToTime(endH)
        });
        remainingHours -= chunk;
        part++;
        dayIdx++;
      }
    }

    const fits = placements.length > 0 && plannerSubtasks.every(s => placements.some(p => p.subtaskId === s.id)) && totalRequiredHours <= totalAvailableHours;

    return {
      placements,
      usedDays: usedDays.map(d => format(d)),
      totalRequiredHours,
      totalAvailableHours,
      fits,
      shortfallHours: Math.max(0, totalRequiredHours - totalAvailableHours)
    };

    function format(d: Date): string {
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
  };

  const plannerSchedule = useMemo(
    () => (plannerProject ? computePlannerSchedule() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plannerProject, plannerSubtasks, plannerDeadline, plannerDedication, plannerMode]
  );

  // "Uygula" — proje notunun İÇİNE (ayrı bir dosyaya değil) tek bir ebeveyn görev + altına
  // girintili alt görevler olarak yazar. Zaten AÇIK bir plan varsa (aynı iş adıyla daha önce
  // yazılmışsa) o bloğu SİLİP yeniden yazar — "tarihi/oranı değiştir, tekrar Uygula'ya bas"
  // akışını (yeniden hesapla + yeniden yaz) destekler.
  const handleApplyPlanner = async () => {
    if (!plannerProject || !plannerSchedule || !onSaveNote) return;
    const projectSlug = plannerProject.name.toLocaleLowerCase('tr').replace(/\s+/g, '-');
    const content = scannedContents[plannerProject.path] || '';
    const lines = content.split('\n');

    // Aynı isimli eski plan bloğunu (ebeveyn satır + hemen altındaki girintili satırlar) temizle.
    const parentRegex = new RegExp(`^\\s*[*\\-]\\s+\\[[ xX/]\\]\\s+${plannerTaskName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*\\[`, 'i');
    let cleaned: string[] = [];
    let skipping = false;
    for (const line of lines) {
      if (parentRegex.test(line)) { skipping = true; continue; }
      if (skipping) {
        if (/^\s{2,}[*\-]\s+\[/.test(line)) continue; // girintili eski alt görev
        skipping = false;
      }
      cleaned.push(line);
    }

    const newLines: string[] = [
      '',
      `- [ ] ${plannerTaskName} [project:${projectSlug}] [due:${plannerDeadline}]`
    ];
    plannerSchedule.placements.forEach(p => {
      newLines.push(`  - [ ] ${p.label} [due:${p.dateStr}] [plannedtime:${p.startTime}-${p.endTime}] [project:${projectSlug}]`);
    });

    await onSaveNote(plannerProject.path, [...cleaned, ...newLines].join('\n'));
    setPlannerProject(null);
  };

  // İSTEK: "Yeni Müşteri" — klasör iskeleti: {clientsFolder}/{MüşteriAdı}/{MüşteriAdı}.md,
  // içine #müşteri etiketi yazılır. Alt "Projeler" klasörü, ilk proje eklendiğinde kendiliğinden
  // oluşur (writeNote ara klasörleri otomatik oluşturuyor — bkz. electron/main.cjs mkdirSync
  // recursive) — baştan boş bir klasör yaratmaya gerek yok.
  const handleCreateClient = async (name: string) => {
    if (!onSaveNote) return;
    const cleanName = name.trim();
    if (!cleanName) return;
    const path = `${clientsFolder}/${cleanName}/${cleanName}.md`;
    if (notes.some(n => n.path.toLowerCase() === path.toLowerCase())) {
      alert(`"${cleanName}" adında bir müşteri zaten var.`);
      return;
    }
    await onSaveNote(path, `# ${cleanName}\n\n#müşteri\n`);
  };

  // İSTEK: "Yeni Proje" (bir müşteri kartından) — {clientsFolder}/{MüşteriAdı}/Projeler/{ProjeAdı}.md,
  // içine hem #proje HEM müşterinin slug'ı (#{musteri-adi}) etiketi yazılır — mevcut proje→müşteri
  // bağlama kuralıyla (CLIENT_COLOR_REGEX'in üstündeki getClientProjects mantığı) AYNI kural.
  const handleCreateProject = async (clientName: string, name: string) => {
    if (!onSaveNote) return;
    const cleanName = name.trim();
    if (!cleanName) return;
    const clientSlug = clientName.toLocaleLowerCase('tr').replace(/\s+/g, '-');
    const path = `${clientsFolder}/${clientName}/Projeler/${cleanName}.md`;
    if (notes.some(n => n.path.toLowerCase() === path.toLowerCase())) {
      alert(`"${cleanName}" adında bir proje zaten var.`);
      return;
    }
    await onSaveNote(path, `# ${cleanName}\n\n#proje #${clientSlug}\n`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="projects-header" style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '20px' }}>
            <Briefcase size={24} color="var(--accent-color)" />
            Proje Yönetimi
          </h2>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '13px' }}>
            #proje veya #müşteri etiketi içeren notlar otomatik olarak burada listelenir.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('dashboard')}
            style={{
              padding: '8px 16px', borderRadius: '6px', cursor: 'pointer',
              background: activeTab === 'dashboard' ? 'var(--accent-color)' : 'var(--bg-secondary)',
              color: activeTab === 'dashboard' ? '#fff' : 'var(--text-primary)',
              border: 'none', display: 'flex', alignItems: 'center', gap: '6px'
            }}
          >
            <LayoutDashboard size={16} /> Dashboard
          </button>
          <button
            onClick={() => setActiveTab('kanban')}
            style={{
              padding: '8px 16px', borderRadius: '6px', cursor: 'pointer',
              background: activeTab === 'kanban' ? 'var(--accent-color)' : 'var(--bg-secondary)',
              color: activeTab === 'kanban' ? '#fff' : 'var(--text-primary)',
              border: 'none', display: 'flex', alignItems: 'center', gap: '6px'
            }}
          >
            <Target size={16} /> Kanban
          </button>
          <button
            onClick={() => setActiveTab('clients')}
            style={{
              padding: '8px 16px', borderRadius: '6px', cursor: 'pointer',
              background: activeTab === 'clients' ? 'var(--accent-color)' : 'var(--bg-secondary)',
              color: activeTab === 'clients' ? '#fff' : 'var(--text-primary)',
              border: 'none', display: 'flex', alignItems: 'center', gap: '6px'
            }}
          >
            <Users size={16} /> Müşteriler
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="projects-content" style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        
        {/* Sidebar for Projects */}
        {activeTab !== 'clients' && (
          <div className="projects-sidebar" style={{ width: '250px', borderRight: '1px solid var(--border-color)', overflowY: 'auto', padding: '16px', background: 'var(--bg-secondary)' }}>
            <h3 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '12px' }}>PROJELER ({projectNotes.length})</h3>
            
            <div 
              onClick={() => setSelectedProject(null)}
              style={{
                padding: '10px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                marginBottom: '8px',
                background: selectedProject === null ? 'var(--bg-hover)' : 'transparent',
                color: selectedProject === null ? 'var(--text-primary)' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Folder size={16} /> Tüm Görevler
            </div>

            {projectNotes.map(note => {
              const cleanName = note.name.replace('.md', '');
              const { percent } = getProjectProgress(note.name);
              return (
                <div
                  key={note.path}
                  onClick={() => setSelectedProject(cleanName)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    marginBottom: '8px',
                    background: selectedProject === cleanName ? 'var(--bg-hover)' : 'transparent',
                    color: selectedProject === cleanName ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Briefcase size={16} /> 
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '13px' }}>
                      {cleanName}
                    </span>
                  </div>
                  
                  {/* Progress bar mini */}
                  <div style={{ height: '4px', background: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: percent === 100 ? '#4caf50' : 'var(--accent-color)', width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Main View Area */}
        <div className="projects-main-view" style={{ flex: 1, overflow: 'hidden' }}>
          {activeTab === 'dashboard' && (
            <div style={{ padding: '24px', overflowY: 'auto', height: '100%' }}>
              <h2>{selectedProject ? selectedProject : 'Genel Bakış'}</h2>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px', marginTop: '24px' }}>
                {(selectedProject ? projectNotes.filter(n => n.name.replace('.md', '').toLowerCase() === selectedProject.toLowerCase()) : projectNotes).map(note => {
                  const stats = getProjectProgress(note.name);
                  const changelogPreview = getProjectChangelogPreview(note.path);
                  return (
                    <div key={note.path} style={{ background: 'var(--bg-secondary)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Briefcase size={18} />
                          {note.name.replace('.md', '')}
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {stats.blocked > 0 && (
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.12)', padding: '3px 8px', borderRadius: '10px' }}>
                              🔴 Bloklu: {stats.blocked}
                            </span>
                          )}
                          {onSaveNote && (
                            <button
                              type="button"
                              onClick={() => {
                                setPlannerProject({ path: note.path, name: note.name.replace('.md', '') });
                                setPlannerTaskName('');
                                setPlannerSubtasks([]);
                                setPlannerNewSubtaskName('');
                                setPlannerNewSubtaskHours('4');
                                setPlannerDeadlineDays('10');
                                setPlannerDedication(80);
                                setPlannerMode('skip-days');
                              }}
                              title="İş Planla — Gantt tarzı otomatik takvim dağıtımı"
                              style={{
                                display: 'flex', alignItems: 'center', gap: '4px',
                                background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                                borderRadius: '6px', color: 'var(--accent-color)', cursor: 'pointer',
                                fontSize: '11px', fontWeight: 700, padding: '3px 8px'
                              }}
                            >
                              <Gauge size={12} /> İş Planla
                            </button>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                        <span>İlerleme</span>
                        <span>{stats.percent}% ({stats.done}/{stats.total})</span>
                      </div>

                      <div style={{ height: '8px', background: 'var(--bg-hover)', borderRadius: '4px', overflow: 'hidden', marginBottom: changelogPreview.length > 0 ? '16px' : '0' }}>
                        <div style={{ height: '100%', background: stats.percent === 100 ? '#4caf50' : 'var(--accent-color)', width: `${stats.percent}%`, transition: 'width 0.3s ease' }} />
                      </div>

                      {changelogPreview.length > 0 && (
                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: '6px' }}>Son Hareketler</div>
                          <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {changelogPreview.map((entry, i) => <li key={i}>{entry}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'kanban' && (
            <KanbanBoard 
              tasks={currentProjectTasks} 
              onChangeTaskStatus={onChangeTaskStatus}
              onOpenNote={onOpenNote}
            />
          )}

          {activeTab === 'clients' && (
            <div style={{ padding: '24px', overflowY: 'auto', height: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>Müşteri Listesi</h2>
                {onSaveNote && (
                  <button
                    type="button"
                    onClick={() => { setCreateModalInput(''); setCreateModal({ type: 'client' }); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      background: 'var(--accent-color)', color: '#fff', border: 'none',
                      borderRadius: '8px', padding: '8px 14px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    <Plus size={14} /> Yeni Müşteri
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px', marginTop: '24px' }}>
                {clientNotes.map(client => {
                  const cleanClientName = client.name.replace('.md', '');
                  const linkedProjects = getClientProjects(client.name, client.path);
                  const clientContent = scannedContents[client.path] || '';
                  const clientColor = parseClientColor(clientContent);
                  const clientIcon = parseClientIcon(clientContent);
                  const isPickerOpen = colorPickerOpenFor === client.path;

                  return (
                    <div
                      key={client.path}
                      style={{
                        background: 'var(--bg-secondary)',
                        padding: '20px',
                        borderRadius: '12px',
                        border: '1px solid var(--border-color)',
                        borderLeft: `4px solid ${clientColor}`
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => setColorPickerOpenFor(isPickerOpen ? null : client.path)}
                            title="Renk ve icon seç"
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              width: '26px', height: '26px', borderRadius: '50%',
                              background: clientColor, border: 'none', cursor: onSaveNote ? 'pointer' : 'default',
                              fontSize: '13px'
                            }}
                          >
                            {clientIcon}
                          </button>
                          {cleanClientName}
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-hover)', padding: '2px 8px', borderRadius: '12px' }}>
                            {linkedProjects.length} Proje
                          </span>
                          {onSaveNote && (
                            <button
                              type="button"
                              onClick={() => { setCreateModalInput(''); setCreateModal({ type: 'project', clientName: cleanClientName }); }}
                              title="Bu müşteriye yeni proje ekle"
                              style={{
                                display: 'flex', alignItems: 'center', gap: '4px',
                                background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                                borderRadius: '6px', color: 'var(--accent-color)', cursor: 'pointer',
                                fontSize: '11px', fontWeight: 700, padding: '3px 8px'
                              }}
                            >
                              <Plus size={11} /> Proje
                            </button>
                          )}
                        </div>
                      </div>

                      {isPickerOpen && onSaveNote && (
                        <div style={{ marginBottom: '14px', padding: '10px', background: 'var(--bg-tertiary)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                            {CLIENT_PALETTE.map(c => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => handleSetClientColor(client.path, clientContent, c)}
                                style={{
                                  width: '20px', height: '20px', borderRadius: '50%', background: c,
                                  border: clientColor === c ? '2px solid var(--text-primary)' : '2px solid transparent', cursor: 'pointer'
                                }}
                              />
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                            {CLIENT_ICON_CHOICES.map(ic => (
                              <button
                                key={ic}
                                type="button"
                                onClick={() => handleSetClientIcon(client.path, clientContent, ic)}
                                style={{
                                  width: '24px', height: '24px', borderRadius: '4px', fontSize: '13px',
                                  background: clientIcon === ic ? 'var(--bg-hover)' : 'transparent',
                                  border: '1px solid var(--border-color)', cursor: 'pointer'
                                }}
                              >
                                {ic}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {linkedProjects.length > 0 ? (
                          linkedProjects.map(proj => {
                            const stats = getProjectProgress(proj.name);
                            return (
                              <div key={proj.path} style={{ fontSize: '13px', background: 'var(--bg-hover)', padding: '10px', borderRadius: '6px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                  <span style={{ fontWeight: 500 }}>{proj.name.replace('.md', '')}</span>
                                  <span style={{ color: 'var(--text-muted)' }}>{stats.percent}%</span>
                                </div>
                                <div style={{ height: '4px', background: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden' }}>
                                  <div style={{ height: '100%', background: stats.percent === 100 ? '#4caf50' : 'var(--accent-color)', width: `${stats.percent}%` }} />
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            Bağlı proje bulunamadı. Projenin içine #{cleanClientName.toLowerCase()} yazarak bağlayabilirsin.
                          </div>
                        )}
                      </div>

                      {(() => {
                        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
                        // Müşteri kartında görevleri DOĞRUDAN göstermiyoruz artık (kullanıcı geri bildirimi:
                        // hiyerarşi Müşteri → Proje → Görev olmalı, müşteriye direkt görev bağlamak anlamsız).
                        // Bunun yerine, bağlı projelerin ilerlemesini (getProjectProgress zaten hem proje
                        // notu İÇİNDEKİ hem #proje-slug etiketli günlük-not görevlerini sayıyor) toplayıp
                        // müşteri düzeyinde tek bir özet gösteriyoruz.
                        const totals = linkedProjects.reduce((acc, proj) => {
                          const s = getProjectProgress(proj.name);
                          return { total: acc.total + s.total, done: acc.done + s.done };
                        }, { total: 0, done: 0 });
                        if (totals.total === 0) return null;
                        const pct = Math.round((totals.done / totals.total) * 100);
                        return (
                          <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                              <span style={{ color: 'var(--text-secondary)' }}>Toplam Görev İlerlemesi</span>
                              <span style={{ fontWeight: 600 }}>{pct}% ({totals.done}/{totals.total})</span>
                            </div>
                            <div style={{ height: '5px', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
                              <div style={{ height: '100%', background: pct === 100 ? '#4caf50' : 'var(--accent-color)', width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
                {clientNotes.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', gridColumn: '1/-1' }}>
                    Henüz müşteri notu oluşturulmadı. Bir not açıp içine #müşteri yazarak müşteri profili oluşturabilirsin.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {plannerProject && plannerSchedule && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', zIndex: 2100,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
          }}
          onClick={() => setPlannerProject(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '640px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto',
              background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
              borderRadius: '12px', padding: '22px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', color: 'var(--text-primary)'
            }}
          >
            <h3 style={{ margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Gauge size={18} /> İş Planla — {plannerProject.name}
            </h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: 'var(--text-muted)' }}>
              Bir iş için alt görevleri, son tarihi ve dedike oranını gir — önizlemede nasıl dağıldığını gör, beğenince Uygula'ya bas.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>İŞ ADI</label>
              <input
                type="text"
                value={plannerTaskName}
                onChange={(e) => setPlannerTaskName(e.target.value)}
                placeholder="Örn: Esnek Teklif"
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', padding: '8px 12px', fontSize: '13px', outline: 'none' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>ALT GÖREVLER (tahmini saat ile)</label>
              {plannerSubtasks.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '4px' }}>
                  {plannerSubtasks.map((s, i) => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-tertiary)', borderRadius: '6px', padding: '6px 10px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', width: '16px' }}>{i + 1}.</span>
                      <span style={{ flex: 1, fontSize: '13px' }}>{s.name}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{s.hours}sa</span>
                      <button type="button" onClick={() => setPlannerSubtasks(prev => prev.filter(x => x.id !== s.id))}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={plannerNewSubtaskName}
                  onChange={(e) => setPlannerNewSubtaskName(e.target.value)}
                  placeholder="Alt görev adı..."
                  style={{ flex: 1, background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', padding: '8px 12px', fontSize: '13px', outline: 'none' }}
                />
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={plannerNewSubtaskHours}
                  onChange={(e) => setPlannerNewSubtaskHours(e.target.value)}
                  style={{ width: '70px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', padding: '8px 10px', fontSize: '13px', outline: 'none' }}
                />
                <button
                  type="button"
                  disabled={!plannerNewSubtaskName.trim()}
                  onClick={() => {
                    const hours = parseFloat(plannerNewSubtaskHours) || 1;
                    setPlannerSubtasks(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, name: plannerNewSubtaskName.trim(), hours }]);
                    setPlannerNewSubtaskName('');
                    setPlannerNewSubtaskHours('4');
                  }}
                  style={{ background: 'var(--accent-color)', border: 'none', borderRadius: '8px', color: '#fff', padding: '8px 12px', fontSize: '12.5px', fontWeight: 700, cursor: plannerNewSubtaskName.trim() ? 'pointer' : 'not-allowed', opacity: plannerNewSubtaskName.trim() ? 1 : 0.5 }}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '14px', marginBottom: '14px' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>KAÇ İŞ GÜNÜ İÇİNDE?</label>
                <input
                  type="number"
                  min="1"
                  value={plannerDeadlineDays}
                  onChange={(e) => setPlannerDeadlineDays(e.target.value)}
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', padding: '8px 12px', fontSize: '13px', outline: 'none' }}
                />
                <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  Son tarih: <strong style={{ color: 'var(--text-secondary)' }}>{new Date(`${plannerDeadline}T00:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
                </span>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>DEDİKE % ({plannerDedication})</label>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={plannerDedication}
                  onChange={(e) => setPlannerDedication(parseInt(e.target.value, 10))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '18px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>DEDİKE %, TAKVİMDE NASIL UYGULANSIN?</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" onClick={() => setPlannerMode('skip-days')}
                  style={{
                    flex: 1, padding: '10px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer',
                    background: plannerMode === 'skip-days' ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                    color: plannerMode === 'skip-days' ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border-color)'
                  }}>
                  📅 Haftada gün atla<br /><span style={{ fontSize: '10.5px', fontWeight: 400, opacity: 0.85 }}>Kullanılan günler tam 09-18</span>
                </button>
                <button type="button" onClick={() => setPlannerMode('shorten-hours')}
                  style={{
                    flex: 1, padding: '10px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer',
                    background: plannerMode === 'shorten-hours' ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                    color: plannerMode === 'shorten-hours' ? '#fff' : 'var(--text-secondary)', border: '1px solid var(--border-color)'
                  }}>
                  ⏱️ Her gün saati kısalt<br /><span style={{ fontSize: '10.5px', fontWeight: 400, opacity: 0.85 }}>Hiçbir gün tamamen boş kalmaz</span>
                </button>
              </div>
            </div>

            {/* Önizleme (Gantt-tarzı gün ızgarası) */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '14px', marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>Önizleme</div>
              {!plannerDeadline ? (
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', fontStyle: 'italic' }}>Bir son tarih seç.</div>
              ) : plannerSubtasks.length === 0 ? (
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', fontStyle: 'italic' }}>Henüz alt görev eklenmedi.</div>
              ) : plannerSchedule.usedDays.length === 0 ? (
                <div style={{ fontSize: '12.5px', color: '#ef4444' }}>Bu tarih aralığında kullanılabilir hafta içi gün yok.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: `140px repeat(${plannerSchedule.usedDays.length}, 34px)`, gap: '2px', minWidth: 'max-content' }}>
                    <div />
                    {plannerSchedule.usedDays.map(d => (
                      <div key={d} style={{ fontSize: '9.5px', color: 'var(--text-muted)', textAlign: 'center', writingMode: 'vertical-rl', height: '36px' }}>
                        {d.slice(5)}
                      </div>
                    ))}
                    {plannerSubtasks.map(sub => (
                      <React.Fragment key={sub.id}>
                        <div style={{ fontSize: '11.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>{sub.name}</div>
                        {plannerSchedule.usedDays.map(d => {
                          const p = plannerSchedule.placements.find(pl => pl.subtaskId === sub.id && pl.dateStr === d);
                          return (
                            <div key={d} title={p ? `${p.startTime}-${p.endTime}` : ''} style={{
                              height: '22px', borderRadius: '4px',
                              background: p ? 'var(--accent-color)' : 'var(--bg-tertiary)'
                            }} />
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
              {plannerSubtasks.length > 0 && plannerDeadline && (
                <div style={{ marginTop: '10px', fontSize: '12px', color: plannerSchedule.fits ? 'var(--text-secondary)' : '#ef4444' }}>
                  Gerekli: {plannerSchedule.totalRequiredHours}sa · Kullanılabilir: {Math.round(plannerSchedule.totalAvailableHours * 10) / 10}sa
                  {!plannerSchedule.fits && ` — bu tempoyla ${Math.round(plannerSchedule.shortfallHours * 10) / 10} saat sığmıyor, son tarihi ilerlet veya dedike %'ni artır.`}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" onClick={() => setPlannerProject(null)}
                style={{ flex: 1, background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-secondary)', padding: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                Vazgeç
              </button>
              <button
                type="button"
                disabled={!plannerTaskName.trim() || !plannerDeadline || plannerSubtasks.length === 0}
                onClick={handleApplyPlanner}
                style={{
                  flex: 1, background: 'var(--accent-color)', border: 'none', borderRadius: '8px', color: '#fff',
                  padding: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                  opacity: (!plannerTaskName.trim() || !plannerDeadline || plannerSubtasks.length === 0) ? 0.5 : 1
                }}
              >
                Uygula — Takvime Yaz
              </button>
            </div>
          </div>
        </div>
      )}

      {createModal && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', zIndex: 2000,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
          onClick={() => setCreateModal(null)}
        >
          <div
            style={{
              width: '340px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
              borderRadius: '12px', padding: '20px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', color: '#fff'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 14px 0', fontSize: '15px', fontWeight: 700 }}>
              {createModal.type === 'client' ? 'Yeni Müşteri' : `"${createModal.clientName}" için Yeni Proje`}
            </h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!createModalInput.trim()) return;
                if (createModal.type === 'client') {
                  await handleCreateClient(createModalInput);
                } else {
                  await handleCreateProject(createModal.clientName, createModalInput);
                }
                setCreateModal(null);
                setCreateModalInput('');
              }}
            >
              <input
                type="text"
                autoFocus
                value={createModalInput}
                onChange={(e) => setCreateModalInput(e.target.value)}
                placeholder={createModal.type === 'client' ? 'Müşteri adı...' : 'Proje adı...'}
                style={{
                  width: '100%', padding: '8px 12px', fontSize: '13px', marginBottom: '16px',
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px',
                  color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box'
                }}
              />
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setCreateModal(null)}
                  style={{
                    flex: 1, background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '8px',
                    color: 'var(--text-secondary)', padding: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={!createModalInput.trim()}
                  style={{
                    flex: 1, background: 'var(--accent-color)', border: 'none', borderRadius: '8px',
                    color: '#fff', padding: '10px', fontSize: '13px', fontWeight: 600,
                    cursor: createModalInput.trim() ? 'pointer' : 'not-allowed', opacity: createModalInput.trim() ? 1 : 0.5
                  }}
                >
                  Oluştur
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
