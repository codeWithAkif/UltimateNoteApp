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
}

export default function ProjectsView({ timelineItems, notes, scannedContents, onChangeTaskStatus, onOpenNote }: ProjectsViewProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'kanban' | 'clients'>('dashboard');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

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

  const getProjectProgress = (noteName: string) => {
    const cleanName = noteName.replace('.md', '');
    const projectTasks = timelineItems.filter(t => t.note && t.note.toLowerCase() === cleanName.toLowerCase() && t.isTodo);
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
    ? timelineItems.filter(t => t.note && t.note.toLowerCase() === selectedProject.toLowerCase() && t.isTodo && !t.isSubtask) 
    : timelineItems.filter(t => t.note && projectNames.has(t.note.toLowerCase()) && t.isTodo && !t.isSubtask);

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
                  
                  return (
                    <div 
                      key={client.path} 
                      style={{ 
                        background: 'var(--bg-secondary)', 
                        padding: '20px', 
                        borderRadius: '12px', 
                        border: '1px solid var(--border-color)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <User size={18} color="var(--accent-color)" />
                          {cleanClientName}
                        </h3>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-hover)', padding: '2px 8px', borderRadius: '12px' }}>
                          {linkedProjects.length} Proje
                        </span>
                      </div>

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
