-- Create messages table
create table if not exists messages (
  id uuid default gen_random_uuid() primary key,
  sender_id uuid references auth.users not null,
  receiver_id uuid references auth.users not null,
  content text not null,
  is_read boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Set up RLS (Row Level Security)
alter table messages enable row level security;

-- Policy: Users can see messages sent to them or sent by them
create policy "Users can view their own messages"
  on messages for select
  using ( auth.uid() = sender_id or auth.uid() = receiver_id );

-- Policy: Users can send messages
create policy "Users can send messages"
  on messages for insert
  with check ( auth.uid() = sender_id );

-- Policy: Users can update 'is_read' status of messages sent to them
create policy "Receivers can update read status"
  on messages for update
  using ( auth.uid() = receiver_id );
