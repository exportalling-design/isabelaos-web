-- IsabelaOS TikTok Live Avatar v3 — youtube_url column
-- Run in Supabase SQL Editor

ALTER TABLE tiktok_live_sessions
  ADD COLUMN IF NOT EXISTS youtube_url text;
