/**
 * Ebook Controller – Phase 4
 * Full CRUD with template + AI formatting metadata.
 */
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/db';
import { parseText, toFormattedJson } from '../utils/textParser';
import { formatTextWithAI } from '../utils/aiUtils';
import { trackEvent } from '../utils/analyticsUtils';

function buildFormattedJson(parsed: ReturnType<typeof parseText>, aiApplied: boolean, aiSource: string): string {
  return JSON.stringify({
    ...toFormattedJson(parsed),
    ai_applied: aiApplied,
    ai_source: aiSource,
  });
}

// GET /api/ebooks – list user's ebooks
export const getEbooks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id, title, template, status, created_at, updated_at,
              COALESCE((formatted_json->>'ai_applied')::boolean, false) AS ai_applied,
              COALESCE((formatted_json->>'ai_source'), 'manual') AS ai_source
       FROM ebooks WHERE user_id = $1 ORDER BY updated_at DESC`,
      [req.user?.userId]
    );
    res.json({ ebooks: result.rows });
  } catch (err) {
    console.error('getEbooks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/ebooks/:id – get specific ebook
export const getEbook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT *,
              COALESCE((formatted_json->>'ai_applied')::boolean, false) AS ai_applied,
              COALESCE((formatted_json->>'ai_source'), 'manual') AS ai_source
       FROM ebooks WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user?.userId]
    );
    if (!result.rows.length) {
      res.status(404).json({ error: 'Ebook not found' });
      return;
    }
    res.json({ ebook: result.rows[0] });
  } catch (err) {
    console.error('getEbook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// POST /api/ebooks – create ebook
export const createEbook = async (req: AuthRequest, res: Response): Promise<void> => {
  const { title, raw_text, template = 'minimal', apply_ai = false } = req.body;

  if (!title?.trim()) {
    res.status(400).json({ error: 'Title is required' });
    return;
  }
  if (!raw_text?.trim()) {
    res.status(400).json({ error: 'Content is required' });
    return;
  }

  try {
    const parsed = apply_ai
      ? (await formatTextWithAI(raw_text.trim(), title.trim())).parsed
      : parseText(raw_text.trim(), title.trim());

    const aiSource = apply_ai ? 'openai_or_heuristic' : 'manual';
    const formatted_json = buildFormattedJson(parsed, Boolean(apply_ai), aiSource);

    const result = await pool.query(
      `INSERT INTO ebooks (user_id, title, raw_text, formatted_json, template)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user?.userId, title.trim(), raw_text.trim(), formatted_json, template]
    );
    const ebook = result.rows[0];

    await trackEvent('ebook_created', {
      userId: req.user?.userId,
      ebookId: ebook.id,
      template,
      aiApplied: Boolean(apply_ai),
      source: 'ebook_create',
    });

    await trackEvent('template_selected', {
      userId: req.user?.userId,
      ebookId: ebook.id,
      template,
      aiApplied: Boolean(apply_ai),
      source: 'ebook_create',
    });

    if (apply_ai) {
      await trackEvent('ai_format_applied', {
        userId: req.user?.userId,
        ebookId: ebook.id,
        template,
        aiApplied: true,
        source: 'ebook_create',
      });
    }

    res.status(201).json({
      ebook: {
        ...ebook,
        ai_applied: Boolean(apply_ai),
        ai_source: aiSource,
      },
    });
  } catch (err) {
    console.error('createEbook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// PUT /api/ebooks/:id – update ebook
export const updateEbook = async (req: AuthRequest, res: Response): Promise<void> => {
  const { title, raw_text, template, apply_ai = false } = req.body;

  try {
    // Re-parse if raw_text is being updated
    let formattedJson: string | null = null;
    if (raw_text?.trim()) {
      const parsed = apply_ai
        ? (await formatTextWithAI(raw_text.trim(), title ?? '')).parsed
        : parseText(raw_text.trim(), title ?? '');
      const aiSource = apply_ai ? 'openai_or_heuristic' : 'manual';
      formattedJson = buildFormattedJson(parsed, Boolean(apply_ai), aiSource);
    }

    const result = await pool.query(
      `UPDATE ebooks
       SET title          = COALESCE($1, title),
           raw_text       = COALESCE($2, raw_text),
           formatted_json = COALESCE($3::jsonb, formatted_json),
           template       = COALESCE($4, template),
           updated_at     = NOW()
       WHERE id = $5 AND user_id = $6 RETURNING *`,
      [title ?? null, raw_text ?? null, formattedJson, template ?? null, req.params.id, req.user?.userId]
    );
    if (!result.rows.length) {
      res.status(404).json({ error: 'Ebook not found' });
      return;
    }
    const ebook = result.rows[0];

    await trackEvent('ebook_updated', {
      userId: req.user?.userId,
      ebookId: ebook.id,
      template: ebook.template,
      aiApplied: Boolean(apply_ai),
      source: 'ebook_update',
    });

    await trackEvent('template_selected', {
      userId: req.user?.userId,
      ebookId: ebook.id,
      template: ebook.template,
      aiApplied: Boolean(apply_ai),
      source: 'ebook_update',
    });

    if (apply_ai) {
      await trackEvent('ai_format_applied', {
        userId: req.user?.userId,
        ebookId: ebook.id,
        template: ebook.template,
        aiApplied: true,
        source: 'ebook_update',
      });
    }

    res.json({
      ebook: {
        ...ebook,
        ai_applied: formattedJson ? Boolean(apply_ai) : ebook.ai_applied ?? false,
        ai_source: formattedJson ? (apply_ai ? 'openai_or_heuristic' : 'manual') : ebook.ai_source ?? 'manual',
      },
    });
  } catch (err) {
    console.error('updateEbook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// DELETE /api/ebooks/:id – delete ebook
export const deleteEbook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      'DELETE FROM ebooks WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user?.userId]
    );
    if (!result.rows.length) {
      res.status(404).json({ error: 'Ebook not found' });
      return;
    }
    res.json({ message: 'Ebook deleted' });
  } catch (err) {
    console.error('deleteEbook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
