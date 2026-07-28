import React, { useState, useMemo } from 'react';
import { Sword, Coins, Package, ScrollText, Sparkles, Loader2, ShoppingBag, X, Wrench, Dices, Tag } from 'lucide-react';
import { type QuestRpgState, getRpgLevel, ITEM_PULL_COST, ITEM_REPAIR_COST, getItemSellPrice } from '../questRpg';
import { generateChronicle } from '../services/geminiMentor';

interface NoteItem {
  name: string;
  path: string;
  type: 'note' | 'folder' | 'excalidraw' | 'drawio';
}

interface AdventureViewProps {
  questRpg: QuestRpgState;
  notes: NoteItem[];
  fileContents: Record<string, string>;
  onChronicleGenerated: (text: string, newWorldStateFlags: Record<string, string>) => void;
  onBuyRandomItem: () => void;
  onRepairItem: (itemId: string) => void;
  onSellItem: (itemId: string) => void;
}

const RARITY_COLORS: Record<string, string> = {
  common: '#9ca3af',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#f59e0b'
};

export default function AdventureView({ questRpg, notes, fileContents, onChronicleGenerated, onBuyRandomItem, onRepairItem, onSellItem }: AdventureViewProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [isStoreOpen, setIsStoreOpen] = useState(false);

  const level = getRpgLevel(questRpg.xp);
  const progressPercent = level.nextMinXp
    ? Math.min(100, Math.round(((questRpg.xp - level.minXp) / (level.nextMinXp - level.minXp)) * 100))
    : 100;

  // Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
  // Son 7 gündeki [quest:] etiketli tamamlanmış görevleri tüm notlardan tarar — AI
  // Chronicle'ı gerçek performansa dayandırmak için (bkz. geminiMentor.ts generateChronicle).
  const recentQuestSummaries = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const summaries: { title: string; outcome: string }[] = [];
    Object.values(fileContents).forEach(content => {
      if (!content) return;
      const lines = content.split('\n');
      lines.forEach(line => {
        const outcomeMatch = line.match(/\[quest:(fast|ontime|failed)\]/i);
        if (!outcomeMatch) return;
        const completedMatch = line.match(/\[tamamlanma:([^\]]+)\]/i);
        if (completedMatch && new Date(completedMatch[1]).getTime() < weekAgo) return;
        const titleMatch = line.match(/^\s*[*\-]\s+\[[xX]\]\s+(.*)$/);
        const title = titleMatch ? titleMatch[1].replace(/\[[^\]]+\]/g, '').trim() : 'İsimsiz görev';
        summaries.push({ title, outcome: outcomeMatch[1].toLowerCase() });
      });
    });
    return summaries;
  }, [fileContents]);

  const handleGenerateChronicle = async () => {
    setIsGenerating(true);
    setGenError(null);
    try {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekStartStr = weekStart.toISOString().split('T')[0];
      const result = await generateChronicle(recentQuestSummaries, questRpg.worldState, weekStartStr);
      onChronicleGenerated(result.text, result.newWorldStateFlags);
    } catch (err: any) {
      setGenError(err?.message || 'Chronicle oluşturulamadı.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '24px', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="custom-scroll">
      <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Sword size={20} style={{ color: 'var(--accent-color)' }} />
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>Görev Macerası</h2>
          </div>
          <button
            onClick={() => setIsStoreOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
          >
            <ShoppingBag size={14} /> Mağaza
          </button>
        </div>

        <div style={{ padding: '18px', borderRadius: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '16px', fontWeight: 'bold' }}>{level.name}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '14px', color: '#f59e0b', fontWeight: 600 }}>
              <Coins size={14} /> {questRpg.gold}
            </span>
          </div>
          <div style={{ width: '100%', height: '6px', borderRadius: '3px', background: 'var(--bg-hover)', overflow: 'hidden', marginBottom: '4px' }}>
            <div style={{ width: `${progressPercent}%`, height: '100%', background: 'var(--accent-color)', transition: 'width 0.3s ease' }} />
          </div>
          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
            {questRpg.xp} XP {level.nextMinXp ? `— sonraki unvana ${level.nextMinXp - questRpg.xp} XP kaldı` : '(en üst unvan)'}
          </span>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <Package size={15} style={{ color: 'var(--text-secondary)' }} />
            <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 'bold' }}>Envanter</h3>
          </div>
          {questRpg.inventory.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '12px', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
              Henüz eşyan yok — görevleri hızlı tamamlayınca rastgele eşya kazanırsın.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' }}>
              {questRpg.inventory.map(item => (
                <div
                  key={item.id}
                  title={`${item.name} (${item.rarity})${item.damaged ? ' — hasarlı' : ''}`}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                    padding: '10px 6px', borderRadius: '8px', background: 'var(--bg-secondary)',
                    border: `1px solid ${item.damaged ? 'var(--border-color)' : RARITY_COLORS[item.rarity]}`,
                    opacity: item.damaged ? 0.5 : 1
                  }}
                >
                  <span style={{ fontSize: '26px', filter: item.damaged ? 'grayscale(1)' : 'none' }}>{item.emoji}</span>
                  <span style={{ fontSize: '9.5px', color: 'var(--text-secondary)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                    {item.name}{item.damaged ? ' (hasarlı)' : ''}
                  </span>
                  {item.damaged && (
                    <button
                      onClick={() => onRepairItem(item.id)}
                      disabled={questRpg.gold < ITEM_REPAIR_COST}
                      title={`Tamir Et (${ITEM_REPAIR_COST} altın)`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '3px', padding: '3px 6px', borderRadius: '5px', border: 'none',
                        background: questRpg.gold >= ITEM_REPAIR_COST ? 'var(--accent-color)' : 'var(--bg-hover)',
                        color: questRpg.gold >= ITEM_REPAIR_COST ? '#fff' : 'var(--text-muted)',
                        fontSize: '9px', cursor: questRpg.gold >= ITEM_REPAIR_COST ? 'pointer' : 'default'
                      }}
                    >
                      <Wrench size={9} /> {ITEM_REPAIR_COST}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ScrollText size={15} style={{ color: 'var(--text-secondary)' }} />
              <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 'bold' }}>Chronicle</h3>
            </div>
            <button
              onClick={handleGenerateChronicle}
              disabled={isGenerating}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: '6px', border: 'none', background: 'var(--accent-color)', color: '#fff', fontSize: '11.5px', fontWeight: 600, cursor: isGenerating ? 'default' : 'pointer', opacity: isGenerating ? 0.6 : 1 }}
            >
              {isGenerating ? <Loader2 size={12} className="spin" style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={12} />}
              Bu Haftanın Chronicle'ı
            </button>
          </div>
          {genError && (
            <div style={{ fontSize: '11px', color: '#ef4444', marginBottom: '8px' }}>{genError}</div>
          )}
          {questRpg.chronicles.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '12px', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
              Henüz bir hikaye bölümü yok — yukarıdaki butonla ilkini oluştur.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[...questRpg.chronicles].reverse().map((entry, idx) => (
                <div key={idx} style={{ padding: '12px 14px', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px' }}>{entry.weekStart}</div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{entry.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isStoreOpen && (
        <div className="modal-overlay animate-fade" onClick={() => setIsStoreOpen(false)} style={{ zIndex: 6100 }}>
          <div className="modal-content animate-pop" onClick={(e) => e.stopPropagation()} style={{ width: '380px', maxWidth: '92%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ShoppingBag size={15} /> Mağaza
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Coins size={12} /> {questRpg.gold}
              </span>
              <button onClick={() => setIsStoreOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={16} /></button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', borderRadius: '8px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Dices size={20} style={{ color: 'var(--accent-color)' }} />
                <div>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>Rastgele Eşya Çek</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Ortak/nadir/epik/efsanevi şans</div>
                </div>
              </div>
              <button
                onClick={onBuyRandomItem}
                disabled={questRpg.gold < ITEM_PULL_COST}
                style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', fontSize: '11.5px', fontWeight: 600, cursor: questRpg.gold >= ITEM_PULL_COST ? 'pointer' : 'default', background: questRpg.gold >= ITEM_PULL_COST ? 'var(--accent-color)' : 'var(--bg-hover)', color: questRpg.gold >= ITEM_PULL_COST ? '#fff' : 'var(--text-muted)' }}
              >
                💰 {ITEM_PULL_COST}
              </button>
            </div>

            <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '14px' }}>
              Hasarlı eşyaları envanterden {ITEM_REPAIR_COST} altın karşılığında tamir edebilirsin (her eşyanın yanındaki 🔧 butonu).
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <Tag size={13} style={{ color: 'var(--text-secondary)' }} />
              <h4 style={{ margin: 0, fontSize: '12px', fontWeight: 'bold' }}>Envanterini Sat</h4>
            </div>
            {questRpg.inventory.length === 0 ? (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '10px', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
                Satacak eşyan yok.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }} className="custom-scroll">
                {questRpg.inventory.map(item => (
                  <div
                    key={item.id}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', borderRadius: '7px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <span style={{ fontSize: '16px', filter: item.damaged ? 'grayscale(1)' : 'none' }}>{item.emoji}</span>
                      <span style={{ fontSize: '11.5px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}{item.damaged ? ' (hasarlı)' : ''}
                      </span>
                    </div>
                    <button
                      onClick={() => onSellItem(item.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: '6px', border: 'none', background: 'var(--bg-hover)', color: 'var(--text-primary)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
                    >
                      Sat · 💰 {getItemSellPrice(item)}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
