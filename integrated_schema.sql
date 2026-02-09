-- 통합된 데이터베이스 스키마 (Integrated Database Schema)
-- 기존의 migration_full.sql, migration_messages.sql, fix_relationships.sql을 통합하고 최적화했습니다.

-- auth.users와 1:1 관계를 가집니다.
create table if not exists public.profiles (
  id uuid references auth.users not null primary key,
  nickname text,
  role text default 'user', -- 'user' or 'admin' (운영 관리를 위해 추가)
  post_count int default 0,
  comment_count int default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.profiles enable row level security;

drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
create policy "Public profiles are viewable by everyone"
  on profiles for select
  using ( true );
 
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on profiles for update
  using ( auth.uid() = id );

-- Trigger to create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, '문도_' || substr(new.id::text, 1, 6));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill profiles for existing auth.users without profiles
do $$
begin
  insert into public.profiles (id, nickname)
  select u.id, '문도_' || substr(u.id::text, 1, 6)
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null;
end $$;

create table if not exists public.stock_tags (
  id uuid default gen_random_uuid() primary key,
  name text unique not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.stock_tags enable row level security;

drop policy if exists "Stock tags are viewable by everyone" on public.stock_tags;
create policy "Stock tags are viewable by everyone"
  on stock_tags for select
  using ( true );

drop policy if exists "Authenticated users can insert stock tags" on public.stock_tags;
create policy "Authenticated users can insert stock tags"
  on stock_tags for insert
  with check ( auth.role() = 'authenticated' );


-- profiles 테이블을 참조하도록 수정됨 (JOIN 최적화)
create table if not exists public.posts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade, -- auth.users 대신 profiles 참조
  guest_nickname text, -- For anonymous posts
  title text not null,
  content text not null,
  type text not null, -- 'public', 'stock', 'secret'
  stock_id text, -- Stores stock name if type is 'stock'
  mugong_id text, -- 'sword', 'dao', 'auto'
  view_count int default 0,
  like_count int default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.posts enable row level security;

drop policy if exists "Posts are viewable by everyone" on public.posts;
create policy "Posts are viewable by everyone"
  on posts for select
  using ( true );

drop policy if exists "Users can insert posts" on public.posts;
create policy "Users can insert posts"
  on posts for insert
  with check ( true ); 

drop policy if exists "Users can update own posts" on public.posts;
create policy "Users can update own posts"
  on posts for update
  using ( auth.uid() = user_id );

drop policy if exists "Users can delete own posts" on public.posts;
create policy "Users can delete own posts"
  on posts for delete
  using ( auth.uid() = user_id );


create table if not exists public.comments (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.posts on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade, -- profiles 참조
  guest_nickname text,
  guest_device_id text,
  content text not null,
  parent_id uuid references public.comments, -- For nested comments
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.comments enable row level security;

create or replace function public.can_insert_comment(p_user_id uuid, p_guest_device_id text)
returns boolean as $$
declare
  cnt integer;
begin
  if p_user_id is not null then
    return true;
  end if;
  if p_guest_device_id is null then
    return false;
  end if;
  select count(*) into cnt
  from public.comments
  where user_id is null
    and guest_device_id = p_guest_device_id
    and created_at::date = timezone('utc', now())::date;
  return cnt < 10;
end;
$$ language plpgsql stable;

-- Ensure guest_device_id column exists (for older deployments)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'comments'
      and column_name = 'guest_device_id'
  ) then
    alter table public.comments add column guest_device_id text;
  end if;
end $$;

drop policy if exists "Comments are viewable by everyone" on public.comments;
create policy "Comments are viewable by everyone"
  on comments for select
  using ( true );

drop policy if exists "Users can insert comments" on public.comments;
create policy "Users can insert comments"
  on comments for insert
  with check ( public.can_insert_comment(user_id, guest_device_id) );


create table if not exists public.chat_messages (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade, -- profiles 참조
  guest_nickname text,
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.chat_messages enable row level security;

drop policy if exists "Chat is viewable by everyone" on public.chat_messages;
create policy "Chat is viewable by everyone"
  on chat_messages for select
  using ( true );

drop policy if exists "Everyone can insert chat" on public.chat_messages;
create policy "Everyone can insert chat"
  on chat_messages for insert
  with check ( true );


create table if not exists public.messages (
  id uuid default gen_random_uuid() primary key,
  sender_id uuid references public.profiles(id) on delete cascade not null, -- profiles 참조
  receiver_id uuid references public.profiles(id) on delete cascade not null, -- profiles 참조
  content text not null,
  is_read boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.messages enable row level security;

drop policy if exists "Users can view their own messages" on public.messages;
create policy "Users can view their own messages"
  on messages for select
  using ( auth.uid() = sender_id or auth.uid() = receiver_id );

drop policy if exists "Users can send messages" on public.messages;
create policy "Users can send messages"
  on messages for insert
  with check ( auth.uid() = sender_id );

drop policy if exists "Receivers can update read status" on public.messages;
create policy "Receivers can update read status"
  on messages for update
  using ( auth.uid() = receiver_id );


-- 7. Realtime Setup (Supabase Realtime 활성화)
-- 모든 주요 테이블에 대해 실시간 구독을 활성화합니다.
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;

alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.stock_tags;


-- 8. Storage Policies (Standard Template)
-- 'images' 버킷이 존재해야 합니다.
drop policy if exists "Public Access" on storage.objects;
create policy "Public Access"
  on storage.objects for select
  using ( bucket_id = 'images' );

drop policy if exists "Authenticated Upload" on storage.objects;
create policy "Authenticated Upload"
  on storage.objects for insert
  with check ( bucket_id = 'images' and auth.role() = 'authenticated' );

do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'role') then
    alter table public.profiles add column role text default 'user';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'is_banned') then
    alter table public.profiles add column is_banned boolean default false;
  end if;
end $$;

create table if not exists public.post_likes (
  user_id uuid references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (user_id, post_id)
);
alter table public.post_likes enable row level security;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'avatar_url') then
    alter table public.profiles add column avatar_url text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'banner_url') then
    alter table public.profiles add column banner_url text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'receive_comment_noti') then
    alter table public.profiles add column receive_comment_noti boolean default true;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'receive_like_noti') then
    alter table public.profiles add column receive_like_noti boolean default true;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'receive_message_noti') then
    alter table public.profiles add column receive_message_noti boolean default true;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'badge_style') then
    alter table public.profiles add column badge_style text default 'auto';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'badge_icon') then
    alter table public.profiles add column badge_icon text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'theme_style') then
    alter table public.profiles add column theme_style text default 'dark';
  end if;
