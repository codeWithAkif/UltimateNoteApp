// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// "Finans Kayıtları" — harcama/gelir verisini notlar içine gömülü serbest metin etiketleri
// yerine gerçek, kategorili, alt kalemli bir tabloda tutan yeni ekran (bkz. financeSync.ts,
// migrations/0006_create_finance_entries.sql). FinanceView.tsx'teki mevcut not-tabanlı
// analiz (kaynaklar/varlıklar/fiyat karşılaştırma) BOZULMADAN, ayrı bir sekme olarak durur;
// bu ikisi zamanla birbirine yaklaşabilir ama şimdilik veri kaynakları kasıtlı olarak ayrı.

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, X, Pencil, Import, TrendingUp, TrendingDown, Tag } from 'lucide-react';
import type { FinanceEntry, FinanceCategory, FinanceEntryType, FinanceItem, NewFinanceEntryInput } from '../services/financeSync';

export interface LegacyCandidate {
  key: string; // `${notePath}#${lineIdx}` — finance_entries.legacy_note_path/legacy_line_idx ile eşleşir
  noteName: string;
  notePath: string;
  lineIdx: number;
  date: string;
  description: string;
  amount: number;
  type: FinanceEntryType;
  source: string;
}

interface FinanceEntriesViewProps {
  entries: FinanceEntry[];
  categories: FinanceCategory[];
  onAddEntry: (input: NewFinanceEntryInput) => Promise<void>;
  onUpdateEntry: (id: string, patch: Partial<NewFinanceEntryInput>) => Promise<void>;
  onDeleteEntry: (id: string) => Promise<void>;
  onAddCategory: (name: string, color: string) => Promise<void>;
  onDeleteCategory: (name: string) => Promise<void>;
  legacyCandidates: LegacyCandidate[];
  alreadyImportedKeys: Set<string>;
  onImportLegacy: (selected: LegacyCandidate[]) => Promise<void>;
}

const TYPE_LABELS: Record<FinanceEntryType, string> = {
  gider: 'Gider',
  gelir: 'Gelir',
  yatirim: 'Yatırım',
  tasarruf: 'Tasarruf'
};

const PALETTE = ['#22c55e', '#f97316', '#3b82f6', '#a855f7', '#eab308', '#ef4444', '#ec4899', '#94a3b8', '#06b6d4', '#84cc16'];

const emptyItem = (): FinanceItem => ({ name: '', price: 0 });

