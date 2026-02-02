-- Migration V2: 기능 확장 (좋아요, 신고, 알림, 관리자)
-- 이 파일은 기존 스키마 위에 새로운 기능을 추가합니다.

-- 0. 기존 Profiles 테이블에 role 컬럼 확인 및 추가 (없을 경우)
-- 정책 생성 시 role 컬럼이 필요하므로 가장 먼저 실행합니다.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'role') then
    alter table public.profiles add column role text default 'user';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'is_banned') then
    alter table public.profiles add column is_banned boolean default false;
  end if;
end $$;

-- 1. 좋아요 시스템 (DB 기반)
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

-- 정책: 기존 정책이 있으면 오류가 발생할 수 있으므로 drop 후 create
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

-- 좋아요 카운트 자동 업데이트 트리거
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


-- 2. 신고 시스템
create table if not exists public.reports (
  id uuid default gen_random_uuid() primary key,
  reporter_id uuid references public.profiles(id),
  target_type text not null, -- 'post', 'comment', 'message'
  target_id uuid not null,
  reason text not null,
  status text default 'pending', -- 'pending', 'resolved', 'dismissed'
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


-- 3. 알림 시스템
create table if not exists public.notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  type text not null, -- 'comment', 'like', 'message'
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

-- 알림 트리거 (댓글 작성 시 게시글 작성자에게 알림)
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
  
-- 관리자 권한: 프로필 업데이트, 글/댓글 삭제
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

-- 4. Realtime 설정 추가
-- 기존에 추가되어 있을 수 있으므로 오류 방지
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

-- 5. 사용자 관계 (팔로우/뮤트/차단)
create table if not exists public.user_relationships (
  user_id uuid references public.profiles(id) on delete cascade,
  target_id uuid references public.profiles(id) on delete cascade,
  type text not null, -- 'follow', 'mute', 'block'
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
