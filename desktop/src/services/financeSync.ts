// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// Finans verisi (harcama/gelir/yatırım) önceden notlar içine gömülü serbest metin
// etiketleri olarak tutuluyordu (bkz. FinanceView.tsx'teki eski regex ayrıştırma) — bu,
// veriyi düzinelerce nota dağıtıyor, kategori/rapor desteğini zorlaştırıyordu. Bu dosya,
// finans verisini notlardan BAĞIMSIZ, gerçek satır-bazlı tablolarda (finance_entries,
// finance_categories) tutar — notlar/klasörler tablosuyla AYNI kanıtlanmış senkron
// desenini (her kayıt kendi satırı, tombstone'lu soft-delete, realtime abonelik) kullanır.
// dev_paths/quest_rpg'nin DÜŞTÜĞÜ "tek blob, tam üzerine yazma" tuzağına hiç girmez.

import { getSupabaseClient, getCurrentVault } from './supabaseSync';

export interface FinanceItem {
  name: string;
  price: number;
}

export type FinanceEntryType = 'gider' | 'gelir' | 'yatirim' | 'tasarruf';

export interface FinanceEntry {
  id: string;
  entryDate: string; // YYYY-MM-DD
  category: string;
  type: FinanceEntryType;
  amount: number;
  source: string | null;
  note: string | null;
  items: FinanceItem[];
  legacyNotePath: string | null;
  legacyLineIdx: number | null;
  updatedAt: string;
}

export interface FinanceCategory {
  name: string;
  color: string | null;
  updatedAt: string;
}

export const DEFAULT_FINANCE_CATEGORIES: { name: string; color: string }[] = [
  { name: 'Market', color: '#22c55e' },
  { name: 'Yemek', color: '#f97316' },
  { name: 'Fatura', color: '#3b82f6' },
  { name: 'Ulaşım', color: '#a855f7' },
  { name: 'Alınacaklar', color: '#eab308' },
  { name: 'Sağlık', color: '#ef4444' },
  { name: 'Eğlence', color: '#ec4899' },
  { name: 'Diğer', color: '#94a3b8' }
];

const rowToEntry = (row: any): FinanceEntry => ({
  id: row.id,
  entryDate: row.entry_date,
  category: row.category,
  type: row.type,
  amount: Number(row.amount),
  source: row.source,
  note: row.note,
  items: Array.isArray(row.items) ? row.items : [],
  legacyNotePath: row.legacy_note_path,
  legacyLineIdx: row.legacy_line_idx,
  updatedAt: row.updated_at
});

const rowToCategory = (row: any): FinanceCategory => ({
  name: row.name,
  color: row.color,
  updatedAt: row.updated_at
});

// Tam listeyi çeker (silinmemiş kayıtlar). Not senkronundaki gibi damga bazlı artımlı
// indirme YAPILMAZ çünkü finans verisi tipik olarak notların içeriğinden çok daha küçük —
// egress kaygısı burada notlardaki kadar kritik değil. Realtime abonelik (bkz. aşağı)
// zaten sonraki değişiklikleri tek tek, tam liste indirmeden taşır.
export const fetchAllFinanceEntries = async (): Promise<FinanceEntry[]> => {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('finance_entries')
      .select('*')
      .eq('vault', getCurrentVault())
      .eq('is_deleted', false)
      .order('entry_date', { ascending: false });
    if (error) throw error;
    return (data || []).map(rowToEntry);
  } catch (err) {
    console.warn('[Finance Sync] Kayıtlar çekilemedi (migrations/0006 çalıştırıldı mı?):', err);
    return [];
  }
};

export const fetchAllFinanceCategories = async (): Promise<FinanceCategory[]> => {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('finance_categories')
      .select('*')
      .eq('vault', getCurrentVault())
      .eq('is_deleted', false)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map(rowToCategory);
  } catch (err) {
    console.warn('[Finance Sync] Kategoriler çekilemedi (migrations/0006 çalıştırıldı mı?):', err);
    return [];
  }
};

export interface NewFinanceEntryInput {
  entryDate: string;
  category: string;
  type: FinanceEntryType;
  amount: number;
  source?: string | null;
  note?: string | null;
  items?: FinanceItem[];
  legacyNotePath?: string | null;
  legacyLineIdx?: number | null;
}

// Projede yazılan kodun ne için gerekli olduğunu açıklayan Türkçe yorum satırı (Kural 5):
// `id` isteğe bağlı olarak İSTEMCİ tarafından üretilip gönderilebilir (bkz. App.tsx'teki
// handleAddFinanceEntry) — bu sayede kayıt önce çevrimdışı/iyimser olarak yerel state'e
// (o id ile) eklenir, sonra bu fonksiyon AYNI id ile sunucuya yazar. İkisi hep aynı id'yi
// paylaştığı için sunucu cevabı beklenip yerel geçici kaydın "gerçek id"yle değiştirilmesine
// hiç gerek kalmaz — bağlantı yokken oluşturulan kayıt kalıcı olarak yerelde durur, sonraki
// bağlantıda (bkz. loadFinanceData) aynı id ile tekrar denenir, mükerrer kayıt oluşmaz.
export const createFinanceEntry = async (input: NewFinanceEntryInput & { id?: string }): Promise<FinanceEntry | null> => {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('finance_entries')
      .insert({
        ...(input.id ? { id: input.id } : {}),
        vault: getCurrentVault(),
        entry_date: input.entryDate,
        category: input.category,
        type: input.type,
        amount: input.amount,
        source: input.source || null,
        note: input.note || null,
        items: input.items || [],
        legacy_note_path: input.legacyNotePath || null,
        legacy_line_idx: input.legacyLineIdx ?? null
      })
      .select()
      .single();
    if (error) throw error;
    return rowToEntry(data);
  } catch (err) {
    console.error('[Finance Sync] Kayıt oluşturulamadı:', err);
    return null;
  }
};

