-- CreatorLab.ink – Initial Database Schema
-- Run this once to set up the PostgreSQL database.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name        VARCHAR(255),
  plan        VARCHAR(50) DEFAULT 'free',         -- 'free' | 'lifetime' | 'annual'
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Ebooks table
CREATE TABLE IF NOT EXISTS ebooks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(500) NOT NULL DEFAULT 'Untitled Ebook',
  raw_text    TEXT,
  formatted_json JSONB,                            -- Phase 4: AI-structured content
  template    VARCHAR(100) DEFAULT 'minimal',      -- 'minimal' | 'workbook' | 'business'
  status      VARCHAR(50) DEFAULT 'draft',         -- 'draft' | 'published'
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Payments table (Phase 3 placeholder)
CREATE TABLE IF NOT EXISTS payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  stripe_session_id TEXT,
  amount        INTEGER,                            -- in cents
  currency      VARCHAR(10) DEFAULT 'usd',
  status        VARCHAR(50),                        -- 'pending' | 'completed' | 'failed'
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ebooks_user_id ON ebooks(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
