-- Run this once in your Supabase project's SQL editor (Dashboard -> SQL Editor -> New query).
--
-- Why: every app launch/resume ran a full reconciliation pass (re-reading and
-- re-hashing every local note's content, fetching all remote metadata) even when
-- reopening from the SAME device that performed the last successful sync — nothing
-- could have changed in between. This table records which device last completed a
-- full sync for a vault, so that device can skip straight to "synced" on its next
-- launch/resume instead of redoing the work.

create table if not exists public.sync_devices (
  vault text primary key,
  device_id text not null,
  synced_at timestamptz not null default now()
);

alter table public.sync_devices enable row level security;

-- Mirrors the permissive "allow all" policy used for `notes`/`folders` (this app has
-- no per-user auth — see the notes in 0001_create_folders_table.sql). Adjust if your
-- other tables' policies differ.
create policy "allow all for sync_devices" on public.sync_devices
  for all using (true) with check (true);
