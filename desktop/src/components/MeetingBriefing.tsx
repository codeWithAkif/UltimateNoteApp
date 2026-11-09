import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Save, RefreshCw, Brain, Calendar as CalIcon } from 'lucide-react';
import { isGeminiConfigured } from '../services/geminiMentor';
import {
  gatherBriefingContext, generateBriefing, briefingToMarkdown,
  type Briefing, type BriefNote, type BriefTask
} from '../services/meetingBriefing';
import ErrandPlannerPanel from './ErrandPlanner';
import TaskExtractorPanel from './TaskExtractor';
import MeetingTranscriptPanel from './MeetingTranscript';
import type { ErrandTaskInput } from '../services/errandPlanner';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2200,
  background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px'
};
const panelStyle: React.CSSProperties = {
  width: 'min(560px, 100%)', maxHeight: '88vh', overflowY: 'auto', boxSizing: 'border-box',
  background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px',
  padding: '18px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', color: 'var(--text-primary)'
};
const smallBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap',
  background: 'var(--bg-hover)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)',
  borderRadius: '8px', padding: '7px 11px', fontSize: '12px', fontWeight: 600, cursor: 'pointer'
};

export interface BriefingEvent { key: string; title: string; when: string }

// Asistan penceresi: iki araç sekmesi. "Toplantı brifingi" = yaklaşan toplantılar listesi + serbest konu kutusu;
// "Dışarı işler" = alışveriş/görevlerden tek turluk rota (bkz. ErrandPlanner).
export function BriefingLauncherModal({ events, onPick, onClose, errand }: {
  events: BriefingEvent[];
  onPick: (title: string, when: string) => void;
  onClose: () => void;
  errand?: { tasks: ErrandTaskInput[]; fileContents: Record<string, string>; clientsFolder?: string; onSaveNote?: (path: string, content: string) => Promise<void> };
}) {
  const [custom, setCustom] = useState('');
  const [tab, setTab] = useState<'meeting' | 'errands' | 'extract' | 'transcript'>('meeting');
  const tabBtn = (key: 'meeting' | 'errands' | 'extract' | 'transcript', text: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      style={{
        flex: 1, padding: '8px 10px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', borderRadius: '8px',
        border: '1px solid var(--border-color)', whiteSpace: 'nowrap',
        background: tab === key ? 'var(--accent-color)' : 'var(--bg-tertiary)',
        color: tab === key ? '#fff' : 'var(--text-secondary)'
      }}
    >
      {text}
    </button>
  );
  return createPortal(
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}><Brain size={18} /> Asistan</h3>
          <button type="button" onClick={onClose} style={{ ...smallBtn, padding: '5px 7px' }} title="Kapat"><X size={14} /></button>
        </div>
        {errand && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
            {tabBtn('meeting', 'Toplantı brifingi')}
            {tabBtn('transcript', 'Transkript')}
            {tabBtn('errands', 'Dışarı işler')}
            {tabBtn('extract', 'Görev çıkar')}
          </div>
        )}

        {tab === 'transcript' && errand ? (
          <MeetingTranscriptPanel fileContents={errand.fileContents} clientsFolder={errand.clientsFolder} onSaveNote={errand.onSaveNote} />
        ) : tab === 'extract' && errand ? (
          <TaskExtractorPanel fileContents={errand.fileContents} onSaveNote={errand.onSaveNote} />
        ) : tab === 'errands' && errand ? (
          <ErrandPlannerPanel tasks={errand.tasks} fileContents={errand.fileContents} onSaveNote={errand.onSaveNote} />
        ) : (
          <>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: 1.5 }}>
              Bir toplantı seçin: ilgili müşteri/proje notlarınızdan ve görevlerinizden kısa bir hazırlık özeti çıkarılır.
              Yalnızca seçilen not ve görev metinleri Gemini'ye gönderilir.
            </div>
            {events.length === 0 ? (
              <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '12px' }}>Bugün ve yarın için saatli etkinlik yok.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                {events.map(ev => (
                  <button
                    key={ev.key}
                    type="button"
                    onClick={() => onPick(ev.title, ev.when)}
                    style={{ ...smallBtn, justifyContent: 'space-between', whiteSpace: 'normal', textAlign: 'left', gap: '10px', padding: '9px 12px' }}
                  >
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)', fontSize: '13px' }}>{ev.title}</span>
                    <span style={{ flexShrink: 0, fontSize: '11px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <CalIcon size={11} /> {ev.when}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) onPick(custom.trim(), ''); }}
                placeholder="Ya da bir konu yazın (örn. Borusan Datahub)"
                maxLength={120}
                style={{ flex: 1, minWidth: 0, background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '6px', padding: '7px 10px', fontSize: '12.5px' }}
              />
              <button
                type="button"
                disabled={!custom.trim()}
                onClick={() => onPick(custom.trim(), '')}
                style={{ ...smallBtn, background: 'var(--accent-color)', color: '#fff', border: 'none', opacity: custom.trim() ? 1 : 0.5 }}
              >
                Hazırla
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

const Section = ({ title, items }: { title: string; items: string[] }) => (
  items.length === 0 ? null : (
    <div style={{ marginTop: '12px' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '5px' }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {items.map((it, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{it}</li>)}
      </ul>
    </div>
  )
);

export function MeetingBriefingModal({ title, when, notes, fileContents, tasks, clientsFolder, onSaveNote, onClose }: {
  title: string;
  when: string;
  notes: BriefNote[];
  fileContents: Record<string, string>;
  tasks: BriefTask[];
  clientsFolder?: string;
  onSaveNote?: (path: string, content: string) => Promise<void>;
  onClose: () => void;
}) {
  const ctx = useMemo(
    () => gatherBriefingContext({ title, notes, fileContents, tasks, clientsFolder }),
    // Bağlam açıldığı andaki hâliyle sabit: yazarken/senkronda yeniden hesaplanıp yanıt değişmesin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title]
  );
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const runId = useRef(0);

  const run = async () => {
    const id = ++runId.current;
    setState('loading'); setError(''); setNote('');
    if (!isGeminiConfigured()) {
      setState('error');
      setError('Gemini API anahtarı ayarlı değil. Ayarlar > AI Mentor bölümünden ekleyin.');
      return;
    }
    try {
      const b = await generateBriefing(title, when, ctx);
      if (id !== runId.current) return;
      setBriefing(b); setState('ready');
    } catch (e: any) {
      if (id !== runId.current) return;
      setState('error'); setError(String(e?.message || e));
    }
  };
  useEffect(() => { run(); return () => { runId.current++; }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [title]);

  const markdown = briefing ? briefingToMarkdown(title, when, briefing, ctx) : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(markdown); setNote('Panoya kopyalandı.'); } catch { setNote('Kopyalanamadı.'); }
  };
  const save = async () => {
    if (!onSaveNote || !briefing) return;
    const d = new Date();
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const safeTitle = title.replace(/[\\/:*?"<>|#\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Toplantı';
    const folder = ctx.matchedClients.length
      ? `${(clientsFolder || 'Müşteriler').replace(/\/+$/, '')}/${ctx.matchedClients[0]}/Toplantılar`
      : 'Toplantılar';
    const path = `${folder}/${ymd} ${safeTitle} brifing.md`;
    try { await onSaveNote(path, markdown); setNote(`Kaydedildi: ${path}`); } catch (e: any) { setNote(`Kaydedilemedi: ${String(e?.message || e)}`); }
  };

  const sources = [
    ctx.matchedClients.length ? `Müşteri: ${ctx.matchedClients.join(', ')}` : '',
    ctx.matchedProjects.length ? `Proje: ${ctx.matchedProjects.join(', ')}` : ''
  ].filter(Boolean).join(' · ');

  return createPortal(
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}><Brain size={18} style={{ flexShrink: 0 }} /> <span style={{ overflowWrap: 'anywhere' }}>{title}</span></h3>
            {when && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>{when}</div>}
          </div>
          <button type="button" onClick={onClose} style={{ ...smallBtn, padding: '5px 7px', flexShrink: 0 }} title="Kapat"><X size={14} /></button>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', lineHeight: 1.5 }}>
          {sources || (ctx.usedFallbackSearch ? 'Müşteri/proje adıyla eşleşme bulunamadı, kelime aramasıyla bulunan notlar kullanıldı (ilgisiz olabilir).' : 'İlgili müşteri/proje bulunamadı.')}
          <br />Gemini'ye giden: {ctx.recentNotes.length} not{ctx.recentNotes.length ? ` (${ctx.recentNotes.map(n => n.name).join(', ')})` : ''}, {ctx.openTasks.length} açık görev, {ctx.recentlyDone.length} biten iş.
        </div>

        {state === 'loading' && <div style={{ marginTop: '16px', fontSize: '13px', color: 'var(--text-muted)' }}>Brifing hazırlanıyor…</div>}
        {state === 'error' && <div style={{ marginTop: '16px', fontSize: '12.5px', color: '#ef4444', overflowWrap: 'anywhere' }}>{error}</div>}
        {state === 'ready' && briefing && (
          <div>
            {briefing.ozet && <p style={{ margin: '14px 0 0 0', fontSize: '13.5px', lineHeight: 1.55 }}>{briefing.ozet}</p>}
            <Section title="Son durum" items={briefing.sonDurum} />
            <Section title="Açık işler" items={briefing.acikIsler} />
            <Section title="Kararlar" items={briefing.kararlar} />
            <Section title="Sorulacaklar" items={briefing.sorular} />
            <Section title="Riskler" items={briefing.riskler} />
            <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
              Yapay zekâ notlarınızdan özetledi, hata yapabilir; önemli kararları kendi notunuzdan doğrulayın.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px', alignItems: 'center' }}>
          {state === 'ready' && <button type="button" onClick={copy} style={smallBtn}><Copy size={13} /> Kopyala</button>}
          {state === 'ready' && onSaveNote && <button type="button" onClick={save} style={smallBtn}><Save size={13} /> Nota kaydet</button>}
          {state !== 'loading' && <button type="button" onClick={run} style={smallBtn}><RefreshCw size={13} /> Yeniden üret</button>}
          {note && <span style={{ fontSize: '11.5px', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{note}</span>}
        </div>
      </div>
    </div>,
    document.body
  );
}
