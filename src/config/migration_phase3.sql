-- Phase 3 migration: add unique constraint on stripe_session_id
-- Run this on your existing database after applying schema.sql

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;

-- Prevent duplicate webhook events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_stripe_session_id_key'
  ) THEN
    ALTER TABLE payments ADD CONSTRAINT payments_stripe_session_id_key UNIQUE (stripe_session_id);
  END IF;
END $$;
