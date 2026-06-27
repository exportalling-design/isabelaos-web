-- IsabelaOS TikTok Live Avatar v4 — individual task ID columns
-- Run in Supabase SQL Editor

ALTER TABLE tiktok_live_sessions
  ADD COLUMN IF NOT EXISTS task_idle    text,
  ADD COLUMN IF NOT EXISTS task_talking text,
  ADD COLUMN IF NOT EXISTS task_dancing text,
  ADD COLUMN IF NOT EXISTS task_lipsync text;
