import { Request, Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middleware/auth';
import { trackEvent, AnalyticsEventName } from '../utils/analyticsUtils';

export const captureEvent = async (req: Request, res: Response): Promise<void> => {
  const { event_name, user_id, ebook_id, template, ai_applied, source, metadata } = req.body as {
    event_name?: AnalyticsEventName;
    user_id?: string;
    ebook_id?: string;
    template?: string;
    ai_applied?: boolean;
    source?: string;
    metadata?: Record<string, unknown>;
  };

  if (!event_name) {
    res.status(400).json({ error: 'event_name is required' });
    return;
  }

  await trackEvent(event_name, {
    userId: user_id ?? null,
    ebookId: ebook_id ?? null,
    template: template ?? null,
    aiApplied: ai_applied ?? null,
    source: source ?? null,
    metadata,
  });

  res.json({ ok: true });
};

export const getAnalyticsSummary = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [users, ebooks, events] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM users'),
      pool.query('SELECT COUNT(*)::int AS count FROM ebooks'),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE event_name = 'pdf_download')::int AS downloads,
           COUNT(*) FILTER (WHERE event_name = 'cta_click')::int AS cta_clicks,
           COUNT(*) FILTER (WHERE event_name = 'signup')::int AS signup_events
         FROM analytics_events`
      ),
    ]);

    const templateUsage = await pool.query(
      `SELECT template, COUNT(*)::int AS count
       FROM ebooks
       GROUP BY template
       ORDER BY count DESC`
    );

    const conversion = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE event_name = 'cta_click')::float AS cta,
         COUNT(*) FILTER (WHERE event_name = 'signup')::float AS signups
       FROM analytics_events`
    );

    const cta = conversion.rows[0]?.cta ?? 0;
    const signups = conversion.rows[0]?.signups ?? 0;
    const ctaToSignupRate = cta > 0 ? Number(((signups / cta) * 100).toFixed(2)) : 0;

    res.json({
      totals: {
        signups: users.rows[0]?.count ?? 0,
        ebooks: ebooks.rows[0]?.count ?? 0,
        downloads: events.rows[0]?.downloads ?? 0,
      },
      funnel: {
        cta_clicks: events.rows[0]?.cta_clicks ?? 0,
        signup_events: events.rows[0]?.signup_events ?? 0,
        cta_to_signup_rate_percent: ctaToSignupRate,
      },
      template_usage: templateUsage.rows,
    });
  } catch (err) {
    console.error('getAnalyticsSummary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
