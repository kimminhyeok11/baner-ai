-- Stocks master + hot rooms RPC for Supabase
-- Schema: public

-- 1) Stocks master
create table if not exists public.stocks (
  code text primary key,
  name text not null,
  market text not null default 'KOSPI',
  keywords text,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_stocks_name on public.stocks using btree (upper(name));
create index if not exists idx_stocks_market on public.stocks(market);

-- Full-text search support (optional but recommended)
create extension if not exists pg_trgm;
create index if not exists idx_stocks_name_trgm on public.stocks using gin (name gin_trgm_ops);
create index if not exists idx_stocks_keywords_trgm on public.stocks using gin (coalesce(keywords,'') gin_trgm_ops);

-- 2) Optimize posts lookup for stock rooms
-- Assumes 'posts' table exists with columns: type text, stock_id text, created_at timestamptz
create index if not exists idx_posts_stock_recent on public.posts(type, stock_id, created_at desc);

-- 3) Hot rooms RPC: count recent posts by stock_id
create or replace function public.get_hot_stock_rooms(p_hours int default 24, p_limit int default 12)
returns table (stock_id text, post_count bigint)
language sql
stable
set search_path = ''
as $$
  select stock_id, count(*) as post_count
  from public.posts
  where type = 'stock'
    and created_at >= now() - make_interval(hours => p_hours)
    and stock_id is not null
  group by stock_id
  order by count(*) desc
  limit p_limit;
$$;

grant execute on function public.get_hot_stock_rooms(int, int) to anon, authenticated;

-- 4) Optional: simple search RPC (name/code/keywords)
create or replace function public.search_stocks(p_query text, p_limit int default 10)
returns table (code text, name text, market text, score real)
language sql
stable
set search_path = ''
as $$
  with q as (
    select trim(p_query) as q
  )
  select s.code, s.name, s.market,
         greatest(
           similarity(s.name, (select q from q)),
           similarity(coalesce(s.keywords,''), (select q from q)),
           case when s.code ilike (select q from q) then 1.0 else 0.0 end
         ) as score
  from public.stocks s
  where s.is_active
    and (
      s.name ilike '%' || (select q from q) || '%' or
      s.code ilike '%' || (select q from q) || '%' or
      coalesce(s.keywords,'') ilike '%' || (select q from q) || '%'
    )
  order by score desc, s.market, s.name
  limit p_limit;
$$;

grant execute on function public.search_stocks(text, int) to anon, authenticated;

-- 5) Seed example (remove in production)
-- insert into public.stocks(code, name, market, keywords) values
-- ('005930','삼성전자','KOSPI','반도체 메모리 파운드리'),
-- ('000660','SK하이닉스','KOSPI','반도체 HBM'),
-- ('035420','NAVER','KOSPI','포털 AI'),
-- ('035720','카카오','KOSPI','플랫폼 메신저');
