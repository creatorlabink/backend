-- Phase 5: analytics events for MVP launch readiness

CREATE TABLE IF NOT EXISTS analytics_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name  VARCHAR(80) NOT NULL,
  user_id     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ebook_id    UUID NULL REFERENCES ebooks(id) ON DELETE SET NULL,
  template    VARCHAR(100),
  ai_applied  BOOLEAN,
  source      VARCHAR(120),
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at DESC);
