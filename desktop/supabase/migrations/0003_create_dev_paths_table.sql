-- Run this once in your Supabase project's SQL editor (Dashboard -> SQL Editor -> New query).
--
-- Why: the "Gelişim Yolu" (development path / rank) feature lets a user mark any folder
-- as an independent skill path with its own rütbe (rank), replacing the old pet widget.
-- Unlike notes/folders, this data has no filesystem dimension (no create/rename/delete of
-- a real file) — it's a single small JSON blob per vault, so one row with a jsonb column
-- is enough (no need for the per-path multi-row/tombstone design used for folders).

create table if not exists public.dev_paths (
  vault text primary key,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.dev_paths enable row level security;

-- Mirrors the permissive "allow all" policy used for notes/folders/sync_devices (this app
-- has no per-user auth). Adjust if your other tables' policies differ.
create policy "allow all for dev_paths" on public.dev_paths
  for all using (true) with check (true);

alter publication supabase_realtime add table public.dev_paths;
