import React, { useState } from 'react';
import type { TimelineItem } from '../App';
import KanbanBoard from './KanbanBoard';
import { Briefcase, Folder, BarChart, LayoutDashboard, Target, Users, User } from 'lucide-react';

interface NoteItem {
  name: string;
  path: string;
  updatedAt: number;
}

interface ProjectsViewProps {
  timelineItems: TimelineItem[];
  notes: NoteItem[];
  scannedContents: Record<string, string>;
  onChangeTaskStatus: (id: string, newStatus: 'todo' | 'in-progress' | 'done') => void;
  onOpenNote?: (item: TimelineItem) => void;
  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Müşteriye renk/icon atarken müşteri notunun içeriğine [renk:]/[icon:] etiketi yazmak
  // için gerekli — Finans kategorileri gibi ayrı bir tablo yerine, müşteri zaten bir NOT
  // olduğundan (bkz. #müşteri etiketi) veriyi doğrudan o notun içinde tutmak, mevcut
  // not-senkron mekanizmasını (satır-bazlı, kanıtlanmış) bedavaya kullanır.
  onSaveNote?: (path: string, content: string) => Promise<void>;
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

export default function ProjectsView({ timelineItems, notes, scannedContents, onChangeTaskStatus, onOpenNote, onSaveNote }: ProjectsViewProps) {
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
    const slug = cleanProjectName.toLowerCase().replace(/\s+/g, '-');
    // BUG DÜZELTMESİ: `tags` (not-geneli birleştirilmiş) yerine `ownTags` (SADECE bu
    // görevin kendi satırı) kullanılır — aksi halde aynı günlük nottaki BAŞKA bir görevin
    // proje etiketi, alakasız görevleri de o projeye sayarmış gibi gösterirdi.
    return (t.note && t.note.toLowerCase() === cleanProjectName.toLowerCase()) || (t.ownTags || t.tags).includes(slug);
  };

  const getProjectProgress = (noteName: string) => {
    const cleanName = noteName.replace('.md', '');
    const projectTasks = timelineItems.filter(t => t.isTodo && isProjectTask(t, cleanName));
    if (projectTasks.length === 0) return { total: 0, done: 0, percent: 0 };

    const doneTasks = projectTasks.filter(t => t.status === 'done' || (!t.status && t.isCompleted));
    return {
      total: projectTasks.length,
      done: doneTasks.length,
      percent: Math.round((doneTasks.length / projectTasks.length) * 100)
    };
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
                  return (
                    <div key={note.path} style={{ background: 'var(--bg-secondary)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                      <h3 style={{ margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Briefcase size={18} />
                        {note.name.replace('.md', '')}
                      </h3>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                        <span>İlerleme</span>
                        <span>{stats.percent}% ({stats.done}/{stats.total})</span>
                      </div>
                      
                      <div style={{ height: '8px', background: 'var(--bg-hover)', borderRadius: '4px', overflow: 'hidden', marginBottom: '16px' }}>
                        <div style={{ height: '100%', background: stats.percent === 100 ? '#4caf50' : 'var(--accent-color)', width: `${stats.percent}%`, transition: 'width 0.3s ease' }} />
                      </div>
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
              <h2>Müşteri Listesi</h2>
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
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-hover)', padding: '2px 8px', borderRadius: '12px' }}>
                          {linkedProjects.length} Proje
                        </span>
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
    </div>
  );
}