end $$;

drop policy if exists "Likes are viewable by everyone" on public.post_likes;
create policy "Likes are viewable by everyone"
  on post_likes for select
  using ( true );

drop policy if exists "Users can toggle own likes" on public.post_likes;
create policy "Users can toggle own likes"
  on post_likes for insert
  with check ( auth.uid() = user_id );

drop policy if exists "Users can remove own likes" on public.post_likes;
create policy "Users can remove own likes"
  on post_likes for delete
  using ( auth.uid() = user_id );

create or replace function public.handle_like_count()
returns trigger as $$
begin
  if (TG_OP = 'INSERT') then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
  elsif (TG_OP = 'DELETE') then
    update public.posts set like_count = greatest(0, like_count - 1) where id = old.post_id;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists on_post_like_change on public.post_likes;
create trigger on_post_like_change
  after insert or delete on public.post_likes
  for each row execute procedure public.handle_like_count();

create table if not exists public.reports (
  id uuid default gen_random_uuid() primary key,
  reporter_id uuid references public.profiles(id),
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  status text default 'pending',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.reports enable row level security;
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'reports'
      and column_name = 'status'
  ) then
    alter table public.reports add column status text default 'pending';
  end if;
end $$;

drop policy if exists "Admins can view reports" on public.reports;
create policy "Admins can view reports"
  on reports for select
  using ( auth.uid() in (select id from public.profiles where role = 'admin') );