export const updateFinanceEntry = async (id: string, patch: Partial<NewFinanceEntryInput>): Promise<FinanceEntry | null> => {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    const payload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (patch.entryDate !== undefined) payload.entry_date = patch.entryDate;
    if (patch.category !== undefined) payload.category = patch.category;
    if (patch.type !== undefined) payload.type = patch.type;
    if (patch.amount !== undefined) payload.amount = patch.amount;
    if (patch.source !== undefined) payload.source = patch.source;
    if (patch.note !== undefined) payload.note = patch.note;
    if (patch.items !== undefined) payload.items = patch.items;

    const { data, error } = await supabase
      .from('finance_entries')
      .update(payload)
      .eq('id', id)
      .eq('vault', getCurrentVault())
      .select()
      .single();
    if (error) throw error;
    return rowToEntry(data);
  } catch (err) {
    console.error('[Finance Sync] Kayıt güncellenemedi:', err);
    return null;
  }
};

export const deleteFinanceEntry = async (id: string): Promise<boolean> => {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('finance_entries')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('vault', getCurrentVault());
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Finance Sync] Kayıt silinemedi:', err);
    return false;
  }
};

// Kategori ekleme/güncelleme — (vault, name) birincil anahtar olduğu için upsert doğal
// olarak "aynı isimde kategori zaten varsa güncelle" davranışı verir (renk değiştirme dahil).
export const upsertFinanceCategory = async (name: string, color?: string | null): Promise<boolean> => {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('finance_categories')
      .upsert(
        { vault: getCurrentVault(), name, color: color || null, is_deleted: false, updated_at: new Date().toISOString() },
        { onConflict: 'vault,name' }
      );
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Finance Sync] Kategori eklenemedi:', err);
    return false;
  }
};

export const deleteFinanceCategory = async (name: string): Promise<boolean> => {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  try {
    const { error } = await supabase
      .from('finance_categories')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('vault', getCurrentVault())
      .eq('name', name);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Finance Sync] Kategori silinemedi:', err);
    return false;
  }
};

// Bir (not yolu, satır no) çiftinin daha önce içe aktarılıp aktarılmadığını kontrol eder —
// "Eski Verileri İçe Aktar" ekranının aynı satırı iki kez eklememesi için. finance_entries
// tablosundaki benzersiz kısmi indeks (bkz. migrations/0006) bunu veritabanı seviyesinde de
// garanti eder; bu fonksiyon yalnızca ARAYÜZDE "zaten aktarılmış" rozetini göstermek için.
export const fetchImportedLegacyKeys = async (): Promise<Set<string>> => {
  const supabase = getSupabaseClient();
  if (!supabase) return new Set();
  try {
    const { data, error } = await supabase
      .from('finance_entries')
      .select('legacy_note_path, legacy_line_idx')
      .eq('vault', getCurrentVault())
      .not('legacy_note_path', 'is', null);
    if (error) throw error;
    return new Set((data || []).map((r: any) => `${r.legacy_note_path}#${r.legacy_line_idx}`));
  } catch (err) {
    console.warn('[Finance Sync] İçe aktarılmış kayıtlar listelenemedi:', err);
    return new Set();
  }
};

let financeRealtimeChannel: any = null;

// Ayrı bir realtime kanalı: supabaseSync.ts'teki ana kanaldan (notes/folders/dev_paths/
// quest_rpg) bilerek AYRI tutulur — finans ekranı açık değilken bu aboneliğin hiç
// kurulmamasına izin verir (initFinanceRealtime yalnızca FinanceView bağlandığında çağrılır),
// ana senkron akışının karmaşıklığını artırmaz.
export const initFinanceRealtime = (
  onEntryChange: (entry: FinanceEntry, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => void,
  onCategoryChange: (category: FinanceCategory, eventType: 'INSERT' | 'UPDATE' | 'DELETE') => void
): (() => void) => {
  const supabase = getSupabaseClient();
  if (!supabase) return () => {};

  if (financeRealtimeChannel) {
    try { supabase.removeChannel(financeRealtimeChannel); } catch (e) { /* yoksay */ }
    financeRealtimeChannel = null;
  }

  financeRealtimeChannel = supabase
    .channel('realtime-finance-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'finance_entries', filter: `vault=eq.${getCurrentVault()}` },
      (payload: any) => {
        const rec = payload.new || payload.old;
        if (!rec) return;
        onEntryChange(rowToEntry(rec), payload.eventType);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'finance_categories', filter: `vault=eq.${getCurrentVault()}` },
      (payload: any) => {
        const rec = payload.new || payload.old;
        if (!rec) return;
        onCategoryChange(rowToCategory(rec), payload.eventType);
      }
    )
    .subscribe();

  return () => {
    if (financeRealtimeChannel && supabase) {
      try { supabase.removeChannel(financeRealtimeChannel); } catch (e) { /* yoksay */ }
      financeRealtimeChannel = null;
    }
  };
};