const FinanceEntriesView: React.FC<FinanceEntriesViewProps> = ({
  entries, categories, onAddEntry, onUpdateEntry, onDeleteEntry,
  onAddCategory, onDeleteCategory, legacyCandidates, alreadyImportedKeys, onImportLegacy
}) => {
  const [subView, setSubView] = useState<'list' | 'report' | 'categories' | 'import'>('list');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formDate, setFormDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [formCategory, setFormCategory] = useState('');
  const [formType, setFormType] = useState<FinanceEntryType>('gider');
  const [formAmount, setFormAmount] = useState('');
  const [formSource, setFormSource] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formItems, setFormItems] = useState<FinanceItem[]>([]);

  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState(PALETTE[0]);

  const [monthFilter, setMonthFilter] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedImportKeys, setSelectedImportKeys] = useState<Set<string>>(new Set());

  const pendingImportCandidates = useMemo(
    () => legacyCandidates.filter(c => !alreadyImportedKeys.has(c.key)),
    [legacyCandidates, alreadyImportedKeys]
  );

  const resetForm = () => {
    setEditingId(null);
    setFormDate(new Date().toISOString().split('T')[0]);
    setFormCategory(categories[0]?.name || '');
    setFormType('gider');
    setFormAmount('');
    setFormSource('');
    setFormNote('');
    setFormItems([]);
  };

  const openAddForm = () => {
    resetForm();
    setIsFormOpen(true);
  };

  const openEditForm = (entry: FinanceEntry) => {
    setEditingId(entry.id);
    setFormDate(entry.entryDate);
    setFormCategory(entry.category);
    setFormType(entry.type);
    setFormAmount(String(entry.amount));
    setFormSource(entry.source || '');
    setFormNote(entry.note || '');
    setFormItems(entry.items.length > 0 ? entry.items : []);
    setIsFormOpen(true);
  };

  const handleSubmitForm = async () => {
    const amount = parseFloat(formAmount.replace(',', '.'));
    if (!formCategory || isNaN(amount) || amount <= 0) return;

    const cleanItems = formItems.filter(i => i.name.trim());
    const input: NewFinanceEntryInput = {
      entryDate: formDate,
      category: formCategory,
      type: formType,
      amount,
      source: formSource.trim() || null,
      note: formNote.trim() || null,
      items: cleanItems
    };

    if (editingId) {
      await onUpdateEntry(editingId, input);
    } else {
      await onAddEntry(input);
    }
    setIsFormOpen(false);
    resetForm();
  };

  // Ay ay + kategori bazlı toplamlar (yalnızca gider/gelir, yatırım/tasarruf raporda ayrı satır)
  const monthlyReport = useMemo(() => {
    const byMonth: Record<string, Record<string, number>> = {};
    entries.forEach(e => {
      const month = e.entryDate.slice(0, 7);
      if (!byMonth[month]) byMonth[month] = {};
      const key = `${e.type}:${e.category}`;
      byMonth[month][key] = (byMonth[month][key] || 0) + e.amount;
    });
    return byMonth;
  }, [entries]);

  const months = useMemo(
    () => Object.keys(monthlyReport).sort((a, b) => b.localeCompare(a)),
    [monthlyReport]
  );

  const entriesForMonth = useMemo(
    () => entries.filter(e => e.entryDate.startsWith(monthFilter)).sort((a, b) => b.entryDate.localeCompare(a.entryDate)),
    [entries, monthFilter]
  );

  const monthTotals = useMemo(() => {
    let gider = 0, gelir = 0;
    entriesForMonth.forEach(e => {
      if (e.type === 'gider') gider += e.amount;
      else if (e.type === 'gelir') gelir += e.amount;
    });
    return { gider, gelir };
  }, [entriesForMonth]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '2px', background: 'var(--bg-tertiary)', padding: '3px', borderRadius: '6px' }}>
          {(['list', 'report', 'categories', 'import'] as const).map(v => (
            <button
              key={v}
              onClick={() => setSubView(v)}
              style={{
                padding: '6px 12px', borderRadius: '4px', border: 'none', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
                background: subView === v ? 'var(--accent-color)' : 'transparent',
                color: subView === v ? '#fff' : 'var(--text-secondary)'
              }}
            >
              {v === 'list' ? 'Kayıtlar' : v === 'report' ? 'Aylık Rapor' : v === 'categories' ? 'Kategoriler' : `İçe Aktar${pendingImportCandidates.length > 0 ? ` (${pendingImportCandidates.length})` : ''}`}
            </button>
          ))}
        </div>
        {subView === 'list' && (
          <button
            onClick={openAddForm}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', background: 'var(--accent-color)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
          >
            <Plus size={14} /> Yeni Kayıt
          </button>
        )}
      </div>

      {subView === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <input
            type="month"
            value={monthFilter}
            onChange={e => setMonthFilter(e.target.value)}
            style={{ width: '160px', padding: '6px 10px', fontSize: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }}
          />
          <div style={{ display: 'flex', gap: '12px', fontSize: '12px' }}>
            <span style={{ color: '#10b981' }}>Gelir: {monthTotals.gelir.toLocaleString('tr-TR')} TL</span>
            <span style={{ color: '#ef4444' }}>Gider: {monthTotals.gider.toLocaleString('tr-TR')} TL</span>
            <span style={{ color: monthTotals.gelir - monthTotals.gider >= 0 ? '#10b981' : '#ef4444' }}>
              Net: {(monthTotals.gelir - monthTotals.gider).toLocaleString('tr-TR')} TL
            </span>
          </div>

          {entriesForMonth.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12.5px' }}>
              Bu ayda kayıt yok. "Yeni Kayıt" ile ekleyin ya da "İçe Aktar" sekmesinden eski notlardaki harcamaları taşıyın.
            </div>
          )}

          {entriesForMonth.map(entry => {
            const cat = categories.find(c => c.name === entry.category);
            return (
              <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: cat?.color || '#94a3b8', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span>{entry.category}</span>
                    <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 400 }}>{entry.entryDate}</span>
                    {entry.source && <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 400 }}>· {entry.source}</span>}
                  </div>
                  {entry.items.length > 0 && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {entry.items.map(i => `${i.name} (${i.price} TL)`).join(', ')}
                    </div>
                  )}
                  {entry.note && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{entry.note}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: entry.type === 'gelir' ? '#10b981' : entry.type === 'gider' ? '#ef4444' : 'var(--text-secondary)' }}>
                  {entry.type === 'gelir' ? <TrendingUp size={14} /> : entry.type === 'gider' ? <TrendingDown size={14} /> : null}
                  <span style={{ fontSize: '13px', fontWeight: 700 }}>{entry.amount.toLocaleString('tr-TR')} TL</span>
                </div>
                <button onClick={() => openEditForm(entry)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px' }}>
                  <Pencil size={13} />
                </button>
                <button onClick={() => onDeleteEntry(entry.id)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}>
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {subView === 'report' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {months.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12.5px' }}>Henüz rapor için yeterli veri yok.</div>
          )}
          {months.map(month => {
            const catTotals = monthlyReport[month];
            const rows = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
            const monthTotal = rows.reduce((sum, [key, amt]) => key.startsWith('gider:') ? sum + amt : sum, 0);
            return (
              <div key={month} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '10px' }}>{month}</div>
                {rows.map(([key, amt]) => {
                  const [type, category] = key.split(':');
                  const cat = categories.find(c => c.name === category);
                  const pct = monthTotal > 0 && type === 'gider' ? (amt / monthTotal) * 100 : 0;
                  return (
                    <div key={key} style={{ marginBottom: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: '3px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{TYPE_LABELS[type as FinanceEntryType]} · {category}</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{amt.toLocaleString('tr-TR')} TL</span>
                      </div>
                      {type === 'gider' && (
                        <div style={{ height: '5px', background: 'var(--bg-tertiary)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: cat?.color || 'var(--accent-color)' }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {subView === 'categories' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              type="text" placeholder="Yeni kategori adı" value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              style={{ flex: 1, minWidth: '160px', padding: '7px 10px', fontSize: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }}
            />
            <div style={{ display: 'flex', gap: '4px' }}>
              {PALETTE.map(c => (
                <button key={c} onClick={() => setNewCategoryColor(c)}
                  style={{ width: '20px', height: '20px', borderRadius: '50%', background: c, border: newCategoryColor === c ? '2px solid var(--text-primary)' : '2px solid transparent', cursor: 'pointer' }} />
              ))}
            </div>
            <button
              onClick={async () => { if (newCategoryName.trim()) { await onAddCategory(newCategoryName.trim(), newCategoryColor); setNewCategoryName(''); } }}
              style={{ padding: '7px 14px', background: 'var(--accent-color)', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}
            >
              Ekle
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {categories.map(cat => (
              <div key={cat.name} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: cat.color || '#94a3b8' }} />
                <span style={{ flex: 1, fontSize: '12.5px', color: 'var(--text-primary)' }}>{cat.name}</span>
                <button onClick={() => onDeleteCategory(cat.name)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {subView === 'import' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Notlarınızda bulunan eski etiketli harcama satırları aşağıda listelenir. İşaretleyip
            "Seçilenleri İçe Aktar" ile yeni Finans Kayıtları tablosuna taşıyabilirsiniz. Orijinal
            not satırları SİLİNMEZ/değiştirilmez — yalnızca kopyalanır, bu yüzden aynı satırı tekrar
            işaretleyip aktarmaya çalışırsanız engellenir (zaten aktarılmış sayılır).
          </div>
          {pendingImportCandidates.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12.5px' }}>
              İçe aktarılacak yeni bir kayıt bulunamadı.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setSelectedImportKeys(new Set(pendingImportCandidates.map(c => c.key)))}
                  style={{ padding: '5px 10px', fontSize: '11px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  Tümünü Seç
                </button>
                <button
                  onClick={async () => {
                    const selected = pendingImportCandidates.filter(c => selectedImportKeys.has(c.key));
                    await onImportLegacy(selected);
                    setSelectedImportKeys(new Set());
                  }}
                  disabled={selectedImportKeys.size === 0}
                  style={{ padding: '5px 14px', fontSize: '11px', fontWeight: 600, background: selectedImportKeys.size === 0 ? 'rgba(16,185,129,0.3)' : '#10b981', border: 'none', borderRadius: '4px', color: '#fff', cursor: selectedImportKeys.size === 0 ? 'not-allowed' : 'pointer' }}
                >
                  Seçilenleri İçe Aktar ({selectedImportKeys.size})
                </button>
              </div>
              {pendingImportCandidates.map(c => (
                <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedImportKeys.has(c.key)}
                    onChange={e => {
                      setSelectedImportKeys(prev => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.key); else next.delete(c.key);
                        return next;
                      });
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{c.description || '(açıklamasız)'}</div>
                    <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>{c.date} · {c.noteName} · {TYPE_LABELS[c.type]}</div>
                  </div>
                  <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{c.amount.toLocaleString('tr-TR')} TL</span>
                </label>
              ))}
            </>
          )}
        </div>
      )}

      {isFormOpen && (
        <div
          onClick={() => setIsFormOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '20px', width: '420px', maxWidth: '92vw', maxHeight: '86vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary)' }}>{editingId ? 'Kaydı Düzenle' : 'Yeni Finans Kaydı'}</h3>
              <button onClick={() => setIsFormOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={16} /></button>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: 'var(--text-secondary)' }}>Tarih</label>
                <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', fontSize: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: 'var(--text-secondary)' }}>Tip</label>
                <select value={formType} onChange={e => setFormType(e.target.value as FinanceEntryType)}
                  style={{ width: '100%', padding: '6px 8px', fontSize: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }}>
                  {(Object.keys(TYPE_LABELS) as FinanceEntryType[]).map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: 'var(--text-secondary)' }}>Kategori</label>
              <select value={formCategory} onChange={e => setFormCategory(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', fontSize: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }}>
                <option value="" disabled>Seçin...</option>
                {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: 'var(--text-secondary)' }}>Toplam Tutar (TL)</label>
              <input type="number" value={formAmount} onChange={e => setFormAmount(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', fontSize: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: 'var(--text-secondary)' }}>Kaynak (hesap/kart, opsiyonel)</label>
              <input type="text" value={formSource} onChange={e => setFormSource(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', fontSize: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }} />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', marginBottom: '6px', color: 'var(--text-secondary)', fontWeight: 'bold' }}>Alt Kalemler (opsiyonel)</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {formItems.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '6px' }}>
                    <input type="text" placeholder="Ürün adı" value={item.name}
                      onChange={e => setFormItems(prev => prev.map((it, i) => i === idx ? { ...it, name: e.target.value } : it))}
                      style={{ flex: 1, padding: '5px 8px', fontSize: '11.5px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }} />
                    <input type="number" value={item.price}
                      onChange={e => setFormItems(prev => prev.map((it, i) => i === idx ? { ...it, price: parseFloat(e.target.value) || 0 } : it))}
                      style={{ width: '70px', padding: '5px 8px', fontSize: '11.5px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }} />
                    <button onClick={() => setFormItems(prev => prev.filter((_, i) => i !== idx))}
                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}>✕</button>
                  </div>
                ))}
              </div>
              <button onClick={() => setFormItems(prev => [...prev, emptyItem()])}
                style={{ marginTop: '6px', padding: '5px 10px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer' }}>
                + Kalem Ekle
              </button>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: 'var(--text-secondary)' }}>Not (opsiyonel)</label>
              <input type="text" value={formNote} onChange={e => setFormNote(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', fontSize: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }} />
            </div>

            <button
              onClick={handleSubmitForm}
              disabled={!formCategory || !formAmount}
              style={{ marginTop: '4px', padding: '10px', background: (!formCategory || !formAmount) ? 'rgba(16,185,129,0.3)' : '#10b981', border: 'none', borderRadius: '6px', color: '#fff', fontWeight: 'bold', fontSize: '13px', cursor: (!formCategory || !formAmount) ? 'not-allowed' : 'pointer' }}
            >
              Kaydet
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinanceEntriesView;