drop policy if exists "Users can create reports" on public.reports;
create policy "Users can create reports"
  on reports for insert
  with check ( auth.role() = 'authenticated' );
  
drop policy if exists "Admins can update reports" on public.reports;
create policy "Admins can update reports"
  on reports for update
  using ( auth.uid() in (select id from public.profiles where role = 'admin') );

create table if not exists public.notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  type text not null,
  content text not null,
  is_read boolean default false,
  link text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.notifications enable row level security;

drop policy if exists "Users can view own notifications" on public.notifications;
create policy "Users can view own notifications"
  on notifications for select
  using ( auth.uid() = user_id );

drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications"
  on notifications for update
  using ( auth.uid() = user_id );
  
drop policy if exists "Users can delete own notifications" on public.notifications;
create policy "Users can delete own notifications"
  on notifications for delete
  using ( auth.uid() = user_id );
  
drop policy if exists "Admins can insert notifications" on public.notifications;
create policy "Admins can insert notifications"
  on notifications for insert
  with check ( auth.uid() in (select id from public.profiles where role = 'admin') );

create or replace function public.handle_new_comment()
returns trigger as $$
declare
  post_author_id uuid;
  post_title text;
  allow boolean;
begin
  select user_id, title into post_author_id, post_title from public.posts where id = new.post_id;
  select coalesce(receive_comment_noti, true) into allow from public.profiles where id = post_author_id;
  if post_author_id is not null and post_author_id != new.user_id and coalesce(allow, true) = true then
    insert into public.notifications (user_id, type, content, link)
    values (post_author_id, 'comment', '새로운 댓글이 달렸습니다: ' || coalesce(new.content, '내용 없음'), 'post:' || new.post_id);
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_comment_created on public.comments;
create trigger on_comment_created
  after insert on public.comments
  for each row execute procedure public.handle_new_comment();
  
drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
  on public.profiles for update
  using ( auth.uid() in (select id from public.profiles where role = 'admin') );

drop policy if exists "Admins can delete any post" on public.posts;
create policy "Admins can delete any post"
  on public.posts for delete
  using ( auth.uid() in (select id from public.profiles where role = 'admin') );

drop policy if exists "Users can delete own post" on public.posts;
create policy "Users can delete own post"
  on public.posts for delete
  using ( auth.uid() = user_id );

drop policy if exists "Admins can delete any comment" on public.comments;
create policy "Admins can delete any comment"
  on public.comments for delete
  using ( auth.uid() in (select id from public.profiles where role = 'admin') );

drop policy if exists "Users can delete own comment" on public.comments;
create policy "Users can delete own comment"
  on public.comments for delete
  using ( auth.uid() = user_id );

drop function if exists public.delete_guest_comment(uuid, text);
create or replace function public.delete_guest_comment(p_comment_id uuid, p_device_id text)
returns void as $$
begin
  delete from public.comments
  where id = p_comment_id
    and user_id is null
    and guest_device_id = p_device_id;
end;
$$ language plpgsql security definer;
create or replace function public.handle_new_like()
returns trigger as $$
declare
  post_author_id uuid;
  allow boolean;
begin
  select user_id into post_author_id from public.posts where id = new.post_id;
  select coalesce(receive_like_noti, true) into allow from public.profiles where id = post_author_id;
  if post_author_id is not null and post_author_id != new.user_id and coalesce(allow, true) = true then
    insert into public.notifications (user_id, type, content, link)
    values (post_author_id, 'like', '누군가 당신의 비급을 추천했습니다.', 'post:' || new.post_id);
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_post_liked on public.post_likes;
create trigger on_post_liked
  after insert on public.post_likes
  for each row execute procedure public.handle_new_like();

