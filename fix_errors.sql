
-- Repair missing tables and columns causing 404/400 errors

-- 1. Fix 'post_impressions' 404 error
create table if not exists public.post_impressions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  post_id uuid references public.posts(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.post_impressions enable row level security;

-- Policies for post_impressions
drop policy if exists "Impressions insert by owner" on public.post_impressions;
create policy "Impressions insert by owner"
  on public.post_impressions for insert
  with check ( auth.uid() = user_id );

drop policy if exists "Impressions view by owner" on public.post_impressions;
create policy "Impressions view by owner"
  on public.post_impressions for select
  using ( auth.uid() = user_id );

-- Indexes for post_impressions
create index if not exists idx_post_impressions_user_post on public.post_impressions(user_id, post_id);
create index if not exists idx_post_impressions_post_created on public.post_impressions(post_id, created_at);


-- 2. Fix 'journal_entries' 400 error (likely missing is_public column or relationship issue)
create table if not exists public.journal_entries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  entry_date date not null,
  base_capital numeric(18,2) not null,
  profit_amount numeric(18,2) not null,
  profit_percent numeric(9,4) not null,
  note text,
  is_public boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Ensure is_public column exists
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'journal_entries' and column_name = 'is_public') then
    alter table public.journal_entries add column is_public boolean default false;
  end if;
end $$;

alter table public.journal_entries enable row level security;

-- Policies for journal_entries
drop policy if exists "Journal entries are viewable" on public.journal_entries;
create policy "Journal entries are viewable"
  on journal_entries for select
  using ( is_public = true or auth.uid() = user_id );

drop policy if exists "Users can insert journal" on public.journal_entries;
create policy "Users can insert journal"
  on journal_entries for insert
  with check ( auth.uid() = user_id );

drop policy if exists "Users can update own journal" on public.journal_entries;
create policy "Users can update own journal"
  on journal_entries for update
  using ( auth.uid() = user_id );

drop policy if exists "Users can delete own journal" on public.journal_entries;
create policy "Users can delete own journal"
  on journal_entries for delete
  using ( auth.uid() = user_id );

-- Indexes for journal_entries
create index if not exists idx_journal_user_date on public.journal_entries(user_id, entry_date);
create index if not exists idx_journal_public_created on public.journal_entries(is_public, created_at);

-- 3. Ensure other commonly missing tables
create table if not exists public.post_clicks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  post_id uuid references public.posts(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.post_clicks enable row level security;
drop policy if exists "Clicks insert by owner" on public.post_clicks;
create policy "Clicks insert by owner"
  on public.post_clicks for insert
  with check ( auth.uid() = user_id );
drop policy if exists "Clicks view by owner" on public.post_clicks;
create policy "Clicks view by owner"
  on public.post_clicks for select
  using ( auth.uid() = user_id );
