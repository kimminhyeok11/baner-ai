
-- Fix impersonation vulnerabilities in RLS policies

-- 1. Posts: Ensure user_id matches auth.uid() or is null (guest)
drop policy if exists "Users can insert posts" on public.posts;
create policy "Users can insert posts"
  on posts for insert
  with check (
    (user_id is null or user_id = auth.uid())
  );

-- 2. Comments: Ensure user_id matches auth.uid() or is null (guest)
-- Also keep the rate limit check
drop policy if exists "Users can insert comments" on public.comments;
create policy "Users can insert comments"
  on comments for insert
  with check (
    (user_id is null or user_id = auth.uid())
    and public.can_insert_comment(user_id, guest_device_id)
  );

-- 3. Chat Messages: Ensure user_id matches auth.uid() or is null (guest)
drop policy if exists "Everyone can insert chat" on public.chat_messages;
create policy "Everyone can insert chat"
  on chat_messages for insert
  with check (
    (user_id is null or user_id = auth.uid())
  );

-- 4. Reports: Ensure reporter_id matches auth.uid()
drop policy if exists "Users can create reports" on public.reports;
create policy "Users can create reports"
  on reports for insert
  with check (
    auth.role() = 'authenticated' and reporter_id = auth.uid()
  );

-- 5. Predictions: Ensure user_id matches auth.uid()
drop policy if exists "Users can insert predictions" on public.predictions;
create policy "Users can insert predictions"
  on predictions for insert
  with check (
    auth.role() = 'authenticated' and user_id = auth.uid()
  );
