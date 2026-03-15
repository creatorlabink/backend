-- CreatorLab.ink Supabase-ready schema
-- Run this entire file in Supabase SQL Editor (single run is fine; all statements are idempotent where practical).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app;

-- ----------------------------------------------------------------------------
-- Helper functions
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  raw_user_id TEXT;
BEGIN
  raw_user_id := COALESCE(
    NULLIF(current_setting('request.jwt.claim.user_id', true), ''),
    NULLIF(current_setting('request.jwt.claim.sub', true), '')
  );

  IF raw_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN raw_user_id::UUID;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- Core tables
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name VARCHAR(255),
  plan VARCHAR(50) NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'lifetime', 'annual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  display_name VARCHAR(255),
  avatar_url TEXT,
  bio TEXT,
  website_url TEXT,
  timezone VARCHAR(80),
  locale VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ebooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL DEFAULT 'Untitled Ebook',
  raw_text TEXT,
  formatted_json JSONB,
  template VARCHAR(100) NOT NULL DEFAULT 'minimal' CHECK (template IN ('minimal', 'workbook', 'business')),
  status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_session_id TEXT,
  amount INTEGER,
  currency VARCHAR(10) NOT NULL DEFAULT 'usd',
  status VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name VARCHAR(100) NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ebook_id UUID REFERENCES public.ebooks(id) ON DELETE SET NULL,
  template VARCHAR(100),
  ai_applied BOOLEAN,
  source VARCHAR(120),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.social_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider VARCHAR(30) NOT NULL,
  provider_user_id VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_user_id),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS public.oauth_auth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(30) NOT NULL,
  state TEXT NOT NULL UNIQUE,
  intent VARCHAR(20) NOT NULL CHECK (intent IN ('login', 'signup')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider VARCHAR(80) NOT NULL,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at TIMESTAMPTZ,
  oauth_state TEXT,
  account_id TEXT,
  account_username TEXT,
  scopes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS public.integration_publish_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ebook_id UUID REFERENCES public.ebooks(id) ON DELETE CASCADE,
  provider VARCHAR(80) NOT NULL,
  external_import_id TEXT,
  external_product_id TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'queued',
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction VARCHAR(20) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  template_key VARCHAR(100),
  sender_email VARCHAR(255),
  recipient_email VARCHAR(255),
  subject TEXT,
  html_body TEXT,
  text_body TEXT,
  payload_json JSONB,
  provider_message_id TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'queued',
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin', 'support')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  actor_email VARCHAR(255),
  action VARCHAR(120) NOT NULL,
  target_table VARCHAR(120),
  target_id UUID,
  payload_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_ebooks_user_id ON public.ebooks(user_id);
CREATE INDEX IF NOT EXISTS idx_ebooks_user_updated ON public.ebooks(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_event_name ON public.analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_user_created ON public.analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oauth_states_provider ON public.oauth_auth_states(provider, expires_at);
CREATE INDEX IF NOT EXISTS idx_social_identities_user ON public.social_identities(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_integration_connections_user_provider ON public.integration_connections(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_integration_publish_jobs_user ON public.integration_publish_jobs(user_id, provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_created_at ON public.email_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_direction ON public.email_messages(direction, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_created_by ON public.email_messages(created_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON public.admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_logs_actor_created ON public.admin_audit_logs(actor_user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- Triggers
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

DROP TRIGGER IF EXISTS trg_ebooks_updated_at ON public.ebooks;
CREATE TRIGGER trg_ebooks_updated_at
BEFORE UPDATE ON public.ebooks
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

DROP TRIGGER IF EXISTS trg_social_identities_updated_at ON public.social_identities;
CREATE TRIGGER trg_social_identities_updated_at
BEFORE UPDATE ON public.social_identities
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

DROP TRIGGER IF EXISTS trg_integration_connections_updated_at ON public.integration_connections;
CREATE TRIGGER trg_integration_connections_updated_at
BEFORE UPDATE ON public.integration_connections
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

DROP TRIGGER IF EXISTS trg_integration_publish_jobs_updated_at ON public.integration_publish_jobs;
CREATE TRIGGER trg_integration_publish_jobs_updated_at
BEFORE UPDATE ON public.integration_publish_jobs
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

DROP TRIGGER IF EXISTS trg_email_messages_updated_at ON public.email_messages;
CREATE TRIGGER trg_email_messages_updated_at
BEFORE UPDATE ON public.email_messages
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON public.admin_users;
CREATE TRIGGER trg_admin_users_updated_at
BEFORE UPDATE ON public.admin_users
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Admin helper
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.is_active = TRUE
      AND (
        (app.current_user_id() IS NOT NULL AND au.user_id = app.current_user_id())
        OR (
          NULLIF(current_setting('request.jwt.claim.email', true), '') IS NOT NULL
          AND lower(au.email) = lower(current_setting('request.jwt.claim.email', true))
        )
      )
  );
$$;

-- ----------------------------------------------------------------------------
-- Row Level Security (RLS)
-- ----------------------------------------------------------------------------

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_auth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_publish_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- users
DROP POLICY IF EXISTS users_select_self ON public.users;
CREATE POLICY users_select_self ON public.users
FOR SELECT USING (id = app.current_user_id());

DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self ON public.users
FOR UPDATE USING (id = app.current_user_id())
WITH CHECK (id = app.current_user_id());

-- profiles
DROP POLICY IF EXISTS profiles_select_self ON public.profiles;
CREATE POLICY profiles_select_self ON public.profiles
FOR SELECT USING (user_id = app.current_user_id());

DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
CREATE POLICY profiles_insert_self ON public.profiles
FOR INSERT WITH CHECK (user_id = app.current_user_id());

DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
FOR UPDATE USING (user_id = app.current_user_id())
WITH CHECK (user_id = app.current_user_id());

-- ebooks
DROP POLICY IF EXISTS ebooks_owner_all ON public.ebooks;
CREATE POLICY ebooks_owner_all ON public.ebooks
FOR ALL USING (user_id = app.current_user_id())
WITH CHECK (user_id = app.current_user_id());

-- payments
DROP POLICY IF EXISTS payments_select_owner_or_admin ON public.payments;
CREATE POLICY payments_select_owner_or_admin ON public.payments
FOR SELECT USING (user_id = app.current_user_id() OR app.is_admin());

-- analytics events
DROP POLICY IF EXISTS analytics_select_owner_or_admin ON public.analytics_events;
CREATE POLICY analytics_select_owner_or_admin ON public.analytics_events
FOR SELECT USING (user_id = app.current_user_id() OR app.is_admin());

-- social identities
DROP POLICY IF EXISTS social_identities_owner_all ON public.social_identities;
CREATE POLICY social_identities_owner_all ON public.social_identities
FOR ALL USING (user_id = app.current_user_id())
WITH CHECK (user_id = app.current_user_id());

-- oauth states (backend/admin only)
DROP POLICY IF EXISTS oauth_states_admin_only ON public.oauth_auth_states;
CREATE POLICY oauth_states_admin_only ON public.oauth_auth_states
FOR ALL USING (app.is_admin())
WITH CHECK (app.is_admin());

-- integration connections
DROP POLICY IF EXISTS integration_connections_owner_all ON public.integration_connections;
CREATE POLICY integration_connections_owner_all ON public.integration_connections
FOR ALL USING (user_id = app.current_user_id())
WITH CHECK (user_id = app.current_user_id());

-- integration publish jobs
DROP POLICY IF EXISTS integration_publish_jobs_owner_all ON public.integration_publish_jobs;
CREATE POLICY integration_publish_jobs_owner_all ON public.integration_publish_jobs
FOR ALL USING (user_id = app.current_user_id())
WITH CHECK (user_id = app.current_user_id());

-- email messages
DROP POLICY IF EXISTS email_messages_admin_all ON public.email_messages;
CREATE POLICY email_messages_admin_all ON public.email_messages
FOR ALL USING (app.is_admin())
WITH CHECK (app.is_admin());

-- admin users
DROP POLICY IF EXISTS admin_users_admin_read ON public.admin_users;
CREATE POLICY admin_users_admin_read ON public.admin_users
FOR SELECT USING (app.is_admin());

DROP POLICY IF EXISTS admin_users_admin_write ON public.admin_users;
CREATE POLICY admin_users_admin_write ON public.admin_users
FOR ALL USING (app.is_admin())
WITH CHECK (app.is_admin());

-- admin audit logs
DROP POLICY IF EXISTS admin_audit_logs_admin_read ON public.admin_audit_logs;
CREATE POLICY admin_audit_logs_admin_read ON public.admin_audit_logs
FOR SELECT USING (app.is_admin());

DROP POLICY IF EXISTS admin_audit_logs_admin_write ON public.admin_audit_logs;
CREATE POLICY admin_audit_logs_admin_write ON public.admin_audit_logs
FOR INSERT WITH CHECK (app.is_admin());

-- ----------------------------------------------------------------------------
-- Supabase Storage buckets + policies
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('ebook-exports', 'ebook-exports', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('ebook-assets', 'ebook-assets', false)
ON CONFLICT (id) DO NOTHING;

-- Let authenticated users manage only their own files in these buckets.
DROP POLICY IF EXISTS "ebook objects read own" ON storage.objects;
CREATE POLICY "ebook objects read own" ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id IN ('ebook-exports', 'ebook-assets')
  AND owner = auth.uid()
);

DROP POLICY IF EXISTS "ebook objects insert own" ON storage.objects;
CREATE POLICY "ebook objects insert own" ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id IN ('ebook-exports', 'ebook-assets')
  AND owner = auth.uid()
);

DROP POLICY IF EXISTS "ebook objects update own" ON storage.objects;
CREATE POLICY "ebook objects update own" ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id IN ('ebook-exports', 'ebook-assets')
  AND owner = auth.uid()
)
WITH CHECK (
  bucket_id IN ('ebook-exports', 'ebook-assets')
  AND owner = auth.uid()
);

DROP POLICY IF EXISTS "ebook objects delete own" ON storage.objects;
CREATE POLICY "ebook objects delete own" ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id IN ('ebook-exports', 'ebook-assets')
  AND owner = auth.uid()
);

COMMIT;
