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
