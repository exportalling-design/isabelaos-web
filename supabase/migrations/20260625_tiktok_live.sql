-- IsabelaOS TikTok Live Avatar — Supabase migration
-- Run in Supabase SQL Editor or via `supabase db push`

-- Sessions
create table if not exists tiktok_live_sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users on delete cascade,
  tiktok_username     text not null,
  avatar_url          text,
  avatar_type         text check (avatar_type in ('video', 'png')) default 'video',
  avatar_idle_url     text,
  avatar_talking_url  text,
  avatar_reaction_url text,
  voice_id            text not null,
  persona_prompt      text not null,
  status              text check (status in ('active', 'stopped')) default 'active',
  created_at          timestamptz default now()
);

alter table tiktok_live_sessions enable row level security;
create policy "users own sessions"
  on tiktok_live_sessions for all
  using (auth.uid() = user_id);

-- Events (written by worker, read by SSE endpoint + overlay)
create table if not exists tiktok_live_events (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid references tiktok_live_sessions(id) on delete cascade,
  event_type    text check (event_type in ('comment','gift','follow','response')),
  username      text not null,
  message       text,
  audio_url     text,
  response_text text,
  priority      integer default 3,
  created_at    timestamptz default now()
);

create index if not exists tiktok_live_events_session_ts
  on tiktok_live_events (session_id, created_at desc);

-- Service role can insert/select events (worker uses service key)
alter table tiktok_live_events enable row level security;
create policy "service role full access events"
  on tiktok_live_events for all
  using (true)
  with check (true);

-- Storage bucket for live audio
insert into storage.buckets (id, name, public)
values ('live-audio', 'live-audio', true)
on conflict (id) do nothing;

-- Allow public reads on live-audio
create policy "public read live-audio"
  on storage.objects for select
  using (bucket_id = 'live-audio');

-- Allow service role to insert
create policy "service insert live-audio"
  on storage.objects for insert
  with check (bucket_id = 'live-audio');
