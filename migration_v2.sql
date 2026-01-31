-- Migration V2: 기능 확장 (좋아요, 신고, 알림, 관리자)
-- 이 파일은 기존 스키마 위에 새로운 기능을 추가합니다.

-- 0. 기존 Profiles 테이블에 role 컬럼 확인 및 추가 (없을 경우)
-- 정책 생성 시 role 컬럼이 필요하므로 가장 먼저 실행합니다.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'role') then
    alter table public.profiles add column role text default 'user';
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

-- 알림 트리거 (댓글 작성 시 게시글 작성자에게 알림)
create or replace function public.handle_new_comment()
returns trigger as $$
declare
  post_author_id uuid;
  post_title text;
begin
  select user_id, title into post_author_id, post_title from public.posts where id = new.post_id;
  
  if post_author_id is not null and post_author_id != new.user_id then
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
end $$;
