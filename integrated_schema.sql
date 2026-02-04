-- 통합된 데이터베이스 스키마 (Integrated Database Schema)
-- 기존의 migration_full.sql, migration_messages.sql, fix_relationships.sql을 통합하고 최적화했습니다.

-- 1. Profiles Table (User Profiles)
-- auth.users와 1:1 관계를 가집니다.
create table public.profiles (
  id uuid references auth.users not null primary key,
  nickname text,
  role text default 'user', -- 'user' or 'admin' (운영 관리를 위해 추가)
  post_count int default 0,
  comment_count int default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.profiles enable row level security;

create policy "Public profiles are viewable by everyone"
  on profiles for select
  using ( true );

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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- 2. Stock Tags Table (For Stock Board)
create table public.stock_tags (
  id uuid default gen_random_uuid() primary key,
  name text unique not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.stock_tags enable row level security;

create policy "Stock tags are viewable by everyone"
  on stock_tags for select
  using ( true );

create policy "Authenticated users can insert stock tags"
  on stock_tags for insert
  with check ( auth.role() = 'authenticated' );


-- 3. Posts Table
-- profiles 테이블을 참조하도록 수정됨 (JOIN 최적화)
create table public.posts (
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

create policy "Posts are viewable by everyone"
  on posts for select
  using ( true );

create policy "Users can insert posts"
  on posts for insert
  with check ( true ); 

create policy "Users can update own posts"
  on posts for update
  using ( auth.uid() = user_id );

create policy "Users can delete own posts"
  on posts for delete
  using ( auth.uid() = user_id );


-- 4. Comments Table
create table public.comments (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references public.posts on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade, -- profiles 참조
  guest_nickname text,
  content text not null,
  parent_id uuid references public.comments, -- For nested comments
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.comments enable row level security;

create policy "Comments are viewable by everyone"
  on comments for select
  using ( true );

create policy "Users can insert comments"
  on comments for insert
  with check ( true );


-- 5. Chat Messages Table
create table public.chat_messages (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade, -- profiles 참조
  guest_nickname text,
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.chat_messages enable row level security;

create policy "Chat is viewable by everyone"
  on chat_messages for select
  using ( true );

create policy "Everyone can insert chat"
  on chat_messages for insert
  with check ( true );


-- 6. Messages Table (Direct Messages / Note)
create table public.messages (
  id uuid default gen_random_uuid() primary key,
  sender_id uuid references public.profiles(id) on delete cascade not null, -- profiles 참조
  receiver_id uuid references public.profiles(id) on delete cascade not null, -- profiles 참조
  content text not null,
  is_read boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.messages enable row level security;

create policy "Users can view their own messages"
  on messages for select
  using ( auth.uid() = sender_id or auth.uid() = receiver_id );

create policy "Users can send messages"
  on messages for insert
  with check ( auth.uid() = sender_id );

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
create policy "Public Access"
  on storage.objects for select
  using ( bucket_id = 'images' );

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

drop policy if exists "Admins can delete any comment" on public.comments;
create policy "Admins can delete any comment"
  on public.comments for delete
  using ( auth.uid() in (select id from public.profiles where role = 'admin') );

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
  with check ( auth.role() = 'authenticated' OR user_id is null );
create policy "Users can update own predictions"
  on public.predictions for update
  using ( auth.uid() = user_id );
create policy "Users can delete own predictions"
  on public.predictions for delete
  using ( auth.uid() = user_id );
create index if not exists idx_predictions_created on public.predictions(created_at);
create index if not exists idx_predictions_stock_dir on public.predictions(stock_id, direction);
