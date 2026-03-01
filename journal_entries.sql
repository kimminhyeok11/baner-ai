-- Journal entries table and basic RLS

create extension if not exists pgcrypto;

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null default current_date,
  base_capital numeric(18,2),
  profit_amount numeric(18,2) not null default 0,
  profit_percent numeric(9,4),
  note text,
  strategy text,
  tags text,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.journal_entries enable row level security;

create index if not exists idx_journal_entries_user on public.journal_entries(user_id);
create index if not exists idx_journal_entries_public on public.journal_entries(is_public, created_at desc);

create policy "journal_entries_select_public"
  on public.journal_entries
  for select
  using (is_public = true or auth.uid() = user_id);

create policy "journal_entries_insert_own"
  on public.journal_entries
  for insert
  with check (auth.uid() = user_id);

create policy "journal_entries_update_own"
  on public.journal_entries
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "journal_entries_delete_own"
  on public.journal_entries
  for delete
  using (auth.uid() = user_id);

