-- Run this once in your Supabase project's SQL editor (Dashboard -> SQL Editor -> New query).
--
-- KÖK SEBEP: "Gelişim Yolları" (dev_paths) ve "Dakiklik Pusulası" (quest_rpg) daha önce
-- istemci tarafında oku-değiştir-tamamen-üzerine-yaz (upsert) deseniyle senkronlanıyordu —
-- her cihaz kendi TÜM yerel kopyasını (developmentPaths haritasının tamamı / punctuality
-- skorunun tamamı) sunucuya yolluyordu. İki cihaz aynı pencerede farklı şeyler değiştirip
-- yüklerse, ikincisi sunucuya yazan, birincisinin değişikliğini tamamen SİLİYORDU (birincinin
-- yolladığı satırı hiç görmeden kendi eski kopyasını üzerine basıyordu) — klasik "lost update"
-- yarış durumu. Bu, "bir cihazda değiştiriyorum, başka cihazda eski hali / üçüncü cihazda
-- bambaşka bir hali var" şikayetinin doğrudan sebebi.
--
-- ÇÖZÜM: İstemciler artık kendi TAM kopyalarını yazmıyor; yalnızca DEĞİŞEN parçayı
-- (tek bir gelişim yolu anahtarı, ya da tek bir dakiklik olayının puanı) sunucuya bildirir.
-- Birleştirme/toplama işlemi PostgreSQL içinde, TEK bir atomik ifadeyle yapılır — bu yüzden
-- iki cihaz aynı anda yazsa bile ikisinin de değişikliği korunur (veritabanı sıraya koyar,
-- hiçbiri diğerini görmeden üzerine yazamaz).

-- ============================================================================
-- 1. GELİŞİM YOLLARI: tek-anahtar atomik JSONB birleştirme
-- ============================================================================
-- data sütunu {"<klasör-yolu>": {...DevPath...}, ...} şeklinde bir harita. Önceden istemci
-- bu haritanın TAMAMINI yeniden yazıyordu. Artık yalnızca DEĞİŞEN <klasör-yolu> anahtarını
-- gönderiyor; `||` (jsonb birleştirme) operatörü sadece o anahtarı ekler/değiştirir, diğer
-- anahtarlara (başka cihazların az önce yazmış olabileceği) dokunmaz.
create or replace function public.merge_dev_path(p_vault text, p_path text, p_data jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.dev_paths (vault, data, updated_at)
  values (p_vault, jsonb_build_object(p_path, p_data), now())
  on conflict (vault) do update
  set data = public.dev_paths.data || jsonb_build_object(p_path, p_data),
      updated_at = now();
$$;

-- Kullanıcı bir klasörü gelişim yolu olmaktan çıkardığında (unmark) çağrılır — jsonb `-`
-- operatörü tek bir anahtarı, geri kalanına dokunmadan kaldırır.
create or replace function public.delete_dev_path(p_vault text, p_path text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.dev_paths
  set data = data - p_path, updated_at = now()
  where vault = p_vault;
$$;

grant execute on function public.merge_dev_path(text, text, jsonb) to anon, authenticated;
grant execute on function public.delete_dev_path(text, text) to anon, authenticated;

-- ============================================================================
-- 2. DAKİKLİK PUSULASI: tek-olay atomik EMA güncellemesi
-- ============================================================================
-- Önceden istemci, kendi yerel hareketli-ortalama (EMA) skorunun SONUCUNU hesaplayıp
-- tamamını sunucuya yazıyordu — iki cihaz farklı görevleri yaklaşık aynı anda tamamlarsa,
-- ikinci yazan birincinin katkısını hiç görmeden kendi (o katkıdan habersiz) skorunu
-- basıyordu. Artık istemci yalnızca "az önce olan olayın puanını" (outcome_score) gönderir;
-- EMA hesaplaması satır kilidiyle (FOR UPDATE) TEK bir veritabanı işleminde yapılır — iki
-- cihaz aynı anda çağırsa bile PostgreSQL bunları sıraya koyar, ikisi de skora yansır.
create or replace function public.nudge_punctuality_score(
  p_vault text,
  p_outcome_score numeric,
  p_alpha numeric default 0.12
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  old_score numeric;
  new_score numeric;
begin
  insert into public.quest_rpg (vault, data, updated_at)
  values (p_vault, jsonb_build_object('score', 50, 'updatedAt', now()), now())
  on conflict (vault) do nothing;

  select coalesce((data->>'score')::numeric, 50) into old_score
  from public.quest_rpg
  where vault = p_vault
  for update;

  new_score := round((old_score * (1 - p_alpha) + p_outcome_score * p_alpha) * 10) / 10;
  new_score := greatest(0, least(100, new_score));

  update public.quest_rpg
  set data = jsonb_build_object('score', new_score, 'updatedAt', now()),
      updated_at = now()
  where vault = p_vault;

  return new_score;
end;
$$;

grant execute on function public.nudge_punctuality_score(text, numeric, numeric) to anon, authenticated;
