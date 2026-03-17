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
  | 'ai_format_applied'
  | 'page_view'
  | 'payment_completed'
  // Feature usage events
  | 'unveil_session_started'
  | 'unveil_path_created'
  | 'unveil_path_revealed'
  | 'teleprompter_session_started'
  | 'teleprompter_script_loaded'
  | 'teleprompter_playback_started'
  | 'ebook_editor_opened';

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