create or replace function public.handle_new_message()
returns trigger as $$
declare
  allow boolean;
begin
  select coalesce(receive_message_noti, true) into allow from public.profiles where id = new.receiver_id;
  if coalesce(allow, true) = true then
    insert into public.notifications (user_id, type, content, link)
    values (new.receiver_id, 'message', '새로운 쪽지가 도착했습니다.', 'message:' || new.id);
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_message_created on public.messages;
create trigger on_message_created
  after insert on public.messages
  for each row execute procedure public.handle_new_message();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'post_likes') then
    alter publication supabase_realtime add table public.post_likes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

create table if not exists public.user_relationships (
  user_id uuid references public.profiles(id) on delete cascade,
  target_id uuid references public.profiles(id) on delete cascade,
  type text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (user_id, target_id, type)
);
alter table public.user_relationships enable row level security;

drop policy if exists "Relationships are viewable by everyone" on public.user_relationships;
create policy "Relationships are viewable by everyone"
  on public.user_relationships for select
  using ( true );

drop policy if exists "Users can insert own relationships" on public.user_relationships;
create policy "Users can insert own relationships"
  on public.user_relationships for insert
  with check ( auth.uid() = user_id );

drop policy if exists "Users can delete own relationships" on public.user_relationships;
create policy "Users can delete own relationships"
  on public.user_relationships for delete
  using ( auth.uid() = user_id );

alter table public.posts alter column user_id drop not null;
drop policy if exists "Users can insert posts" on public.posts;
drop policy if exists "Everyone can insert posts" on public.posts;
drop policy if exists "Authenticated users can insert posts" on public.posts;
create policy "Allow posting based on auth status"
  on public.posts for insert
  with check (
    auth.role() = 'authenticated' OR
    (type = 'secret')
  );

create table if not exists public.guild_memberships (
  user_id uuid references public.profiles(id) on delete cascade,
  stock_id text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (user_id, stock_id)
);
alter table public.guild_memberships enable row level security;
create policy "Guild memberships are viewable by everyone"
  on public.guild_memberships for select
  using ( true );
create policy "Users can insert own guild membership"
  on public.guild_memberships for insert
  with check ( auth.uid() = user_id );
create policy "Users can delete own guild membership"
  on public.guild_memberships for delete
  using ( auth.uid() = user_id );
create index if not exists idx_guild_memberships_stock on public.guild_memberships(stock_id);

create table if not exists public.predictions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  stock_id text not null,
  direction text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.predictions enable row level security;
create policy "Predictions are viewable by everyone"
  on public.predictions for select
  using ( true );
create policy "Users can insert predictions"
  on public.predictions for insert
  with check ( auth.role() = 'authenticated' );
create policy "Users can update own predictions"
  on public.predictions for update
  using ( auth.uid() = user_id );
create policy "Users can delete own predictions"
  on public.predictions for delete
  using ( auth.uid() = user_id );
create index if not exists idx_predictions_created on public.predictions(created_at);
create index if not exists idx_predictions_stock_dir on public.predictions(stock_id, direction);
create unique index if not exists uniq_predictions_user_stock_month 
  on public.predictions (user_id, stock_id, date_trunc('month', created_at));
create index if not exists idx_posts_type_created on public.posts(type, created_at);
create index if not exists idx_posts_stock_created on public.posts(type, stock_id, created_at);
create index if not exists idx_posts_stock_like on public.posts(type, stock_id, like_count);
create index if not exists idx_comments_post_created on public.comments(post_id, created_at);
create index if not exists idx_comments_user_created on public.comments(user_id, created_at);
create index if not exists idx_post_likes_user_created on public.post_likes(user_id, created_at);
create index if not exists idx_post_likes_post_created on public.post_likes(post_id, created_at);
create index if not exists idx_notifications_user_created on public.notifications(user_id, created_at);
create index if not exists idx_notifications_user_type_created on public.notifications(user_id, type, created_at);
create index if not exists idx_messages_receiver_created on public.messages(receiver_id, created_at);
create index if not exists idx_messages_sender_created on public.messages(sender_id, created_at);

