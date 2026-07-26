import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, Send, FileText, Loader2, AlertCircle } from 'lucide-react';
import { isGeminiConfigured, findRelevantNotes, askNotesChat, type NotesChatMessage } from '../services/geminiMentor';

interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw' | 'drawio';
}

interface ChatEntry {
  role: 'user' | 'assistant';
  text: string;
  sources?: { path: string; name: string }[];
  isError?: boolean;
}

interface NotesChatViewProps {
  notes: NoteItem[];
  fileContents: Record<string, string>;
  onSelectNote: (path: string) => void;
}

export default function NotesChatView({ notes, fileContents, onSelectNote }: NotesChatViewProps) {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const geminiReady = isGeminiConfigured();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isAsking]);

  const handleSend = async () => {
    const question = input.trim();
    if (!question || isAsking) return;

    const history: NotesChatMessage[] = messages.map(m => ({ role: m.role, text: m.text }));
    setMessages(prev => [...prev, { role: 'user', text: question }]);
    setInput('');
    setIsAsking(true);

    try {
      const relevant = findRelevantNotes(question, notes, fileContents, 6);
      const result = await askNotesChat(question, relevant, history);
      const sources = relevant
        .filter(r => result.usedNoteNames.some(n => n.toLowerCase() === r.name.toLowerCase()))
        .map(r => ({ path: r.path, name: r.name }));
      setMessages(prev => [...prev, { role: 'assistant', text: result.answer, sources }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', text: err?.message || 'Bir hata oluştu.', isError: true }]);
    } finally {
      setIsAsking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!geminiReady) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', gap: '12px', padding: '24px', textAlign: 'center' }}>
        <MessageCircle size={32} style={{ opacity: 0.5 }} />
        <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-primary)' }}>AI Sohbet için Gemini anahtarı gerekli</div>
        <div style={{ fontSize: '12.5px', maxWidth: '360px' }}>
          Notlarınla sohbet edebilmek için Ayarlar &gt; AI Mentor bölümünden kendi Gemini API anahtarını eklemen gerekiyor.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <MessageCircle size={18} style={{ color: '#7c5cff' }} />
        <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 'bold' }}>Notlarımla Sohbet</h2>
      </div>

      <div ref={scrollRef} className="custom-scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', marginTop: '40px' }}>
            Notlarınla ilgili bir soru sor — cevaplar sadece senin notlarına dayanarak verilir.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '75%',
              padding: '10px 14px',
              borderRadius: '12px',
              fontSize: '13.5px',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              background: m.role === 'user' ? '#7c5cff' : (m.isError ? 'var(--bg-tertiary)' : 'var(--bg-secondary)'),
              color: m.role === 'user' ? '#fff' : (m.isError ? '#ef4444' : 'var(--text-primary)'),
              border: m.isError ? '1px solid #ef444444' : 'none'
            }}>
              {m.isError && <AlertCircle size={13} style={{ verticalAlign: 'middle', marginRight: '4px' }} />}
              {m.text}
            </div>
            {m.sources && m.sources.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                {m.sources.map(s => (
                  <button
                    key={s.path}
                    onClick={() => onSelectNote(s.path)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '3px 8px', borderRadius: '999px',
                      background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                      color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer'
                    }}
                  >
                    <FileText size={11} />
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {isAsking && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '13px' }}>
            <Loader2 size={14} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
            Notların taranıyor...
          </div>
        )}
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Notların hakkında bir soru sor..."
          rows={1}
          style={{
            flex: 1, resize: 'none', padding: '10px 12px', borderRadius: '10px',
            border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
            color: 'var(--text-primary)', fontSize: '13.5px', fontFamily: 'inherit', maxHeight: '120px'
          }}
        />
        <button
          onClick={handleSend}
          disabled={isAsking || !input.trim()}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '38px', height: '38px', borderRadius: '10px', border: 'none',
            background: isAsking || !input.trim() ? 'var(--bg-tertiary)' : '#7c5cff',
            color: '#fff', cursor: isAsking || !input.trim() ? 'default' : 'pointer', flexShrink: 0
          }}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
