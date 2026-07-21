-- Run this once in your Supabase project's SQL editor (Dashboard -> SQL Editor -> New query).
--
-- Why: folders were never a synced entity — only the `notes` table existed, keyed by
-- path. Folders were inferred purely from each device's own local file listing, so an
-- empty folder created on one device never reached another, renames only rewrote child
-- notes' paths (never the folder itself), and two devices could independently diverge
-- on the same folder's nesting. This table makes folders sync the same way notes do.

create table if not exists public.folders (
  vault text not null,
  path text not null,
  is_deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (vault, path)
);

alter table public.folders enable row level security;

-- NOTE: this app has no per-user auth (the client never calls supabase.auth.signIn —
-- the "vault" column is an app-level namespace, not a Postgres-auth boundary), so the
-- existing `notes` table's RLS policy is almost certainly a permissive "allow all"
-- policy using the anon key. This mirrors that. If your `notes` table's policy is
-- different, edit this to match it instead of using the one below as-is.
create policy "allow all for folders" on public.folders
  for all using (true) with check (true);

-- Realtime: the app subscribes to postgres_changes on this table. If your project
-- doesn't already have every table auto-added to the `supabase_realtime` publication,
-- run this too (safe to run even if already added):
alter publication supabase_realtime add table public.folders;