create extension if not exists pg_trgm;
create index if not exists idx_posts_title_trgm on public.posts using gin (title gin_trgm_ops);
create index if not exists idx_posts_content_trgm on public.posts using gin (content gin_trgm_ops);
create index if not exists idx_posts_like_created on public.posts(like_count, created_at);
create index if not exists idx_notifications_user_isread on public.notifications(user_id, is_read);
create index if not exists idx_messages_receiver_isread on public.messages(receiver_id, is_read);
create index if not exists idx_user_relationships_user_type on public.user_relationships(user_id, type);
create index if not exists idx_user_relationships_target_type on public.user_relationships(target_id, type);

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
alter table public.journal_entries enable row level security;
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
create index if not exists idx_journal_user_date on public.journal_entries(user_id, entry_date);
create index if not exists idx_journal_public_created on public.journal_entries(is_public, created_at);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'journal_entries' and column_name = 'strategy'
  ) then
    alter table public.journal_entries add column strategy text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'journal_entries' and column_name = 'tags'
  ) then
    alter table public.journal_entries add column tags text;
  end if;
end $$;
create index if not exists idx_journal_public_strategy on public.journal_entries(is_public, strategy);
create index if not exists idx_journal_public_tags on public.journal_entries using gin (tags gin_trgm_ops);

alter view if exists public.predictions_monthly set (security_invoker = true);

