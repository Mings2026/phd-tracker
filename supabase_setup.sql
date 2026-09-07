-- PhD Tracker V1.3 - Supabase database setup
-- Run this entire script once in Supabase Dashboard > SQL Editor.

create table if not exists public.phd_tracker_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.phd_tracker_state enable row level security;

-- Least-privilege grants for the browser client.
revoke all on table public.phd_tracker_state from anon, authenticated;
grant select, insert, update, delete on table public.phd_tracker_state to authenticated;

-- Re-running this file is safe.
drop policy if exists "phd_tracker_select_own" on public.phd_tracker_state;
drop policy if exists "phd_tracker_insert_own" on public.phd_tracker_state;
drop policy if exists "phd_tracker_update_own" on public.phd_tracker_state;
drop policy if exists "phd_tracker_delete_own" on public.phd_tracker_state;

create policy "phd_tracker_select_own"
on public.phd_tracker_state
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "phd_tracker_insert_own"
on public.phd_tracker_state
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "phd_tracker_update_own"
on public.phd_tracker_state
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "phd_tracker_delete_own"
on public.phd_tracker_state
for delete
to authenticated
using ((select auth.uid()) = user_id);
