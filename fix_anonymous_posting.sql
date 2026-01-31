-- 익명(암천객잔) 게시글 작성 허용을 위한 RLS 정책 수정

-- 1. posts 테이블의 user_id가 NULL을 허용하도록 설정
alter table public.posts alter column user_id drop not null;

-- 2. 기존의 INSERT 정책들을 정리 (충돌 방지)
drop policy if exists "Users can insert posts" on public.posts;
drop policy if exists "Everyone can insert posts" on public.posts;
drop policy if exists "Authenticated users can insert posts" on public.posts;

-- 3. 새로운 INSERT 정책 적용
-- 로그인한 사용자(authenticated)는 모든 글 작성 가능
-- 로그인하지 않은 사용자(anon)는 type이 'secret'(암천객잔)인 경우에만 작성 가능
create policy "Allow posting based on auth status"
  on public.posts for insert
  with check (
    auth.role() = 'authenticated' OR
    (type = 'secret')
  );

-- 4. 확인을 위한 코멘트
comment on table public.posts is 'Posts table with anonymous access allowed for secret type';
