-- Run this once in your Supabase project's SQL editor (Dashboard -> SQL Editor -> New query).
--
-- Why: the "Görev Macerası" (time-management RPG) feature keeps a small "character sheet"
-- (gold, xp, inventory, world-state flags, AI-written weekly chronicles). Like dev_paths,
-- this data has no filesystem dimension — it's a single small JSON blob per vault, so one
-- row with a jsonb column is enough. Per-quest data (difficulty/estimate/outcome) lives
-- inline in the task's own markdown line as tags, NOT in this table.

create table if not exists public.quest_rpg (
  vault text primary key,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.quest_rpg enable row level security;

-- Mirrors the permissive "allow all" policy used for notes/folders/dev_paths (this app
-- has no per-user auth). Adjust if your other tables' policies differ.
create policy "allow all for quest_rpg" on public.quest_rpg
  for all using (true) with check (true);

alter publication supabase_realtime add table public.quest_rpg;
