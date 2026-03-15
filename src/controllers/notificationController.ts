import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { sendTestEmail } from '../utils/emailUtils';

export const sendTestNotificationEmail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const to = (req.body?.to as string | undefined)?.trim() || user.email;

    if (!to) {
      res.status(400).json({ error: 'Recipient email is required.' });
      return;
    }

    await sendTestEmail({
      to,
      initiatedBy: user.email,
    });

    res.json({ success: true, to });
  } catch (err) {
    console.error('sendTestNotificationEmail error:', err);
    res.status(500).json({ error: 'Failed to send test email.' });
  }
};
