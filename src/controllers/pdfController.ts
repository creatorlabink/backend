/**
 * PDF Controller – Phase 3
 * Exports a user's ebook as a formatted PDF.
 * Only lifetime/annual plan users can export; free users are redirected to pay.
 */
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/db';
import { generatePdfFromParsed } from '../utils/pdfUtils';
import { parseText } from '../utils/textParser';
import { trackEvent } from '../utils/analyticsUtils';

// POST /api/pdf/export/:ebookId
export const exportPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    // ── Payment gate ──────────────────────────────────────────────────────────
    const userRow = await pool.query('SELECT plan, name FROM users WHERE id = $1', [userId]);
    if (!userRow.rows.length) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    const { plan, name } = userRow.rows[0];
    if (plan === 'free') {
      res.status(402).json({
        error: 'payment_required',
        message: 'Upgrade to lifetime access to export PDFs.',
      });
      return;
    }

    // ── Fetch ebook ───────────────────────────────────────────────────────────
    const result = await pool.query(
      'SELECT * FROM ebooks WHERE id = $1 AND user_id = $2',
      [req.params.ebookId, userId]
    );
    if (!result.rows.length) {
      res.status(404).json({ error: 'Ebook not found' });
      return;
    }
    const ebook = result.rows[0];

    // ── Parse & generate ──────────────────────────────────────────────────────
    // Prefer pre-stored formatted_json (Phase 4 AI output), fall back to parser
    let parsed;
    if (ebook.formatted_json && ebook.formatted_json.sections) {
      parsed = { title: ebook.title, ...ebook.formatted_json };
    } else {
      parsed = parseText(ebook.raw_text || '', ebook.title);
      parsed.title = ebook.title;
    }

    const aiApplied = Boolean(ebook.formatted_json?.ai_applied);
    await trackEvent('pdf_download', {
      userId,
      ebookId: ebook.id,
      template: ebook.template ?? 'minimal',
      aiApplied,
      source: 'pdf_export',
    });
    generatePdfFromParsed(parsed, name ?? '', res, ebook.template ?? 'minimal', aiApplied);
  } catch (err) {
    console.error('exportPdf error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
};

// POST /api/pdf/preview/:ebookId – returns parsed JSON for frontend preview
export const previewEbook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT * FROM ebooks WHERE id = $1 AND user_id = $2',
      [req.params.ebookId, req.user?.userId]
    );
    if (!result.rows.length) {
      res.status(404).json({ error: 'Ebook not found' });
      return;
    }
    const ebook = result.rows[0];
    const parsed = ebook.formatted_json?.sections
      ? { title: ebook.title, ...ebook.formatted_json }
      : parseText(ebook.raw_text || '', ebook.title);
    parsed.title = ebook.title;
    res.json({
      parsed,
      template: ebook.template ?? 'minimal',
      ai_applied: Boolean(ebook.formatted_json?.ai_applied),
      ai_source: ebook.formatted_json?.ai_source ?? 'manual',
    });
  } catch (err) {
    console.error('previewEbook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
