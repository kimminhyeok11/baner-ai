-- 1. Profiles Table (User Profiles)
create table public.profiles (
  id uuid references auth.users not null primary key,
  nickname text,
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
create table public.posts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users,
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
  with check ( true ); -- Allow anon posts (logic handled in app)

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
  user_id uuid references auth.users,
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
  user_id uuid references auth.users,
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
  sender_id uuid references auth.users not null,
  receiver_id uuid references auth.users not null,
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


-- 7. Storage Policies (Bucket must be created manually in dashboard named 'images')
-- Note: These policies assume the 'images' bucket exists. Run these in SQL Editor.

-- Enable storage RLS if not already enabled (this command might vary based on Supabase version, usually done via dashboard settings, but policies can be added)
-- create policy "Public Access" on storage.objects for select using ( bucket_id = 'images' );
-- create policy "Authenticated Upload" on storage.objects for insert with check ( bucket_id = 'images' and auth.role() = 'authenticated' );

-- Since storage policies are specific to the storage schema, here is the standard way to add them via SQL if extensions are enabled:
-- Policy for public read access to 'images' bucket
create policy "Public Access"
on storage.objects for select
using ( bucket_id = 'images' );

-- Policy for authenticated users to upload to 'images' bucket
create policy "Authenticated Upload"
on storage.objects for insert
with check ( bucket_id = 'images' and auth.role() = 'authenticated' );
