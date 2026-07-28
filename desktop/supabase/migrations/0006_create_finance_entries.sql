-- Run this once in your Supabase project's SQL editor (Dashboard -> SQL Editor -> New query).
--
-- Neden: Finans verisi (harcama/gelir/yatırım) önceden notlar içine gömülü serbest metin
-- etiketleri ([harcama: 150 TL] gibi) olarak tutuluyordu — bu, veriyi düzinelerce farklı
-- nota dağıtıyor, kategori/rapor/filtreleme desteğini zorlaştırıyordu. Bu migration, finans
-- verisini notlardan BAĞIMSIZ, gerçek tablo yapısına taşır: her kayıt kendi satırı, her
-- kategori kendi satırı — notlar/klasörler tablosuyla AYNI kanıtlanmış senkron desenini
-- (satır-bazlı, tombstone'lu soft-delete) kullanır.

-- ============================================================================
-- 1. KATEGORİLER — kullanıcı tanımlı, vault başına serbestçe eklenip kaldırılabilir
-- ============================================================================
create table if not exists public.finance_categories (
  vault text not null,
  name text not null,
  color text,
  is_deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (vault, name)
);

alter table public.finance_categories enable row level security;
create policy "allow all for finance_categories" on public.finance_categories
  for all using (true) with check (true);
alter publication supabase_realtime add table public.finance_categories;

-- ============================================================================
-- 2. FİNANS KAYITLARI — tek kayıt = tarih + kategori + tutar + (opsiyonel) alt kalemler
-- ============================================================================
create table if not exists public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  vault text not null,
  entry_date date not null,
  category text not null,
  type text not null check (type in ('gider', 'gelir', 'yatirim', 'tasarruf')),
  amount numeric not null,
  source text,               -- hangi hesap/kart (kaynak) — serbest metin, notlardaki [kaynak:] ile aynı fikir
  note text,                 -- serbest açıklama
  items jsonb not null default '[]', -- alt kalemler: [{"name": "...", "price": 0}, ...]
  -- Eski (not içi etiket) bir kayıttan içe aktarıldıysa, tekrar aktarılmasını (mükerrer
  -- kayıt) önlemek için kaynağını işaretler. Kullanıcının kendi eklediği kayıtlarda null.
  legacy_note_path text,
  legacy_line_idx int,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_entries_vault_date_idx
  on public.finance_entries (vault, entry_date);

-- Aynı not+satırın iki kez içe aktarılmasını veritabanı seviyesinde de engeller
-- (uygulama tarafındaki kontrolün yanında ikinci bir güvenlik katmanı).
create unique index if not exists finance_entries_legacy_unique_idx
  on public.finance_entries (vault, legacy_note_path, legacy_line_idx)
  where legacy_note_path is not null;

alter table public.finance_entries enable row level security;
create policy "allow all for finance_entries" on public.finance_entries
  for all using (true) with check (true);
alter publication supabase_realtime add table public.finance_entries;