create table if not exists public.post_impressions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  post_id uuid references public.posts(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.post_impressions enable row level security;
drop policy if exists "Impressions insert by owner" on public.post_impressions;
create policy "Impressions insert by owner"
  on public.post_impressions for insert
  with check ( auth.uid() = user_id );
drop policy if exists "Impressions view by owner" on public.post_impressions;
create policy "Impressions view by owner"
  on public.post_impressions for select
  using ( auth.uid() = user_id );
create index if not exists idx_post_impressions_user_post on public.post_impressions(user_id, post_id);
create index if not exists idx_post_impressions_post_created on public.post_impressions(post_id, created_at);

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
create index if not exists idx_post_clicks_user_post on public.post_clicks(user_id, post_id);
create index if not exists idx_post_clicks_post_created on public.post_clicks(post_id, created_at);

create index if not exists idx_posts_user_created on public.posts(user_id, created_at);
create index if not exists idx_posts_content_trgm on public.posts using gin (content gin_trgm_ops);

create table if not exists public.sponsor_slots (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  label text,
  link_url text not null,
  image_url text,
  priority integer default 0,
  active boolean default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.sponsor_slots enable row level security;
drop policy if exists "Sponsors public view" on public.sponsor_slots;
create policy "Sponsors public view"
  on public.sponsor_slots for select
  using ( active = true );
create index if not exists idx_sponsors_active_priority on public.sponsor_slots(active, priority desc, created_at desc);

create table if not exists public.materials (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  preview text,
  price integer not null default 0,
  is_active boolean default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.materials enable row level security;
drop policy if exists "Materials list view" on public.materials;
create policy "Materials list view"
  on public.materials for select
  using ( is_active = true );
drop policy if exists "Materials insert by owner" on public.materials;
create policy "Materials insert by owner"
  on public.materials for insert
  with check ( auth.uid() = user_id );
drop policy if exists "Materials update by owner" on public.materials;
create policy "Materials update by owner"
  on public.materials for update
  using ( auth.uid() = user_id );
drop policy if exists "Materials delete by owner" on public.materials;
create policy "Materials delete by owner"
  on public.materials for delete
  using ( auth.uid() = user_id );
create index if not exists idx_materials_active_created on public.materials(is_active, created_at);

create table if not exists public.material_contents (
  material_id uuid references public.materials(id) on delete cascade primary key,
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.material_contents enable row level security;
drop policy if exists "Material contents owner view" on public.material_contents;
create policy "Material contents owner view"
  on public.material_contents for select
  using ( exists (select 1 from public.materials m where m.id = material_id and m.user_id = auth.uid()) );
drop policy if exists "Material contents buyers view" on public.material_contents;
create policy "Material contents buyers view"
  on public.material_contents for select
  using ( exists (select 1 from public.material_purchases p where p.material_id = material_id and p.user_id = auth.uid() and p.status = 'paid') );
drop policy if exists "Material contents insert by owner" on public.material_contents;
create policy "Material contents insert by owner"
  on public.material_contents for insert
  with check ( exists (select 1 from public.materials m where m.id = material_id and m.user_id = auth.uid()) );
drop policy if exists "Material contents update by owner" on public.material_contents;
create policy "Material contents update by owner"
  on public.material_contents for update
  using ( exists (select 1 from public.materials m where m.id = material_id and m.user_id = auth.uid()) );

create table if not exists public.material_purchases (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  material_id uuid references public.materials(id) on delete cascade not null,
  status text not null default 'paid',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.material_purchases enable row level security;
drop policy if exists "Material purchases insert by owner" on public.material_purchases;
create policy "Material purchases insert by owner"
  on public.material_purchases for insert
  with check ( auth.uid() = user_id );
drop policy if exists "Material purchases view by owner" on public.material_purchases;
create policy "Material purchases view by owner"
  on public.material_purchases for select
  using ( auth.uid() = user_id );
create unique index if not exists uniq_material_purchase on public.material_purchases(user_id, material_id);

create table if not exists public.deposit_requests (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  material_id uuid references public.materials(id) on delete cascade not null,
  depositor_name text not null,
  amount integer not null,
  memo text,
  status text not null default 'requested',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  confirmed_at timestamp with time zone,
  confirmed_by uuid references public.profiles(id)
);
alter table public.deposit_requests enable row level security;
drop policy if exists "Deposit requests view by owner" on public.deposit_requests;
create policy "Deposit requests view by owner"
  on public.deposit_requests for select
  using ( auth.uid() = user_id );
drop policy if exists "Deposit requests insert by owner" on public.deposit_requests;
create policy "Deposit requests insert by owner"
  on public.deposit_requests for insert
  with check ( auth.uid() = user_id );
drop policy if exists "Deposit requests admin view" on public.deposit_requests;
create policy "Deposit requests admin view"
  on public.deposit_requests for select
  using ( auth.uid() in (select id from public.profiles where role = 'admin') );
drop policy if exists "Deposit requests admin update" on public.deposit_requests;
create policy "Deposit requests admin update"
  on public.deposit_requests for update
  using ( auth.uid() in (select id from public.profiles where role = 'admin') );
create index if not exists idx_deposit_status_created on public.deposit_requests(status, created_at);
create index if not exists idx_deposit_user_created on public.deposit_requests(user_id, created_at);
create index if not exists idx_deposit_material on public.deposit_requests(material_id);

create or replace function public.handle_deposit_confirm()
returns trigger as $$
begin
  if TG_OP = 'UPDATE' and new.status = 'confirmed' and (old.status is distinct from 'confirmed') then
    if not exists (
      select 1 from public.material_purchases mp
      where mp.user_id = new.user_id and mp.material_id = new.material_id
    ) then
      insert into public.material_purchases (user_id, material_id, status)
      values (new.user_id, new.material_id, 'paid');
    end if;
    if new.confirmed_at is null then
      new.confirmed_at = timezone('utc'::text, now());
    end if;
    insert into public.notifications (user_id, type, content, link)
    values (new.user_id, 'purchase', '입금 확인되었습니다. 강의 자료 열람이 가능합니다.', 'material:' || new.material_id);
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_deposit_confirm on public.deposit_requests;
create trigger on_deposit_confirm
  before update on public.deposit_requests
  for each row execute procedure public.handle_deposit_confirm();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'deposit_requests') then
    alter publication supabase_realtime add table public.deposit_requests;
  end if;
end $$;

create or replace function public.get_recommended_posts(p_user uuid, p_limit int default 10)
returns table (
  id uuid,
  user_id uuid,
  title text,
  content text,
  type text,
  stock_id text,
  like_count integer,
  created_at timestamp with time zone,
  score numeric
)
language sql
security invoker
as $$
  with base as (
    select
      p.id,
      p.user_id,
      p.title,
      p.content,
      p.type,
      p.stock_id,
      p.like_count,
      p.created_at,
      (least(coalesce(p.like_count,0),10) / 10.0)
      + greatest(0, 1 - least(1, extract(epoch from now() - p.created_at) / (7*24*3600)))
      + case when exists (
          select 1 from public.user_relationships ur 
          where ur.user_id = p_user and ur.target_id = p.user_id and ur.type = 'follow'
        ) then 0.8 else 0 end
      + 0.6 * greatest(
          coalesce((
            select max(similarity(p.title, lp.title))
            from public.posts lp
            where lp.id in (select post_id from public.post_likes where user_id = p_user)
          ), 0),
          coalesce((
            select max(similarity(p.content, lc.content))
            from public.posts lc
            where lc.id in (select post_id from public.post_likes where user_id = p_user)
          ), 0)
        )
      + 0.7 * (least(coalesce((select count(*) from public.comments c where c.post_id = p.id),0),5) / 5.0)
      as score
    from public.posts p
    where p.type = 'public'
    and not exists (
      select 1 from public.user_relationships urb
      where urb.user_id = p_user and urb.target_id = p.user_id and urb.type = 'block'
    )
    and not exists (
      select 1 from public.user_relationships urm
      where urm.user_id = p_user and urm.target_id = p.user_id and urm.type = 'mute'
    )
    and not exists (
      select 1 from public.post_feedbacks pf
      where pf.user_id = p_user and pf.post_id = p.id and pf.type = 'not_interested'
    )
  ),
  ranked as (
    select *,
      row_number() over (partition by stock_id order by score desc, created_at desc) as rn
    from base
  )
  select
    id, user_id, title, content, type, stock_id, like_count, created_at, score
  from ranked
  where rn <= 2
  order by score desc, created_at desc
  limit p_limit;
$$;

create table if not exists public.post_feedbacks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  post_id uuid references public.posts(id) on delete cascade not null,
  type text not null check (type in ('not_interested')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.post_feedbacks enable row level security;
drop policy if exists "Feedbacks insert by owner" on public.post_feedbacks;
create policy "Feedbacks insert by owner"
  on public.post_feedbacks for insert
  with check ( auth.uid() = user_id );
drop policy if exists "Feedbacks view by owner" on public.post_feedbacks;
create policy "Feedbacks view by owner"
  on public.post_feedbacks for select
  using ( auth.uid() = user_id );
create index if not exists idx_post_feedbacks_user_post on public.post_feedbacks(user_id, post_id);

create table if not exists public.journal_monthly_goals (
  user_id uuid references public.profiles(id) on delete cascade not null,
  ym text not null,
  target_profit numeric(18,2) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (user_id, ym)
);
alter table public.journal_monthly_goals enable row level security;
drop policy if exists "Goals viewable by owner" on public.journal_monthly_goals;
create policy "Goals viewable by owner"
  on journal_monthly_goals for select
  using ( auth.uid() = user_id );
drop policy if exists "Goals insert by owner" on public.journal_monthly_goals;
create policy "Goals insert by owner"
  on journal_monthly_goals for insert
  with check ( auth.uid() = user_id );
drop policy if exists "Goals update by owner" on public.journal_monthly_goals;
create policy "Goals update by owner"
  on journal_monthly_goals for update
  using ( auth.uid() = user_id );
create index if not exists idx_goals_user_ym on public.journal_monthly_goals(user_id, ym);
