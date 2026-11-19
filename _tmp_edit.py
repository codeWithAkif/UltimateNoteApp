import sys
p = sys.argv[1]
s = open(p, 'rb').read().decode('utf-8').replace('\r\n', '\n')


def r(a, b):
    global s
    assert s.count(a) == 1, a
    s = s.replace(a, b)


r("""  speaker: ['M4 9v6h4l5 4V5L8 9z', 'M17 8a5 5 0 0 1 0 8'],
""", """  speaker: ['M4 9v6h4l5 4V5L8 9z', 'M17 8a5 5 0 0 1 0 8'],
  play: ['M8 5l11 7-11 7z'],
  pause: ['M8 5v14', 'M16 5v14'],
  prev: ['M6 5v14', 'M19 5l-9 7 9 7z'],
  next: ['M18 5v14', 'M5 5l9 7-9 7z'],
""")
r("useState<'idle' | 'loading' | 'playing'>('idle');", "useState<'idle' | 'loading' | 'playing' | 'paused'>('idle');")
r("""  const rafRef = useRef<number | null>(null);
""", """  const rafRef = useRef<number | null>(null);
  // Cümle başlangıçları ve cümle numaraları: duraklat/devam ve cümle atlama için çalma boyunca saklanır.
  const startsRef = useRef<number[] | null>(null);
  const idxMapRef = useRef<number[]>([]);
  // Kelime panelinde cümle çevirisi (akordiyon); her yeni kelimede gizli başlar.
  const [transOpen, setTransOpen] = useState(false);
""")
r("""    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setAudioState('idle');""", """    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    startsRef.current = null;
    setAudioState('idle');""")
r("""  // Okunan cümle görünür alanın dışına çıkarsa kaydır.""", """  // Vurgulanan cümleyi sesin konumuna göre günceller (çalarken her karede, atlamada bir kez).
  const syncActive = (audio: HTMLAudioElement) => {
    const st = startsRef.current;
    if (!st) return;
    const i = sentenceAt(st, audio.currentTime);
    const seg = i >= 0 ? idxMapRef.current[i] : -1;
    setActiveSeg(prev => (prev === seg ? prev : seg));
  };
  const startHighlight = (audio: HTMLAudioElement) => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (!startsRef.current) return;
    const tick = () => {
      if (audioRef.current !== audio) return;
      syncActive(audio);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  const togglePause = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audioState === 'playing') {
      audio.pause();
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      setAudioState('paused');
    } else if (audioState === 'paused') {
      try { await audio.play(); } catch (e: any) { setError(`Ses devam ettirilemedi: ${String(e?.message || e)}. Tekrar dene.`); return; }
      if (audioRef.current !== audio) return;
      setAudioState('playing');
      startHighlight(audio);
    }
  };
  // Cümle bazlı atlama. Tek cümle sesinde (starts yok) geri = başa sar, ileri yok.
  const skipSentence = (dir: -1 | 1) => {
    const audio = audioRef.current;
    if (!audio) return;
    const st = startsRef.current;
    if (!st || st.length === 0) {
      if (dir < 0) audio.currentTime = 0;
      return;
    }
    const cur = Math.max(0, sentenceAt(st, audio.currentTime));
    if (dir > 0) {
      if (cur >= st.length - 1) return;
      audio.currentTime = st[cur + 1];
    } else {
      // Cümlenin başından uzaksak önce başına dön, yakınsak bir önceki cümleye geç.
      audio.currentTime = audio.currentTime - st[cur] > 1.5 || cur === 0 ? st[cur] : st[cur - 1];
    }
    syncActive(audio);
  };
  // Okunan cümle görünür alanın dışına çıkarsa kaydır.""")
r("""        setActiveSeg(-1); setAudioState('idle'); setAudioKey(null);
      });""", """        startsRef.current = null;
        setActiveSeg(-1); setAudioState('idle'); setAudioKey(null);
      });""")
r("""      if (starts) {
        const idxMap = sel.map(t => t.index);
        const st = starts;
        const tick = () => {
          if (audioRef.current !== audio) return;
          const i = sentenceAt(st, audio.currentTime);
          const seg = i >= 0 ? idxMap[i] : -1;
          setActiveSeg(prev => (prev === seg ? prev : seg));
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }""", """      if (starts) {
        startsRef.current = starts;
        idxMapRef.current = sel.map(t => t.index);
        startHighlight(audio);
      }""")
