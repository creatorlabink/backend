/**
 * PDF Controller – Phase 3 Placeholder
 * Full PDF export implemented in Phase 3: Text Input & Basic Ebook Export.
 */
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/db';
import { generatePdf } from '../utils/pdfUtils';

// POST /api/pdf/export/:ebookId – export ebook as PDF
export const exportPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT * FROM ebooks WHERE id = $1 AND user_id = $2',
      [req.params.ebookId, req.user?.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Ebook not found' });
      return;
    }

    const ebook = result.rows[0];

    // TODO Phase 4: Use AI formatting before PDF generation
    // TODO Phase 4: Apply selected template styles
    generatePdf({
      title: ebook.title,
      chapters: [{ heading: 'Content', body: ebook.raw_text || '' }],
    }, res);
  } catch (err) {
    console.error('exportPdf error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
