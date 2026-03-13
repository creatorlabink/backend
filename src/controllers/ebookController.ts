/**
 * Ebook Controller – Phase 3
 * Full CRUD for ebooks. Auto-parses raw text and stores formatted_json.
 * Phase 4 will replace the parser with AI-assisted formatting.
 */
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/db';
import { parseText, toFormattedJson } from '../utils/textParser';

// GET /api/ebooks – list user's ebooks
export const getEbooks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id, title, template, status, created_at, updated_at
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
      'SELECT * FROM ebooks WHERE id = $1 AND user_id = $2',
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
  const { title, raw_text, template = 'minimal' } = req.body;

  if (!title?.trim()) {
    res.status(400).json({ error: 'Title is required' });
    return;
  }
  if (!raw_text?.trim()) {
    res.status(400).json({ error: 'Content is required' });
    return;
  }

  try {
    const parsed = parseText(raw_text.trim(), title.trim());
    const formatted_json = toFormattedJson(parsed);

    const result = await pool.query(
      `INSERT INTO ebooks (user_id, title, raw_text, formatted_json, template)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user?.userId, title.trim(), raw_text.trim(), JSON.stringify(formatted_json), template]
    );
    res.status(201).json({ ebook: result.rows[0] });
  } catch (err) {
    console.error('createEbook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// PUT /api/ebooks/:id – update ebook
export const updateEbook = async (req: AuthRequest, res: Response): Promise<void> => {
  const { title, raw_text, template } = req.body;

  try {
    // Re-parse if raw_text is being updated
    let formattedJson: string | null = null;
    if (raw_text?.trim()) {
      const parsed = parseText(raw_text.trim(), title ?? '');
      formattedJson = JSON.stringify(toFormattedJson(parsed));
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
    res.json({ ebook: result.rows[0] });
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
