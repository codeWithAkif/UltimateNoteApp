import React, { useMemo } from 'react';
import { Compass, ChevronUp, Clock3 } from 'lucide-react';
import { type PunctualityState, getPunctualityRank, PUNCTUALITY_RANK_LADDER, getDeadlineFromLine, computeSavedTimeStats } from '../punctuality';
import PunctualityGauge from './PunctualityGauge';

interface AdventureViewProps {
  punctuality: PunctualityState;
  fileContents: Record<string, string>;
}

interface HistoryEntry {
  title: string;
  outcome: 'fast' | 'ontime' | 'late';
  completedAt: string;
  savedMinutes: number;
}

const OUTCOME_META: Record<HistoryEntry['outcome'], { label: string; icon: string; color: string }> = {
  fast: { label: 'Erken bitirdi', icon: '⚡', color: '#22c55e' },
  ontime: { label: 'Zamanında', icon: '✅', color: '#94a3b8' },
  late: { label: 'Geç kaldı', icon: '🐌', color: '#ef4444' }
};

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// "Görev Macerası" (altın/XP/envanter/mağaza) yerine gelen sade sayfa: büyük ibre + son
// tamamlanan görevlerin gerçek dakiklik geçmişi. Ekonomi/oyunlaştırma katmanı bilerek yok —
// kullanıcı bunun karmaşık gelip işe yaramadığını belirtti, tek net sinyal (skor + geçmiş)
// istedi.
export default function AdventureView({ punctuality, fileContents }: AdventureViewProps) {
  const history = useMemo(() => {
    const entries: HistoryEntry[] = [];
    Object.values(fileContents).forEach(content => {
      if (!content) return;
      const lines = content.split('\n');
      lines.forEach(line => {
        const outcomeMatch = line.match(/\[(?:outcome|dakiklik):(fast|ontime|late)\]/i);
        if (!outcomeMatch) return;
        const outcome = outcomeMatch[1].toLowerCase() as HistoryEntry['outcome'];
        const completedMatch = line.match(/\[(?:completed|tamamlanma):([^\]]+)\]/i);
        const titleMatch = line.match(/^\s*[*\-]\s+\[[xX]\]\s+(.*)$/);
        const title = titleMatch
          ? titleMatch[1].replace(/\[[^\]]+\]/g, '').trim()
          : 'İsimsiz görev';

        // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
        // Kazanılan süre ayrı bir yerde SAKLANMAZ (uygulamanın felsefesi: her şey etiketlerden
        // türetilir) — burada [due:]+[plannedtime:] (plan) ile [completed:] (gerçek) karşılaştırılarak
        // anlık hesaplanır. Yalnızca 'fast' sonuçlarda ve plan bilgisi (saatli) varsa anlamlı.
        let savedMinutes = 0;
        if (outcome === 'fast' && completedMatch) {
          const deadline = getDeadlineFromLine(line);
          if (deadline && /\[(?:plannedtime|time|window):/i.test(line)) {
            const completedMs = new Date(completedMatch[1]).getTime();
            if (!isNaN(completedMs)) {
              const diff = (deadline.getTime() - completedMs) / 60000;
              if (diff > 0) savedMinutes = diff;
            }
          }
        }

        entries.push({
          title: title || 'İsimsiz görev',
          outcome,
          completedAt: completedMatch ? completedMatch[1] : '',
          savedMinutes
        });
      });
    });
    return entries.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  }, [fileContents]);

  const recentHistory = useMemo(() => history.slice(0, 30), [history]);

  const stats = useMemo(() => {
    const fast = history.filter(h => h.outcome === 'fast').length;
    const ontime = history.filter(h => h.outcome === 'ontime').length;
    const late = history.filter(h => h.outcome === 'late').length;
    return { fast, ontime, late, total: history.length };
  }, [history]);

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Bugün/hafta/ay/tüm zamanlar kazanılan süre — Sidebar widget'ıyla AYNI paylaşılan
  // hesaplama (computeSavedTimeStats), ayrı bir depolama yok.
  const savedTimeStats = useMemo(() => computeSavedTimeStats(fileContents), [fileContents]);

  const rank = getPunctualityRank(punctuality.score);
  const nextRank = rank.index < PUNCTUALITY_RANK_LADDER.length - 1 ? PUNCTUALITY_RANK_LADDER[rank.index + 1] : null;
  const rankProgressPercent = rank.nextMinScore
    ? Math.min(100, Math.max(0, ((punctuality.score - rank.minScore) / (rank.nextMinScore - rank.minScore)) * 100))
    : 100;

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '24px', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="custom-scroll">
      <div style={{ maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Compass size={20} style={{ color: 'var(--accent-color)' }} />
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>Dakiklik Pusulası</h2>
        </div>

        <div style={{ padding: '24px 20px', borderRadius: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '26px' }}>{rank.emoji}</span>
            <span style={{ fontSize: '22px', fontWeight: 800, color: rank.color }}>{rank.name}</span>
          </div>
          <PunctualityGauge score={punctuality.score} width={340} />
          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
            Skor: {punctuality.score.toFixed(1)} / 100 — her tamamlanan görev ibreyi biraz kaydırır, tek bir görev asla aniden dibe vurdurmaz.
          </span>

          {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
              Bir üst rütbeye ilerleme çubuğu — devPaths.ts'teki rütbe ilerleme UI'ıyla AYNI
              desen. Kullanıcı yalnızca skorunu değil, bir sonraki rütbeye ne kadar kaldığını
              görsün ve oraya tırmanmak istesin. */}
          {nextRank ? (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Sıradaki rütbe</span>
                <span style={{ fontSize: '11px', fontWeight: 700, color: nextRank.color }}>
                  {nextRank.emoji} {nextRank.name} <ChevronUp size={11} style={{ verticalAlign: '-1px' }} />
                </span>
              </div>
              <div style={{ width: '100%', height: '6px', borderRadius: '3px', background: 'var(--bg-hover)', overflow: 'hidden' }}>
                <div style={{ width: `${rankProgressPercent}%`, height: '100%', borderRadius: '3px', background: nextRank.color, transition: 'width 0.5s ease' }} />
              </div>
              <span style={{ fontSize: '9.5px', color: 'var(--text-muted)', alignSelf: 'flex-end' }}>
                {(rank.nextMinScore! - punctuality.score).toFixed(1)} puan kaldı
              </span>
            </div>
          ) : (
            <span style={{ fontSize: '11px', fontWeight: 700, color: rank.color }}>🏆 En üst rütbedesin</span>
          )}
        </div>

        {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
            Tüm merdiveni göster — kullanıcı hem şu an nerede olduğunu hem de merdivenin
            tamamını (üstte neler var, altta neler var) görsün. Mevcut rütbe vurgulanır. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h3 style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>RÜTBE MERDİVENİ</h3>
          {[...PUNCTUALITY_RANK_LADDER].reverse().map((r, i) => {
            const realIndex = PUNCTUALITY_RANK_LADDER.length - 1 - i;
            const isCurrent = realIndex === rank.index;
            return (
              <div
                key={r.name}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 10px',
                  borderRadius: '6px',
                  background: isCurrent ? `${r.color}22` : 'transparent',
                  border: isCurrent ? `1px solid ${r.color}` : '1px solid transparent'
                }}
              >
                <span style={{ fontSize: '14px', width: '20px', textAlign: 'center' }}>{r.emoji}</span>
                <span style={{ fontSize: '12px', fontWeight: isCurrent ? 700 : 500, color: isCurrent ? r.color : 'var(--text-secondary)', flex: 1 }}>{r.name}</span>
                <span style={{ fontSize: '9.5px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{r.minScore}+</span>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          <div style={{ padding: '12px', borderRadius: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#22c55e' }}>{stats.fast}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>⚡ Erken bitirdi</div>
          </div>
          <div style={{ padding: '12px', borderRadius: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#94a3b8' }}>{stats.ontime}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>✅ Zamanında</div>
          </div>
          <div style={{ padding: '12px', borderRadius: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#ef4444' }}>{stats.late}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>🐌 Geç kaldı</div>
          </div>
        </div>

        {/* Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
            Bugün/hafta/ay/tüm zamanlar kazanılan süre — kullanıcının "kazanılan zaman da
            kayıt edilirse sevinirim" + "haftalık ve aylık kazanımlarda da gözüksün" isteğine
            karşılık. Ayrı bir yerde saklanmıyor, tüm 'fast' geçmişten anlık toplanıyor
            (bkz. computeSavedTimeStats, Sidebar widget'ıyla paylaşılan aynı hesap). */}
        {savedTimeStats.allTime >= 1 && (
          <div style={{ padding: '14px 16px', borderRadius: '10px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock3 size={16} style={{ color: '#22c55e', flexShrink: 0 }} />
              <span style={{ fontSize: '11.5px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>KAZANILAN SÜRE</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#22c55e' }}>{Math.round(savedTimeStats.today)}</div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>dk · bugün</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#22c55e' }}>{Math.round(savedTimeStats.week)}</div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>dk · bu hafta</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#22c55e' }}>{Math.round(savedTimeStats.month)}</div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>dk · bu ay</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#22c55e' }}>{Math.round(savedTimeStats.allTime)}</div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>dk · tüm zamanlar</div>
              </div>
            </div>
          </div>
        )}

        <div>
          <h3 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>Son Görevler</h3>
          {recentHistory.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '16px', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
              Henüz tamamlanmış görev yok. Bir göreve "▶️ Başla" deyip zamanında bitirdiğinde burada görünecek.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {recentHistory.map((h, idx) => {
                const meta = OUTCOME_META[h.outcome];
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                    <span style={{ fontSize: '15px' }}>{meta.icon}</span>
                    <span style={{ flex: 1, fontSize: '12px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</span>
                    {h.savedMinutes >= 1 && (
                      <span style={{ fontSize: '9.5px', fontWeight: 600, color: '#22c55e' }}>+{Math.round(h.savedMinutes)} dk</span>
                    )}
                    <span style={{ fontSize: '10.5px', fontWeight: 600, color: meta.color, flexShrink: 0 }}>{meta.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
