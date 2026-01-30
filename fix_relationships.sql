-- Fix Foreign Key Relationships for PostgREST Joins
-- Supabase API requires explicit Foreign Keys to the table being joined (profiles).
-- Previously, these tables referenced auth.users, which caused the 400 Error when trying to select profiles:user_id(...).

-- 1. Posts
alter table public.posts drop constraint if exists posts_user_id_fkey;
alter table public.posts add constraint posts_user_id_fkey 
    foreign key (user_id) references public.profiles(id) on delete cascade;

-- 2. Comments
alter table public.comments drop constraint if exists comments_user_id_fkey;
alter table public.comments add constraint comments_user_id_fkey 
    foreign key (user_id) references public.profiles(id) on delete cascade;

-- 3. Chat Messages
alter table public.chat_messages drop constraint if exists chat_messages_user_id_fkey;
alter table public.chat_messages add constraint chat_messages_user_id_fkey 
    foreign key (user_id) references public.profiles(id) on delete cascade;

-- 4. Messages (Sender and Receiver)
alter table public.messages drop constraint if exists messages_sender_id_fkey;
alter table public.messages add constraint messages_sender_id_fkey 
    foreign key (sender_id) references public.profiles(id) on delete cascade;

alter table public.messages drop constraint if exists messages_receiver_id_fkey;
alter table public.messages add constraint messages_receiver_id_fkey 
    foreign key (receiver_id) references public.profiles(id) on delete cascade;

-- Re-apply RLS policies just in case (optional, but good practice)
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.chat_messages enable row level security;
alter table public.messages enable row level security;
