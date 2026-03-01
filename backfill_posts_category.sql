-- Backfill posts.category from title prefixes

create or replace function public.backfill_post_categories()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.posts
  set category = 'notice'
  where category is null and (title ilike '[공지]%' or title ilike '공지:%' or title ilike '공지 %');

  update public.posts
  set category = 'question'
  where category is null and (title ilike '[질문]%' or title ilike '질문:%' or title ilike '질문 %' or title ilike '%?');

  update public.posts
  set category = 'analysis'
  where category is null and (title ilike '[분석]%' or title ilike '분석:%' or title ilike '분석 %');
end;
$$;

grant execute on function public.backfill_post_categories() to authenticated;
