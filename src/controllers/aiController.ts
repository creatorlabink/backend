import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { formatTextWithAI } from '../utils/aiUtils';

// POST /api/ai/format
export const formatEbookText = async (req: AuthRequest, res: Response): Promise<void> => {
  const { raw_text, title } = req.body as { raw_text?: string; title?: string };

  if (!raw_text?.trim()) {
    res.status(400).json({ error: 'Content is required' });
    return;
  }

  try {
    const result = await formatTextWithAI(raw_text.trim(), (title || 'Untitled Ebook').trim());
    res.json({
      parsed: result.parsed,
      formatted_text: result.formattedText,
      ai_applied: result.aiApplied,
      ai_source: result.source,
    });
  } catch (err) {
    console.error('formatEbookText error:', err);
    res.status(500).json({ error: 'AI formatting failed' });
  }
};
