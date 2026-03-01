-- Posts category and ranking RPCs

alter table if exists public.posts
  add column if not exists category text check (category in ('notice','question','analysis'));

create index if not exists idx_posts_category on public.posts(category);
create index if not exists idx_posts_like_recent on public.posts(type, created_at desc, like_count);
create index if not exists idx_posts_views_recent on public.posts(type, created_at desc, view_count);

create or replace function public.get_top_posts(p_hours int default 24, p_type text default 'stock', p_limit int default 20)
returns table (id uuid, title text, stock_id text, like_count int, view_count int, created_at timestamptz, category text)
language sql
stable
set search_path = ''
as $$
  with base as (
    select id, title, stock_id, like_count, view_count, created_at, category
    from public.posts
    where type = p_type
      and created_at >= now() - make_interval(hours => p_hours)
  ),
  scored as (
    select *,
      ln(1 + coalesce(like_count,0)) * 2
      + ln(1 + coalesce(view_count,0)) as score
    from base
  )
  select id, title, stock_id, like_count, view_count, created_at, category
  from scored
  order by score desc, created_at desc
  limit p_limit;
$$;

grant execute on function public.get_top_posts(int, text, int) to anon, authenticated;
