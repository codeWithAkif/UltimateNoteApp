import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Save, Sparkles, X } from 'lucide-react';
import { isGeminiConfigured } from '../services/geminiMentor';
import { gatherBriefingContext } from '../services/meetingBriefing';
import {
  fmtClock, generateMeetingSummary, meetingNoteMarkdown, parseVtt, titleFromFileName,
  type MeetingSummary, type ParsedTranscript
} from '../services/meetingTranscript';

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap',
  background: 'var(--bg-hover)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)',
  borderRadius: '8px', padding: '7px 11px', fontSize: '12px', fontWeight: 600, cursor: 'pointer'
};
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
  color: 'var(--text-primary)', borderRadius: '6px', padding: '7px 10px', fontSize: '12.5px', fontFamily: 'inherit'
};
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '14px 0 6px' };

export interface TranscriptSource { name: string; content: string; mtimeMs?: number }

const Section = ({ title, items }: { title: string; items: string[] }) => (
  items.length === 0 ? null : (
    <div>
      <div style={label}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {items.map((it, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{it}</li>)}
      </ul>
    </div>
  )
);

// "Toplantı transkripti" paneli: Teams'ten inen .vtt dosyasını okur (otomatik bildirimden ya da sürükle-bırak/dosya seç),
// özet + kararlar + kişi bazlı görevler + paylaşılan kaynakları önerir; onayınızla nota yazar. Onaysız hiçbir şey gönderilmez/yazılmaz.
export default function MeetingTranscriptPanel({ source: initial, fileContents, clientsFolder, onSaveNote, onDone }: {
  source?: TranscriptSource | null;
  fileContents: Record<string, string>;
  clientsFolder?: string;
  onSaveNote?: (path: string, content: string) => Promise<void>;
  onDone?: () => void;
}) {
  const [source, setSource] = useState<TranscriptSource | null>(initial || null);
  const [title, setTitle] = useState(initial ? titleFromFileName(initial.name) : '');
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error' | 'saved'>('idle');
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [withTranscript, setWithTranscript] = useState(true);
  const [error, setError] = useState('');
  const [savedPath, setSavedPath] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [watchFolder, setWatchFolder] = useState(() => { try { return localStorage.getItem('transcript_folder') || ''; } catch { return ''; } });
  const pickFolder = async () => {
    const f = await (window as any).electron?.transcriptPickFolder?.();
    if (f) { try { localStorage.setItem('transcript_folder', f); } catch { /* yoksay */ } setWatchFolder(f); }
  };
  const runId = useRef(0);

  const parsed: ParsedTranscript | null = useMemo(() => (source ? parseVtt(source.content) : null), [source]);
  const meetingDate = source?.mtimeMs ? new Date(source.mtimeMs) : new Date();

  const load = async (file: File) => {
    if (!/\.vtt$/i.test(file.name)) { setState('error'); setError('Yalnızca .vtt transkript dosyaları desteklenir.'); return; }
    if (file.size > 5 * 1024 * 1024) { setState('error'); setError('Dosya 5 MB sınırından büyük.'); return; }
    const content = await file.text();
    setSource({ name: file.name, content, mtimeMs: file.lastModified });
    setTitle(titleFromFileName(file.name));
    setSummary(null); setState('idle'); setError('');
  };

  const run = async () => {
    if (!parsed) return;
    if (!isGeminiConfigured()) { setState('error'); setError('Gemini API anahtarı ayarlı değil. Ayarlar > AI Mentor bölümünden ekleyin.'); return; }
    const id = ++runId.current;
    setState('loading'); setError(''); setOff(new Set());
    try {
      const s = await generateMeetingSummary(title.trim() || 'Toplantı', parsed, meetingDate);
      if (id !== runId.current) return;
      setSummary(s); setState('ready');
    } catch (e: any) {
      if (id !== runId.current) return;
      setState('error'); setError(String(e?.message || e));
    }
  };

  const chosenTasks = summary ? summary.gorevler.filter((_, i) => !off.has(i)) : [];
  const toggle = (i: number) => setOff(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const save = async () => {
    if (!onSaveNote || !summary || !parsed) return;
    const t = title.trim() || 'Toplantı';
    const notes = Object.keys(fileContents).filter(p => /\.md$/i.test(p)).map(p => ({ path: p, name: p.split('/').pop()!.replace(/\.md$/i, ''), updatedAt: 0 }));
    let client = '';
    try { client = gatherBriefingContext({ title: t, notes, fileContents, tasks: [], clientsFolder }).matchedClients[0] || ''; } catch { /* müşteri eşleşmezse genel klasör */ }
    const d = meetingDate;
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const safeTitle = t.replace(/[\\/:*?"<>|#\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Toplantı';
    const folder = client ? `${(clientsFolder || 'Müşteriler').replace(/\/+$/, '')}/${client}/Toplantılar` : 'Toplantılar';
    let path = `${folder}/${day} ${safeTitle}.md`;
    // Aynı gün aynı adlı bir not varsa üzerine yazılmaz.
    for (let n = 2; fileContents[path] !== undefined && n < 20; n++) path = `${folder}/${day} ${safeTitle} (${n}).md`;
    try {
      await onSaveNote(path, meetingNoteMarkdown({ title: t, date: d, parsed, summary, tasks: chosenTasks, includeTranscript: withTranscript }));
      setSavedPath(path); setState('saved');
    } catch (e: any) { setState('error'); setError(`Kaydedilemedi: ${String(e?.message || e)}`); }
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) load(f); }}
    >
      {!source ? (
        <div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Teams'ten indirdiğiniz transkript dosyasını (.vtt) buraya bırakın ya da seçin. Masaüstünde İndirilenler klasörüne inen
            transkriptler otomatik fark edilir.
          </div>
          <div style={{ marginTop: '12px', border: '1px dashed var(--border-color)', borderRadius: '10px', padding: '22px 12px', textAlign: 'center', fontSize: '12.5px', color: 'var(--text-muted)' }}>
            <button type="button" style={btn} onClick={() => fileInput.current?.click()}><FileText size={13} /> .vtt dosyası seç</button>
            <div style={{ marginTop: '8px' }}>ya da dosyayı bu alana sürükleyin</div>
          </div>
          {typeof window !== 'undefined' && (window as any).electron?.transcriptPickFolder && (
            <div style={{ marginTop: '10px', fontSize: '11.5px', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
              İzlenen klasör: {watchFolder || 'İndirilenler'}{' '}
              <button type="button" onClick={pickFolder} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent-color)', cursor: 'pointer', fontSize: '11.5px', fontWeight: 700 }}>Değiştir</button>
            </div>
          )}
          <input ref={fileInput} type="file" accept=".vtt" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }} />
          {state === 'error' && <div style={{ marginTop: '10px', fontSize: '12.5px', color: '#ef4444', overflowWrap: 'anywhere' }}>{error}</div>}
        </div>
      ) : (
        <div>
          <div style={label}>Toplantı adı</div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} style={inputStyle} />
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
            {parsed && parsed.turns.length > 0
              ? <>Süre {fmtClock(parsed.durationSec)} · {parsed.turns.length} konuşma · Katılımcılar: {parsed.speakers.map(s => s.name).join(', ')}</>
              : <span style={{ color: '#eab308' }}>Bu dosyada okunabilir konuşma bulunamadı.</span>}
            <br />Onay verince bu metin Gemini'ye gönderilir.
          </div>

          {state !== 'saved' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
              <button
                type="button"
                disabled={!parsed || parsed.turns.length === 0 || state === 'loading'}
                onClick={run}
                style={{ ...btn, background: 'var(--accent-color)', color: '#fff', border: 'none', opacity: parsed && parsed.turns.length && state !== 'loading' ? 1 : 0.5 }}
              >
                <Sparkles size={13} /> {state === 'loading' ? 'Hazırlanıyor…' : summary ? 'Yeniden üret' : 'Özet ve görevleri çıkar'}
              </button>
              <button type="button" style={btn} onClick={() => { setSource(null); setSummary(null); setState('idle'); setError(''); }}>Başka dosya</button>
            </div>
          )}

          {state === 'error' && <div style={{ marginTop: '12px', fontSize: '12.5px', color: '#ef4444', overflowWrap: 'anywhere' }}>{error}</div>}
          {state === 'saved' && (
            <div style={{ marginTop: '14px', fontSize: '12.5px', color: '#22c55e', overflowWrap: 'anywhere' }}>
              Kaydedildi: {savedPath} ({chosenTasks.length} görev eklendi)
              {onDone && <div style={{ marginTop: '10px' }}><button type="button" style={btn} onClick={onDone}>Kapat</button></div>}
            </div>
          )}

          {summary && state !== 'saved' && (
            <div>
              {summary.ozet && (<><div style={label}>Özet</div><p style={{ margin: 0, fontSize: '13px', lineHeight: 1.55 }}>{summary.ozet}</p></>)}
              <Section title="Kararlar" items={summary.kararlar} />
              <div style={label}>Görevler ({chosenTasks.length}/{summary.gorevler.length})</div>
              {summary.gorevler.length === 0 ? (
                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Toplantıda üstlenilen görev bulunamadı.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {summary.gorevler.map((g, i) => (
                    <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 10px', background: 'var(--bg-tertiary)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
                      <input type="checkbox" checked={!off.has(i)} onChange={() => toggle(i)} style={{ marginTop: '3px', flexShrink: 0 }} />
                      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        <strong style={{ fontWeight: 700 }}>{g.kisi}</strong>: {g.metin}
                        {g.tarih && <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{g.tarih}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <Section title="Paylaşılan kaynaklar" items={summary.kaynaklar} />
              <Section title="Açık sorular" items={summary.acikSorular} />

              {onSaveNote && (
                <div style={{ marginTop: '14px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12.5px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={withTranscript} onChange={(e) => setWithTranscript(e.target.checked)} />
                    Konuşmacı bazlı dökümü de nota ekle
                  </label>
                  <div style={{ marginTop: '10px' }}>
                    <button type="button" style={btn} onClick={save}><Save size={13} /> Nota kaydet ({chosenTasks.length} görevle)</button>
                  </div>
                </div>
              )}
              <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--text-muted)' }}>
                Yapay zekâ hata yapabilir; görev kişilerini ve tarihleri kaydetmeden önce kontrol edin.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2300,
  background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px'
};

// Otomatik bildirimden açılan bağımsız pencere.
export function MeetingTranscriptModal({ source, fileContents, clientsFolder, onSaveNote, onClose }: {
  source: TranscriptSource;
  fileContents: Record<string, string>;
  clientsFolder?: string;
  onSaveNote?: (path: string, content: string) => Promise<void>;
  onClose: () => void;
}) {
  return createPortal(
    <div style={overlayStyle} onClick={onClose}>
      <div
        style={{ width: 'min(560px, 100%)', maxHeight: '88vh', overflowY: 'auto', boxSizing: 'border-box', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '18px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', color: 'var(--text-primary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
          <h3 style={{ margin: 0, fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}><FileText size={18} /> Toplantı transkripti</h3>
          <button type="button" onClick={onClose} style={{ ...btn, padding: '5px 7px' }} title="Kapat"><X size={14} /></button>
        </div>
        <MeetingTranscriptPanel source={source} fileContents={fileContents} clientsFolder={clientsFolder} onSaveNote={onSaveNote} onDone={onClose} />
      </div>
    </div>,
    document.body
  );
}
