import pool from '../config/db';

export type AnalyticsEventName =
  | 'signup'
  | 'login'
  | 'password_reset'
  | 'cta_click'
  | 'ebook_created'
  | 'ebook_updated'
  | 'pdf_download'
  | 'template_selected'
  | 'ai_format_applied';

export async function trackEvent(
  eventName: AnalyticsEventName,
  options: {
    userId?: string | null;
    ebookId?: string | null;
    template?: string | null;
    aiApplied?: boolean | null;
    source?: string | null;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO analytics_events (event_name, user_id, ebook_id, template, ai_applied, source, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        eventName,
        options.userId ?? null,
        options.ebookId ?? null,
        options.template ?? null,
        options.aiApplied ?? null,
        options.source ?? null,
        options.metadata ? JSON.stringify(options.metadata) : null,
      ]
    );
  } catch {
    // Non-blocking analytics for MVP readiness
  }
}
