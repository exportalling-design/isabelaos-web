-- IsabelaOS TikTok Live Avatar v2 — new columns + live-avatars bucket
-- Run in Supabase SQL Editor

ALTER TABLE tiktok_live_sessions
  ADD COLUMN IF NOT EXISTS face_image_url      text,
  ADD COLUMN IF NOT EXISTS body_image_url      text,
  ADD COLUMN IF NOT EXISTS video_idle_url      text,
  ADD COLUMN IF NOT EXISTS video_talking_url   text,
  ADD COLUMN IF NOT EXISTS video_dancing_url   text,
  ADD COLUMN IF NOT EXISTS video_lipsync_url   text,
  ADD COLUMN IF NOT EXISTS behaviors           jsonb,
  ADD COLUMN IF NOT EXISTS product_link        text,
  ADD COLUMN IF NOT EXISTS language            text,
  ADD COLUMN IF NOT EXISTS generation_status   text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS generation_task_ids jsonb;

-- Allow "pending" status in addition to existing active/stopped
ALTER TABLE tiktok_live_sessions
  DROP CONSTRAINT IF EXISTS tiktok_live_sessions_status_check;
ALTER TABLE tiktok_live_sessions
  ADD CONSTRAINT tiktok_live_sessions_status_check
    CHECK (status IN ('pending', 'active', 'stopped'));

-- Allow "state" event_type for worker → overlay state signals
ALTER TABLE tiktok_live_events
  DROP CONSTRAINT IF EXISTS tiktok_live_events_event_type_check;
ALTER TABLE tiktok_live_events
  ADD CONSTRAINT tiktok_live_events_event_type_check
    CHECK (event_type IN ('comment', 'gift', 'follow', 'response', 'state'));

-- Storage bucket for generated avatar videos
INSERT INTO storage.buckets (id, name, public)
VALUES ('live-avatars', 'live-avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Public read on live-avatars
CREATE POLICY IF NOT EXISTS "public read live-avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'live-avatars');

-- Service role insert
CREATE POLICY IF NOT EXISTS "service insert live-avatars"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'live-avatars');

-- Service role update (upsert)
CREATE POLICY IF NOT EXISTS "service update live-avatars"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'live-avatars');
