/**
 * Ebook Controller – Phase 3 Placeholder
 * Full CRUD for ebooks added in Phase 3: Text Input & Basic Ebook Export.
 */
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/db';

// GET /api/ebooks – list user's ebooks
export const getEbooks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT id, title, created_at, updated_at FROM ebooks WHERE user_id = $1 ORDER BY updated_at DESC',
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
    if (result.rows.length === 0) {
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
  try {
    const result = await pool.query(
      'INSERT INTO ebooks (user_id, title, raw_text, template) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user?.userId, title, raw_text, template]
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
    const result = await pool.query(
      `UPDATE ebooks SET title = COALESCE($1, title), raw_text = COALESCE($2, raw_text),
       template = COALESCE($3, template), updated_at = NOW()
       WHERE id = $4 AND user_id = $5 RETURNING *`,
      [title, raw_text, template, req.params.id, req.user?.userId]
    );
    if (result.rows.length === 0) {
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
    await pool.query('DELETE FROM ebooks WHERE id = $1 AND user_id = $2', [req.params.id, req.user?.userId]);
    res.json({ message: 'Ebook deleted' });
  } catch (err) {
    console.error('deleteEbook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
