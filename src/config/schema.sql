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

-- Integration connections (OAuth tokens for external publishing platforms)
CREATE TABLE IF NOT EXISTS integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(80) NOT NULL,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at TIMESTAMPTZ,
  oauth_state TEXT,
  account_id TEXT,
  account_username TEXT,
  scopes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- Publish job history for external integrations
CREATE TABLE IF NOT EXISTS integration_publish_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ebook_id UUID NOT NULL REFERENCES ebooks(id) ON DELETE CASCADE,
  provider VARCHAR(80) NOT NULL,
  external_import_id TEXT,
  external_product_id TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'queued',
  response_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ebooks_user_id ON ebooks(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_integration_connections_user_provider ON integration_connections(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_integration_publish_jobs_user ON integration_publish_jobs(user_id, provider, created_at DESC);