r("""    setPicked({ word: token.text, segKey: seg.key, exp: known, loading: !known });""", """    setTransOpen(false);
    setPicked({ word: token.text, segKey: seg.key, exp: known, loading: !known });""")
r("""audioKey === key && audioState === 'playing' ? 'Durdur'""", """audioKey === key && (audioState === 'playing' || audioState === 'paused') ? 'Durdur'""")
r("""      <div style={{ borderTop: `1px solid ${P.line}`, paddingTop: 10 }}>
        <div style={muted}>Cümlenin anlamı</div>
        <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{seg.translation || '—'}</div>
        {seg.native !== seg.text && <div style={{ fontFamily: P.read, fontSize: 20, marginTop: 6, color: P.muted }}>{seg.native}</div>}
      </div>""", """      <div style={{ borderTop: `1px solid ${P.line}`, paddingTop: 10 }}>
        <button aria-expanded={transOpen} onClick={() => setTransOpen(o => !o)}
          style={{ ...muted, display: 'flex', alignItems: 'center', gap: 6, width: '100%', minHeight: 44, padding: 0, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ display: 'inline-flex', transform: transOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}><Icon name="chevron" size={16} /></span>
          {transOpen ? 'Cümlenin Türkçesini gizle' : 'Cümlenin Türkçesini göster'}
        </button>
        {transOpen && <>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{seg.translation || '—'}</div>
          {seg.native !== seg.text && <div style={{ fontFamily: P.read, fontSize: 20, marginTop: 6, color: P.muted }}>{seg.native}</div>}
        </>}
      </div>""")
r("""        <button style={S.btn(false, audioKey === 'sentence' && audioState === 'loading')} disabled={audioKey === 'sentence' && audioState === 'loading'} onClick={""", """        <button style={S.btn(false, audioKey === 'full' || (audioKey === 'sentence' && audioState === 'loading'))} disabled={audioKey === 'full' || (audioKey === 'sentence' && audioState === 'loading')} onClick={""")
r("""<Icon name={audioKey === 'sentence' && audioState === 'playing' ? 'stop' : 'speaker'} size={18} />{playLabel('sentence', 'Cümleyi dinle')}""", """<Icon name={audioKey === 'sentence' && (audioState === 'playing' || audioState === 'paused') ? 'stop' : 'speaker'} size={18} />{playLabel('sentence', 'Cümleyi dinle')}""")
r("""onClick={() => { stopAudio(); setPicked(null); }}>Kapat""", """onClick={() => setPicked(null)}>Kapat""")
r("paddingBottom: sheetMode ? 320 : 0 }}>", "paddingBottom: sheetMode ? (transOpen ? 480 : 320) : 0 }}>")
r("""          <Icon name={audioKey === 'full' && audioState === 'playing' ? 'stop' : 'speaker'} size={20} />{playLabel('full', 'Tümünü dinle')}
        </button>
""", """          <Icon name={audioKey === 'full' && (audioState === 'playing' || audioState === 'paused') ? 'stop' : 'speaker'} size={20} />{playLabel('full', 'Tümünü dinle')}
        </button>
        {(audioState === 'playing' || audioState === 'paused') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {([
              { label: 'Önceki cümle', icon: 'prev', onClick: () => skipSentence(-1) },
              { label: audioState === 'paused' ? 'Devam et' : 'Duraklat', icon: audioState === 'paused' ? 'play' : 'pause', onClick: togglePause },
              { label: 'Sonraki cümle', icon: 'next', onClick: () => skipSentence(1) }
            ] as const).map(b => (
              <button key={b.label} aria-label={b.label} title={b.label} onClick={b.onClick}
                style={{ width: 44, height: 44, borderRadius: 22, border: 'none', background: dark ? P.surface : 'transparent', color: P.primary, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={b.icon} size={20} />
              </button>
            ))}
          </div>
        )}
""")
r("anlamı ve cümlenin çevirisi {dark ? 'cümlenin altında' : 'aşağıda'} açılır.", "anlamı {dark ? 'cümlenin altında' : 'aşağıda'} açılır; cümlenin Türkçesi için paneldeki başlığa dokun.")
open(p, 'wb').write(s.replace('\n', '\r\n').encode('utf-8'))
