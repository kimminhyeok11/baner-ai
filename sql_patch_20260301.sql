do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'posts'
      and column_name = 'guest_device_id'
  ) then
    alter table public.posts add column guest_device_id text;
  end if;
end $$;

drop function if exists public.can_insert_post(uuid, text);
create or replace function public.can_insert_post(p_user_id uuid, p_guest_device_id text)
returns boolean as $$
declare
  last_ts timestamp with time zone;
  cnt integer;
begin
  if p_user_id is not null then
    select max(created_at) into last_ts
    from public.posts
    where user_id = p_user_id;
    if last_ts is not null and now() - last_ts < interval '15 seconds' then
      return false;
    end if;
    return true;
  end if;
  if p_guest_device_id is null then
    return false;
  end if;
  select max(created_at) into last_ts
  from public.posts
  where user_id is null
    and guest_device_id = p_guest_device_id;
  if last_ts is not null and now() - last_ts < interval '30 seconds' then
    return false;
  end if;
  select count(*) into cnt
  from public.posts
  where user_id is null
    and guest_device_id = p_guest_device_id
    and created_at::date = timezone('utc', now())::date;
  return cnt < 3;
end;
$$ language plpgsql stable set search_path = '';

create or replace function public.can_insert_comment(p_user_id uuid, p_guest_device_id text)
returns boolean as $$
declare
  last_ts timestamp with time zone;
  cnt integer;
begin
  if p_user_id is not null then
    select max(created_at) into last_ts
    from public.comments
    where user_id = p_user_id;
    if last_ts is not null and now() - last_ts < interval '10 seconds' then
      return false;
    end if;
    return true;
  end if;
  if p_guest_device_id is null then
    return false;
  end if;
  select max(created_at) into last_ts
  from public.comments
  where user_id is null
    and guest_device_id = p_guest_device_id;
  if last_ts is not null and now() - last_ts < interval '20 seconds' then
    return false;
  end if;
  select count(*) into cnt
  from public.comments
  where user_id is null
    and guest_device_id = p_guest_device_id
    and created_at::date = timezone('utc', now())::date;
  return cnt < 10;
end;
$$ language plpgsql stable set search_path = '';

drop policy if exists "Posts are viewable by everyone" on public.posts;
create policy "Posts are viewable by everyone"
  on posts for select
  using (
    auth.uid() is null
    or user_id is null
    or not exists (
      select 1 from public.user_relationships ur
      where ur.user_id = auth.uid()
        and ur.target_id = posts.user_id
        and ur.type in ('block','mute')
    )
  );

drop policy if exists "Users can insert posts" on public.posts;
create policy "Users can insert posts"
  on posts for insert
  with check ( public.can_insert_post(user_id, guest_device_id) );

create index if not exists idx_posts_fts on public.posts using gin (
  to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,''))
);

create or replace function public.search_posts_fts(
  p_query text,
  p_type text default null,
  p_stock_id text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  user_id uuid,
  guest_nickname text,
  title text,
  content text,
  type text,
  stock_id text,
  mugong_id text,
  view_count int,
  like_count int,
  created_at timestamptz,
  category text,
  nickname text
)
language sql
stable
set search_path = ''
as $$
  select
    p.id,
    p.user_id,
    p.guest_nickname,
    p.title,
    p.content,
    p.type,
    p.stock_id,
    p.mugong_id,
    p.view_count,
    p.like_count,
    p.created_at,
    p.category,
    pr.nickname
  from public.posts p
  left join public.profiles pr on pr.id = p.user_id
  where (p_type is null or p.type = p_type)
    and (p_stock_id is null or p.stock_id = p_stock_id)
    and to_tsvector('simple', coalesce(p.title,'') || ' ' || coalesce(p.content,'')) @@ websearch_to_tsquery('simple', p_query)
  order by
    ts_rank(to_tsvector('simple', coalesce(p.title,'') || ' ' || coalesce(p.content,'')), websearch_to_tsquery('simple', p_query)) desc nulls last,
    p.created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.search_posts_fts(text, text, text, int, int) to anon, authenticated;

create or replace function public.is_clean_text(p_text text)
returns boolean as $$
declare
  v text;
  w text;
  bad_words text[] := array['시발','씨발','ㅅㅂ','병신','좆','섹스','카지노','토토','도박','먹튀','야동','보지','자지'];
begin
  if p_text is null then
    return true;
  end if;
  v := lower(p_text);
  foreach w in array bad_words loop
    if v like '%' || w || '%' then
      return false;
    end if;
  end loop;
  return true;
end;
$$ language plpgsql stable set search_path = '';

drop policy if exists "Users can insert posts" on public.posts;
create policy "Users can insert posts"
  on posts for insert
  with check ( public.can_insert_post(user_id, guest_device_id) and public.is_clean_text(title) and public.is_clean_text(content) );

drop policy if exists "Users can update own posts" on public.posts;
create policy "Users can update own posts"
  on posts for update
  using ( auth.uid() = user_id )
  with check ( public.is_clean_text(title) and public.is_clean_text(content) );

drop policy if exists "Users can insert comments" on public.comments;
create policy "Users can insert comments"
  on comments for insert
  with check ( public.can_insert_comment(user_id, guest_device_id) and public.is_clean_text(content) );

create table if not exists public.rate_limit_logs (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete set null,
  guest_device_id text,
  action text not null,
  reason text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.rate_limit_logs enable row level security;
drop policy if exists "Admins can view rate limits" on public.rate_limit_logs;
create policy "Admins can view rate limits"
  on rate_limit_logs for select
  using ( auth.uid() in (select id from public.profiles where role = 'admin') );
drop policy if exists "Anyone can log rate limits" on public.rate_limit_logs;
create policy "Anyone can log rate limits"
  on rate_limit_logs for insert
  with check ( true );
create index if not exists idx_rate_limit_logs_created on public.rate_limit_logs(created_at desc);
create index if not exists idx_rate_limit_logs_action on public.rate_limit_logs(action, created_at desc);

drop function if exists public.log_rate_limit(text, text, uuid, text);
create or replace function public.log_rate_limit(p_action text, p_reason text, p_user_id uuid, p_guest_device_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.rate_limit_logs (user_id, guest_device_id, action, reason)
  values (p_user_id, p_guest_device_id, coalesce(p_action, 'unknown'), p_reason);
end;
$$;
grant execute on function public.log_rate_limit(text, text, uuid, text) to anon, authenticated;
