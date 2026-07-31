-- Run this once in your Supabase project's SQL editor (Dashboard -> SQL Editor -> New query).
--
-- Neden: `notes` tablosu, projedeki diğer tüm senkron tablolarının (folders, sync_devices,
-- dev_paths, quest_rpg, finance_entries) aksine RLS'siz kalmıştı — muhtemelen bu tablo,
-- "RLS aç + hepsine izin ver policy'si ekle" deseni oturmadan önce, en başta oluşturulduğu
-- için. Uygulamanın per-user auth'u yok (istemci hiçbir zaman supabase.auth.signIn
-- çağırmıyor, sadece anon key kullanılıyor; "vault" sütunu gerçek bir Postgres/auth sınırı
-- değil, sadece uygulama seviyesinde bir isim alanı) — bu yüzden anlamlı tek policy zaten
-- "hepsine izin ver". RLS'i policy'siz açmak (ör. dashboard'daki "Enable RLS" butonuna
-- tek başına basmak) anon key ile HER ŞEYİ reddeder ve senkronu anında kırar; bu migration
-- diğer tablolarla aynı, erişimi eskisi gibi açık bırakan policy'yi ekler.

alter table public.notes enable row level security;

create policy "allow all for notes" on public.notes
  for all using (true) with check (true);
